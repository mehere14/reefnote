import {test,expect} from 'vitest';
import {zipSync,strToU8} from 'fflate';
import {prepareAttachments,attachmentContext} from '../src/lib/server/ai/attachments';
const file=(name:string,text:string)=>({name,data:Buffer.from(text).toString('base64')});
test('research files preserve text and DOCX paragraphs and entities',()=>{
 const doc=zipSync({'word/document.xml':strToU8('<w:document><w:p><w:r><w:t>Tea &amp; sea</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p></w:document>')});
 const result=prepareAttachments([file('notes.md','# Research'),{name:'research.docx',data:Buffer.from(doc).toString('base64')}]);
 expect(result[1].text).toBe('Tea & sea\nNext\n');
 expect(attachmentContext([{attachments:JSON.stringify(result)}]).text).toContain('# Research');
});
test('rejects invalid, oversized, unsupported, and unreadable documents',()=>{
 for(const input of [file('notes.pdf','pdf'),file('empty.txt',' '),file('broken.docx','oops'),{name:'notes.txt',data:'@@@'},file('long.md','a'.repeat(100001))])expect(()=>prepareAttachments([input])).toThrow();
});
test('detects image bytes without trusting filename and retains image data',()=>{
 const image={name:'photo.jpg',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
 const result=prepareAttachments([image]);expect(result[0].mime).toBe('image/png');
 expect(attachmentContext([{attachments:JSON.stringify(result)}]).images[0].data).toBe(image.data);
});
