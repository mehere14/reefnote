import {beforeEach, describe, expect, it, vi} from 'vitest';
import PDFDocument from 'pdfkit';
import {unzipSync, strFromU8} from 'fflate';
process.env.NOVEL_STUDIO_DB=':memory:';
const db=(await import('../src/lib/server/db')).default;
const {createCard, saveProse, moveCard}=await import('../src/lib/server/core');
const {getManuscript, markdown, epub, pdf, exportManuscript}=await import('../src/lib/server/manuscript');
const api=await import('../src/routes/api/[...path]/+server');
beforeEach(()=>{db.prepare('DELETE FROM novels').run();db.prepare("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book',?,0,0)").run('Café & <Tides> “Home”');});
function chapter(title:string){return createCard('book',{type:'chapter',title,body:'Planning notes must not be exported'});}
function scene(parentId:string,text:string){const c=createCard('book',{type:'scene',parentId,title:'Private scene label',body:'Scene outline'});saveProse(c.id,{text,baseRev:1});return c;}

describe('manuscript exports',()=>{
 it('exports full prose in the current chapter and scene order without planning content',()=>{
  const first=chapter('First'), second=chapter('Second');
  const a=scene(first.id,'Original opening.');scene(first.id,'Next scene.');scene(first.id,'   ');
  scene(second.id,'Long passage '+ 'word '.repeat(45000)+'THE END');
  moveCard(second.id,{direction:-1});moveCard(a.id,{direction:1});
  const manuscript=getManuscript('book');
  expect(manuscript.chapters.map(c=>c.title)).toEqual(['Second','First']);
  expect(manuscript.chapters[1].scenes).toEqual(['Next scene.','Original opening.']);
  const md=markdown(manuscript);
  expect(md).toContain('THE END');expect(md).toContain('Next scene.\n\n* * *\n\nOriginal opening.');
  expect(md).not.toContain('Planning notes');expect(md).not.toContain('Private scene label');
 });
 it('creates an EPUB with an uncompressed first mimetype entry, matching spine and navigation, and escaped XHTML',()=>{
  const c=chapter('Waves & <Wind>');scene(c.id,'“Hello,” said José.\nA < B & C.\n\nAnother paragraph.');scene(c.id,'Ending.');
  const archive=epub(getManuscript('book'));
  expect(archive.readUInt32LE(0)).toBe(0x04034b50);expect(archive.readUInt16LE(8)).toBe(0);
  expect(archive.subarray(30,38).toString()).toBe('mimetype');
  const files=unzipSync(archive);
  expect(strFromU8(files.mimetype)).toBe('application/epub+zip');
  expect(strFromU8(files['META-INF/container.xml'])).toContain('EPUB/package.opf');
  expect(strFromU8(files['EPUB/package.opf'])).toContain('<itemref idref="ch0"/>');
  expect(strFromU8(files['EPUB/nav.xhtml'])).toContain('href="chapter-1.xhtml"');
  const body=strFromU8(files['EPUB/chapter-1.xhtml']);
  expect(body).toContain('Waves &amp; &lt;Wind&gt;');expect(body).toContain('José.');expect(body).toContain('A &lt; B &amp; C.');expect(body).toContain('<br/>');expect(body).toContain('class="break"');
 });
 it('generates a paginated PDF with an embedded font and a correct download response',async()=>{
  const c=chapter('Chapter one');scene(c.id,'“Café,” José said.\n\n'+ 'A paragraph of manuscript prose. '.repeat(1500));
  const result=await pdf(getManuscript('book'));
  expect(result.subarray(0,5).toString()).toBe('%PDF-');
  const content=result.toString('latin1');expect(content).toContain('/FontFile');expect(content).toContain('/ToUnicode');
  expect((content.match(/\/Type \/Page\b/g)||[]).length).toBeGreaterThan(2);
  const response=await exportManuscript('book','pdf');
  expect(response.headers.get('Content-Type')).toBe('application/pdf');
  expect(response.headers.get('Content-Disposition')).toContain('filename*=UTF-8\'\'Caf%C3%A9');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
 });
 it('uses the recommended trim size by default on every page',async()=>{
  const c=chapter('Chapter one');scene(c.id,'A long passage of prose. '.repeat(1500));
  const content=(await pdf(getManuscript('book'))).toString('latin1');
  const boxes=[...content.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(match=>match[1]);
  expect(boxes.length).toBeGreaterThan(2);
  expect(new Set(boxes)).toEqual(new Set(['0 0 396 612']));
 });
 it.each([
  ['5x8',360,576],['5.25x8',378,576],['5.5x8.5',396,612],['6x9',432,648],['a5',419.527559,595.275591]
 ])('exports the requested %s size through the API',async(size,width,height)=>{
  const url=new URL(`http://localhost/api/novels/book/export?format=pdf&pageSize=${size}`);
  const response=await api.GET({request:new Request(url),url,params:{path:'novels/book/export'}} as any);
  expect(response.status).toBe(200);
  const content=Buffer.from(await response.arrayBuffer()).toString('latin1');
  const box=content.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
  expect(Number(box[1])).toBeCloseTo(Number(width),4);
  expect(Number(box[2])).toBeCloseTo(Number(height),4);
 });
 it('alternates running headers, updates chapters, and omits headers on opening pages',async()=>{
  const spy=vi.spyOn(PDFDocument.prototype,'text');
  try {
   const content=(await pdf({id:'headers',title:'Book title',chapters:[
    {title:'First chapter',scenes:['First passage. '.repeat(2500)]},
    {title:'Second chapter',scenes:['Second passage. '.repeat(2500)]}
   ]},'5x8')).toString('latin1');
   const pages:(string|null)[]=[];
   let header:string|null=null;
   for(const args of spy.mock.calls) {
    if(args[2]===27)header=String(args[0]);
    if(args[2]===576-36){pages.push(header);header=null;}
   }
   expect(pages.length).toBe((content.match(/\/Type \/Page\b/g)||[]).length);
   expect(pages.slice(0,4)).toEqual([null,null,'First chapter','Book title']);
   const secondOpening=pages.findIndex((value,index)=>index>1&&value===null);
   expect(secondOpening).toBeGreaterThan(3);
   expect(pages.slice(secondOpening+1)).toContain('Second chapter');
   for(let i=2;i<pages.length;i++) {
    if(i===secondOpening)continue;
    expect(pages[i]).toBe((i+1)%2===0?'Book title':i<secondOpening?'First chapter':'Second chapter');
   }
  } finally {spy.mockRestore();}
 });
 it('rejects unsupported PDF sizes',async()=>{
  const url=new URL('http://localhost/api/novels/book/export?format=pdf&pageSize=unknown');
  const response=await api.GET({request:new Request(url),url,params:{path:'novels/book/export'}} as any);
  expect(response.status).toBe(400);
 });
 it('allows empty books and chapters in every format',async()=>{
  expect(markdown(getManuscript('book'))).toContain('# Café');expect(unzipSync(epub(getManuscript('book')))['EPUB/title.xhtml']).toBeDefined();
  expect((await pdf(getManuscript('book'))).toString('latin1')).toContain('/Type /Page');
  chapter('Empty chapter');expect(markdown(getManuscript('book'))).toContain('## Empty chapter');
 });
 it('returns attachments and handles invalid formats and missing books through the API',async()=>{
  const call=async(path:string)=>{const url=new URL(`http://localhost/api/${path}`);return api.GET({request:new Request(url),url,params:{path:url.pathname.slice(5)}} as any);};
  for(const format of ['md','epub','pdf']){const response=await call(`novels/book/export?format=${format}`);expect(response.status).toBe(200);expect(response.headers.get('Content-Disposition')).toContain(`.${format}`);}
  expect((await call('novels/book/export?format=html')).status).toBe(400);
  expect((await call('novels/missing/export?format=md')).status).toBe(404);
 });
});
