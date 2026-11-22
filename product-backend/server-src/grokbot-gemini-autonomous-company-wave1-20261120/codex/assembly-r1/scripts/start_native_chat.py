import argparse,importlib.util,os
from pathlib import Path
a=argparse.ArgumentParser();a.add_argument('--root',required=True);a.add_argument('--origin',required=True);a.add_argument('--port',required=True,type=int);v=a.parse_args()
instance_nonce=os.environ['STARLI_INSTANCE_NONCE']
chat_key_file=os.environ.get('STARLI_PRIVATE_OPENROUTER_KEY_FILE')
preview_url=os.environ.get('STARLI_PREVIEW_CONTROLLER_URL')
preview_key=os.environ.get('STARLI_PREVIEW_CONTROL_KEY')
source=Path(__file__).resolve().parents[2]/'claim-review-r1/native_auth_staging.py'
spec=importlib.util.spec_from_file_location('native_auth_staging',source);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
app=m.create_app(v.root,v.origin)
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'guest-session-refresh-r1'))
from guest_session_refresh import install_guest_session_refresh
install_guest_session_refresh(app,app.state.grokbot1)
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'adapters'))
from claimed_chat_defaults import install_claimed_chat_defaults
install_claimed_chat_defaults(app.state.grokbot1)
if chat_key_file:
 from native_company_chat import install_native_chat
 install_native_chat(app,app.state.grokbot1,chat_key_file)
 sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'provider-integration-r1'))
 from openrouter_provider import OpenRouterProvider,install_public_provider
 from guest_workspace import install_guest_workspace
 install_public_provider(app.state.grokbot1,OpenRouterProvider(chat_key_file))
 install_guest_workspace(app,app.state.grokbot1,allowed_origins={v.origin})
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'native-wiring-r3'))
from native_claim_execution_routes import install_native_worker_routes
from native_node_dispatcher import NativeNodeDispatcher
install_native_worker_routes(app,app.state.grokbot1,NativeNodeDispatcher(v.root),allowed_origins={v.origin})
if preview_url and preview_key:
 sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'preview-lifecycle-r1'))
 from native_preview_routes import install_preview_routes
 install_preview_routes(app,app.state.grokbot1,controller_url=preview_url,controller_key=preview_key,allowed_origins={v.origin})
from claim_resume_routes import install_claim_resume_routes
install_claim_resume_routes(app,app.state.grokbot1)
@app.get('/staging/instance')
async def instance():return {'instanceNonce':instance_nonce,'pid':os.getpid()}
import uvicorn
uvicorn.run(app,host='127.0.0.1',port=v.port,access_log=False,log_level='warning')
