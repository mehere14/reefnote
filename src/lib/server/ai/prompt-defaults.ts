import {cardTypes} from './structure';
import {preamble,instructions} from './flows';
export const structureInstructions=`Convert writing sections into suggestions. Never rewrite body text: use text_ref S0, S1, S2 or S2#corner only. Return {"suggestions":[...]}. Each suggestion must include action, what, and a nonempty why explaining the concrete reason for creating or changing this card. Use the section reason metadata when supplied. Keep reasons and editorial change commentary in why, never in saved card content. For create_card use the exact proposed card title and supported type. For update_card select the exact existing card ID matching the intended title and type; never create a duplicate to update an existing card. Use append only when the section contains solely new material. Use replace when it contains the complete resulting field content, including unchanged material. Never append a full revised body to the original body.
Valid actions and JSON shapes:
create_card {action:"create_card",type,subtype?,title,text_ref,fields_refs?,parent_id?,links?:[{to_id,label,direction?:"in"|"out"}],what,why}
update_card {action:"update_card",card_id,field,mode:"append"|"replace",text_ref,what,why}
set_link {action:"set_link",from_id,to_id:null|existing_card_id,label:"POV"|"uses_style",mode?:"inherit"|"none",what,why}
Use set_link to clear an assignment (to_id:null) or replace it; mode controls cleared style inheritance.
add_link {action:"add_link",from_id,to_id,label,what,why}
flag_issue {action:"flag_issue",card_id,what,why,text_ref?,fix?:{field,mode:"append"|"replace",text}}
Card type must be exactly one of: ${cardTypes.join(', ')}. Descriptive categories belong in subtype, never type. For World & Rules use setting for places, rule for world principles or systems (including conceptual or technological systems), object for concrete items or devices, and event for happenings. "concept" and "technology" are not valid card types; choose the supported type that fits the writing and preserve the category in subtype.
For update_card.field and flag_issue.fix.field, use exactly "body", "prose", or "fields.<key>" where <key> contains only ASCII letters and underscores (for example "fields.opens"). Use "body" for general card content; "prose" is only for scene manuscript text. Never use a display label, title, subtype, or nested path as field. A chapter body contains chapter notes, not manuscript prose. For revisions to a chapter’s narrative or dialogue, target the intended child scene ID with field "prose". Never save manuscript revisions to a chapter body. If the intended scene is ambiguous or unavailable in context, do not propose a manuscript update; ask which scene to revise. Scene body is its plan, not its manuscript.
Style cards use type style and subtype preset; the Book voice already exists and must be updated by ID. Book voice and preset style content always use field "body", never "fields.styleNotes". Only chapter and scene cards use "fields.styleNotes" for their local overrides. A request to populate or revise a Book voice or preset must update that style card’s body. For a new preset and its assignments, put uses_style links inside the create_card suggestion with direction in and to_id equal to each existing scene or chapter ID: accepting that suggestion creates the preset and assigns those sources atomically. Never invent card IDs for new cards. POV and uses_style links are exclusive and replace previous assignments. Use existing card IDs only; @scope is allowed only when scope is a card ID. Section names such as world are not card IDs. Respect the allowed flow actions. On validationError, correct the invalid suggestions using these rules without changing the writing.`;
export const promptDefaults:Record<string,string>={
 preamble,
 ...Object.fromEntries(Object.entries(instructions).map(([key,value])=>['flow.'+key,value])),
 conversation:"You are a helpful co-writer. Respond to the writer request using the conversation. No card context is supplied. Help explore and refine ideas.",
 structure:structureInstructions,
 digest:'Summarise factual continuity: who, what, where, when, what changed. No interpretation. At most 120 words.',
 json:' Respond with valid JSON only. No markdown fences.',
 connection:'Reply OK.'
};
