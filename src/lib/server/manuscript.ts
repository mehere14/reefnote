import db from './db';
import { PDF_SIZES, DEFAULT_PDF_SIZE } from '../pdf-sizes';
import { CoreError, getNovel } from './core';
import PDFDocument from 'pdfkit';
import { zipSync, strToU8, type Zippable } from 'fflate';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

export type Manuscript = { id: string; title: string; chapters: { title: string; scenes: string[] }[] };
const xml = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[<>&"']/g, c => ({'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;'}[c]!));
const paragraphs = (text: string) => text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).filter(Boolean);
const heading = (text: string) => text.replace(/\r?\n/g, ' ').replace(/([\\`*_{}\[\]<>#!|])/g, '\\$1');

export function getManuscript(id: string): Manuscript {
 return db.transaction(() => {
  const novel = getNovel(id) as {id: string; title: string};
  const chapters = db.prepare("SELECT id,title FROM cards WHERE novel_id=? AND type='chapter' ORDER BY position,id").all(id) as {id:string;title:string}[];
  const scenes = db.prepare("SELECT c.parent_id,p.text FROM cards c JOIN scene_prose p ON p.scene_id=c.id WHERE c.novel_id=? AND c.type='scene' ORDER BY c.position,c.id").all(id) as {parent_id:string;text:string}[];
  return {id:novel.id, title:novel.title, chapters:chapters.map(chapter => ({title:chapter.title, scenes:scenes.filter(scene => scene.parent_id===chapter.id && scene.text.trim()).map(scene => scene.text)}))};
 })();
}

export function markdown(manuscript: Manuscript) {
 return `# ${heading(manuscript.title)}\n\n` + manuscript.chapters.map(chapter => `## ${heading(chapter.title)}\n\n${chapter.scenes.map(text => text.replace(/\r\n?/g, '\n').trim()).join('\n\n* * *\n\n')}`).join('\n\n') + '\n';
}

export function epub(manuscript: Manuscript) {
 const document = (title:string, body:string) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
 const chapterFile = (index:number) => `chapter-${index+1}.xhtml`;
 const files: Zippable = {
  mimetype: [strToU8('application/epub+zip'), {level:0}],
  'META-INF/container.xml':strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
  'EPUB/style.css':strToU8('body{font-family:serif;line-height:1.6;margin:5%}h1{text-align:center;margin:2em 0}p{margin:0 0 1em;white-space:pre-wrap}.break{text-align:center;margin:2em 0}'),
  'EPUB/title.xhtml':strToU8(document(manuscript.title, `<section epub:type="titlepage"><h1>${xml(manuscript.title)}</h1></section>`)),
  'EPUB/nav.xhtml':strToU8(document('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="title.xhtml">${xml(manuscript.title)}</a></li>${manuscript.chapters.map((c,i) => `<li><a href="${chapterFile(i)}">${xml(c.title)}</a></li>`).join('')}</ol></nav>`)),
  'EPUB/package.opf':strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:reefnote:${xml(manuscript.id)}</dc:identifier><dc:title>${xml(manuscript.title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>${manuscript.chapters.map((_,i) => `<item id="ch${i}" href="${chapterFile(i)}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine><itemref idref="title"/>${manuscript.chapters.map((_,i) => `<itemref idref="ch${i}"/>`).join('')}</spine></package>`)
 };
 manuscript.chapters.forEach((chapter,i) => {
  files[`EPUB/${chapterFile(i)}`] = strToU8(document(chapter.title, `<section epub:type="chapter"><h1>${xml(chapter.title)}</h1>${chapter.scenes.map(scene => paragraphs(scene).map(p => `<p>${xml(p).replace(/\n/g, '<br/>')}</p>`).join('')).join('<p class="break">* * *</p>')}</section>`));
 });
 return Buffer.from(zipSync(files));
}

const require = createRequire(import.meta.url);
export async function pdf(manuscript: Manuscript, pageSize: string = DEFAULT_PDF_SIZE): Promise<Buffer> {
 const size = PDF_SIZES.find(size => size.id===pageSize);
 if(!size)throw new CoreError(400,'Choose a supported PDF page size');
 const font = readFileSync(require.resolve('@fontsource/newsreader/files/newsreader-latin-400-normal.woff'));
 const doc = new PDFDocument({size:[size.width,size.height], margins:{top:54,bottom:54,left:45,right:45}, bufferPages:true, info:{Title:manuscript.title, Creator:'Reefnote'}});
 const chunks:Buffer[] = [];
 const result = new Promise<Buffer>((resolve,reject) => {doc.on('data', chunk => chunks.push(chunk));doc.on('end', () => resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 // Record chapter ownership as PDFKit adds overflow pages. Explicit chapter
 // opening pages and title pages have no running header.
 let currentChapter:string|null=null;
 const pageChapters:(string|null)[]=[null];
 doc.on('pageAdded',()=>pageChapters.push(currentChapter));
 doc.font(font).fontSize(28).text(manuscript.title, {align:'center'});
 for(const chapter of manuscript.chapters) {
  currentChapter=chapter.title;
  doc.addPage();
  pageChapters[pageChapters.length-1]=null;
  doc.fontSize(20).text(chapter.title, {align:'center'}).moveDown(2);
  chapter.scenes.forEach((scene,index) => {
   if(index)doc.fontSize(12).text('* * *', {align:'center'}).moveDown();
   for(const paragraph of paragraphs(scene))doc.fontSize(12).text(paragraph, {lineGap:3}).moveDown(0.5);
  });
 }
 const range = doc.bufferedPageRange();
 for(let i=range.start;i<range.start+range.count;i++) {
  doc.switchToPage(i);
  const width=doc.page.width-doc.page.margins.left-doc.page.margins.right;
  const chapter=pageChapters[i];
  if(chapter!==null) {
   // Physical even pages are on the left; odd pages are on the right.
   const header=((i+1)%2===0?manuscript.title:chapter).replace(/\s+/g,' ').trim();
   doc.fontSize(9).fillColor('#666666').text(header,doc.page.margins.left,27,{width,height:14,align:'center',ellipsis:true});
  }
  doc.fillColor('#000000');
  const bottom=doc.page.margins.bottom;
  doc.page.margins.bottom=0;
  doc.fontSize(10).text(String(i+1),doc.page.margins.left,doc.page.height-36,{width,align:'center',lineBreak:false});
  doc.page.margins.bottom=bottom;
 }
 doc.end();
 return result;
}

export async function exportManuscript(id: string, format: string | null, pageSize: string = DEFAULT_PDF_SIZE) {
 if(!['md','epub','pdf'].includes(format || ''))throw new CoreError(400,'Choose md, epub, or pdf for the export format');
 const manuscript = getManuscript(id);
 const data = format==='md' ? Buffer.from(markdown(manuscript),'utf8') : format==='epub' ? epub(manuscript) : await pdf(manuscript,pageSize);
 const name = manuscript.title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'-').replace(/^\.+|[. ]+$/g,'').trim().slice(0,100) || 'manuscript';
 const filename = `${name}.${format}`;
 return new Response(new Uint8Array(data), {headers:{
  'Content-Type':format==='md'?'text/markdown; charset=utf-8':format==='epub'?'application/epub+zip':'application/pdf',
  'Content-Disposition':`attachment; filename="${filename.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'
 }});
}
