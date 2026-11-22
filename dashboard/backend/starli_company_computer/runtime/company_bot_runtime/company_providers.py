"""Company-owned provider vault. No personal/guest fallback; source-only adapter."""
import hashlib
import inspect
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from contextlib import contextmanager


class Denied(Exception):
    pass


class CompanyProviders:
    def __init__(self, path, cipher, authority, require_bot, catalog, authenticate, *, refresh_models=None, hosted_available=None):
        self.path, self.cipher = path, cipher
        self.authority, self.require_bot, self.catalog = authority, require_bot, catalog
        self.authenticate = authenticate
        self.refresh_models = refresh_models
        self.hosted_available = hosted_available or (lambda company: True)

    def initialize(self):
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS company_provider_connections(
              company TEXT NOT NULL,id TEXT NOT NULL,provider TEXT NOT NULL,
              sealed BLOB NOT NULL,revision INTEGER NOT NULL,active INTEGER NOT NULL,
              PRIMARY KEY(company,id));
            CREATE TABLE IF NOT EXISTS company_bot_provider_selections(
              company TEXT NOT NULL,bot TEXT NOT NULL,connection TEXT,
              provider TEXT NOT NULL,model TEXT NOT NULL,revision INTEGER NOT NULL,
              updated_by TEXT NOT NULL,
              PRIMARY KEY(company,bot));
            CREATE TABLE IF NOT EXISTS company_provider_catalogs(
              company TEXT NOT NULL, connection TEXT NOT NULL, revision INTEGER NOT NULL,
              connection_revision INTEGER NOT NULL, models TEXT NOT NULL, state TEXT,
              PRIMARY KEY(company,connection));
            CREATE TABLE IF NOT EXISTS company_provider_audit(
              event_id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL,
              actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
              revision INTEGER NOT NULL, happened_at TEXT NOT NULL);
            ''')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def scope(self, actor, company, permission='read'):
        try:
            scope = self.authority.require_member(actor, company, permission=permission)
        except Denied:
            raise
        except Exception:
            raise Denied('COMPANY_AUTHORIZATION_DENIED') from None
        if inspect.isawaitable(scope):
            scope.close()
            raise Denied('ASYNC_AUTHORITY_UNSUPPORTED')
        if not isinstance(scope, dict) or scope.get('company_id') != company or scope.get('user_id') != actor or scope.get('contract_version') not in (1,2):
            raise Denied('COMPANY_SCOPE_INVALID')
        if scope['contract_version']==2 and permission not in scope.get('capabilities',[]):
            raise Denied('COMPANY_CAPABILITY_DENIED')
        return scope

    def fence(self, actor, company, bot=None, permission='read'):
        scope = self.scope(actor, company, permission)
        if bot is not None:
            try:
                result = self.require_bot(company, bot)
            except Denied:
                raise
            except Exception:
                raise Denied('COMPANY_BOT_DENIED') from None
            if inspect.isawaitable(result):
                result.close()
                raise Denied('ASYNC_BOT_AUTHORITY_UNSUPPORTED')
            if isinstance(result,dict):
                if result.get('id')!=bot or result.get('kind')!='company' or result.get('owner')!=company or not result.get('active') or type(result.get('revision'))is not int:
                    raise Denied('COMPANY_BOT_DENIED')
                scope={**scope,'bot_revision':result['revision']}
            elif result is True:
                scope={**scope,'bot_revision':0} # Legacy callback/test compatibility.
            else:raise Denied('COMPANY_BOT_DENIED')
        return scope

    def connect(self, actor, company, provider, credential):
        self.fence(actor, company, permission='connections.manage')
        if provider == 'hosted' or not self.catalog(provider):
            raise Denied('PROVIDER_UNSUPPORTED')
        authenticated = self.authenticate(provider, credential)
        if inspect.isawaitable(authenticated):
            authenticated.close()
            raise Denied('ASYNC_PROVIDER_AUTHENTICATION_UNSUPPORTED')
        if authenticated is not True:
            raise Denied('PROVIDER_AUTHENTICATION_FAILED')
        sealed = self.cipher.encrypt(json.dumps(credential).encode())
        connection = str(uuid.uuid4())
        with self.db() as db:
            self.fence(actor, company, permission='connections.manage')
            db.execute('INSERT INTO company_provider_connections VALUES(?,?,?,?,1,1)', (company, connection, provider, sealed))
            self.audit(db, company, actor, 'connect', connection, 1)
        return connection

    def options(self, actor, company, bot):
        self.fence(actor, company, bot)
        with self.db() as db:
            rows = db.execute('SELECT id,provider FROM company_provider_connections WHERE company=? AND active=1', (company,)).fetchall()
            self.fence(actor, company, bot)
            return [{'connectionId': None, 'provider': 'hosted', 'models': self.models_for(db,company,None,'hosted')}] + [
                {'connectionId': r['id'], 'provider': r['provider'], 'models': self.models_for(db,company,r['id'],r['provider'])} for r in rows]

    def choose(self, actor, company, bot, connection, model, expected_revision):
        self.fence(actor, company, bot, 'shared_bot.choose_provider')
        with self.db() as db:
            provider = 'hosted'
            if connection is not None:
                row = db.execute('SELECT provider FROM company_provider_connections WHERE company=? AND id=? AND active=1', (company, connection)).fetchone()
                if row is None:
                    raise Denied('COMPANY_CONNECTION_UNAVAILABLE')
                provider = row['provider']
            if model not in self.models_for(db,company,connection,provider):
                raise Denied('MODEL_UNSUPPORTED')
            old = db.execute('SELECT revision FROM company_bot_provider_selections WHERE company=? AND bot=?', (company, bot)).fetchone()
            revision = old['revision'] if old else 0
            if revision != expected_revision:
                raise Denied('SELECTION_CONFLICT')
            self.fence(actor, company, bot, 'shared_bot.choose_provider')
            db.execute('INSERT OR REPLACE INTO company_bot_provider_selections VALUES(?,?,?,?,?,?,?)', (company, bot, connection, provider, model, revision+1, actor))
            self.audit(db, company, actor, 'choose', bot, revision+1)
        return revision+1

    def disconnect(self, actor, company, connection):
        with self.db() as db:
            self.fence(actor, company, permission='connections.manage')
            if db.execute('UPDATE company_provider_connections SET active=0,sealed=?,revision=revision+1 WHERE company=? AND id=? AND active=1', (b'', company, connection)).rowcount != 1:
                raise Denied('COMPANY_CONNECTION_UNAVAILABLE')
            self.fence(actor, company, permission='connections.manage')
            rev=db.execute('SELECT revision FROM company_provider_connections WHERE company=? AND id=?',(company,connection)).fetchone()[0]
            self.audit(db, company, actor, 'revoke', connection, rev)

    def capture(self, actor, company, bot):
        scope = self.fence(actor, company, bot)
        with self.db() as db:
            row = db.execute('SELECT * FROM company_bot_provider_selections WHERE company=? AND bot=?', (company, bot)).fetchone()
            if row is None:
                raise Denied('COMPANY_SELECTION_REQUIRED')
            selection = dict(row)
            credential = None
            if row['connection'] is not None:
                conn = db.execute('SELECT * FROM company_provider_connections WHERE company=? AND id=? AND active=1', (company, row['connection'])).fetchone()
                if conn is None or conn['provider'] != row['provider']:
                    raise Denied('COMPANY_CONNECTION_UNAVAILABLE')
                selection['connectionRevision'] = conn['revision']
                credential = json.loads(self.cipher.decrypt(conn['sealed']))
            selection['catalogRevision']=self.catalog_revision(db,company,row['connection'])
            if row['model'] not in self.models_for(db,company,row['connection'],row['provider']):
                raise Denied('MODEL_UNSUPPORTED')
            current = self.fence(actor, company, bot)
            if current['membership_revision'] != scope['membership_revision'] or current['bot_revision']!=scope['bot_revision']:
                raise Denied('MEMBERSHIP_CHANGED')
            selection['membershipRevision'] = scope['membership_revision']
            selection['botRevision'] = scope['bot_revision']
            selection['actorUserId'] = actor
            revision = hashlib.sha256(json.dumps(selection, sort_keys=True).encode()).hexdigest()
            return {'version': 'starli.company-provider.v1', 'companyId': company, 'actorUserId': actor,
                    'botId': bot, 'provider': row['provider'], 'model': row['model'],
                    'configurationRevision': row['revision'], 'updatedBy': row['updated_by'], 'connectionId': row['connection'],
                    'selectionRevision': revision, 'credential': credential, 'connectionRevision':selection.get('connectionRevision',0),
                    'catalogState':self.catalog_state(db,company,row['connection'],selection.get('connectionRevision',0))}

    def check(self, snapshot):
        current = self.capture(snapshot['actorUserId'], snapshot['companyId'], snapshot['botId'])
        if current['selectionRevision'] != snapshot['selectionRevision']:
            raise Denied('COMPANY_SELECTION_CHANGED')
        return True

    @staticmethod
    def audit(db, company, actor, action, target, revision):
        db.execute('INSERT INTO company_provider_audit(company,actor,action,target,revision,happened_at) VALUES(?,?,?,?,?,?)',
                   (company,actor,action,target,revision,datetime.now(timezone.utc).isoformat()))

    def connections(self, actor, company):
        scope=self.fence(actor,company)
        with self.db() as db:
            rows=db.execute('SELECT id,provider,revision,active FROM company_provider_connections WHERE company=? ORDER BY id',(company,)).fetchall()
            self.fence(actor,company)
            return {'companyId':company,'canManage':scope.get('role') in ('owner','admin'),
                    'supportedProviders':[p for p in ('openai','anthropic','google','xai','groq','openrouter','mistral') if self.catalog(p)],
                    'connections':[{'connectionId':r['id'],'provider':r['provider'],'revision':r['revision'],
                                    'status':'active' if r['active'] else 'revoked'} for r in rows]}

    def rotate(self, actor, company, connection, credential, expected_revision):
        self.fence(actor,company,permission='connections.manage')
        with self.db() as db:
            row=db.execute('SELECT * FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
            if row is None: raise Denied('COMPANY_CONNECTION_UNAVAILABLE')
            if row['revision']!=expected_revision: raise Denied('CONNECTION_CONFLICT')
            authenticated=self.authenticate(row['provider'],credential)
            if inspect.isawaitable(authenticated):
                authenticated.close()
                raise Denied('ASYNC_PROVIDER_AUTHENTICATION_UNSUPPORTED')
            if authenticated is not True: raise Denied('PROVIDER_AUTHENTICATION_FAILED')
            sealed=self.cipher.encrypt(json.dumps(credential).encode())
            self.fence(actor,company,permission='connections.manage')
            db.execute('UPDATE company_provider_connections SET sealed=?,revision=revision+1 WHERE company=? AND id=?',(sealed,company,connection))
            self.audit(db,company,actor,'rotate',connection,row['revision']+1)
            return row['revision']+1

    def public_selection(self, actor, company, bot):
        self.fence(actor,company,bot)
        with self.db() as db:
            row=db.execute('SELECT * FROM company_bot_provider_selections WHERE company=? AND bot=?',(company,bot)).fetchone()
            if row is None:
                result={'version':'starli.company-provider.v1','companyId':company,'botId':bot,
                        'provider':None,'model':None,'connectionId':None,
                        'configurationRevision':0,'status':'unconfigured','updatedBy':None,'updatedAt':None}
            else:
                connection=db.execute('SELECT active,provider FROM company_provider_connections WHERE company=? AND id=?',(company,row['connection'])).fetchone() if row['connection'] else None
                status='ready'
                if row['connection'] and (connection is None or not connection['active'] or connection['provider']!=row['provider']): status='connection_revoked'
                elif row['model'] not in self.models_for(db,company,row['connection'],row['provider']): status='model_unavailable'
                event=db.execute("SELECT happened_at FROM company_provider_audit WHERE company=? AND target=? AND action='choose' AND revision=? ORDER BY event_id DESC LIMIT 1",(company,bot,row['revision'])).fetchone()
                result={'version':'starli.company-provider.v1','companyId':company,'botId':bot,
                        'configurationRevision':row['revision'],'provider':row['provider'],'model':row['model'],
                        'connectionId':row['connection'],'updatedBy':row['updated_by'],
                        'updatedAt':event[0] if event else None,'status':status}
            self.fence(actor,company,bot)
            return result

    @staticmethod
    def catalog_revision(db,company,connection):
        row=db.execute('SELECT revision FROM company_provider_catalogs WHERE company=? AND connection=?',(company,connection)).fetchone()
        return row[0] if row else 0

    @staticmethod
    def catalog_state(db,company,connection,revision):
        row=db.execute('SELECT state FROM company_provider_catalogs WHERE company=? AND connection=? AND connection_revision=?',(company,connection,revision)).fetchone()
        return json.loads(row[0]) if row and row[0] else None

    def models_for(self,db,company,connection,provider):
        if provider=='hosted' and not self.hosted_available(company):return []
        row=db.execute('SELECT models,connection_revision FROM company_provider_catalogs WHERE company=? AND connection=?',(company,connection)).fetchone() if connection else None
        if row:
            current=db.execute('SELECT revision FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
            if current and row['connection_revision']==current[0]:return json.loads(row['models'])
        return self.catalog(provider)

    def refresh(self,actor,company,connection,expected_revision):
        self.fence(actor,company,permission='connections.manage')
        if not callable(self.refresh_models):raise Denied('COMPANY_MODEL_REFRESH_UNAVAILABLE')
        with self.db() as db:
            row=db.execute('SELECT * FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
            if row is None:raise Denied('COMPANY_CONNECTION_UNAVAILABLE')
            if row['revision']!=expected_revision:raise Denied('CONNECTION_CONFLICT')
            provider=row['provider'];credential=json.loads(self.cipher.decrypt(row['sealed']))
        refreshed=self.refresh_models(provider,credential)
        models=refreshed.get('models') if isinstance(refreshed,dict) else refreshed
        state=refreshed.get('modelsState') if isinstance(refreshed,dict) else None
        replacement=refreshed.get('credential',credential) if isinstance(refreshed,dict) else credential
        if len(json.dumps(state))>2097152:raise Denied('COMPANY_MODEL_CATALOG_INVALID')
        if not isinstance(models,list) or len(models)>20000 or any(not isinstance(m,str) or not 0<len(m)<=180 for m in models):raise Denied('COMPANY_MODEL_CATALOG_INVALID')
        models=list(dict.fromkeys(models))
        with self.db() as db:
            self.fence(actor,company,permission='connections.manage')
            row=db.execute('SELECT revision FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
            if row is None:raise Denied('COMPANY_CONNECTION_UNAVAILABLE')
            if row[0]!=expected_revision:raise Denied('CONNECTION_CONFLICT')
            connection_revision=expected_revision
            if replacement!=credential:
                if credential.get('type')!='oauth' or not isinstance(replacement,dict) or replacement.get('type')!='oauth' or replacement.get('env'):raise Denied('COMPANY_CREDENTIAL_REFRESH_DENIED')
                connection_revision+=1
                db.execute('UPDATE company_provider_connections SET sealed=?,revision=? WHERE company=? AND id=?',(self.cipher.encrypt(json.dumps(replacement).encode()),connection_revision,company,connection))
            revision=self.catalog_revision(db,company,connection)+1
            db.execute('INSERT OR REPLACE INTO company_provider_catalogs VALUES(?,?,?,?,?,?)',(company,connection,revision,connection_revision,json.dumps(models),json.dumps(state)))
            self.audit(db,company,actor,'refresh_models',connection,revision)
        return {'catalogRevision':revision,'connectionRevision':connection_revision,'models':models}

    def refresh_runtime_credential(self,snapshot,replacement):
        self.check(snapshot)
        previous=snapshot.get('credential')
        if not isinstance(previous,dict) or previous.get('type')!='oauth' or not isinstance(replacement,dict) or replacement.get('type')!='oauth' or len(json.dumps(replacement))>131072 or replacement.get('env'):
            raise Denied('COMPANY_CREDENTIAL_REFRESH_DENIED')
        company,bot,actor,connection=snapshot['companyId'],snapshot['botId'],snapshot['actorUserId'],snapshot['connectionId']
        with self.db() as db:
            self.fence(actor,company,bot)
            row=db.execute('SELECT * FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
            choice=db.execute('SELECT revision,connection FROM company_bot_provider_selections WHERE company=? AND bot=?',(company,bot)).fetchone()
            if row is None or choice is None or choice['revision']!=snapshot['configurationRevision'] or choice['connection']!=connection or row['revision']!=snapshot['connectionRevision'] or json.loads(self.cipher.decrypt(row['sealed']))!=previous:
                raise Denied('COMPANY_CREDENTIAL_REFRESH_CONFLICT')
            db.execute('UPDATE company_provider_connections SET sealed=?,revision=revision+1 WHERE company=? AND id=?',(self.cipher.encrypt(json.dumps(replacement).encode()),company,connection))
            # A token refresh preserves the authenticated model list; new logins/rotation do not.
            db.execute('UPDATE company_provider_catalogs SET connection_revision=connection_revision+1 WHERE company=? AND connection=? AND connection_revision=?',(company,connection,row['revision']))
            self.audit(db,company,actor,'refresh_credential',connection,row['revision']+1)
        return self.capture(actor,company,bot)
