"""Deployment attestation gate, NOT an unimplemented claim of network fencing."""
from .compiler import need
class WorkerGate:
    def __init__(self,attest,verify):self.attest,self.verify=attest,verify
    async def __call__(self,ctx,review_hash,effects,node_types):
        # attest/verify are private supervisor ports. A user JSON object is never
        # accepted as proof. All evidence is bound to exact company and flow hash.
        proof=await self.attest(ctx.company,review_hash)
        need(self.verify(proof) is True,'company_worker_attestation_invalid')
        need(proof.get('companyId')==ctx.company and proof.get('reviewHash')==review_hash,'company_worker_scope_changed')
        need(set(node_types)<=set(proof.get('loadedNodeTypes',[])),'company_nodes_not_enabled_on_engine')
        need(proof.get('hostExecBlocked') is True and proof.get('rawFileAccessBlocked') is True and proof.get('communityPackagesBlocked') is True,'company_worker_isolation_missing')
        if any(e['effect']!='pure' for e in effects):
            # Current deployment has NONE of these proofs: external dispatch is
            # intentionally held until actual worker/gateway acceptance.
            for field in ('companyCredentialIsolation','fixedProviderEgress','freshNodeGrantFence','revocationCancelsWorker','unknownNoRetry','noAmbientCredentials'):
                need(proof.get(field) is True,'company_external_worker_not_ready')
            requested={h for e in effects for h in e['hosts']}
            need(requested<=set(proof.get('permittedProviderHosts',[])),'company_worker_provider_host_denied')
        return True
