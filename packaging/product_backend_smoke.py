"""Run the actual new-product native core API checks using the target hash lock.

This proves core auth/company/bot/team/guest boundaries and isolated collaboration
fixtures, not configured inference, workers or the joined preview. Only sanitized
reports are CI artifacts.
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
    # unittest owns a fresh TemporaryDirectory per test. Keep those directories,
    # suite homes and all captured output within this attempt's private boundary.
    unit_runner="""import json,sys,unittest
suite=unittest.defaultTestLoader.discover(sys.argv[1],pattern='test_local_collaboration.py')
count=suite.countTestCases()
result=unittest.TextTestRunner(verbosity=2).run(suite)
ok=result.wasSuccessful() and count>0 and not result.skipped
print(json.dumps({'status':'PASS' if ok else 'FAIL','testsRun':result.testsRun,'skipped':len(result.skipped)}))
raise SystemExit(0 if ok else 1)
"""
    suites=[('foundation','test_local_server.py',None),
            ('collaboration-fixtures','test_local_collaboration.py',unit_runner),
            ('native-collaboration-fixtures','test_native_collaboration_routes.py',None)]
    reports=[]
    for label,filename,runner in suites:
        case=private/label
        for name in ['', 'home','tmp','home/appdata','home/localappdata']:
            filesystem.ensure_private_directory(case/name)
        child_env={**env,'HOME':str(case/'home'),'USERPROFILE':str(case/'home'),
                   'TMP':str(case/'tmp'),'TEMP':str(case/'tmp'),'TMPDIR':str(case/'tmp'),
                   'APPDATA':str(case/'home/appdata'),'LOCALAPPDATA':str(case/'home/localappdata'),
                   'PYTHONUTF8':'1','PYTHONIOENCODING':'utf-8','OFFLINE_MODE':'true',
                   'HF_HUB_OFFLINE':'1','ANONYMIZED_TELEMETRY':'false','DO_NOT_TRACK':'true'}
        command=([sys.executable,'-c',runner,str(ROOT/'product-backend')] if runner
                 else [sys.executable,str(ROOT/'product-backend'/filename)])
        entry={'suite':label,'status':'FAIL','private_logs_uploaded':False}
        if label!='foundation':entry.update(actualInference=False,externalCalls=0,executionClass='TEST_FIXTURE')
        try:
            result=subprocess.run(command,cwd=ROOT,env=child_env,capture_output=True,text=True,timeout=240)
            (case/'private-test.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
            entry['returncode']=result.returncode
            if result.returncode==0:
                for line in reversed(result.stdout.splitlines()):
                    try:value=json.loads(line)
                    except ValueError:continue
                    if not isinstance(value,dict) or value.get('status')!='PASS':continue
                    if runner:
                        if not isinstance(value.get('testsRun'),int) or value['testsRun']<1 or value.get('skipped')!=0:continue
                        entry.update(status='PASS',testsRun=value['testsRun'],skipped=0)
                    elif isinstance(value.get('checks'),list):
                        if label=='foundation' and (value.get('modelCalls')!=0 or value.get('externalActions')!=0):continue
                        if label!='foundation' and (value.get('actualInference') is not False or value.get('externalCalls')!=0):continue
                        entry.update(status='PASS',checks=value['checks'])
                    else:continue
                    break
        except (OSError,subprocess.TimeoutExpired) as error:
            entry['failure_type']=type(error).__name__
        reports.append(entry)
    foundation=reports[0]
    report={'status':'PASS' if all(item['status']=='PASS' for item in reports) else 'FAIL',
            'attempt':attempt,'scope':'native core ASGI APIs and separate isolated collaboration fixtures; no actual inference',
            'checks':foundation.get('checks',[]),'modelCalls':0,'externalActions':0,
            'actualInference':False,'suites':reports,'private_logs_uploaded':False,
            'limitations':['Collaboration model/native callback results use explicit fixtures, not actual inference',
                           'No configured provider, worker execution or joined preview lifecycle claimed',
                           'ASGI TestClient validation; separate socket launch validation required']}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':report['status'],'scope':report['scope'],'checks':len(report['checks']),
                      'suites':[{'suite':item['suite'],'status':item['status'],'testsRun':item.get('testsRun')} for item in reports]}))
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
