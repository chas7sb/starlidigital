import test from 'node:test';
import assert from 'node:assert/strict';
import {accountEmail,accountUsername,administratorEmail} from '../src/account-identity.js';
import {parseSmtpConfig,validateSmtpConfig} from '../src/smtp.js';
test('account identities default to local.invalid and accept explicit instance configuration',()=>{
 const domain=process.env.ACCOUNT_EMAIL_DOMAIN,admin=process.env.ADMIN_EMAIL;
 try{
  delete process.env.ACCOUNT_EMAIL_DOMAIN;delete process.env.ADMIN_EMAIL;
  assert.equal(accountEmail('owner'),'owner@local.invalid');assert.equal(administratorEmail('owner'),'owner@local.invalid');
  process.env.ACCOUNT_EMAIL_DOMAIN='accounts.example.test';process.env.ADMIN_EMAIL='owner@example.test';
  assert.equal(accountEmail('member'),'member@accounts.example.test');assert.equal(accountUsername('Member@accounts.example.test'),'member');assert.equal(administratorEmail('owner'),'owner@example.test');
  process.env.ACCOUNT_EMAIL_DOMAIN='bad\r\ndomain';assert.throws(()=>accountEmail('member'),/invalid/);
 }finally{domain===undefined?delete process.env.ACCOUNT_EMAIL_DOMAIN:process.env.ACCOUNT_EMAIL_DOMAIN=domain;admin===undefined?delete process.env.ADMIN_EMAIL:process.env.ADMIN_EMAIL=admin;}
});
test('SMTP has no original sender fallback and requires an explicit sender',()=>{
 const config=parseSmtpConfig({SMTP_ENABLED:'true'});assert.equal(config.from,'');assert.equal(validateSmtpConfig(config).valid,false);
});
