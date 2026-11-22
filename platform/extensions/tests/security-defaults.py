import ast, os, pathlib, runpy, tempfile, yaml
r=pathlib.Path(__file__).resolve().parents[1]
init=runpy.run_path(str(r/'search/init-settings.py'))['initialize']
with tempfile.TemporaryDirectory(prefix='starli-security-defaults-') as directory:
 a=pathlib.Path(directory).resolve()/'a.yml'; b=a.with_name('b.yml')
 init(a);init(b)
 first=yaml.safe_load(a.read_text());second=yaml.safe_load(b.read_text())
 assert len(first['server']['secret_key'])==64 and first['server']['secret_key']!=second['server']['secret_key']
 assert first['engines'][0]['disabled'] is True and first['engines'][0]['api_key']==''
 try:init(a)
 except FileExistsError:pass
 else:raise AssertionError('Existing settings overwritten')
os.environ.pop('SEARXNG_SETTINGS_PATH',None)
try:runpy.run_path(str(r/'search/wsgi.py'))
except RuntimeError as error:assert str(error)=='SEARXNG_SETTINGS_PATH_REQUIRED'
else:raise AssertionError('Missing settings accepted')
tree=ast.parse((r/'search/source/searx/engines/pexels.py').read_text())
setup=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='setup')
setup.returns=None
for arg in setup.args.args:arg.annotation=None
namespace={'api_key':''};exec(compile(ast.Module(body=[setup],type_ignores=[]),'pexels.setup','exec'),namespace)
assert namespace['setup']({'name':'pexels'}) is False
namespace['api_key']='operator-supplied-key';assert namespace['setup']({'name':'pexels'}) is True
settings=yaml.safe_load((r/'search/source/searx/settings.yml').read_text());assert settings['server']['secret_key']==''
assert next(e for e in settings['engines'] if e['name']=='pexels')['disabled'] is True
print('PASS: unique private secrets, overwrite refusal, fail-closed search boot, BYO-only disabled Pexels defaults')
