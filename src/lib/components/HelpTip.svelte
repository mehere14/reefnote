<script context="module" lang="ts">let nextId=0;</script>
<script lang="ts">
 import {onMount,tick} from 'svelte';
 export let term:string;
 export let text:string;
 let button:HTMLButtonElement,open=false,pinned=false,left=8,top=8;
 const id='help-tip-'+(++nextId);
 async function show(){const r=button.getBoundingClientRect();left=Math.max(8,Math.min(r.left,window.innerWidth-Math.min(320,window.innerWidth-16)-8));top=r.bottom+8;open=true;await tick();const tip=document.getElementById(id);if(tip){const h=tip.getBoundingClientRect().height;top=r.bottom+8+h>window.innerHeight-8?Math.max(8,r.top-h-8):r.bottom+8;}}
 function close(){open=false;pinned=false;}
 onMount(()=>{const outside=(e:PointerEvent)=>{if(!button.contains(e.target as Node))close();};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};});
</script>
<span class="help-tip"><button bind:this={button} type="button" class="help-button" aria-label={'Help: '+term} aria-describedby={open?id:undefined} aria-expanded={open} on:mouseenter={show} on:mouseleave={()=>{if(!pinned)open=false;}} on:focus={show} on:blur={close} on:click={(e)=>{e.preventDefault();e.stopPropagation();if(pinned)close();else{pinned=true;show();}}}>?</button>{#if open}<span {id} role="tooltip" class="help-content" style:left={left+'px'} style:top={top+'px'}>{text}</span>{/if}</span>
<style>
 .help-tip{display:inline-flex;vertical-align:middle;margin-inline-start:.35rem;font:400 13px/1.5 var(--font-ui,sans-serif)}
 .help-tip .help-button{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;min-width:22px;min-height:22px;padding:0;border:1px solid currentColor;border-radius:50%;background:transparent;color:var(--muted,#577474);font:600 13px/1 sans-serif;cursor:help;box-shadow:none}
 .help-button:focus-visible{outline:2px solid var(--accent,#087e7b);outline-offset:3px}
 .help-content{position:fixed;z-index:10000;box-sizing:border-box;width:320px;max-width:calc(100vw - 16px);max-height:40vh;overflow:auto;padding:12px 14px;border:1px solid #708989;border-radius:10px;background:#173738;color:#fff;box-shadow:0 5px 20px #0003;text-align:left;white-space:normal;letter-spacing:normal;font:400 14px/1.5 sans-serif}
</style>
