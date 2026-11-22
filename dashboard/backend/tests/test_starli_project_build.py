"""Snapshot consistency and owner boundaries for safe project compilation."""
import asyncio,json,sqlite3
from contextlib import contextmanager
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_workspace as workspace,starli_project_build as compiler

@pytest.fixture
def project(tmp_path,monkeypatch):
    path=tmp_path/"source.sqlite"
    @contextmanager
    def database():
        c=sqlite3.connect(path,timeout=5);c.row_factory=sqlite3.Row
        c.execute("CREATE TABLE IF NOT EXISTS records(collection TEXT,id TEXT,owner TEXT,payload TEXT,PRIMARY KEY(collection,id))")
        try:
            with c:yield c
        finally:c.close()
    monkeypatch.setattr(workspace,"db",database)
    monkeypatch.setattr(workspace,"owner",lambda user:user["id"])
    value=workspace.create("alice","Customer fixture")
    value["files"]=[{"path":"index.html","content":"<html><head></head><body>Version one</body></html>"}]
    with database() as c:workspace.save(c,"alice",value)
    return value

def output(ok=True):
    return {"ok":ok,"framework":"HTML_BROWSER_PREVIEW","html":"<html><head></head><body>Compiled</body></html>","diagnostics":[] if ok else [{"message":"Syntax error"}],"checks":[{"name":"Browser syntax and imports","status":"PASSED" if ok else "FAILED"}],"limitations":["No backend runtime"]}

def test_build_saves_only_current_snapshot(project,monkeypatch):
    async def compile(*args,**kwargs):return output()
    monkeypatch.setattr(compiler,"compile_snapshot",compile)
    result=asyncio.run(compiler.build({"id":"alice"},{"projectId":project["id"]}))
    assert result["status"]=="PASSED" and result["previewUpdated"] is True
    saved=workspace.read("alice",project["id"])
    assert compiler.compiled_preview(saved)["available"] is True
    assert saved["previewBuild"]["sourceDigest"]==compiler.source_digest(saved)
    assert result["applicationTestsRun"] is False and result["serverRuntimeVerified"] is False

def test_concurrent_edit_never_publishes_stale_preview(project,monkeypatch):
    async def compile(*args,**kwargs):
        with workspace.db() as c:
            current=workspace.get(c,"alice",project["id"]);current["files"][0]["content"]="New source";workspace.save(c,"alice",current)
        return output()
    monkeypatch.setattr(compiler,"compile_snapshot",compile)
    result=asyncio.run(compiler.build({"id":"alice"},{"projectId":project["id"]}))
    assert result["status"]=="SOURCE_CHANGED"
    assert "previewHtml" not in workspace.read("alice",project["id"])

def test_source_changes_hide_a_previously_successful_preview(project):
    project["previewBuild"]={"sourceDigest":compiler.source_digest(project),"status":"PASSED"};project["previewHtml"]="old"
    assert compiler.compiled_preview(project)["available"] is True
    project["files"][0]["content"]="changed"
    assert compiler.compiled_preview(project)["available"] is False
    compiler.invalidate_preview(project)
    assert "previewHtml" not in project and project["previewBuild"]["status"]=="STALE"

def test_failed_build_clears_old_compiled_html(project,monkeypatch):
    with workspace.db() as c:
        p=workspace.get(c,"alice",project["id"]);p["previewHtml"]="old";workspace.save(c,"alice",p)
    async def compile(*args,**kwargs):return output(False)
    monkeypatch.setattr(compiler,"compile_snapshot",compile)
    result=asyncio.run(compiler.build({"id":"alice"},{"projectId":project["id"]}))
    assert result["status"]=="FAILED" and result["previewUpdated"] is False
    assert "previewHtml" not in workspace.read("alice",project["id"])

def test_foreign_project_is_denied_before_compilation(project,monkeypatch):
    async def forbidden(*args,**kwargs):raise AssertionError("Compiler must not run")
    monkeypatch.setattr(compiler,"compile_snapshot",forbidden)
    with pytest.raises(HTTPException) as error:asyncio.run(compiler.build({"id":"bob"},{"projectId":project["id"]}))
    assert error.value.status_code==404
