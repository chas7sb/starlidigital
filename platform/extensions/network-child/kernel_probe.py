"""Operator-only QA. Not installed as a callable runtime profile or arbitrary-code tool."""
import json,os,subprocess,sys
from pathlib import Path
import profile_setup as setup
if sys.argv[-1]!='child':
 node=sys.argv[1] if len(sys.argv)>1 else '/usr/bin/node'
 assert node in ('/usr/bin/node','/opt/starlidigital/node/bin/node')
 r=subprocess.run([sys.executable,__file__,node,'child'],capture_output=True,text=True,timeout=15)
 if r.returncode:raise RuntimeError(r.stderr)
 print(r.stdout)
else:
 reads=[Path(x).resolve() for x in ['/usr/lib','/usr/share/nodejs','/usr/share/ca-certificates','/etc/ssl/certs','/etc/ssl/openssl.cnf','/etc/ld.so.cache','/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf','/etc/gai.conf'] if Path(x).exists()]
 node=sys.argv[1]
 executable=[Path(node).resolve(),Path('/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2').resolve()]
 reads+=[Path(__file__).parent.resolve()] # Operator-only fixture; never used by installed setup.
 setup.landlock(reads+executable,executable,[53,443]);setup.seccomp()
 code=r'''const fs=require('fs'),cp=require('child_process'),net=require('net'),dns=require('dns').promises;
const proof={};
try{fs.readFileSync('/etc/passwd');throw Error('READ_NOT_BLOCKED')}catch(e){if(e.code!=='EACCES')throw e;proof.worldReadableSecretPathDenied=true}
try{fs.writeFileSync('/tmp/starli-kernel-probe-should-not-exist','x');throw Error('WRITE_NOT_BLOCKED')}catch(e){if(e.code!=='EACCES')throw e;proof.filesystemWritesDenied=true}
const spawn=cp.spawnSync('/usr/bin/true');if(!['EPERM','EACCES'].includes(spawn.error?.code))throw Error('SPAWN_NOT_BLOCKED');proof.childProcessDenied=true;
Promise.all([
 new Promise((ok,no)=>{const s=net.connect({path:'/run/dbus/system_bus_socket'});s.on('error',e=>{if(e.code!=='EPERM')return no(e);proof.unixSocketDenied=true;ok()});s.on('connect',()=>no(Error('UNIX_NOT_BLOCKED')))}),
 new Promise((ok,no)=>{const s=net.connect({host:'127.0.0.1',port:80});s.on('error',e=>{if(!['EPERM','EACCES'].includes(e.code))return no(e);proof.unapprovedTcpPortDenied=true;ok()});s.on('connect',()=>no(Error('PORT_NOT_BLOCKED')))}),
 dns.resolve4('example.org').then(ips=>{if(!ips.length)throw Error('DNS_EMPTY');proof.ipv4DnsWorks=true})
]).then(()=>console.log(JSON.stringify(proof))).catch(e=>{console.error(e);process.exitCode=1});'''
 os.execve(node,[node,'--max-old-space-size=96','-e',code],{'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/nonexistent'})
