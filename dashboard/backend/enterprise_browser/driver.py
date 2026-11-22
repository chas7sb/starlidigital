"""Lazy isolated contexts using the deployed Playwright network boundary.

Host must explicitly register this driver for an enrolled company. Importing or
constructing it never launches Chromium. Legacy browser_action keeps its admin
gate unchanged; this adapter never impersonates an admin or borrows its session.
"""
import asyncio
import time
from .core import Fault


class PlaywrightDriver:
    def __init__(self, boundary, *, authorize, max_sessions=4, ttl=600):
        self.boundary, self.authorize = boundary, authorize
        self.max_sessions, self.ttl = max_sessions, ttl
        self.sessions, self.lock = {}, asyncio.Lock()

    async def _check(self, scope, control=False):
        from .core import invoke
        if await invoke(self.authorize, scope, 'control' if control else 'view') is not True:
            raise Fault('BROWSER_AUTHORITY_DENIED')

    async def _close(self, key):
        session = self.sessions.pop(key, None)
        if session:
            try:
                await session['context'].close()
            finally:
                await session['http'].close()

    async def perform(self, scope, action, args):
        from .core import EFFECTS
        await self._check(scope, action in EFFECTS)
        async with self.lock:
            now = time.monotonic()
            for key, session in list(self.sessions.items()):
                if now - session['seen'] > self.ttl:
                    await self._close(key)
            s = self.sessions.get(scope.key)
            if action == 'close':
                await self._close(scope.key)
                return {'available': False, 'url': '', 'title': '', 'image': '', 'text': ''}
            if not s and action != 'navigate':
                return {'available': False, 'url': '', 'title': '', 'image': '', 'text': ''}
            if action == 'navigate':
                self.boundary.validate_url(args['url'])
            if not s:
                if len(self.sessions) >= self.max_sessions:
                    raise Fault('BROWSER_BUSY', 503)
                import aiohttp
                browser = await self.boundary._browser_app()
                context = await browser.new_context(accept_downloads=False, service_workers='block', ignore_https_errors=False)
                http = aiohttp.ClientSession(connector=aiohttp.TCPConnector(resolver=self.boundary.PublicResolver()), cookie_jar=aiohttp.CookieJar(), trust_env=False, timeout=aiohttp.ClientTimeout(total=20))
                try:
                    page = await context.new_page()
                    await context.route('**/*', lambda route: self.boundary._fulfill(route, http))
                    async def block_socket(route):
                        await route.close()
                    await context.route_web_socket('**/*', block_socket)
                    page.on('download', lambda download: download.cancel())
                    s = {'context': context, 'page': page, 'http': http, 'seen': now}
                    self.sessions[scope.key] = s
                except BaseException:
                    await context.close()
                    await http.close()
                    raise
            s['seen'] = now
        page = s['page']
        await self._check(scope, action in EFFECTS)
        if action == 'navigate':
            await page.goto(args['url'], wait_until='domcontentloaded', timeout=20000)
        elif action == 'click':
            size = page.viewport_size
            if not size or args['x'] >= size['width'] or args['y'] >= size['height']:
                raise Fault('BROWSER_COORDINATES_OUTSIDE_FRAME', 422)
            await page.mouse.click(args['x'], args['y'])
        elif action == 'type':
            await page.keyboard.insert_text(args['text'])
        elif action == 'key':
            await page.keyboard.press(args['key'])
        elif action == 'scroll':
            await page.mouse.wheel(0, -500 if args['direction'] == 'up' else 500)
        await self._check(scope)
        import base64
        image = await page.screenshot(type='jpeg', quality=40)
        return {'available': True, 'url': page.url, 'title': (await page.title())[:2000],
                'image': 'data:image/jpeg;base64,' + base64.b64encode(image).decode(),
                'text': (await page.inner_text('body'))[:8000]}

    async def close(self):
        for key in list(self.sessions):
            await self._close(key)
