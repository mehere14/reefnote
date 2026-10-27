import {describe, expect, it} from 'vitest';
import {CardMutationQueue, clearSavedDrafts} from '../src/lib/card-mutations';

describe('card save queue', () => {
 it('keeps all rapid chapter field edits and preserves unrelated fields', async () => {
  let card = {rev: 1, fields: {purpose: '', opens: '', closes: '', custom: 'keep'}};
  const revisions:number[] = [];
  const queue = new CardMutationQueue(async () => ({card: structuredClone(card)}), async (_id, body) => {
   await new Promise(resolve => setTimeout(resolve, 5));
   expect(body.baseRev).toBe(card.rev);
   revisions.push(body.baseRev);
   card = {...card, fields: body.fields, rev: card.rev + 1};
   return {card: structuredClone(card)};
  });
  await Promise.all([
   queue.save('chapter', {fields: {purpose: 'Purpose'}}),
   queue.save('chapter', {fields: {opens: 'Opening hook'}}),
   queue.save('chapter', {fields: {closes: 'Closing hook'}})
  ]);
  expect(card.fields).toEqual({purpose:'Purpose', opens:'Opening hook', closes:'Closing hook', custom:'keep'});
  expect(revisions).toEqual([1, 2, 3]);
 });
 it('allows later edits after a failed save without writing another card by mistake', async () => {
  const cards:any = {a:{rev:1,fields:{}}, b:{rev:1,fields:{}}};
  let fail = true;
  const queue = new CardMutationQueue(async id => ({card: cards[id]}), async (id, body) => {
   if(id === 'a' && fail){fail=false;throw new Error('network');}
   cards[id]={...cards[id],...body,rev:cards[id].rev+1};
   return {card:cards[id]};
  });
  await expect(queue.save('a',{title:'first'})).rejects.toThrow('network');
  await Promise.all([queue.save('a',{title:'second'}),queue.save('b',{title:'other card'})]);
  expect(cards.a.title).toBe('second');
  expect(cards.b.title).toBe('other card');
 });
});

 it('keeps a focused field draft and typing newer than an in-flight save', () => {
  const draft = {'fields.purpose':'Purpose', 'fields.opens':'Still typing', title:'Newer title'};
  expect(clearSavedDrafts(draft, {fields:{purpose:'Purpose'}})).toEqual({'fields.opens':'Still typing',title:'Newer title'});
  expect(clearSavedDrafts(draft, {title:'Older title'})).toEqual(draft);
 });
