import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStaticDocument } from '../src/site-builder.js';

const document=(inside:string)=>`<!doctype html><html lang="ro"><head><title>Salon</title></head><body><main>${'<p>Conținut de prezentare.</p>'.repeat(35)}${inside}</main></body></html>`;
test('static preview receives deny-by-default CSP',()=>{
  const result=validateStaticDocument(document('<a href="#servicii">Servicii</a>'));
  assert.match(result,/script-src 'none'/);assert.match(result,/form-action 'none'/);
});
test('active generated content rejected, not executed or silently repaired',()=>{
  for(const content of ['<script>alert(1)</script>','<img src=x onerror="alert(1)">','<iframe src="https://example.com"></iframe>','<a href="javascript:alert(1)">x</a>','<form action="https://example.com"></form>'])assert.throws(()=>validateStaticDocument(document(content)));
});
test('incomplete or non-Romanian documents rejected',()=>{
  assert.throws(()=>validateStaticDocument('<h1>Test</h1>'));
  assert.throws(()=>validateStaticDocument(document('').replace('lang="ro"','lang="en"')));
});
