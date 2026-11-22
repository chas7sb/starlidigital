"""Run the actual new-product native core API checks using the target hash lock.

This proves core auth/company/bot/team/guest boundaries, not configured inference,
workers or the joined preview. Only sanitized reports are CI artifacts.
"""
import argparse
import json
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

from native_boot_smoke import target_lock

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'work/product-backend-result.json'
STAGE='arguments'
ATTEMPT=os.environ.get('STARLI_PRODUCT_BACKEND_ATTEMPT','')
if len(ATTEMPT)!=32 or any(c not in '0123456789abcdef' for c in ATTEMPT):ATTEMPT=uuid.uuid4().hex

def execute(output):
    if sys.version_info[:2]!=(3,11):raise ValueError('Product backend validation requires Python3.11')
    attempt=ATTEMPT
    private=ROOT/'work'/('product-backend-ci-'+attempt)
    spec=importlib.util.spec_from_file_location('_product_smoke_private_fs',ROOT/'dashboard/backend/starli_private_fs.py')
    filesystem=importlib.util.module_from_spec(spec);spec.loader.exec_module(filesystem)
    filesystem.ensure_private_directory(private)
    allowed=['PATH','SYSTEMROOT','SystemRoot','WINDIR','COMSPEC','ComSpec','PATHEXT','LANG','LC_ALL','TZ','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE']
    env={key:os.environ[key] for key in allowed if key in os.environ}
    for name in ['home','tmp']:filesystem.ensure_private_directory(private/name)
    env.update(HOME=str(private/'home'),USERPROFILE=str(private/'home'),TMP=str(private/'tmp'),TEMP=str(private/'tmp'),PYTHONUTF8='1',PYTHONIOENCODING='utf-8',ANONYMIZED_TELEMETRY='false',DO_NOT_TRACK='true')
    result=subprocess.run([sys.executable,str(ROOT/'product-backend/test_local_server.py')],cwd=ROOT,env=env,capture_output=True,text=True,timeout=180)
    (private/'private-test.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
    report=None
    if result.returncode==0:
        for line in reversed(result.stdout.splitlines()):
            try:value=json.loads(line)
            except ValueError:continue
            if isinstance(value,dict) and value.get('status')=='PASS' and isinstance(value.get('checks'),list):
                report={'status':'PASS','attempt':attempt,'scope':'new product native core ASGI APIs; no configured model execution', 'checks':value['checks'],'modelCalls':value.get('modelCalls'),'externalActions':value.get('externalActions'),'limitations':value.get('limitations',[])}
                break
    if report is None:
        report={'status':'FAIL','attempt':attempt,'stage':'new-product-core-ASGI-test','returncode':result.returncode,'private_logs_uploaded':False}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':report['status'],'scope':report.get('scope'),'checks':len(report.get('checks',[]))}))
    return 0 if report['status']=='PASS' else 1

def main():
    global OUTPUT,STAGE
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install',action='store_true')
    parser.add_argument('--output',type=Path,default=ROOT/'work/product-backend-result.json')
    args=parser.parse_args()
    OUTPUT=args.output.resolve()
    if args.install:
        STAGE='target-lock-installation'
        _,lock=target_lock()
        uv=shutil.which('uv')
        if not uv:raise ValueError('uv0.11.19 is required for locked CI environment installation')
        venv=ROOT/'installer/.runtime/product-backend-ci-python'
        interpreter=venv/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        if not interpreter.exists():subprocess.run([uv,'venv','--python','3.11',str(venv)],cwd=ROOT,check=True,timeout=180)
        subprocess.run([uv,'pip','sync','--python',str(interpreter),'--require-hashes','--default-index','https://pypi.org/simple',str(lock)],cwd=ROOT,check=True,timeout=1800)
        STAGE='installed-environment-core-test'
        result=subprocess.call([str(interpreter),__file__,'--output',str(OUTPUT)],cwd=ROOT,env={**os.environ,'STARLI_PRODUCT_BACKEND_ATTEMPT':ATTEMPT})
        try:report=json.loads(OUTPUT.read_text(encoding='utf-8'))
        except (OSError,ValueError):report={}
        if report.get('attempt')!=ATTEMPT:raise RuntimeError('No current-attempt report from installed environment')
        return result
    STAGE='target-lock-validation'
    target_lock()
    STAGE='new-product-core-ASGI-test'
    return execute(args.output.resolve())

if __name__=='__main__':
    try:outcome=main()
    except Exception as error:
        report={'status':'FAIL','attempt':ATTEMPT,'stage':STAGE,'failure_type':type(error).__name__,'private_logs_uploaded':False}
        if isinstance(error,subprocess.CalledProcessError):report['returncode']=error.returncode
        OUTPUT.parent.mkdir(parents=True,exist_ok=True)
        OUTPUT.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report));outcome=1
    raise SystemExit(outcome)
