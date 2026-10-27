// PDF dimensions are in points (72 points per inch).
export const PDF_SIZES = [
 {id:'5x8', label:'5 × 8 inches — 127 × 203 mm', width:360, height:576},
 {id:'5.25x8', label:'5.25 × 8 inches — 133 × 203 mm', width:378, height:576},
 {id:'5.5x8.5', label:'5.5 × 8.5 inches (recommended) — 140 × 216 mm', width:396, height:612},
 {id:'6x9', label:'6 × 9 inches — 152 × 229 mm', width:432, height:648},
 {id:'a5', label:'A5 — 148 × 210 mm (5.83 × 8.27 inches)', width:148 / 25.4 * 72, height:210 / 25.4 * 72}
] as const;
export const DEFAULT_PDF_SIZE = '5.5x8.5';
