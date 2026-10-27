export const FONT_FAMILIES=['Arial','Calibri','Cambria','Georgia','Times New Roman','Verdana','Tahoma','Segoe UI','Consolas','Courier New','sans-serif','serif','monospace'];
export const FONT_SIZES=[8,9,10,11,12,14,16,18,20,24,28,32,36,48,72];
export function normalizeFontFamily(value){
  if(typeof value!=='string'||value.length>256)return '';
  const families=value.split(',').map(part=>part.trim().replace(/^(["'])(.*)\1$/,'$2'));
  const clean=families.map(part=>[...FONT_FAMILIES,'Helvetica'].find(font=>font.toLowerCase()===part.toLowerCase()));
  return clean.length&&clean.every(Boolean)?clean.join(','):'';
}
export function normalizeFontSize(value){
  if(typeof value!=='string')return '';
  const match=value.trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/i);if(!match)return '';
  const points=Number(match[1])*(match[2].toLowerCase()==='px'?.75:1);
  return points>=6&&points<=96?`${Math.round(points*1000)/1000}pt`:'';
}
export const ALIGNMENTS=['left','center','right','justify'];
const NAMES={black:'#000000',white:'#ffffff',red:'#ff0000',green:'#008000',blue:'#0000ff',yellow:'#ffff00',gray:'#808080',grey:'#808080',silver:'#c0c0c0',maroon:'#800000',purple:'#800080',fuchsia:'#ff00ff',lime:'#00ff00',olive:'#808000',navy:'#000080',teal:'#008080',aqua:'#00ffff',orange:'#ffa500',rebeccapurple:'#663399',transparent:'rgba(0,0,0,0)'};
export function normalizeColor(value){
  if(typeof value!=='string'||value.length>80)return '';
  value=value.trim().toLowerCase();if(NAMES[value])return NAMES[value];
  if(/^#[0-9a-f]{3,4}$/.test(value))return '#'+[...value.slice(1)].map(x=>x+x).join('');
  if(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/.test(value))return value;
  const rgb=value.match(/^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$/);
  if(!rgb||rgb.slice(2,5).some(x=>Number(x)>255)||(rgb[1]==='rgb'&&rgb[5]!==undefined)||(rgb[1]==='rgba'&&rgb[5]===undefined))return '';
  const channels=rgb.slice(2,5).map(Number),alpha=rgb[5]===undefined?1:Number(rgb[5]);
  return alpha===1?'#'+channels.map(x=>x.toString(16).padStart(2,'0')).join(''):`rgba(${channels.join(',')},${alpha})`;
}
function textPresentation(key,value){
  if(key==='font-weight'&&/^(?:normal|bold|bolder|lighter|[1-9]00)$/.test(value))return value;
  if(key==='font-style'&&['normal','italic','oblique'].includes(value))return value;
  if(['text-decoration','text-decoration-line'].includes(key)){
    if(value==='none')return value;
    const parts=value.split(/\s+/);
    if(parts.length<=3&&new Set(parts).size===parts.length&&parts.every(part=>['underline','line-through','overline'].includes(part)))return parts.join(' ');
  }
  return '';
}
export function safeStyles(value,strict=false){
  const result={};if(!value)return result;
  if(typeof value!=='string'||value.length>2048){if(strict)throw Error('Сложное оформление.');return result;}
  for(const part of value.split(';')){
    if(!part.trim())continue;
    const colon=part.indexOf(':'),key=part.slice(0,colon).trim().toLowerCase(),raw=part.slice(colon+1).trim();
    const lower=raw.toLowerCase();
    const clean=key==='text-align'&&ALIGNMENTS.includes(lower)?lower:['color','background-color'].includes(key)?normalizeColor(raw):key==='font-family'?normalizeFontFamily(raw):key==='font-size'?normalizeFontSize(raw):textPresentation(key,lower);
    if(colon<1||!clean){if(strict)throw Error('Неподдерживаемое оформление.');continue;}
    result[key]=clean;
  }
  return result;
}
const NEUTRAL_INLINE_STYLES={
  'font-variant-ligatures':'normal','font-variant-caps':'normal','letter-spacing':'normal',
  orphans:'2',widows:'2','text-indent':'0px','text-transform':'none','white-space':'normal',
  'word-spacing':'0px','-webkit-text-stroke-width':'0px','text-decoration-thickness':'initial',
  'text-decoration-style':'initial','text-decoration-color':'initial','text-align':'start',float:'none',
};
export function safeInlineStyles(value,strict=false){
  if(typeof value!=='string'||value.length>2048)return safeStyles(value,strict);
  // Copied browser defaults do not change the presentation of an inline text span.
  const meaningful=value.split(';').filter(rule=>{
    const colon=rule.indexOf(':');if(colon<1)return true;
    const key=rule.slice(0,colon).trim().toLowerCase(),raw=rule.slice(colon+1).trim().toLowerCase();
    if(key==='display'&&/^inline(?:\s*!important)?$/.test(raw))return false;
    return NEUTRAL_INLINE_STYLES[key]!==raw;
  }).join(';');
  return safeStyles(meaningful,strict);
}
export const styleText=styles=>Object.entries(styles).map(([key,value])=>`${key}:${value}`).join(';');
