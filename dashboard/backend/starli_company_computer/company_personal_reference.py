"""Explicit bot or company account consent; shared credentials retain owner revocation."""
import hashlib,json,uuid
from company_bot_runtime.company_providers import CompanyProviders,Denied

class PersonalReferenceProviders(CompanyProviders):
    def _reference(self,actor,company,bot,credential):
        if not isinstance(credential,dict) or credential.get('type') not in ('personal_account_reference','company_account_reference'):return None
        shared=credential.get('type')=='company_account_reference'
        if credential.get('company')!=company or (not shared and credential.get('bot')!=bot):raise Denied('ACCOUNT_REFERENCE_SCOPE_DENIED')
        owner=credential.get('owner')
        from open_webui.models.users import Users
        from open_webui.routers import starli_providers as personal
        user=Users.get_user_by_id(owner)
        if user is None or user.role not in ('user','admin'):raise Denied('ACCOUNT_REFERENCE_REVOKED')
        self.fence(owner,company,None if shared else bot,'connections.manage')
        data=personal.account(owner);selection=data.get('selection') or {}
        provider=credential.get('provider');value=data.get('credentials',{}).get(provider)
        if (not shared and selection.get('provider')!=provider) or not isinstance(value,dict) or value.get('type')!='oauth' or (not shared and not selection.get('model')) or value.get('env'):raise Denied('ACCOUNT_REFERENCE_REVOKED')
        if not shared and selection['model'] not in self.catalog(provider):raise Denied('MODEL_UNSUPPORTED')
        return owner,personal,selection,value

    def connect_account_reference(self,actor,company,bot,expected_revision):
        self.fence(actor,company,bot,'connections.manage')
        from open_webui.routers import starli_providers as personal
        data=personal.account(actor);selected=data.get('selection') or {};provider=selected.get('provider')
        reference={'type':'personal_account_reference','owner':actor,'company':company,'bot':bot,'provider':provider}
        resolved=self._reference(actor,company,bot,reference)
        if resolved is None or provider!='openai':raise Denied('ACCOUNT_REFERENCE_UNSUPPORTED')
        with self.db() as db:
            self.fence(actor,company,bot,'shared_bot.choose_provider')
            old=db.execute('SELECT revision FROM company_bot_provider_selections WHERE company=? AND bot=?',(company,bot)).fetchone()
            if (old['revision'] if old else 0)!=expected_revision:raise Denied('SELECTION_CONFLICT')
            connection=str(uuid.uuid4())
            db.execute('INSERT INTO company_provider_connections VALUES(?,?,?,?,1,1)',(company,connection,provider,self.cipher.encrypt(json.dumps(reference).encode())))
            db.execute('INSERT OR REPLACE INTO company_bot_provider_selections VALUES(?,?,?,?,?,?,?)',(company,bot,connection,provider,selected['model'],expected_revision+1,actor))
            self.audit(db,company,actor,'connect_account_reference',connection,1);self.audit(db,company,actor,'choose',bot,expected_revision+1)
        return self.public_selection(actor,company,bot)

    def capture(self,actor,company,bot):
        snapshot=super().capture(actor,company,bot)
        resolved=self._reference(actor,company,bot,snapshot.get('credential'))
        if resolved:
            owner,_,selection,value=resolved
            reference=snapshot.get('credential') or {}
            if reference.get('type')!='company_account_reference':snapshot['model']=selection['model']
            snapshot['credential']=value
            snapshot['selectionRevision']=hashlib.sha256(json.dumps({'companyRevision':snapshot['selectionRevision'],'owner':owner,'selection':selection if reference.get('type')!='company_account_reference' else None,'credential':value},sort_keys=True).encode()).hexdigest()
        return snapshot

    def public_selection(self,actor,company,bot):
        result=super().public_selection(actor,company,bot)
        if result.get('connectionId'):
            try:
                current=self.capture(actor,company,bot)
                result['model']=current['model'];result['provider']=current['provider']
                reference=self._connection_reference(company,result['connectionId'])
                if reference and reference.get('type')=='company_account_reference':
                    result['mode']='company_connection'
                elif reference:
                    result['mode']='account_default'
                    result['accountReference']={'ownerUserId':reference['owner'],'followsDefault':True}
            except Denied:result['status']='connection_revoked'
        return result

    def refresh_runtime_credential(self,snapshot,replacement):
        reference=self._connection_reference(snapshot['companyId'],snapshot['connectionId'])
        if reference and reference.get('type')=='company_account_reference':
            owner,personal,_,previous=self._reference(snapshot['actorUserId'],snapshot['companyId'],snapshot['botId'],reference)
            self.check(snapshot)
            if not isinstance(replacement,dict) or replacement.get('type')!='oauth' or replacement.get('env') or len(json.dumps(replacement))>131072:raise Denied('COMPANY_CREDENTIAL_REFRESH_DENIED')
            provider=reference['provider']
            with personal.database() as db:
                row=db.execute('SELECT sealed FROM accounts WHERE owner=?',(owner,)).fetchone()
                if row is None:raise Denied('ACCOUNT_REFERENCE_REVOKED')
                data=json.loads(personal.cipher().decrypt(row[0]))
                if data.get('credentials',{}).get(provider)!=previous or previous!=snapshot['credential']:raise Denied('COMPANY_CREDENTIAL_REFRESH_CONFLICT')
                data['credentials'][provider]=replacement
                import time
                sealed=personal.cipher().encrypt(json.dumps(data).encode())
                if db.execute('UPDATE accounts SET sealed=?,updated=? WHERE owner=? AND sealed=?',(sealed,time.time(),owner,row[0])).rowcount!=1:raise Denied('COMPANY_CREDENTIAL_REFRESH_CONFLICT')
            return self.capture(snapshot['actorUserId'],snapshot['companyId'],snapshot['botId'])
        with self.db() as db:
            row=db.execute('SELECT sealed FROM company_provider_connections WHERE company=? AND id=? AND active=1',(snapshot['companyId'],snapshot['connectionId'])).fetchone()
            reference=json.loads(self.cipher.decrypt(row['sealed'])) if row else None
        resolved=self._reference(snapshot['actorUserId'],snapshot['companyId'],snapshot['botId'],reference)
        if resolved is None:return super().refresh_runtime_credential(snapshot,replacement)
        self.check(snapshot)
        if not isinstance(replacement,dict) or replacement.get('type')!='oauth' or replacement.get('env') or len(json.dumps(replacement))>131072:raise Denied('COMPANY_CREDENTIAL_REFRESH_DENIED')
        owner,personal,selection,_=resolved
        with personal.database() as db:
            row=db.execute('SELECT sealed FROM accounts WHERE owner=?',(owner,)).fetchone()
            if row is None:raise Denied('ACCOUNT_REFERENCE_REVOKED')
            data=json.loads(personal.cipher().decrypt(row[0]))
            if data.get('selection')!=selection or data.get('credentials',{}).get(selection['provider'])!=snapshot['credential']:raise Denied('COMPANY_CREDENTIAL_REFRESH_CONFLICT')
            data['credentials'][selection['provider']]=replacement
            import time
            sealed=personal.cipher().encrypt(json.dumps(data).encode())
            changed=db.execute('UPDATE accounts SET sealed=?,updated=? WHERE owner=? AND sealed=?',(sealed,time.time(),owner,row[0])).rowcount
            if changed!=1:raise Denied('COMPANY_CREDENTIAL_REFRESH_CONFLICT')
        return self.capture(snapshot['actorUserId'],snapshot['companyId'],snapshot['botId'])

    def refresh(self,actor,company,connection,expected_revision):
        self.fence(actor,company,permission='connections.manage')
        with self.db() as db:
            row=db.execute('SELECT * FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
            if row is None:raise Denied('COMPANY_CONNECTION_UNAVAILABLE')
            reference=json.loads(self.cipher.decrypt(row['sealed']))
            if row['revision']!=expected_revision:raise Denied('CONNECTION_CONFLICT')
        if reference.get('type')=='company_account_reference':raise Denied('COMPANY_MODEL_REFRESH_UNAVAILABLE')
        if reference.get('type')!='personal_account_reference':return super().refresh(actor,company,connection,expected_revision)
        bot=reference['bot'];resolved=self._reference(actor,company,bot,reference)
        if not callable(self.refresh_models):raise Denied('COMPANY_MODEL_REFRESH_UNAVAILABLE')
        snapshot=self.capture(actor,company,bot)
        if snapshot['connectionId']!=connection:raise Denied('COMPANY_SELECTION_CHANGED')
        refreshed=self.refresh_models(resolved[2]['provider'],resolved[3])
        models=refreshed.get('models') if isinstance(refreshed,dict) else None
        state=refreshed.get('modelsState') if isinstance(refreshed,dict) else None
        if not isinstance(models,list) or len(models)>20000 or any(not isinstance(m,str) or not 0<len(m)<=180 for m in models) or len(json.dumps(state))>2097152:raise Denied('COMPANY_MODEL_CATALOG_INVALID')
        replacement=refreshed.get('credential',resolved[3])
        if replacement!=resolved[3]:snapshot=self.refresh_runtime_credential(snapshot,replacement)
        self.check(snapshot)
        with self.db() as db:
            self.fence(actor,company,bot,'connections.manage')
            current=db.execute('SELECT * FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
            if current is None or current['revision']!=expected_revision or json.loads(self.cipher.decrypt(current['sealed']))!=reference:raise Denied('CONNECTION_CONFLICT')
            revision=self.catalog_revision(db,company,connection)+1
            models=list(dict.fromkeys(models))
            db.execute('INSERT OR REPLACE INTO company_provider_catalogs VALUES(?,?,?,?,?,?)',(company,connection,revision,expected_revision,json.dumps(models),json.dumps(state)))
            self.audit(db,company,actor,'refresh_models',connection,revision)
        return {'catalogRevision':revision,'connectionRevision':expected_revision,'models':models}

    def _connection_reference(self,company,connection):
        if not connection:return None
        with self.db() as db:
            row=db.execute('SELECT sealed FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
            value=json.loads(self.cipher.decrypt(row['sealed'])) if row else None
        return value if isinstance(value,dict) and value.get('type') in ('personal_account_reference','company_account_reference') else None

    def options(self,actor,company,bot):
        items=super().options(actor,company,bot);result=[]
        for item in items:
            reference=self._connection_reference(company,item['connectionId'])
            if reference:
                shared=reference.get('type')=='company_account_reference'
                if reference.get('company')!=company or (not shared and reference.get('bot')!=bot):continue
                try:resolved=self._reference(actor,company,bot,reference)
                except Denied:continue
                if shared:item={**item,'mode':'company_connection'}
                else:item={**item,'models':[resolved[2]['model']],'mode':'account_default','accountReference':{'ownerUserId':reference['owner'],'followsDefault':True}}
            result.append(item)
        return result

    def choose(self,actor,company,bot,connection,model,expected_revision):
        self.fence(actor,company,bot,'shared_bot.choose_provider')
        reference=self._connection_reference(company,connection)
        if reference:
            resolved=self._reference(actor,company,bot,reference)
            if reference.get('type')!='company_account_reference' and model!=resolved[2]['model']:raise Denied('ACCOUNT_DEFAULT_MODEL_MANAGED')
        return super().choose(actor,company,bot,connection,model,expected_revision)

    def company_account(self,actor,company):
        self.fence(actor,company,permission='connections.manage')
        from open_webui.routers import starli_providers as personal
        data=personal.account(actor);credential=data.get('credentials',{}).get('openai')
        available=isinstance(credential,dict) and credential.get('type')=='oauth' and not credential.get('env')
        return {'companyId':company,'provider':'openai','available':bool(available),'models':self.catalog('openai') if available else []}

    def connect_company_account(self,actor,company,consent):
        self.fence(actor,company,permission='connections.manage')
        if consent is not True:raise Denied('COMPANY_ACCOUNT_CONSENT_REQUIRED')
        reference={'type':'company_account_reference','owner':actor,'company':company,'provider':'openai'}
        self._reference(actor,company,None,reference)
        with self.db() as db:
            self.fence(actor,company,permission='connections.manage')
            rows=db.execute('SELECT id,sealed FROM company_provider_connections WHERE company=? AND active=1',(company,)).fetchall()
            for row in rows:
                if json.loads(self.cipher.decrypt(row['sealed']))==reference:return {'connectionId':row['id']}
            connection=str(uuid.uuid4())
            db.execute('INSERT INTO company_provider_connections VALUES(?,?,?,?,1,1)',(company,connection,'openai',self.cipher.encrypt(json.dumps(reference).encode())))
            self.audit(db,company,actor,'connect_company_account_reference',connection,1)
        return {'connectionId':connection}
