"""Internal project_acl server port for agent8. Roots/profiles never come from request JSON."""
import json
from pathlib import Path
from open_webui.company_authority import Authority
from .resources import Denied
class ProjectRegistry:
 def __init__(self,factory,*,allowed_roots,allowed_users,allowed_profiles):
  self.factory=factory;self.roots=tuple(Path(p).resolve() for p in allowed_roots)
  self.users=frozenset(allowed_users);self.profiles=frozenset(allowed_profiles)
  if not self.roots or not self.users or not self.profiles:raise ValueError("trusted enrollment configuration required")
 def root(self,value):
  path=Path(value).resolve()
  if not path.is_dir() or not any(path==r or r in path.parents for r in self.roots):raise Denied("project unavailable")
  return str(path)
 def enroll_trusted(self,actor,company,project,*,root,profiles,user):
  root=self.root(root)
  if user not in self.users or not profiles or not set(profiles)<=self.profiles:raise ValueError("unapproved profile")
  drive=self.factory()
  try:
   drive.db.execute("CREATE TABLE IF NOT EXISTS drive_project_enrollment(project TEXT PRIMARY KEY,company TEXT,root TEXT,profiles TEXT,os_user TEXT,active INTEGER)")
   drive.db.commit()
   with drive.access(actor,company,"write") as member:
    authority=Authority.__new__(Authority);authority.db=drive.db
    authority.require_member(actor,company,permission="connections.manage")
    row=drive.row(member,project,write=True)
    if row["kind"]!="project":raise Denied("project unavailable")
    drive.db.execute("INSERT INTO drive_project_enrollment VALUES(?,?,?,?,?,1) ON CONFLICT(project) DO UPDATE SET company=excluded.company,root=excluded.root,profiles=excluded.profiles,os_user=excluded.os_user,active=1",(project,company,root,json.dumps(sorted(set(profiles))),user))
    drive.db.execute("UPDATE resource SET version=version+1 WHERE id=?",(project,))
    drive.emit(drive.row(member,project),"project.enrolled")
  finally:drive.db.close()
 def project_acl(self,scope,project_id,permission="read"):
  if not isinstance(scope,dict) or set(scope)!={"actorUserId","companyId"} or permission not in ("read","manage"):raise Denied("server scope required")
  drive=self.factory()
  try:
   with drive.access(scope["actorUserId"],scope["companyId"],"read" if permission=="read" else "write") as member:
    row=drive.row(member,project_id,write=permission=="manage")
    if row["kind"]!="project":raise Denied("project unavailable")
    item=drive.db.execute("SELECT * FROM drive_project_enrollment WHERE project=? AND company=? AND active=1",(project_id,scope["companyId"])).fetchone()
    if item is None:raise Denied("project enrollment unavailable")
    profiles=json.loads(item["profiles"])
    if item["os_user"] not in self.users or not set(profiles)<=self.profiles:raise Denied("project unavailable")
    return dict(id=project_id,company=row["company"],revision=row["version"],root=self.root(item["root"]),profiles=profiles,user=item["os_user"])
  finally:drive.db.close()
