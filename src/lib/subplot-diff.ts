import DiffMatchPatch from 'diff-match-patch';
/** Preserve whitespace and punctuation while highlighting changes at word boundaries. */
export function wordDiff(before:string,after:string):Array<[number,string]>{
 const dictionary:string[]=[''];const index=new Map<string,number>();
 const encode=(text:string)=>(text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu)||[]).map(word=>{let id=index.get(word);if(id===undefined){id=dictionary.length;dictionary.push(word);index.set(word,id);}return String.fromCharCode(id);}).join('');
 // Avoid UTF-16 dictionary overflow on unusually large hunks.
 if(new Set((before+' '+after).split(/\s+/)).size>25000)return new DiffMatchPatch().diff_main(before,after);
 const a=encode(before),b=encode(after);return new DiffMatchPatch().diff_main(a,b,false).map(([op,text])=>[op,[...text].map(char=>dictionary[char.charCodeAt(0)]).join('')]);
}
