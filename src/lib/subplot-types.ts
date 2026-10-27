export type Approval='draft'|'approved'|'needs_review';
export type ProseState='empty'|'generated'|'edited'|'approved';
export type CardRole='on_stage'|'referenced';
export type SecretAction='introduced'|'hinted'|'revealed';
export type SubplotCall='premise'|'turning_points'|'specs'|'prose'|'summarize'|'extract'|'rewrite'|'ripple';
export interface ElementCard {card_id:string;role:CardRole;secret_action?:SecretAction|null}
export interface ElementSpec {purpose:string;target_length:number;time_marker:string;cards:ElementCard[]}
export interface PassageReplacement {start:number;end:number;before:string;after:string;ai_note:string;warning?:string}
export interface Subplot {id:string;novel_id:string;title:string;premise:string;theme:string;start_state:string;end_state:string;status:Approval;rev:number;created_at:number}
export interface TurningPoint {id:string;subplot_id:string;position:number;text:string;status:Approval;rev:number;review_reason:string}
export interface ElementMetadata {scene_id:string;subplot_id:string|null;turning_point_id:string|null;position:number;purpose:string;target_length:number;time_marker:string;summary:string;status:Approval;prose_state:ProseState;version:number;review_reason:string;mention_rev:number}
export type ChangeSetStatus='proposed'|'partially_accepted'|'accepted'|'rejected'|'rolled_back';
export interface ChangeSet {id:string;novel_id:string;title:string;cause_type:'card_edit'|'turning_point_edit'|'manual';cause_ref:string|null;status:ChangeSetStatus;run_status:'running'|'done'|'error'|'cancelled'|'interrupted';error:string|null;created_at:number}
export interface ChangeHunk {id:string;change_set_id:string;element_id:string;field:'prose'|'summary'|'spec';before:string;after:string;start_offset:number;context_before:string;context_after:string;ai_note:string;warning:string;status:'pending'|'accepted'|'rejected';base_prose_rev:number;applied_start:number|null}
