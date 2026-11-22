import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSchema,parse,validate} from 'graphql';
const source=readFileSync(new URL('../../server/src/schema.ts',import.meta.url),'utf8');
const definition=source.match(/const typeDefs=[^`]*`([\s\S]*?)`;/)?.[1];
assert.ok(definition,'GraphQL schema must be available for frontend contract verification');
const schema=buildSchema(definition);
const quote='id projectId domain supported available currency purchasePrice renewalPrice amount years quotedAt expiresAt reason status contactSchemaJson';
const payment='id quoteId projectId domain amount currency status checkoutUrl createdAt paidAt fulfillmentStatus error orderId autoRenew years verification{type domain value reason}';
const email='id kind recipientMasked subject status providerId attempts error createdAt updatedAt deliveredAt';
function valid(document:string){assert.deepEqual(validate(schema,parse(document)).map(e=>e.message),[]);}
test('registrar quote and paid checkout match the implemented API',()=>{valid(`{domainQuotes{${quote}} domainPayments{${payment}}}`);valid(`mutation($projectId:ID!,$domain:String!,$years:Int){createDomainQuote(projectId:$projectId,domain:$domain,years:$years){${quote}}}`);valid(`mutation($quoteId:ID!,$autoRenew:Boolean!,$consent:Boolean!,$contactInformation:DomainContactInput!){createDomainCheckout(quoteId:$quoteId,autoRenew:$autoRenew,consent:$consent,contactInformation:$contactInformation){${payment}}}`);});
test('domain live updates return scoped quote and order records',()=>{valid(`subscription{domainsUpdated{quotes{${quote}} payments{${payment}}}}`);});
test('email diagnostics expose delivery evidence without private payloads',()=>{valid(`{emailStatus{provider configured sender webhookConfigured} adminEmailDeliveries{${email}}}`);valid(`mutation($to:String!){testEmail(to:$to){${email}}}`);valid(`mutation($id:ID!){retryEmail(id:$id){${email}}}`);valid(`subscription{emailDeliveriesUpdated{${email}}}`);});
test('fulfillment and billing mode contracts support durable progress',()=>{valid('{pricing{configured amount currency mode}}');valid('query($projectId:ID){fulfillmentJobs(projectId:$projectId){id projectId paymentId status error updatedAt createdAt}}');valid('subscription($projectId:ID){fulfillmentUpdated(projectId:$projectId){id projectId paymentId status error updatedAt createdAt}}');});
