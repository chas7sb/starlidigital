"""Adapter to existing canonical native Drive APIs; no paths/blob URLs."""
from .data import need, text


class CanonicalDrive:
    def __init__(self,factory):
        # Trusted host factory returns actual native Drive using its configured
        # authority/database/storage/quota; never a model-selected DB or path.
        self.factory=factory

    def read_text(self,ctx,resource,version,max_bytes,fence):
        fence()
        drive=self.factory(ctx)
        try:
            # Reject oversized files through canonical ACL-bound metadata BEFORE
            # the existing whole-blob content API allocates the source bytes.
            with drive.access(ctx.actor,ctx.company) as member:
                row=drive.row(member,resource)
                need(row['kind']=='file' and row['version']==version,'DRIVE_VERSION_CHANGED')
                metadata=drive.db.execute('SELECT size FROM drive_versions WHERE resource=? AND version=?',(resource,version)).fetchone()
                need(metadata is not None and 0<=metadata['size']<=max_bytes,'DRIVE_TEXT_LIMIT')
                fence()
            raw,mime=drive.content(ctx.actor,ctx.company,resource,version)
            need(type(raw) is bytes and len(raw)<=max_bytes,'DRIVE_TEXT_LIMIT')
            value=raw.decode('utf-8',errors='strict')
            fence()
            return dict(resourceId=resource,version=version,text=text(value),mime=mime)
        finally:drive.db.close()

    def write_text(self,ctx,args,operation,fence):
        fence()
        drive=self.factory(ctx)
        try:
            row=drive.create_item(ctx.actor,ctx.company,args['title'],kind='file',parent=args.get('parentId'),
                                  data=text(args['text']).encode(),mime='text/plain')
            fence()
            need(row['company']==ctx.company,'DRIVE_COMPANY_MISMATCH')
            return dict(companyId=ctx.company,resourceId=row['id'],version=row['version'])
        finally:drive.db.close()
