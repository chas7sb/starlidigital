import {createHash} from 'node:crypto';
// Internal binding only. Both the mailbox's transport digest and Studio's full approval are checked.
export function mailboxAdapter(mailbox){return {
 deliver(p){const rawMime=p.rawMime.toString('utf8');const approvalDigest=createHash('sha256').update(JSON.stringify({envelope:p.envelope,rawMime})).digest('hex');return mailbox.deliver({...p,rawMime,approvalDigest,contentApprovalDigest:p.approvalDigest});},
 status(operationId,ctx){return mailbox.status(operationId,ctx.companyId,ctx.actorId);}
};}
// Wire as StudioDelivery.verifyApproval. resolveAccount must recheck a provisioned/verified company
// sender, live connection and domain receipt; it returns accountId and private smtp settings.
export function approvalVerifier(studio,resolveAccount){return request=>{
 const ctx={companyId:request.companyId,actorId:request.actorId};studio.scope(ctx,'messages.send');
 const op=studio.db.prepare('SELECT o.state,a.* FROM operations o JOIN approvals a ON a.id=o.approval JOIN drafts d ON d.id=a.draft WHERE o.id=? AND d.company=? AND a.actor=?').get(request.operationId,ctx.companyId,ctx.actorId);
 if(!op||op.state!=='pending')throw Error('No pending approved Studio operation');const p=JSON.parse(op.payload);studio.assertCurrent(ctx,op.draft,p);
 if(request.rawMime!==Buffer.from(p.mime,'base64').toString('utf8')||JSON.stringify(request.envelope)!==JSON.stringify(p.envelope))throw Error('Approved MIME/envelope mismatch');
 const account=resolveAccount(ctx,p.identity);return {...account,draftId:op.draft,revision:op.revision};
};}
