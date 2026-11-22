"""Company bot profiles in the canonical authority/registry database. No provisioning."""
import json
import sqlite3
from contextlib import closing


class ProfileError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code
        super().__init__(code)


class AgentProfiles:
    def __init__(self, path, authority_type):
        self.path, self.authority_type = str(path), authority_type

    def initialize(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('''CREATE TABLE IF NOT EXISTS company_bot_profiles(
                bot TEXT PRIMARY KEY, company TEXT NOT NULL, purpose TEXT NOT NULL,
                instructions TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)''')
            db.commit()

    def _authority(self, db):
        authority = object.__new__(self.authority_type)
        authority.db = db
        return authority

    def _read(self, db, actor, company, bot):
        a = self._authority(db)
        scope = a.require_member(actor, company)
        row = db.execute("SELECT name,revision FROM bots WHERE id=? AND kind='company' AND owner=? AND active=1", (bot, company)).fetchone()
        target = db.execute("SELECT kind FROM members WHERE company_id=? AND user_id=? AND active=1", (company, bot)).fetchone()
        if not row or not target or target[0] != 'bot':
            raise ProfileError(404, 'AGENT_NOT_FOUND')
        profile = db.execute('SELECT purpose,instructions,updated_by,updated_at FROM company_bot_profiles WHERE bot=? AND company=?', (bot, company)).fetchone()
        if profile:
            purpose, instructions, updated_by, updated_at = profile
        else:
            template = db.execute('SELECT config FROM template_installs WHERE bot=?', (bot,)).fetchone() if db.execute("SELECT 1 FROM sqlite_master WHERE name='template_installs'").fetchone() else None
            purpose, instructions, updated_by, updated_at = '', json.loads(template[0]).get('instructions', '') if template else '', None, None
        capabilities = a.require_member(bot, company)['capabilities']
        a.require_member(actor, company, expected_revision=scope['membership_revision'])
        return dict(version='starli.company-agent-profile.v1', companyId=company, botId=bot,
                    revision=row[1], name=row[0], purpose=purpose, instructions=instructions,
                    configured=profile is not None,
                    canManage=scope['kind']=='person' and scope['role'] in ('owner', 'admin'),
                    toolCapabilities=capabilities, updatedBy=updated_by, updatedAt=updated_at)

    def read(self, actor, company, bot):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('BEGIN')
            return self._read(db, actor, company, bot)

    def save(self, actor, company, bot, expected_revision, name, purpose, instructions, before_commit=lambda: None):
        if type(expected_revision) is not int or expected_revision < 1 or not isinstance(name, str) or not 1 <= len(name.strip()) <= 100 or not isinstance(purpose, str) or len(purpose) > 2000 or not isinstance(instructions, str) or len(instructions) > 16000:
            raise ProfileError(422, 'AGENT_PROFILE_INVALID')
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                current = self._read(db, actor, company, bot)
                if not current['canManage']:
                    raise ProfileError(403, 'AGENT_MANAGEMENT_DENIED')
                if current['revision'] != expected_revision:
                    raise ProfileError(409, 'AGENT_REVISION_CONFLICT')
                db.execute("INSERT INTO company_bot_profiles VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(bot) DO UPDATE SET purpose=excluded.purpose,instructions=excluded.instructions,updated_by=excluded.updated_by,updated_at=excluded.updated_at", (bot, company, purpose, instructions, actor))
                db.execute('UPDATE bots SET name=?,revision=revision+1 WHERE id=? AND revision=?', (name.strip(), bot, expected_revision))
                db.execute('UPDATE members SET name=? WHERE company_id=? AND user_id=? AND kind=\'bot\'', (name.strip(), company, bot))
                template = db.execute('SELECT config FROM template_installs WHERE bot=?', (bot,)).fetchone() if db.execute("SELECT 1 FROM sqlite_master WHERE name='template_installs'").fetchone() else None
                if template:
                    config = json.loads(template[0]) | {'name': name.strip(), 'instructions': instructions}
                    db.execute('UPDATE template_installs SET config=? WHERE bot=?', (json.dumps(config), bot))
                result = self._read(db, actor, company, bot)
                self._authority(db).log(company, actor, 'bot.profile.update', bot)
                before_commit()
                db.execute('COMMIT')
                return result
            except BaseException:
                db.execute('ROLLBACK')
                raise


def build_router(profiles, verified_user, capture_fence, mutation_guard, forbidden_errors=()):
    from fastapi import APIRouter, Depends, HTTPException, Request
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel, ConfigDict, Field
    class Form(BaseModel):
        model_config = ConfigDict(extra='forbid', strict=True)
        expectedRevision: int = Field(ge=1)
        name: str = Field(min_length=1, max_length=100)
        purpose: str = Field(max_length=2000)
        instructions: str = Field(max_length=16000)
    router = APIRouter(prefix='/api/v1/companies')
    def invoke(request, user, company, bot, form=None):
        fence = capture_fence(request, user)
        fence.check()
        try:
            result = profiles.read(user.id, company, bot) if form is None else profiles.save(user.id, company, bot, form.expectedRevision, form.name, form.purpose, form.instructions, before_commit=fence.check)
        except ProfileError as error:
            raise HTTPException(error.status, error.code) from None
        except forbidden_errors:
            raise HTTPException(403, 'AGENT_ACCESS_DENIED') from None
        fence.check()
        return JSONResponse(result, headers={'Cache-Control': 'no-store'})
    @router.get('/{company}/bots/{bot}/profile')
    def read(company: str, bot: str, request: Request, user=Depends(verified_user)):
        return invoke(request, user, company, bot)
    @router.put('/{company}/bots/{bot}/profile')
    def save(company: str, bot: str, form: Form, request: Request, user=Depends(verified_user)):
        mutation_guard(request)
        return invoke(request, user, company, bot, form)
    return router

