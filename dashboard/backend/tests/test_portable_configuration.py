"""Isolated portable configuration checks; no services or provider calls."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('portable_under_test', Path(__file__).parents[1] / 'starli_portable.py')
portable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portable)

class PortableConfigurationTests(unittest.TestCase):
    def test_fresh_defaults_are_in_extracted_project(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(Path(portable.platform_root()), portable.ROOT / 'platform')
            self.assertEqual(Path(portable.config_file('engine.json')), portable.ROOT / 'config/private/engine.json')
            self.assertEqual(Path(portable.data_file('db.sqlite')), portable.DASHBOARD / 'backend/data/db.sqlite')
            self.assertEqual(Path(portable.runtime_file('broker/client.py')), portable.ROOT / 'runtime/vendor/broker/client.py')
            self.assertEqual(portable.public_url('/published/x/'), 'http://localhost:8080/published/x/')
            self.assertEqual(portable.platform_url(), 'http://127.0.0.1:4100')
            self.assertEqual(portable.company_platform_url('/graphql'), 'http://127.0.0.1:4100/graphql')
            self.assertEqual(portable.control_plane_url('/mcp'), 'http://127.0.0.1:4120/mcp')
            self.assertFalse(Path(portable.config_file('engine.json')).exists())

    def test_operator_paths_override_working_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            env = {'STARLI_DATA_DIR': str(root/'data'), 'STARLI_CONFIG_DIR':str(root/'private'),
                   'STARLI_RUNTIME_BUNDLE_DIR':str(root/'vendor'), 'STARLI_PLATFORM_SOURCE_ROOT':str(root/'platform'),
                   'STARLI_WORKSPACE_ROOT':str(root/'workspace')}
            with patch.dict(os.environ,env,clear=True):
                self.assertEqual(Path(portable.data_file('state.db')), root/'data/state.db')
                self.assertEqual(Path(portable.config_file('mail.json')), root/'private/mail.json')
                self.assertEqual(Path(portable.workspace_file('receipt.md')),root/'workspace/receipt.md')
                self.assertEqual(Path(portable.runtime_file('client.py')),root/'vendor/client.py')
                self.assertEqual(Path(portable.platform_root()),root/'platform')

    def test_custom_origins_keep_explicit_host_allowlist(self):
        with patch.dict(os.environ, {'WEBUI_URL':'https://dashboard.example',
                'STARLI_ALLOWED_ORIGINS':'https://dashboard.example,http://localhost:8080',
                'STARLI_PLATFORM_ORIGIN':'https://api.example',
                'STARLI_CONTROL_PLANE_ORIGIN':'https://mcp.example'},clear=True):
            self.assertEqual(portable.public_url('/callback'),'https://dashboard.example/callback')
            self.assertEqual(portable.oauth_origins(), {'dashboard.example':'https://dashboard.example','localhost:8080':'http://localhost:8080'})
            self.assertNotIn('attacker.example',portable.oauth_origins())
            self.assertEqual(portable.platform_url('/graphql'),'https://api.example/graphql')
            self.assertEqual(portable.control_plane_url('/mcp'),'https://mcp.example/mcp')

    def test_invalid_origins_are_rejected(self):
        for value in ['http://external.example','https://user:pass@example.com','https://example.com/path',
                      'https://@example.com','https://example.com?','https://example.com?query=1','https://example.com#fragment','file:///tmp/a','https://example.com:bad','https://example.com\n','https://example.com\\evil']:
            with self.subTest(value=value), self.assertRaises(ValueError):portable.origin(value)
        self.assertEqual(portable.origin('http://[::1]:8080/'),'http://[::1]:8080')

    def test_dashboard_source_database_defaults_to_shared_platform(self):
        import sys
        state_spec = importlib.util.spec_from_file_location('state_under_test', Path(__file__).parents[1] / 'open_webui/routers/starli_state.py')
        state = importlib.util.module_from_spec(state_spec)
        with patch.dict(sys.modules, {'starli_portable': portable}), patch.dict(os.environ, {}, clear=True):
            state_spec.loader.exec_module(state)
            self.assertEqual(Path(state.source_database()), Path(portable.platform_root()) / 'server/data/starli.sqlite')
            self.assertEqual(state.runtime_code_dir(), portable.DASHBOARD / 'scripts/starli-runtime')

    def test_compose_internal_origins_are_separate_from_public_oauth(self):
        with patch.dict(os.environ, {
                'STARLI_PLATFORM_ORIGIN':'http://platform:4100',
                'STARLI_CONTROL_PLANE_ORIGIN':'http://control-plane:4120',
                'STARLI_COMPANY_PLATFORM_ORIGIN':'http://10.20.0.5:4100',
                'STARLI_PLATFORM_PUBLIC_ORIGIN':'https://api.example',
                'STARLI_CONTROL_PLANE_PUBLIC_ORIGIN':'https://mcp.example',
                'WEBUI_URL':'https://dashboard.example'}, clear=True):
            self.assertEqual(portable.platform_url('/graphql'),'http://platform:4100/graphql')
            self.assertEqual(portable.control_plane_url('/mcp'),'http://control-plane:4120/mcp')
            self.assertEqual(portable.company_platform_url('/graphql'),'http://10.20.0.5:4100/graphql')
            self.assertEqual(portable.platform_public_url('/oauth/authorize'),'https://api.example/oauth/authorize')
            self.assertEqual(portable.control_plane_public_url('/mcp'),'https://mcp.example/mcp')
            self.assertEqual(portable.oauth_origins(),{'dashboard.example':'https://dashboard.example'})
        for name, callback in [('STARLI_PLATFORM_PUBLIC_ORIGIN',portable.platform_public_url),
                               ('STARLI_CONTROL_PLANE_PUBLIC_ORIGIN',portable.control_plane_public_url),
                               ('STARLI_PUBLIC_ORIGIN',portable.public_origin)]:
            with patch.dict(os.environ,{name:'http://platform:4100'},clear=True), self.assertRaises(ValueError):callback()

    def test_internal_service_origins_reject_unsafe_url_forms(self):
        for value in ['http://user:pass@platform:4100','http://@platform:4100',
                      'http://platform:4100/path','http://platform:4100?x=1',
                      'http://platform:4100#x','http://platform:4100?',
                      'http://platform:4100#','http://platform:bad','http://platform:0',
                      'http://platform:65536','http://-platform:4100','http://platform..local:4100',
                      'http://platform:4100\\evil','http://platform:4100\n','file:///tmp/service','//platform:4100']:
            with self.subTest(value=value), self.assertRaises(ValueError):portable.service_origin(value)
        self.assertEqual(portable.service_origin('http://[fd00::5]:4100/'),'http://[fd00::5]:4100')

    def test_executables_resolve_from_server_configuration(self):
        with patch.dict(os.environ, {'STARLI_NODE_BINARY':'/custom/node','STARLI_BROWSER_EXECUTABLE_PATH':'/custom/chrome'},clear=True):
            self.assertEqual(portable.node_binary(),'/custom/node')
            self.assertEqual(portable.browser_binary(),'/custom/chrome')

if __name__ == '__main__':unittest.main()
