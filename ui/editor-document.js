import { parseFragment } from './vendor/editorjs/html-parser.js';
import { ALIGNMENTS, normalizeColor, safeStyles, safeInlineStyles, safeHeadingStyles, safeCopiedTextStyles, styleText } from './editor-styles.js';

const INLINE = new Set(['b','strong','i','em','u','s','strike','del','a','br','code','mark','span','font','sub','sup']);
export const TEXT_FLOW_TAGS=['div','p','h1','h2','h3','h4','h5','h6'];
export const isLegacyTextId=value=>typeof value==='string'&&/^ext-gen\d{1,16}$/.test(value);
export const isLegacyFontClass=value=>typeof value==='string'&&/^syno-fontsize-(?:xx-small|x-small|small|medium|large|x-large|xx-large)$/.test(value);
function isClipboardMetadata(name,value){
  if(name==='data-en-clipboard')return value==='true'||value==='false';
  if(name!=='data-pm-slice'||typeof value!=='string'||value.length>4096)return false;
  const match=value.match(/^\d{1,3} \d{1,3} (\[.*\])$/);
  if(!match)return false;
  try{return Array.isArray(JSON.parse(match[1]));}catch{return false;}
}
function textAttrs(node,allowed,strict){
  const values=attrs(node);
  if(strict&&Object.entries(values).some(([name,value])=>!allowed.includes(name)&&!(name==='id'&&isLegacyTextId(value))&&!(name==='class'&&isLegacyFontClass(value))&&!isClipboardMetadata(name,value)))throw Error('Особое оформление текста.');
  return values;
}
function textIdentity(values){return (isLegacyTextId(values.id)?` id="${values.id}"`:'')+(isLegacyFontClass(values.class)?` class="${values.class}"`:'');}
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const attrs = node => Object.fromEntries((node.attrs || []).map(a => [a.name,a.value]));
function copiedTextMetadata(name,value){
  if(name==='data-path-to-node')return typeof value==='string'&&value.length<=256&&/^\d{1,6}(?:,\d{1,6})*$/.test(value);
  if(name==='data-index-in-node')return /^\d{1,12}$/.test(value);
  if(name==='id')return /^p-rc_[a-f0-9]{8,64}-\d{1,16}$/.test(value);
  return false;
}
function hasCopiedMetadata(node){return (node.attrs||[]).some(attr=>copiedTextMetadata(attr.name,attr.value));}
function importedCopiedText(node,inherited=false,depth=0){
  if(depth>30)throw Error('Слишком глубокая разметка текста.');
  const a=attrs(node),copied=inherited||hasCopiedMetadata(node),math=copied&&node.tagName==='span'&&a.class==='math-inline'&&typeof a['data-math']==='string'&&a['data-math'].length<=2048;
  const values=(node.attrs||[]).filter(attr=>!copiedTextMetadata(attr.name,attr.value)&&!(math&&['class','data-math'].includes(attr.name))&&!(copied&&attr.name==='style'));
  if(copied){const style=styleText(safeCopiedTextStyles(a.style,['ul','ol','li'].includes(node.tagName)));if(style)values.push({name:'style',value:style});}
  return {...node,attrs:values,childNodes:(node.childNodes||[]).map(child=>importedCopiedText(child,copied,depth+1))};
}
function importedHeading(node){
  if(!/^h[1-6]$/.test(node.tagName))return node;
  const a=attrs(node);
  if(a.class!==undefined&&(a.class.length>2048||!/^[-_a-zA-Z0-9\s]*$/.test(a.class)))throw Error('Особые классы заголовка.');
  if(a.dir!==undefined&&a.dir!=='auto')throw Error('Особое направление заголовка.');
  const plainText=(node.childNodes||[]).every(child=>['#text','#comment'].includes(child.nodeName));
  const style=styleText(safeHeadingStyles(a.style,plainText));
  return {...node,attrs:[...(node.attrs||[]).filter(attr=>!['class','dir','style'].includes(attr.name)),...(style?[{name:'style',value:style}]:[])]};
}
const children = node => (node.childNodes || []).filter(n => n.nodeName !== '#comment' && !(n.nodeName === '#text' && !n.value.trim()));
const canonical = value => JSON.stringify(stable(value));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k,stable(value[k])]));
  return value;
}
export const blockSignature = block => canonical({ type:block.type, data:block.data, tunes:block.tunes || {} });
export const documentSignature = blocks => canonical(blocks.map(block => ({id:block.id, signature:blockSignature(block)})));
export function safeLink(href) {
  const value = String(href || '').trim();
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return '';
  if (/^(?:https?:|mailto:|tel:)/i.test(value) || /^(?:#|\/[^/]|\.\.?\/)/.test(value)) return value;
  return '';
}
function inlineNodes(nodes, strict, depth = 0, allowFlow = false) {
  if (depth > 30) throw Error('Слишком глубокая разметка текста.');
  return nodes.map(node => {
    if (node.nodeName === '#text') return esc(node.value);
    if(allowFlow && TEXT_FLOW_TAGS.includes(node.tagName)){
      node=importedHeading(node);
      const a=textAttrs(node,['style'],strict),style=styleText(safeStyles(a.style,strict));
      return `<${node.tagName}${textIdentity(a)}${style?` style="${style}"`:''}>${inlineNodes(node.childNodes || [],strict,depth+1,true)}</${node.tagName}>`;
    }
    if (!INLINE.has(node.tagName)) {
      if (strict) throw Error('Неподдерживаемый встроенный элемент.');
      if (['script','style','iframe','object','embed','img','svg','math','input'].includes(node.tagName)) return '';
      return inlineNodes(node.childNodes || [], false, depth + 1, allowFlow);
    }
    const a = attrs(node);
    if(node.tagName==='span' && /^[a-f0-9-]{36}$/.test(a['data-note-image'] || ''))return `<span data-note-image="${a['data-note-image']}" contenteditable="false">[Изображение]</span>`;
    const allowed=node.tagName==='a'?['href','title','target','rel','style']:node.tagName==='font'?['color']:node.tagName==='br'?[]:['style'];
    textAttrs(node,allowed,strict);
    const identity=textIdentity(a);
    if (node.tagName === 'br') return `<br${identity}>`;
    const body = inlineNodes(node.childNodes || [], strict, depth + 1, allowFlow);
    if(['span','font','mark'].includes(node.tagName)){
      const styles=safeInlineStyles(a.style,strict);
      if(styles['text-align']){if(strict)throw Error('Выравнивание встроенного элемента.');delete styles['text-align'];}
      if(node.tagName==='font'){
        const color=normalizeColor(a.color);if(!color&&strict)throw Error('Особый цвет текста.');if(color)styles.color=color;
      }
      const tag=node.tagName==='mark'?'mark':'span',style=styleText(styles);
      return style||identity||tag==='mark'?`<${tag}${identity}${style?` style="${style}"`:''}>${body}</${tag}>`:body;
    }
    if (node.tagName === 'a') {
      const href = safeLink(a.href);
      if (strict && !href) throw Error('Особая ссылка.');
      const styles=safeInlineStyles(a.style,strict);
      if(styles['text-align']){if(strict)throw Error('Особое выравнивание ссылки.');delete styles['text-align'];}
      const style=styleText(styles),formatted=style?`<span style="${style}">${body}</span>`:body;
      return href ? `<a${identity} href="${esc(href)}"${a.title ? ` title="${esc(a.title)}"` : ''}>${formatted}</a>` : formatted;
    }
    const styles=safeInlineStyles(a.style,strict);
    if(styles['text-align']){if(strict)throw Error('Выравнивание встроенного элемента.');delete styles['text-align'];}
    const style=styleText(styles);
    return `<${node.tagName}${identity}${style?` style="${style}"`:''}>${body}</${node.tagName}>`;
  }).join('');
}
export function cleanInline(html) {
  if (typeof html !== 'string' || html.length > 8 * 1024 * 1024) throw Error('Некорректный текст блока.');
  return inlineNodes(parseFragment(html).childNodes, false, 0, true);
}
function onlyAttrs(node, allowed = []) {
  if ((node.attrs || []).some(a => !allowed.includes(a.name)&&!isClipboardMetadata(a.name,a.value))) throw Error('Особые атрибуты элемента.');
}
function invisibleDiv(node,depth=0){
  if(depth>30||node.tagName!=='div'||node.attrs?.length)return false;
  const empty=(child,level)=>{
    if(level>30)return false;
    if(child.nodeName==='#comment')return true;
    if(child.nodeName==='#text')return /^[\t\r\n ]*$/.test(child.value);
    if(child.tagName==='div')return invisibleDiv(child,level);
    if(child.tagName==='a'&&safeLink(attrs(child).href)&&(child.attrs || []).every(attr=>['href','title','target','rel'].includes(attr.name)))return (child.childNodes || []).every(item=>empty(item,level+1));
    return INLINE.has(child.tagName)&&!['br','code','mark'].includes(child.tagName)&&!child.attrs?.length&&(child.childNodes || []).every(item=>empty(item,level+1));
  };
  return (node.childNodes || []).every(child=>empty(child,depth+1));
}
function readList(node, rootTag = node.tagName, depth = 0) {
  if (depth > 12 || node.tagName !== rootTag) throw Error('Сложный вложенный список.');
  onlyAttrs(node, depth ? [] : ['start','type']);
  const elements = children(node);
  if (!elements.length || elements.some(n => n.tagName !== 'li')) throw Error('Нестандартный список.');
  let checklist;
  const items = elements.map(item => {
    onlyAttrs(item);
    const parts = [...item.childNodes];
    const first = parts.find(n => n.nodeName !== '#text' || n.value.trim());
    const check = first?.tagName === 'input' && attrs(first).type === 'checkbox';
    if (checklist !== undefined && checklist !== check) throw Error('Смешанный чеклист.');
    checklist = check;
    if (check) { onlyAttrs(first,['type','checked','disabled']); parts.splice(parts.indexOf(first),1); }
    const sublists = parts.filter(n => ['ul','ol'].includes(n.tagName));
    if (sublists.length > 1 || (sublists.length && parts.slice(parts.indexOf(sublists[0])+1).some(n=>n.nodeName!=='#text'||n.value.trim()))) throw Error('Сложный вложенный список.');
    const content = listText(parts.filter(n=>!sublists.includes(n))).replace(check ? /^\s+/ : /$^/,'');
    const nested = sublists[0] ? readList(sublists[0],rootTag,depth+1) : null;
    if (nested && nested.style !== (check ? 'checklist' : rootTag==='ol' ? 'ordered' : 'unordered')) throw Error('Смешанный вложенный список.');
    return {content, meta:check ? {checked:Object.hasOwn(attrs(first),'checked')} : {}, items:nested?.items || []};
  });
  if (checklist && rootTag !== 'ul') throw Error('Особый чеклист.');
  const a = attrs(node), counter = {a:'lower-alpha',A:'upper-alpha',i:'lower-roman',I:'upper-roman','1':'numeric'}[a.type || '1'];
  const start = a.start === undefined ? 1 : Number(a.start);
  if (!Number.isSafeInteger(start) || start < 1 || !counter) throw Error('Особая нумерация списка.');
  return {style:checklist ? 'checklist' : rootTag==='ol' ? 'ordered' : 'unordered', meta:rootTag==='ol' ? {start,counterType:counter} : {}, items};
}
function listText(nodes){
  let content='',previousBlock=false;
  for(const node of nodes){
    const block=['p','div'].includes(node.tagName);
    if(node.nodeName==='#text'&&/^[\t\r\n ]*$/.test(node.value)&&(previousBlock||!content))continue;
    let value;
    if(block){
      onlyAttrs(node,['style']);const style=styleText(safeStyles(attrs(node).style,true)),body=inlineNodes(node.childNodes||[],true,0,true);
      value=style?`<span style="${style}">${body}</span>`:body;
    }else value=inlineNodes([node],true);
    if(content&&(previousBlock||block))content+='<br>';
    content+=value;previousBlock=block;
  }
  return content;
}
function readTable(node) {
  onlyAttrs(node);
  const rows=[];
  for (const group of children(node)) {
    if (group.tagName === 'tr') rows.push(group);
    else {
      if (!['thead','tbody','tfoot'].includes(group.tagName)) throw Error('Сложная таблица.');
      onlyAttrs(group); rows.push(...children(group));
    }
  }
  if (!rows.length || rows.some(r=>r.tagName!=='tr')) throw Error('Пустая или сложная таблица.');
  let width, headings=false;
  const content=rows.map((row,index)=>{
    onlyAttrs(row); const cells=children(row);
    if (!cells.length || cells.some(c=>!['td','th'].includes(c.tagName))) throw Error('Особые ячейки.');
    if (index===0) {width=cells.length;headings=cells.every(c=>c.tagName==='th');}
    if (cells.length!==width || cells.some(c=>c.tagName!==(index===0&&headings?'th':'td'))) throw Error('Особая структура таблицы.');
    return cells.map(cell=>{onlyAttrs(cell);return inlineNodes(cell.childNodes || [],true);});
  });
  if (width * rows.length > 1000) throw Error('Большая таблица.');
  return {withHeadings:headings,stretched:false,content};
}
function convertBase(node) {
  if (node.nodeName==='#text') return {type:'paragraph',data:{text:esc(node.value)}};
  const tag=node.tagName;
  if (['ul','ol'].includes(tag)) return {type:'list',data:readList(node)};
  if (tag==='table') return {type:'table',data:readTable(node)};
  if (tag==='blockquote') {
    onlyAttrs(node,['style']);const style=attrs(node).style || '';
    if(style && !/^text-align:\s*center;?$/.test(style))throw Error('Особое оформление цитаты.');
    const parts=[...(node.childNodes || [])],last=children(node).at(-1);
    let caption='';
    if(last?.tagName==='footer'){onlyAttrs(last);caption=inlineNodes(last.childNodes || [],true);parts.splice(parts.indexOf(last),1);}
    return {type:'quote',data:{text:inlineNodes(parts,true),caption,alignment:style?'center':'left'}};
  }
  onlyAttrs(node);
  if (['p','div'].includes(tag)) return {type:'paragraph',data:{text:inlineNodes(node.childNodes || [],true,0,true)}};
  if (/^h[1-6]$/.test(tag)) {
    const value=inlineNodes(node.childNodes || [],true);
    if (!value.trim()) throw Error('Пустой заголовок.');
    return {type:'header',data:{text:value,level:Number(tag[1])}};
  }
  if (tag==='pre') {
    const cs=children(node);
    if (cs.length!==1 || (cs[0].nodeName!=='#text' && cs[0].tagName!=='code')) throw Error('Особый блок кода.');
    onlyAttrs(cs[0]);
    if (cs[0].tagName==='code' && cs[0].childNodes.some(n=>n.nodeName!=='#text')) throw Error('Разметка в коде.');
    if (!text(node).trim()) throw Error('Пустой блок кода.');
    return {type:'code',data:{code:text(node)}};
  }
  if (tag==='hr') return {type:'delimiter',data:{}};
  throw Error('Сложный фрагмент HTML.');
}
function convert(node){
  node=importedHeading(node);
  const a=attrs(node);if(!a.style)return convertBase(node);
  const styles=safeStyles(a.style,true),alignment=styles['text-align'];delete styles['text-align'];
  const block=convertBase({...node,attrs:(node.attrs || []).filter(attr=>attr.name!=='style')});
  if(!['paragraph','header','quote','list','table'].includes(block.type))throw Error('Особое оформление блока.');
  const inlineStyle=styleText(styles);
  if(inlineStyle){if(!['paragraph','header','quote'].includes(block.type))throw Error('Особые цвета блока.');block.data.text=`<span style="${inlineStyle}">${block.data.text}</span>`;}
  if(alignment){block.tunes={alignment:{alignment}};if(block.type==='quote')block.data.alignment=alignment==='center'?'center':'left';}
  return block;
}
function renderList(data, items = data.items, depth = 0) {
  if (depth>12 || !Array.isArray(items) || items.length>10000 || !['ordered','unordered','checklist'].includes(data.style)) throw Error('Некорректный список.');
  const ordered=data.style==='ordered',tag=ordered?'ol':'ul';
  const start=Number(data.meta?.start || 1), counter=data.meta?.counterType || 'numeric';
  const types={'numeric':'1','lower-alpha':'a','upper-alpha':'A','lower-roman':'i','upper-roman':'I'};
  if (ordered && (!Number.isSafeInteger(start)||start<1||!types[counter])) throw Error('Некорректная нумерация списка.');
  const extra=ordered ? `${start!==1?` start="${start}"`:''}${counter!=='numeric'?` type="${types[counter]}"`:''}` : '';
  return `<${tag}${extra}>${items.map(item=>{
    if (!item || typeof item.content!=='string' || !Array.isArray(item.items)) throw Error('Некорректный пункт списка.');
    const check=data.style==='checklist'?`<input type="checkbox" disabled${item.meta?.checked===true?' checked':''}> `:'';
    return `<li>${check}${cleanInline(item.content)}${item.items.length?renderList({...data,meta:{}},item.items,depth+1):''}</li>`;
  }).join('')}</${tag}>`;
}
function renderBlockBody(block) {
  const d=block.data;
  if (!d || typeof d!=='object') throw Error('Отсутствуют данные блока.');
  switch(block.type) {
    case 'paragraph':{
      const content=cleanInline(d.text),tag=/<(?:div|p|h[1-6])(?:\s|>)/i.test(content)?'div':'p';
      return `<${tag}>${content}</${tag}>`;
    }
    case 'header':if(![1,2,3,4,5,6].includes(d.level))throw Error('Некорректный заголовок.');return `<h${d.level}>${cleanInline(d.text)}</h${d.level}>`;
    case 'quote':if(!['left','center',undefined].includes(d.alignment))throw Error('Некорректная цитата.');return `<blockquote>${cleanInline(d.text)}${d.caption?`<footer>${cleanInline(d.caption)}</footer>`:''}</blockquote>`;
    case 'code':if(typeof d.code!=='string')throw Error('Некорректный код.');return `<pre><code>${esc(d.code)}</code></pre>`;
    case 'delimiter':return '<hr>';
    case 'list':return renderList(d);
    case 'table': {
      if(!Array.isArray(d.content)||!d.content.length||d.content.length>1000||!d.content.every(r=>Array.isArray(r)&&r.length===d.content[0].length&&r.length>0)||d.content.flat().length>1000)throw Error('Некорректная таблица.');
      return `<table><tbody>${d.content.map((r,i)=>{const tag=i===0&&d.withHeadings?'th':'td';return `<tr>${r.map(c=>`<${tag}>${cleanInline(c)}</${tag}>`).join('')}</tr>`;}).join('')}</tbody></table>`;
    }
    default:throw Error(`Неизвестный тип блока: ${String(block.type).slice(0,40)}.`);
  }
}
export function renderBlock(block){
  const html=renderBlockBody(block),alignment=block.tunes?.alignment?.alignment ?? (block.type==='quote'?block.data.alignment:undefined);
  if(alignment!==undefined&&!ALIGNMENTS.includes(alignment))throw Error('Некорректное выравнивание.');
  return alignment&&alignment!=='left'?html.replace(/^<(\w+)/,`<$1 style="text-align:${alignment}"`):html;
}

export function normalizeImportedText(html){
  if(typeof html!=='string'||html.length>1024*1024)return html;
  const edits=[];
  function walk(node,depth=0){
    if(depth>30)return;
    const a=attrs(node),loc=node.sourceCodeLocation;
    if(loc&&((/^h[1-6]$/.test(node.tagName)&&(a.class!==undefined||a.dir==='auto'))||hasCopiedMetadata(node))){
      try{edits.push([loc.startOffset,loc.endOffset,renderBlock(convert(importedCopiedText(node)))]);return;}catch{}
    }
    for(const child of node.childNodes||[])walk(child,depth+1);
  }
  walk(parseFragment(html,{sourceCodeLocationInfo:true}));
  for(const [start,end,value] of edits.reverse())html=html.slice(0,start)+value+html.slice(end);
  return html;
}

export class EditorDocument {
  constructor(html) {
    if(typeof html!=='string'||html.length>8*1024*1024)throw Error('Некорректный размер заметки.');
    this.html=html;this.records=new Map();this.fragments=new Map();this.blocks=[];this.head='';this.tail='';
    if(html.length>1024*1024){this.addProtected(html,'');return;}
    let errors=false;
    const tree=parseFragment(html,{sourceCodeLocationInfo:true,onParseError:()=>{errors=true;}});
    let cursor=0,sourceNodes=tree.childNodes;
    const meaningful=children(tree),wrapper=meaningful.length===1&&meaningful[0];
    if(wrapper?.tagName==='div'&&!wrapper.attrs?.length&&wrapper.sourceCodeLocation?.startTag&&wrapper.sourceCodeLocation?.endTag&&children(wrapper).some(node=>['ul','ol'].includes(node.tagName))){
      cursor=wrapper.sourceCodeLocation.startTag.endOffset;this.head=html.slice(0,cursor);sourceNodes=wrapper.childNodes;
    }
    const bodyStart=cursor;
    const ranges=[];
    for(const node of sourceNodes) {
      if(ranges.length>=10000){errors=true;break;}
      const loc=node.sourceCodeLocation;
      if(!loc || loc.startOffset<cursor || loc.endOffset<loc.startOffset){errors=true;break;}
      ranges.push({node,start:loc.startOffset,end:loc.endOffset});cursor=loc.endOffset;
    }
    if(errors) {this.head='';if(html)this.addProtected(html,'');return;}
    cursor=bodyStart;
    for(let index=0;index<ranges.length;index++) {
      const {node,start}=ranges[index];let end=ranges[index].end;
      // Zero-height legacy wrappers stay in the raw prefix, not editable blank blocks.
      if(node.nodeName==='#comment'||(node.nodeName==='#text'&&!node.value.trim())||invisibleDiv(node))continue;
      const inline=node.nodeName==='#text'||INLINE.has(node.tagName);
      const flow=[node];
      if(inline){
        while(index+1<ranges.length){
          const next=ranges[index+1];
          if(next.node.nodeName!=='#text'&&!INLINE.has(next.node.tagName))break;
          flow.push(next.node);end=next.end;index++;
        }
      }
      const raw=html.slice(start,end),prefix=html.slice(cursor,start);cursor=end;
      try {this.add(inline?{type:'paragraph',data:{text:inlineNodes(flow.map(item=>importedCopiedText(item)),true)}}:convert(importedCopiedText(node)),raw,prefix);} catch {this.addProtected(raw,prefix);}
    }
    this.tail=html.slice(cursor);
  }
  id(){return crypto.randomUUID();}
  add(block,source,prefix) {
    block.id=this.id();this.blocks.push(block);
    this.records.set(block.id,{source,prefix,baseline:blockSignature(block)});
  }
  addProtected(source,prefix) {
    const key=this.id();this.fragments.set(key,source);this.add({type:'preserved',data:{key}},source,prefix);
  }
  bindBaseline(blocks) {
    for(const block of this.blocks)if(!blocks.some(b=>b.id===block.id&&b.type===block.type))throw Error('Редактор пропустил исходный блок. Откройте классический редактор.');
    for(const block of blocks) {
      const record=this.records.get(block.id);
      if(record)record.baseline=blockSignature(block);
    }
    this.baseline=documentSignature(blocks);
  }
  missingProtected(blocks) {
    const keys=blocks.filter(b=>b.type==='preserved').map(b=>b.data?.key);
    if(keys.some(k=>!this.fragments.has(k)) || new Set(keys).size!==keys.length)throw Error('Повреждён или продублирован защищённый фрагмент.');
    return [...this.fragments.keys()].filter(k=>!keys.includes(k));
  }
  serialize(blocks,allowRemoved = []) {
    if(!Array.isArray(blocks)||blocks.length>10000||new Set(blocks.map(b=>b.id)).size!==blocks.length)throw Error('Некорректная структура заметки.');
    if(this.missingProtected(blocks).some(k=>!allowRemoved.includes(k)))throw Error('Подтвердите удаление защищённых фрагментов.');
    if(documentSignature(blocks)===this.baseline)return this.html;
    return this.head+blocks.map(block=>{
      const record=this.records.get(block.id);
      if(record&&blockSignature(block)===record.baseline)return record.prefix+record.source;
      if(block.type==='preserved')return (record?.prefix || '')+this.fragments.get(block.data.key);
      let rendered=renderBlock(block);
      if(block.type==='paragraph'&&record&&!/^\s*<p[\s>]/i.test(record.source))rendered=rendered.replace(/^<p(?=[\s>])/,'<div').replace(/<\/p>$/,'</div>');
      return (record?.prefix || '')+rendered;
    }).join('')+this.tail;
  }
}
