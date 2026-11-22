import argparse,http.server,os
from pathlib import Path
a=argparse.ArgumentParser();a.add_argument('--build',required=True);a.add_argument('--port',type=int,required=True);v=a.parse_args()
root=Path(v.build).resolve()
nonce=os.environ['STARLI_INSTANCE_NONCE']
if not (root/'index.html').is_file():raise SystemExit('BUILD_REQUIRED')
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(root),**kw)
 def do_GET(self):
  if self.path=='/staging/instance':
   import json
   data=json.dumps({'instanceNonce':nonce,'pid':os.getpid()}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data);return
  target=Path(self.translate_path(self.path))
  if not target.exists() and not self.path.startswith('/_app/'):self.path='/index.html'
  super().do_GET()
 def end_headers(self):self.send_header('Cache-Control','no-store');super().end_headers()
 def log_message(self,*args):pass
http.server.ThreadingHTTPServer(('127.0.0.1',v.port),Handler).serve_forever()
