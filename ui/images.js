import { parseFragment } from './vendor/editorjs/html-parser.js';
import { imageStrings as strings } from './strings.js';

export const IMAGE_LIMIT = 10 * 1024 * 1024;
const FORMATS = new Set(['image/png','image/jpeg','image/gif','image/webp']);
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');

export function imageResources(note,load){
  // A new scope is created for each opened note/version. Nothing survives account changes.
  const cache=new Map();
  return {note,load:args=>{
    if(!load)return Promise.reject(Error(strings.unavailable));
    const key=JSON.stringify([args.id,args.version,args.fileId,args.context]);
    if(!cache.has(key)){
      const request=Promise.resolve().then(()=>load(args)).catch(error=>{cache.delete(key);throw error;});cache.set(key,request);
      if(cache.size>8)cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }};
}

// Source offsets preserve every untouched byte, including legacy image attributes.
function replaceElements(html, match, replace) {
  const tree=parseFragment(html,{sourceCodeLocationInfo:true}),edits=[];
  const walk=node=>{
    if(match(node)&&node.sourceCodeLocation){const loc=node.sourceCodeLocation;edits.push([loc.startOffset,loc.endOffset,replace(html.slice(loc.startOffset,loc.endOffset),node)]);return;}
    for(const child of node.childNodes || [])walk(child);
  };
  walk(tree);
  for(const [start,end,value] of edits.reverse())html=html.slice(0,start)+value+html.slice(end);
  return html;
}
export function imageReference(element,note) {
  const reference=element.getAttribute('ref');
  const attachment=note?.images?.find(image=>image.reference===reference);
  if(attachment)return attachment.file_id;
  const explicit=element.getAttribute('file_id') || element.getAttribute('data-file-id');
  if(explicit)return explicit;
  // Read identifiers only; the original URL is never requested by the WebView or Rust.
  try {
    const url=new URL(element.getAttribute('src') || '', 'https://image.invalid/');
    const value=url.searchParams.get('file_id');
    if(value){try{return JSON.parse(value);}catch{return value;}}
    const path=url.pathname.match(/\/ns\/dv\/[^/]+\/[^/]+\/([^/]+)\//);
    if(path)return decodeURIComponent(path[1]);
  } catch {}
  return null;
}
export function imagePreview(raw,note,load,local,background=false) {
  const template=document.createElement('template');template.innerHTML=raw;
  const source=template.content.querySelector('img'),box=document.createElement('span');
  box.className='note-image';box.contentEditable='false';
  const label=document.createElement('span');label.className='note-image-status';label.textContent=strings.loading;box.append(label);
  const fileId=source&&imageReference(source,note);
  const run=async()=>{
    label.textContent=strings.loading;
    try {
      const inline=source?.getAttribute('src');
      let url=local || (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(inline || '')?inline:null);
      if(!url){if(!fileId||!load)throw Error(strings.unavailable);url=(await load({id:note.object_id,fileId,version:note.ver,context:note.access || {}})).data_url;}
      if(!/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/]+=*$/i.test(url) || url.length>IMAGE_LIMIT*1.4)throw Error(strings.invalid);
      const image=document.createElement('img');image.alt=source?.getAttribute('alt') || strings.image;image.decoding='async';image.src=url;
      await image.decode();
      if(image.naturalWidth>16384||image.naturalHeight>16384||image.naturalWidth*image.naturalHeight>40_000_000)throw Error(strings.invalid);
      for(const key of ['width','height']){const size=Number(source?.getAttribute(key));if(Number.isInteger(size)&&size>0&&size<=16384)image.setAttribute(key,String(size));}
      if(background){
        const bitmap=document.createElement('span');bitmap.className='image-bitmap';bitmap.setAttribute('role','img');bitmap.setAttribute('aria-label',image.alt);
        bitmap.style.cssText='display:inline-block;max-width:100%;background-size:contain;background-repeat:no-repeat;';bitmap.style.backgroundImage=`url("${url}")`;
        const dimension=key=>{const value=Number(source?.getAttribute(key));return Number.isInteger(value)&&value>0&&value<=16384?value:null;};
        const width=dimension('width')||image.naturalWidth,height=dimension('height')||width*image.naturalHeight/image.naturalWidth;
        bitmap.style.width=`${Math.min(16384,width)}px`;bitmap.style.aspectRatio=`${width}/${height}`;box.replaceChildren(bitmap);
      }else box.replaceChildren(image);
    } catch {
      label.textContent=fileId?strings.failed:strings.unavailable;box.replaceChildren(label);
      if(fileId){const retry=document.createElement('button');retry.type='button';retry.textContent=strings.retry;retry.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();run();});box.append(retry);}
    }
  };
  run();return box;
}
export class ImageSession {
  constructor(note,load){this.note=note;this.load=imageResources(note,load).load;this.records=new Map();this.local=new Map();this.pending=Promise.resolve();}
  token(key){return `<span data-note-image="${key}" contenteditable="false">[${strings.image}]</span>`;}
  encode(html){
    return replaceElements(html,node=>node.tagName==='img',raw=>{
      const key=crypto.randomUUID();this.records.set(key,raw);return this.token(key);
    });
  }
  decode(html){
    return replaceElements(html,node=>node.tagName==='span'&&node.attrs?.some(a=>a.name==='data-note-image'),(raw,node)=>{
      const key=node.attrs.find(a=>a.name==='data-note-image').value;
      if(!this.records.has(key))throw Error(strings.invalid);
      return this.records.get(key);
    });
  }
  normalize(value){
    if(typeof value==='string')return replaceElements(value,node=>node.tagName==='span'&&node.attrs?.some(a=>a.name==='data-note-image'),(raw,node)=>this.token(node.attrs.find(a=>a.name==='data-note-image').value));
    if(Array.isArray(value))return value.map(item=>this.normalize(item));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,this.normalize(item)]));
    return value;
  }
  paint(root){
    for(const element of root.querySelectorAll('[data-note-image]')){
      const key=element.dataset.noteImage,raw=this.records.get(key);
      if(!raw||element.querySelector('.note-image'))continue;
      element.contentEditable='false';
      const preview=imagePreview(raw,this.note,this.load,this.local.get(key)?.url,this.background);
      element.replaceChildren(preview);
      if(this.onRemove){
        const button=document.createElement('button');button.type='button';button.className='note-image-remove';button.textContent='×';button.title=strings.remove;button.setAttribute('aria-label',strings.remove);
        element.append(button);
      }
    }
  }
  async add(file){
    if(!FORMATS.has(file.type)||!file.size||file.size>IMAGE_LIMIT)throw Error(strings.invalid);
    if(this.local.size>=20||[...this.local.values()].reduce((sum,item)=>sum+item.file.size,0)+file.size>20*1024*1024)throw Error(strings.total);
    const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(strings.invalid));reader.readAsDataURL(file);});
    const image=new Image();image.src=url;try{await image.decode();}catch{throw Error(strings.invalid);}
    if(image.naturalWidth>16384||image.naturalHeight>16384||image.naturalWidth*image.naturalHeight>40_000_000)throw Error(strings.invalid);
    const key=crypto.randomUUID(),reference=`ns-image-${key}`;
    this.records.set(key,`<img ref="${reference}" alt="${escape(file.name)}">`);
    this.local.set(key,{file,url,reference});return this.token(key);
  }
  uploads(content){return [...this.local.values()].filter(item=>content.includes(`ref="${item.reference}"`)).map(item=>({reference:item.reference,name:item.file.name,data:item.url.split(',')[1]}));}
  removed(content){
    const counts=new Map();
    for(const [key,raw] of this.records)if(!this.local.has(key))counts.set(raw,(counts.get(raw)||0)+1);
    let count=0;for(const [raw,initial] of counts)count+=Math.max(0,initial-(content.split(raw).length-1));return count;
  }
  bind(root,insert,onError){
    const handler=event=>{
      const files=[...(event.clipboardData?.files || event.dataTransfer?.files || [])];
      if(!files.length)return;
      event.preventDefault();event.stopImmediatePropagation();
      this.pending=this.pending.then(async()=>{for(const file of files)await insert(file);}).catch(onError);
    };
    const drag=event=>{if([...event.dataTransfer?.types || []].includes('Files'))event.preventDefault();};
    const remove=event=>{const button=event.target.closest?.('.note-image-remove');if(!button)return;event.preventDefault();event.stopImmediatePropagation();if(event.type==='click')this.onRemove?.(button.closest('[data-note-image]'));};
    root.addEventListener('pointerdown',remove,true);root.addEventListener('click',remove,true);
    root.addEventListener('paste',handler,true);root.addEventListener('drop',handler,true);root.addEventListener('dragover',drag);
    return ()=>{root.removeEventListener('pointerdown',remove,true);root.removeEventListener('click',remove,true);root.removeEventListener('paste',handler,true);root.removeEventListener('drop',handler,true);root.removeEventListener('dragover',drag);};
  }
}
