import {test} from 'node:test';import assert from 'node:assert/strict';
import {safeStripeUrl,creditEntryAmount} from './wallet-utils.ts';
test('payment redirect accepts only exact HTTPS Stripe hosts with no credentials',()=>{
 assert.equal(safeStripeUrl('https://checkout.stripe.com/c/pay/cs_test_example','checkout'),'https://checkout.stripe.com/c/pay/cs_test_example');
 assert.equal(safeStripeUrl('https://billing.stripe.com/p/session/test','portal'),'https://billing.stripe.com/p/session/test');
 for(const url of ['http://checkout.stripe.com/c/pay','https://checkout.stripe.com.evil.example/pay','https://checkout.stripe.com@evil.example/','https://user:secret@checkout.stripe.com/pay','javascript:alert(1)','https://checkout.stripe.com:444/pay','https://billing.stripe.com/p/session/test'])assert.throws(()=>safeStripeUrl(url,'checkout'));
 assert.throws(()=>safeStripeUrl('https://checkout.stripe.com/c/pay','portal'));
});
test('reservations cannot be presented as purchases or completed consumption',()=>{
 assert.equal(creditEntryAmount({kind:'RESERVE',amount:-40},String),'40 rezervate');
 assert.equal(creditEntryAmount({kind:'RELEASE',amount:40},String),'40 eliberate');
 assert.equal(creditEntryAmount({kind:'GRANT',amount:100},String),'+100');
 assert.equal(creditEntryAmount({kind:'SETTLE',amount:-40},String),'-40');
});
