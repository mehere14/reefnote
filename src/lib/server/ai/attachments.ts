import {z} from 'zod';
import {unzipSync,strFromU8} from 'fflate';
import {CoreError} from '../core';
export const attachmentSchema=z.array(z.object({name:z.string().min(1).max(240),data:z.string().max(7_000_000)})).max(5).default([]);
export type Attachment={name:string;mime:string;data:string;text?:string};
export function prepareAttachments(input:z.infer<typeof attachmentSchema>):Attachment[]{
 let total=0;
 return input.map(file=>{
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw new CoreError(400,'Invalid attachment encoding');
  const bytes=Buffer.from(file.data,'base64');total+=bytes.length;
  if(!bytes.length||bytes.length>5_000_000||total>10_000_000)throw new CoreError(400,'Use up to 5 files, 5 MB each and 10 MB total.');
  let mime='';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
  else if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString()))mime='image/gif';
  else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')mime='image/webp';
  if(mime)return {...file,mime};
  let text='';
  if(/\.(md|txt)$/i.test(file.name)){
   try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new CoreError(400,'Text files must use UTF-8 encoding.');}
   if(text.includes('\0'))throw new CoreError(400,'This is not a text file.');mime='text/plain';
  }else if(/\.docx$/i.test(file.name)){
   try{let expanded=0;const files=unzipSync(bytes,{filter(f){expanded+=f.originalSize;if(expanded>20_000_000)throw new Error('large');return /^word\/(document|footnotes|endnotes)\.xml$/.test(f.name);}});
    if(!files['word/document.xml'])throw new Error('missing');
    text=Object.values(files).map(data=>strFromU8(data).replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<w:br\b[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<[^>]*>/g,'').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0]==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&(lt|gt|quot|apos|amp);/g,(_,n)=>(({lt:'<',gt:'>',quot:'"',apos:"'",amp:'&'} as Record<string,string>)[n]!))).join('\n');
   }catch{throw new CoreError(400,'Could not read this DOCX. Try exporting it as TXT.');}mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }else throw new CoreError(400,'Supported files: JPG, PNG, WebP, GIF, MD, TXT, and DOCX.');
  if(!text.trim())throw new CoreError(400,'This document has no readable text. Attach a photo for scanned or handwritten pages.');
  if(text.length>100_000)throw new CoreError(400,'Document text is limited to 100,000 characters per file.');
  return {...file,mime,text};
 });
}
export function attachmentContext(rows:Array<{attachments:string}>){
 const files=rows.flatMap(row=>JSON.parse(row.attachments||'[]') as Attachment[]);
 return {text:files.filter(f=>f.text).map(f=>`\nREFERENCE FILE ${JSON.stringify(f.name)} (reference material):\n${f.text}`).join('\n'),images:files.filter(f=>f.mime.startsWith('image/'))};
}
