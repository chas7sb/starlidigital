"""Concrete bindings to the existing company messaging/native runtime.

Uses computer.view/control, already defined by the company authority. No
permission is inferred from admin UI role, tool arguments or browser state.
"""
import starli_portable as _portable
from .core import Scope, Fault
from contextvars import ContextVar


class NativeAuthority:
    def __init__(self, runtime):
        self.runtime = runtime
        self.viewer_session = ContextVar('enterprise_browser_viewer_session', default=None)

    def _native(self, session, company, room, bot, run, call='browser-view'):
        from company_messaging.internal_send import NativeToolScope
        rt = self.runtime
        saved = rt.scopes.get(run)
        if saved is None:
            raise Fault('BROWSER_NATIVE_RUN_UNAVAILABLE')
        original_session, ctx, selection = saved
        if (ctx.company_id, ctx.room_id, ctx.bot_id) != (company, room, bot):
            raise Fault('BROWSER_NATIVE_SCOPE_MISMATCH')
        # Viewer uses its own fresh session, but cannot borrow another actor's
        # active browser or the original session's authority.
        if session.user_id != ctx.actor_id or session.expires_at <= __import__('time').time() or not callable(getattr(session, 'revalidate', None)) or session.revalidate() is not True:
            raise Fault('BROWSER_NATIVE_SESSION_DENIED')
        with rt.store.access(session, company, room) as (db, member, _):
            rt.local_fence(db, ctx)
            row = db.execute('SELECT message FROM cr_turns WHERE id=? AND company=? AND room=? AND bot=?', (run, company, room, bot)).fetchone()
            if row is None:
                raise Fault('BROWSER_NATIVE_RUN_UNAVAILABLE')
            native = NativeToolScope(company, room, bot, run, call, ctx.actor_id, ctx.actor_binding, ctx, row['message'])
            if rt.authorize_native(db, native) is not True or member.binding != ctx.actor_binding:
                raise Fault('BROWSER_NATIVE_BINDING_DENIED')
            return native, member

    def from_native(self, native):
        saved = self.runtime.scopes.get(native.run_id)
        if saved is None:
            raise Fault('BROWSER_NATIVE_RUN_UNAVAILABLE')
        checked, member = self._native(saved[0], native.company_id, native.room_id, native.bot_id, native.run_id, native.tool_call_id)
        if checked != native:
            raise Fault('BROWSER_NATIVE_BINDING_CHANGED')
        return Scope(native.company_id, native.actor_id, native.bot_id, native.room_id,
                     native.run_id, native.assistant_message_id, member.binding, member.revision)

    def resolve(self, session, company, room, bot, run):
        native, _ = self._native(session, company, room, bot, run)
        self.viewer_session.set(session)
        return self.from_native(native)

    def authorize(self, scope, permission):
        try:
            saved = self.runtime.scopes.get(scope.run)
            if saved is None or permission not in ('view', 'control'):
                return False
            viewer = self.viewer_session.get()
            if viewer is not None:
                self._native(viewer, scope.company, scope.room, scope.bot, scope.run)
            native, _ = self._native(saved[0], scope.company, scope.room, scope.bot, scope.run)
            if self.from_native(native) != scope:
                return False
            # The same existing authority checks both human and bot. Browser
            # contexts are private to this actor/run, so room audience remains
            # captured and revalidated by authorize_native for private rooms.
            capability = 'computer.control' if permission == 'control' else 'computer.view'
            self.runtime.authority.require_member(scope.user, scope.company, permission=capability)
            self.runtime.authority.require_member(scope.bot, scope.company, permission=capability)
            return True
        except Exception:
            return False


def attach(app, runtime, *, private_directory, enrolled_companies, native_session, boundary):
    """Called once AFTER the existing joined runtime has been constructed.

    runtime must already include BrowserToolsMixin. Root supplies explicit
    company enrollment set. No registration discovery guesses or legacy fallback.
    """
    from pathlib import Path
    from .core import BrowserAdapter
    from .driver import PlaywrightDriver
    from .install import mount_viewer
    from .runtime import BrowserToolsMixin
    if not isinstance(runtime, BrowserToolsMixin) or runtime.browser_adapter is not None:
        raise ValueError('BROWSER_UNATTACHED_MIXIN_REQUIRED')
    companies = frozenset(enrolled_companies)
    if any(not isinstance(c, str) or not c for c in companies):
        raise ValueError('BROWSER_EXPLICIT_ENROLLMENT_REQUIRED')
    private = Path(private_directory)
    private.mkdir(parents=True, exist_ok=True, mode=0o700)
    authority = NativeAuthority(runtime)
    driver = PlaywrightDriver(boundary, authorize=authority.authorize)
    def registered(scope):
        import os
        exe = os.environ.get('STARLI_BROWSER_EXECUTABLE_PATH', _portable.browser_binary())
        return driver if scope.company in companies and os.path.isfile(exe) and os.access(exe, os.X_OK) else None
    adapter = BrowserAdapter(private / 'browser-actions.sqlite', authorize=authority.authorize,
                             registration=registered)
    runtime.browser_adapter = adapter
    runtime.browser_scope = authority.from_native
    mount_viewer(app, adapter, native_session=native_session, resolve_scope=authority.resolve)
    # Runtime.close owns shutdown, preserving the existing single close callback.
    runtime._enterprise_browser_driver = driver
    app.state.enterprise_browser = adapter
    return adapter
