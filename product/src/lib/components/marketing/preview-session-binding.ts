/** Transport reuse only; server authority and iframe gate remain separate. */
export function samePreviewSession(previous:any,next:any):boolean{
 const a=previous?.receipt,b=next?.receipt;
 return Boolean(previous?.trustedFrameUrl&&a&&b&&
 previous.authorizedPreviewId===(next.authorizedPreviewId||next.previewId)&&
 previous.previewOrigin===next.previewOrigin&&
 a.companyId===b.companyId&&a.projectId===b.projectId&&
 typeof a.leaseId==='string'&&a.leaseId.length>0&&a.leaseId===b.leaseId&&
 Number.isSafeInteger(a.generation)&&a.generation>0&&a.generation===b.generation&&
 typeof a.artifactDigest==='string'&&a.artifactDigest.length===64&&a.artifactDigest===b.artifactDigest);
}
