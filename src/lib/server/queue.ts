type Handler=(payload:any)=>Promise<void>|void;
const handlers=new Map<string,Handler>(), timers=new Map<string,ReturnType<typeof setTimeout>>();
let running=false; const ready:Array<{kind:string,key:string,payload:any,attempt:number}>=[];
export function registerJob(kind:string,handler:Handler){handlers.set(kind,handler);}
async function drain(){if(running)return;running=true;while(ready.length){const job=ready.shift()!;try{await handlers.get(job.kind)?.(job.payload);}catch(error){console.error('Background job failed',job.kind,error);if(job.attempt===0){const timer=setTimeout(()=>{ready.push({...job,attempt:1});void drain();},2000);timer.unref?.();}}}running=false;}
export function enqueue(kind:string,key:string,payload:any,delayMs=0){clearTimeout(timers.get(key));const timer=setTimeout(()=>{timers.delete(key);const index=ready.findIndex(j=>j.key===key);if(index>=0)ready.splice(index,1);ready.push({kind,key,payload,attempt:0});void drain();},delayMs);timer.unref?.();timers.set(key,timer);}
export function startQueue() {void drain();}
