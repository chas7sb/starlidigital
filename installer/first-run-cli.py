"""Optional trusted local console; uses the backend's same atomic setup operation."""
import argparse,getpass,importlib.util,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser();p.add_argument('--state',required=True);p.add_argument('--port',type=int,required=True);p.add_argument('--origin',required=True);a=p.parse_args()
 if not sys.stdin.isatty():raise RuntimeError('CLI setup requires an interactive local console. Use start and the browser first-run form instead.')
 sys.path.insert(0,str(ROOT/'product-backend'))
 spec=importlib.util.spec_from_file_location('single_company_cli_backend',ROOT/'product-backend/local_server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
 state=server.configure(a.state,a.origin);ns=server.native(state)
 from local_installation import Installation
 installation=Installation(ns)
 if installation.status()['setupRequired'] is not True:raise RuntimeError('Existing administrator/company preserved; setup cannot reset this installation.')
 email=input('Administrator email: ').strip();name=input('Administrator display name: ').strip();company=input('Company name: ').strip()
 password=getpass.getpass('Administrator password (14+ characters): ')
 if password!=getpass.getpass('Confirm password: '):raise RuntimeError('Passwords differ; no administrator created.')
 result=installation.setup(name=name,email=email,password=password,company_name=company)
 if result.get('setupComplete') is not True or not result.get('companyId'):raise RuntimeError('Backend did not confirm atomic setup.')
 print('Administrator and sole company created by the canonical backend transaction. No session issued; start and sign in.')
 return 0
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as error:
  safe_messages={'CLI setup requires an interactive local console. Use start and the browser first-run form instead.','Existing administrator/company preserved; setup cannot reset this installation.','Passwords differ; no administrator created.','Backend did not confirm atomic setup.'}
  detail=str(error)
  if detail not in safe_messages and not (type(error).__name__=='InstallationError' and re.fullmatch('[A-Z][A-Z0-9_]{1,80}',detail)):detail='CLI_SETUP_FAILED: use browser setup; existing data was not reset.'
  print(detail,file=sys.stderr);raise SystemExit(1)
