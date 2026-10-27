/** Serialises edits per card; field patches contain only the field the writer edited. */
export class CardMutationQueue {
 private tails = new Map<string, Promise<unknown>>();
 constructor(private read: (id: string) => Promise<any>, private write: (id: string, patch: any) => Promise<any>) {}
 save(id: string, patch: any): Promise<any> {
  const previous = this.tails.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
   const {card: latest} = await this.read(id);
   const body = {...patch, ...(patch.fields ? {fields: {...latest.fields, ...patch.fields}} : {}), baseRev: latest.rev};
   return this.write(id, body);
  });
  this.tails.set(id, next);
  void next.finally(() => {if (this.tails.get(id) === next) this.tails.delete(id);}).catch(() => {});
  return next;
 }
 async flush(id: string) {await this.tails.get(id);}
}

/** Clear only the exact submitted values; newer typing remains visible during a save. */
export function clearSavedDrafts(draft: Record<string,string> = {}, patch: Record<string,any>) {
 const remaining = {...draft};
 const savedFields = Object.entries(patch.fields ? Object.fromEntries(Object.entries(patch.fields).map(([k,v]) => ['fields.'+k,v])) : patch);
 for (const [key, value] of savedFields) if (remaining[key] === value) delete remaining[key];
 return remaining;
}
