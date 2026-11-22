import starli_portable as _portable
import json,os,subprocess
from pathlib import Path
from fastapi import HTTPException
from open_webui.config import DATA_DIR
HERE=Path(__file__).resolve().parent
DATA=Path(DATA_DIR)
DB=DATA/'company-authority.sqlite3'
BLOBS=DATA/'company-drive-blobs'
class EmailWorker:
    def call(self,operation,actor,company,rid,payload):
        methods={'tool-draft','list','read','edit','review','approve','preview'}
        if os.environ.get('WAVE_SYNTHETIC_TOOL')=='1':methods.add('generate')
        if os.environ.get("WAVE_CONTROLLED_SMTP")=="1":
            methods.update({"controlled-send","controlled-state"})
        if operation not in methods:raise HTTPException(404,'Unavailable')
        config=dict(python=__import__("sys").executable,authorityDir=str(HERE),driveDir=str(HERE),
            authorityDb=str(DB),draftDb=str(DATA/'drafts.sqlite'),fixture=str(DATA/'email-fixture.json'),blobs=str(BLOBS))
        if os.environ.get("WAVE_CONTROLLED_SMTP")=="1":
            config.update(controlledSmtp=True,controlledMailFile=os.environ["WAVE_CONTROLLED_MAIL_FILE"])
        data=dict(config=config,method='email.'+operation,params=dict(actorId=actor,companyId=company,resourceId=rid,**payload))
        try:
            p=subprocess.run(['/usr/local/bin/node',str(HERE/'invoke.mjs')],input=json.dumps(data),text=True,capture_output=True,timeout=75 if operation=="controlled-send" and os.environ.get("WAVE_CONTROLLED_SMTP")=="1" else 30,check=True)
            reply=json.loads(p.stdout)
        except (subprocess.SubprocessError,ValueError,OSError):
            raise HTTPException(503,'Email worker unavailable') from None
        if not reply.get('ok'):raise HTTPException(reply.get('status',503),'Email operation unavailable')
        return reply['result']
    def panel(self,op,ctx,rid,payload=None):
        args={} if op=='get' else dict(expectedRevision=payload['head'],document=payload['document'])
        return self.call('read' if op=='get' else 'edit',ctx['actorId'],ctx['companyId'],rid,args)

