"""Inventory literal GraphQL operation declarations and HTTP pathname checks; no execution."""
import pathlib,re,json
root=pathlib.Path(__file__).resolve().parents[1];out={"limitations":"Lexical inventory; not a parsed executable GraphQL schema or mounted runtime routes.","graphql":[],"http":[]}
for f in sorted((root/"platform").rglob("*")):
 if not f.is_file() or f.suffix not in (".ts",".js",".mjs"):continue
 if "node_modules" in f.parts:continue
 s=f.read_text(encoding="utf-8")
 for m in re.finditer(r"(?:extend\s+)?type\s+(Query|Mutation|Subscription)\s*\{([^}]+)\}",s):
  # Fields may span lines and arguments; this collects names after line starts or return types.
  body=m.group(2)
  flattened=[];depth=0
  for char in body:
   if char=="(":depth+=1
   elif char==")":depth=max(0,depth-1)
   elif depth==0:flattened.append(char)
  names=re.findall(r"\b(\w+)\s*:","".join(flattened))
  out["graphql"].append({"file":str(f.relative_to(root)).replace("\\","/"),"line":s.count("\n",0,m.start())+1,"kind":m.group(1),"fields":names,"declaration":body.strip()})
 for m in re.finditer(r"(?:pathname|req\.url)\s*===?\s*['"+'"'+r"]([^'"+'"'+r"]+)",s):
  out["http"].append({"file":str(f.relative_to(root)).replace("\\","/"),"line":s.count("\n",0,m.start())+1,"path":m.group(1)})
 for m in re.finditer(r"\b(?:router|app)\.(get|post|put|patch|delete|use)\s*\(\s*['\"]([^'\"]+)",s):
  out["http"].append({"file":str(f.relative_to(root)).replace("\\","/"),"line":s.count("\n",0,m.start())+1,"path":m.group(2),"method":m.group(1)})
dest=root/"qa/source-evidence/platform-operations.json";dest.write_text(json.dumps(out,indent=2),encoding="utf-8")
print(json.dumps({"declarations":len(out["graphql"]),"http_checks":len(out["http"])}))
