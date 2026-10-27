/** Reference fixture from the October 26, 2026 Subplot Mode specification. */
export const engineersBetrayal={
 title:"The Engineer's Betrayal",
 premise:"Mira, the ship's chief engineer, secretly sabotages the colony ship to force a return to Earth, where her sick daughter is. She is caught and must choose between her daughter and 2,000 colonists.",
 turningPoints:[
 'Mira learns her daughter is sick on Earth.',
 'First small act of sabotage.',
 'Crewmate Joss nearly catches her.',
 'The sabotage goes wrong and people get hurt.',
 'She is exposed.',
 'Final choice: she fixes the ship.'
 ],
 elements:[
 {title:'3a',purpose:'Joss notices strange power logs',target_length:1500,characters:['Joss','Mira'],location:'Engine bay',objects:['Power logs'],secret_action:'hinted'},
 {title:'3b',purpose:'Mira blames a faulty sensor',target_length:1200,characters:['Joss','Mira'],location:'Engine bay',objects:['Power logs'],secret_action:'hinted'},
 {title:'3c',purpose:'Joss quietly keeps a copy of the logs',target_length:800,characters:['Joss'],location:'Crew quarters',objects:['Log copy'],secret_action:'hinted'}
 ],
 cards:[
 {title:'Mira',type:'character',body:'Chief engineer. She sabotages the ship to return to her sick daughter.'},
 {title:'Joss',type:'character',body:'Friendly, talkative.'},
 {title:'Engine bay',type:'setting',body:'The ship’s engineering workspace.'},
 {title:'Crew quarters',type:'setting',body:'The crew’s private cabins.'},
 {title:'Power logs',type:'object',body:'Records that hint at tampering.'},
 {title:'Log copy',type:'object',body:'The copy Joss keeps for the later exposure.'},
 {title:'Mira is the saboteur',type:'secret',body:'Mira is secretly sabotaging the colony ship.'}
 ]
} as const;
