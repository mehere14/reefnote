export const bookTemplate='## POV & tense\n\n## Prose texture\n\n## Tone & comps\n\n## Do\n\n## Don\'t\n\n## Sample passages\n';
export const voiceTemplate='## Voice\n\n### Dialogue\n\n### Interior\n';
export function hasStyleText(text:string){return text.split('\n').some(line=>line.trim()&&!/^\s*#{1,6}\s/.test(line));}
/** ATX headings outside fenced code only. Sections end at the next peer or ancestor. */
export function sectionRange(text:string,title:string,level:number){
 const lines=text.match(/[^\n]*\n|[^\n]+$/g)||[];let offset=0,start=-1,bodyStart=-1,fence='';
 for(const line of lines){const f=line.match(/^\s{0,3}(`{3,}|~{3,})/);if(f){if(!fence)fence=f[1][0];else if(f[1][0]===fence)fence='';offset+=line.length;continue;}
  const h=!fence&&line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  if(h){if(start>=0&&h[1].length<=level)return {start,bodyStart,end:offset};if(start<0&&h[1].length===level&&h[2].trim().toLowerCase()===title.toLowerCase()){start=offset;bodyStart=offset+line.length;}}
  offset+=line.length;
 }
 return start<0?null:{start,bodyStart,end:text.length};
}
export function characterVoice(body:string){const r=sectionRange(body,'Voice',2);if(!r)return {dialogue:'',interior:''};const text=body.slice(r.bodyStart,r.end);const d=sectionRange(text,'Dialogue',3),i=sectionRange(text,'Interior',3);return {dialogue:(d?text.slice(d.bodyStart,d.end):i?'':text).trim(),interior:i?text.slice(i.bodyStart,i.end).trim():''};}
export function withoutVoice(body:string){const r=sectionRange(body,'Voice',2);return r?body.slice(0,r.start)+body.slice(r.end):body;}
export function replaceVoice(body:string,voice:string){const r=sectionRange(body,'Voice',2);const content=sectionRange(voice,'Voice',2)?voice.trim():'## Voice\n\n'+voice.trim();return r?body.slice(0,r.start)+content+'\n\n'+body.slice(r.end):body+(body.trim()?'\n\n':'')+content+'\n';}
export function withoutSamples(text:string){const r=sectionRange(text,'Sample passages',2);return r?text.slice(0,r.start)+text.slice(r.end):text;}
export type StyleLayer={id:string;kind:'book'|'preset'|'chapter_notes'|'scene_notes'|'pov_interior'|'dialogue_voice';sourceCardId:string;sourceTitle:string;sourceRev:number;text:string;truncated?:boolean};
