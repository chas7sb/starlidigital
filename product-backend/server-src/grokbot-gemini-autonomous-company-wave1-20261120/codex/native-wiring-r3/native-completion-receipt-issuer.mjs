import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export class NativeCompletionReceiptIssuer {
 constructor(issuer){if(typeof issuer?.issueFromCanonicalCompletion!=='function')throw Error('NATIVE_SIGNER_REQUIRED');this.issuer=issuer;}
 issueFromCanonicalCompletion(input){
  if(input.executionClass!=='NATIVE_NONPRODUCTION'||input.agencyReceipt?.executionClass!=='NATIVE_NONPRODUCTION')throw Error('EXPLICIT_NONPRODUCTION_PROVENANCE_REQUIRED');
  const digest=input.agencyReceipt.outputDigest;
  if(!/^[0-9a-f]{64}$/.test(digest||'')||createHash('sha256').update(readFileSync(input.artifactPath)).digest('hex')!==digest)throw Error('EXACT_NATIVE_OUTPUT_DIGEST_REQUIRED');
  return this.issuer.issueFromCanonicalCompletion(input);
 }
}
