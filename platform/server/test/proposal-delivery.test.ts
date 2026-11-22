import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import {
  createOrUpdateProposalDemo,
  getProposalDeliveryInfo,
  rotateOrRevokeClaimCode,
  claimProposalWebsite,
  getPublicProposalBySlug,
  upsertLead
} from '../src/leads-proposals.js';

test('Proposal Delivery Info - creation, retrieval, rotation, security and claim flow', async () => {
  const store = new Store(':memory:');
  const events = new Events();

  const adminUser = { id: 'usr_admin1', role: 'ADMIN', username: 'admin' };
  const adminCtx = { user: adminUser, ip: '127.0.0.1' };
  const visitorCtx = { user: null, ip: '192.168.1.100' };

  // 1. Create a lead and proposal
  const leadRes = upsertLead(store, events, adminCtx as any, {
    businessName: 'Cabinet Stomatologic Dr. Popescu',
    industry: 'Stomatologie',
    locality: 'Cluj-Napoca',
    phone: '+40721234567',
    email: 'contact@drpopescu.ro',
  });
  assert.ok(leadRes.lead.id);

  const proposalRes = await createOrUpdateProposalDemo(store, events, adminCtx as any, {
    leadId: leadRes.lead.id,
    businessName: 'Cabinet Stomatologic Dr. Popescu',
    industry: 'Stomatologie',
    locality: 'Cluj-Napoca',
    phone: '+40721234567',
    email: 'contact@drpopescu.ro',
    mode: 'snapshot',
  });

  // Verify creation response includes 5-digit claim code
  assert.ok(proposalRes.proposal.id);
  assert.ok(proposalRes.claimCode);
  assert.match(proposalRes.claimCode, /^\d{5}$/, 'Claim code must be 5 digits');
  assert.equal(proposalRes.proposal.businessName, 'Cabinet Stomatologic Dr. Popescu');

  // Verify database record has salted scrypt hash and masked prefix, never plaintext code
  const storedInDb = store.get('proposals', proposalRes.proposal.id) as any;
  assert.ok(storedInDb.claimCodeHash.startsWith('claim-v2:'));
  assert.equal(storedInDb.claimCodePrefix, '•••••');
  assert.equal((storedInDb as any).claimCode, undefined, 'Plaintext claimCode must NEVER be stored in the DB');

  // 2. Retrieve delivery info via getProposalDeliveryInfo
  const deliveryInfo = getProposalDeliveryInfo(store, events, adminCtx as any, proposalRes.proposal.id);
  assert.equal(deliveryInfo.proposalId, proposalRes.proposal.id);
  assert.equal(deliveryInfo.businessName, 'Cabinet Stomatologic Dr. Popescu');
  assert.equal(deliveryInfo.publicUrl, `https://starlidigital.ro/propunere/${proposalRes.proposal.publicSlug}`);
  assert.equal(deliveryInfo.claimCode, proposalRes.claimCode, 'Cached code matches newly created proposal');
  assert.equal(deliveryInfo.reissued, false, 'Freshly created code is not reissued');
  assert.equal(deliveryInfo.claimed, false);

  // 3. Security: public endpoint NEVER exposes claim code or hash
  const publicView = getPublicProposalBySlug(store, events, proposalRes.proposal.publicSlug);
  assert.equal(publicView.businessName, 'Cabinet Stomatologic Dr. Popescu');
  assert.equal((publicView as any).claimCode, undefined);
  assert.equal((publicView as any).claimCodeHash, undefined);
  assert.equal((publicView as any).claimCodePrefix, undefined);

  // 4. Security: unauthenticated / non-operator cannot retrieve delivery info
  assert.throws(
    () => getProposalDeliveryInfo(store, events, visitorCtx as any, proposalRes.proposal.id),
    /operator/i
  );

  // 5. Reissuing / rotating claim code invalidates previous code
  const oldCode = deliveryInfo.claimCode!;
  const rotated = rotateOrRevokeClaimCode(store, events, adminCtx as any, proposalRes.proposal.id, false);
  assert.ok(rotated.claimCode);
  assert.match(rotated.claimCode, /^\d{5}$/);
  assert.notEqual(rotated.claimCode, oldCode, 'Rotated code is different from old code');

  // Delivery info now reflects the new code
  const updatedDelivery = getProposalDeliveryInfo(store, events, adminCtx as any, proposalRes.proposal.id);
  assert.equal(updatedDelivery.claimCode, rotated.claimCode);

  // 6. Attempting to claim with the old code fails
  const clientUser = { id: 'usr_client1', role: 'USER', username: 'drpopescu' };
  store.put('users', clientUser);
  const clientCtx = { user: clientUser, ip: '127.0.0.1' };

  assert.throws(
    () => claimProposalWebsite(store, events, clientCtx as any, {
      publicSlug: proposalRes.proposal.publicSlug,
      claimCode: oldCode,
    }),
    /codul/i
  );

  // 7. Claiming with the new valid code succeeds
  const claimResult = claimProposalWebsite(store, events, clientCtx as any, {
    publicSlug: proposalRes.proposal.publicSlug,
    claimCode: rotated.claimCode!,
  });
  assert.ok(claimResult.project.id);
  assert.equal(claimResult.proposal.status, 'REVENDICAT');
  assert.equal(claimResult.proposal.claimedByUserId, clientUser.id);

  // 8. Subsequent retrieval of delivery info shows claimed: true and claimCode: null
  const postClaimDelivery = getProposalDeliveryInfo(store, events, adminCtx as any, proposalRes.proposal.id);
  assert.equal(postClaimDelivery.claimed, true);
  assert.equal(postClaimDelivery.claimCode, null);
  assert.equal(postClaimDelivery.status, 'REVENDICAT');

  // 9. Idempotent repeat by the same user returns alreadyClaimedByMe: true
  const repeatClaim = claimProposalWebsite(store, events, clientCtx as any, {
    publicSlug: proposalRes.proposal.publicSlug,
    claimCode: rotated.claimCode!,
  });
  assert.equal(repeatClaim.alreadyClaimedByMe, true);

  // 10. Another user trying to claim fails with 'deja revendicată'
  const otherUser = { id: 'usr_other', role: 'USER', username: 'other' };
  store.put('users', otherUser);
  const otherCtx = { user: otherUser, ip: '127.0.0.1' };
  assert.throws(
    () => claimProposalWebsite(store, events, otherCtx as any, {
      publicSlug: proposalRes.proposal.publicSlug,
      claimCode: rotated.claimCode!,
    }),
    /deja revendicată/i
  );

  store.close();
});
