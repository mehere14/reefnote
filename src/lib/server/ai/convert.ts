import {z} from 'zod';
import type {Provider} from './providers';
import {permissions,proposalSections,structSchema} from './structure';

export {structureInstructions} from './prompt-defaults';
import {getPrompt} from './prompts';

export async function convertWriting(provider:Provider,input:{model:string;flow:string;scope:string;text:string;cards:unknown[];signal?:AbortSignal}){
 const reviewSchema=structSchema.superRefine((out,ctx)=>{
  out.suggestions.forEach((s,index)=>{if(['create_card','update_card'].includes(s.action)&&!s.why.trim())ctx.addIssue({code:'custom',path:['suggestions',index,'why'],message:'Provide a concrete reason for creating or updating this card in why, separate from the card body.'});});
 });
 let validationError='';
 for(let attempt=0;attempt<2;attempt++){
  try{
   const out=await provider.structured({model:input.model,system:getPrompt('structure'),prompt:JSON.stringify({flow:input.flow,scope:input.scope,allowed:permissions[input.flow],sections:proposalSections(input.text,input.flow),cards:input.cards,validationError}),schema:reviewSchema,maxTokens:8000,signal:input.signal});
   return reviewSchema.parse(out);
  }catch(error){
   if(input.signal?.aborted)throw error;
   // Provider/network failures have their own user-facing messages and cannot be repaired as JSON.
   if(!(error instanceof z.ZodError)&&!(error instanceof SyntaxError))throw error;
   validationError=String(error);
   if(attempt===1)throw new Error("Couldn't turn this into cards. Your chat text is saved. Try again.");
  }
 }
 throw new Error("Couldn't turn this into cards. Your chat text is saved. Try again.");
}
