import { parseFragment } from './vendor/editorjs/html-parser.js';
import { safeLink } from './editor-document.js';
import { normalizeFontFamily, normalizeFontSize, normalizeColor, safeStyles, styleText } from './editor-styles.js';
import { pasteStrings } from './strings.js';

const BLOCKS=new Set(['div','p','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','hr','table','thead','tbody','tfoot','tr','td','th']);
const INLINE=new Set(['span','b','strong','i','em','u','s','strike','del','sub','sup','a','code','mark','br']);
const WRAPPERS=new Set(['article','section','main','header','footer','aside','nav','figure','figcaption','details','summary']);
const DROP=new Set(['script','style','iframe','object','embed','svg','math','link','meta','base','title','template','noscript','form','button','select','textarea','canvas']);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const attributes=node=>Object.fromEntries((node.attrs || []).map(attr=>[attr.name,attr.value]));
const visible=html=>/<(?:br|img|hr|input|audio|video|table)\b/i.test(html)||html.replace(/<[^>]*>/g,'').replace(/[\t\r\n ]/g,'')!=='';

function fontSize(value,parent,root){
  const absolute=normalizeFontSize(value);if(absolute)return absolute;
  const relative=value.trim().match(/^(\d+(?:\.\d+)?)(rem|em|%)$/i);if(!relative)return '';
  const unit=relative[2].toLowerCase(),pixels=Number(relative[1])*(unit==='rem'?root:unit==='em'?parent:parent/100);
  return normalizeFontSize(`${pixels}px`);
}
function fontFamily(value){
  // Keep declared supported fallbacks without requesting the website's fonts.
  return [...new Set(value.split(',').map(part=>normalizeFontFamily(part)).filter(Boolean))].join(',');
}
function presentation(value,parent,root){
  const result={};if(!value||value.length>16384)return result;
  for(const declaration of value.split(';')){
    const colon=declaration.indexOf(':');if(colon<1)continue;
    const key=declaration.slice(0,colon).trim().toLowerCase(),raw=declaration.slice(colon+1).trim();
    const converted=key==='font-size'?fontSize(raw,parent,root):key==='font-family'?fontFamily(raw):key==='text-align'?({start:'left',end:'right'}[raw.toLowerCase()] || raw):raw;
    Object.assign(result,safeStyles(`${key}:${converted}`));
  }
  return result;
}
function imageSource(value){
  if(/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/]+=*$/i.test(value || ''))return value;
  if(safeLink(value)&&!/^mailto:|^tel:|^#/i.test(value))return value;
  if(value&&!/[\s\u0000-\u001f<>"'\\:]/.test(value)&&!value.startsWith('//'))return value;
  return '';
}

export function normalizePastedHtml(html,{baseFontSize=15,rootFontSize=16}={}){
  if(typeof html!=='string'||html.length>2*1024*1024)throw Error(pasteStrings.htmlTooLarge);
  const base=Number.isFinite(baseFontSize)&&baseFontSize>=8&&baseFontSize<=128?baseFontSize:15;
  const root=Number.isFinite(rootFontSize)&&rootFontSize>=8&&rootFontSize<=128?rootFontSize:16;
  let remaining=50000;
  function render(node,parentSize,pre=false,depth=0,inlineFlow=false){
    if(--remaining<0||depth>80)throw Error(pasteStrings.htmlTooComplex);
    if(node.nodeName==='#text')return escape(pre?node.value:node.value.replace(/[\t\r\n\f ]+/g,' '));
    if(!node.tagName)return '';
    let tag=node.tagName;if(DROP.has(tag))return '';
    const a=attributes(node),styles=presentation(a.style,parentSize,root);
    if(tag==='font'){
      if(a.color&&!styles.color){const color=normalizeColor(a.color);if(color)styles.color=color;}
      if(a.face&&!styles['font-family']){const family=fontFamily(a.face);if(family)styles['font-family']=family;}
      if(!styles['font-size']&&/^[1-7]$/.test(a.size || ''))styles['font-size']=normalizeFontSize(`${[0,10,13,16,18,24,32,48][Number(a.size)]}px`);
      tag='span';
    }
    const childSize=styles['font-size']?Number.parseFloat(styles['font-size'])*4/3:parentSize;
    const flatten=['li','td','th','blockquote'].includes(tag)||(inlineFlow&&['p','div'].includes(tag));
    const parts=(node.childNodes || []).map(child=>({node:child,html:render(child,childSize,pre||tag==='pre'||tag==='code',depth+1,flatten)}));
    let body='',previousBlock=false;
    for(let index=0;index<parts.length;index++){
      const part=parts[index],block=['div','p'].includes(part.node.tagName);
      if(!part.html)continue;
      if(flatten&&/^[\t\r\n ]*$/.test(part.html)&&(previousBlock||['div','p'].includes(parts[index+1]?.node.tagName)))continue;
      if(flatten&&body&&(previousBlock||block)&&!body.endsWith('<br>'))body+='<br>';
      body+=part.html;previousBlock=block;
    }
    const output={};
    if(tag==='a'){
      const href=safeLink(a.href);if(!href||!visible(body))return body;
      output.href=href;if(a.title)output.title=a.title;
    }else if(tag==='img'){
      const src=imageSource(a.src);if(src)output.src=src;
      for(const key of ['ref','file_id','data-file-id','alt','title'])if(a[key])output[key]=a[key];
      for(const key of ['width','height'])if(/^\d{1,5}$/.test(a[key] || '')&&Number(a[key])>0&&Number(a[key])<=16384)output[key]=a[key];
      return `<img${Object.entries(output).map(([key,value])=>` ${key}="${escape(value)}"`).join('')}>`;
    }else if(tag==='input'){
      if(a.type?.toLowerCase()!=='checkbox')return '';
      return `<input type="checkbox" disabled${Object.hasOwn(a,'checked')?' checked':''}>`;
    }else if(['audio','video','source'].includes(tag)){
      const src=imageSource(a.src);if(src&&!src.startsWith('data:'))output.src=src;
      if(tag!=='source')output.controls='';
    }else if(!BLOCKS.has(tag)&&!INLINE.has(tag)){
      if(WRAPPERS.has(tag))tag='div';else return body;
    }
    if(tag==='ol'){
      if(/^\d{1,6}$/.test(a.start || '')&&Number(a.start)>0)output.start=a.start;
      if(['1','a','A','i','I'].includes(a.type))output.type=a.type;
    }
    if(['td','th'].includes(tag))for(const key of ['colspan','rowspan'])if(/^\d{1,3}$/.test(a[key] || '')&&Number(a[key])>1)output[key]=a[key];
    const style=styleText(styles);if(style)output.style=style;
    if(tag==='span'&&!style)return body;
    if(['div','a','span','b','strong','i','em','u','s','strike','del','mark'].includes(tag)&&!visible(body))return '';
    if(tag==='p'&&!visible(body))body='<br>';
    if(inlineFlow&&['div','p'].includes(tag)){
      delete styles['text-align'];const inlineStyle=styleText(styles);
      return inlineStyle?`<span style="${inlineStyle}">${body}</span>`:body;
    }
    if(tag==='div'&&!style){
      const children=parts.filter(child=>child.html&&!/^[\t\r\n ]*$/.test(child.html));
      if(children.length&&children.every(child=>BLOCKS.has(child.node.tagName)||WRAPPERS.has(child.node.tagName)))return body;
    }
    const attrs=Object.entries(output).map(([key,value])=>` ${key}="${escape(value)}"`).join('');
    return ['br','hr','source'].includes(tag)?`<${tag}${attrs}>`:`<${tag}${attrs}>${body}</${tag}>`;
  }
  return parseFragment(html).childNodes.map(node=>render(node,base)).join('');
}
