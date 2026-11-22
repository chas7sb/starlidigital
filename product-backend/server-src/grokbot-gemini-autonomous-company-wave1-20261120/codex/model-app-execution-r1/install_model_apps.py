"""Private staged combined actual model app gateway/runtime installation."""
import sys
from pathlib import Path
BASE=Path(__file__).resolve().parent.parent
def install_model_apps(app,svc,authority,*,parent_origin,authority_base_url):
    sys.path.insert(0,str(BASE/"model-app-persistence-r1"))
    sys.path.insert(0,str(BASE/"guest-build-tools-r1"))
    from model_app_lifecycle import ModelAppLifecycle
    from guest_model_build import GuestModelBuildService
    from guest_build_tools import install_guest_build_provider
    lifecycle=ModelAppLifecycle(authority,parent_origin=parent_origin,authority_base_url=authority_base_url,
        state_root=Path(svc.p.root)/"model-app-state",data_root=Path(svc.p.root)/"model-app-data")
    builds=GuestModelBuildService(svc,on_built=lifecycle.on_built)
    authority.read_build_status=builds.status_for_snapshot
    install_guest_build_provider(svc,"/run/starlidigital-private-demo-r2/openrouter.key",builds.build_gateway)
    from model_app_control import install_model_app_control
    install_model_app_control(app,svc,lifecycle)
    app.state.model_app_builds=builds;app.state.model_app_lifecycle=lifecycle
    app.add_event_handler("shutdown",builds.close);app.add_event_handler("shutdown",lifecycle.close)
    return builds,lifecycle
