import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePublicEndpoints} from './transport.ts';
test('local development retains the same-origin GraphQL proxy',()=>{assert.deepEqual(resolvePublicEndpoints(undefined,undefined,'http://127.0.0.1:5188'),{api:'/graphql',ws:'ws://127.0.0.1:5188/graphql'});});
test('production HTTPS API automatically derives the matching secure socket',()=>{assert.deepEqual(resolvePublicEndpoints('https://api.starlidigital.ro/graphql',undefined,'https://starlidigital.ro'),{api:'https://api.starlidigital.ro/graphql',ws:'wss://api.starlidigital.ro/graphql'});});
test('explicit websocket endpoint is used without changing the HTTP endpoint',()=>{assert.equal(resolvePublicEndpoints('/graphql','wss://api.starlidigital.ro/graphql','https://starlidigital.ro').ws,'wss://api.starlidigital.ro/graphql');});
test('mixed content and credentials are rejected',()=>{for(const api of ['http://api.starlidigital.ro/graphql','https://secret:key@api.starlidigital.ro/graphql','//untrusted.example/graphql','https://api.starlidigital.ro/graphql?token=secret'])assert.throws(()=>resolvePublicEndpoints(api,undefined,'https://starlidigital.ro'));assert.throws(()=>resolvePublicEndpoints(undefined,'ws://api.starlidigital.ro/graphql','https://starlidigital.ro'));});
