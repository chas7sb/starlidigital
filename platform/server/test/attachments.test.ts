import test from 'node:test';import assert from 'node:assert/strict';import {validateChatAttachments} from '../src/attachments.js';
test('accepted image content is preserved byte-for-byte instead of silently truncated',()=>{const bytes=Buffer.alloc(2*1024*1024);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);const image='data:image/png;base64,'+bytes.toString('base64');assert.equal(validateChatAttachments([{name:'hero.png',mimeType:'image/png',dataUrl:image}])[0].dataUrl,image);});
test('corrupt data, SVG, MIME mismatch and excessive attachments fail before persistence',()=>{
 for(const value of [[{name:'x',mimeType:'image/png',dataUrl:'data:image/png;base64,AAAA'}],[{name:'x',mimeType:'image/svg+xml',dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}],Array.from({length:6},()=>({name:'x',mimeType:'text/plain',textExcerpt:'data'}))])assert.throws(()=>validateChatAttachments(value));
});
