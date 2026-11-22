"""Composition helpers. No auto-registration or second native ingress."""
from .runtime import BrowserToolsMixin
from .routes import mount


def runtime_type(existing_runtime_type):
    if issubclass(existing_runtime_type, BrowserToolsMixin):
        return existing_runtime_type
    return type('EnterpriseBrowser' + existing_runtime_type.__name__, (BrowserToolsMixin, existing_runtime_type), {})


def constructor_kwargs(adapter=None, native_scope_resolver=None):
    if (adapter is None) != (native_scope_resolver is None):
        raise ValueError('BROWSER_ADAPTER_AND_NATIVE_SCOPE_RESOLVER_REQUIRED_TOGETHER')
    return {'browser_adapter': adapter, 'browser_scope': native_scope_resolver}


def mount_viewer(app, adapter, *, native_session, resolve_scope):
    if getattr(app.state, 'enterprise_browser_mounted', False):
        raise ValueError('BROWSER_ALREADY_MOUNTED')
    router = mount(app, adapter, native_session=native_session, resolve_scope=resolve_scope)
    app.state.enterprise_browser_mounted = True
    return router
