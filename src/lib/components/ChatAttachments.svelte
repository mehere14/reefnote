<script lang="ts">
 export let files:Array<{name:string;data:string;mime?:string}>=[];
 export let readonly=false;
 export let disabled=false;
 export let onError:(message:string)=>void=()=>{};
 let input:HTMLInputElement;
 let loading=false;
 async function add(list:FileList|null){
  if(!list)return;loading=true;
  try{
   const next=[...files];
   for(const file of Array.from(list)){
    if(!/\.(png|jpe?g|webp|gif|md|txt|docx)$/i.test(file.name))throw new Error('Choose JPG, PNG, WebP, GIF, MD, TXT, or DOCX files.');
    if(file.size>5_000_000||next.length>=5)throw new Error('Use up to 5 files, 5 MB each.');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read file.'));reader.readAsDataURL(file);});
    next.push({name:file.name,data,mime:file.type});
   }
   if(next.reduce((sum,f)=>sum+f.data.length*3/4,0)>10_000_000)throw new Error('Attachments must total 10 MB or less.');
   files=next;
  }catch(e){onError((e as Error).message);}finally{loading=false;if(input)input.value='';}
 }
</script>
<div class="chat-attachments">
 {#each files as file,i}
  <div class="attachment">
   {#if /^image\/(png|jpeg|webp|gif)$/.test(file.mime||'')}<img src={`data:${file.mime};base64,${file.data}`} alt={file.name}/>{/if}
   <span>{file.name}</span>
   {#if readonly}<a href={`data:${file.mime||'application/octet-stream'};base64,${file.data}`} download={file.name}>Download</a>{:else}<button class="plain" aria-label={`Remove ${file.name}`} disabled={disabled||loading} on:click={()=>files=files.filter((_,n)=>n!==i)}>×</button>{/if}
  </div>
 {/each}
 {#if !readonly}
  <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.md,.txt,.docx" bind:this={input} on:change={(e)=>add(e.currentTarget.files)} hidden/>
  <button class="chip" disabled={disabled||loading} on:click={()=>input.click()}>{loading?'Reading files…':'＋ Attach files'}</button>
  <small>Photos, images, MD, TXT, DOCX · 5 MB each · 10 MB total. Images need a vision model.</small>
 {/if}
</div>
<style>
 .chat-attachments{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0}.chat-attachments small{font-size:11px;opacity:.7}.attachment{display:flex;align-items:center;gap:7px;padding:6px;border:1px solid var(--line,#ccc);border-radius:8px;max-width:100%;font-size:12px}.attachment span{overflow-wrap:anywhere}.attachment img{width:64px;height:64px;object-fit:contain;border-radius:4px}.attachment a{color:inherit}
</style>
