import { imageStrings as strings } from './strings.js';

// Controls live outside the editable document, including when it is an iframe.
export function bindImageControls(root,session,onError){
  const owner=root.ownerDocument,view=owner.defaultView,doc=document;
  const frame=view.frameElement;
  const panel=doc.createElement('form');panel.className='image-size-panel';panel.noValidate=true;panel.hidden=true;panel.setAttribute('aria-label',strings.resize);
  const label=doc.createElement('label');label.textContent=strings.width;
  const input=doc.createElement('input');input.type='number';input.min='1';input.max='16384';input.step='1';input.required=true;input.setAttribute('aria-label',strings.width);label.append(input);
  const button=(text,action)=>{const element=doc.createElement('button');element.type='button';element.textContent=text;element.addEventListener('click',action);panel.append(element);return element;};
  panel.append(label);
  const apply=button(strings.apply,()=>{});apply.type='submit';
  button(strings.fit,()=>commit(availableWidth()));
  button(strings.original,()=>commit(natural().width));
  const closeButton=button('×',()=>close());closeButton.setAttribute('aria-label',strings.close);
  const message=doc.createElement('span');message.className='image-size-message';message.setAttribute('role','status');panel.append(message);
  const overlay=doc.createElement('div');overlay.className='image-size-overlay';overlay.hidden=true;
  doc.body.append(panel,overlay);
  let selected=null,drag=null,raf=0,busy=false,lastKey='';
  const bitmap=()=>selected?.querySelector('.note-image img,.image-bitmap');
  const natural=()=>({width:Number(selected?.querySelector('.note-image')?.dataset.naturalWidth),height:Number(selected?.querySelector('.note-image')?.dataset.naturalHeight)});
  const availableWidth=()=>{
    const container=selected?.closest('.ce-block__content')||root;
    const style=view.getComputedStyle(container);
    return Math.max(1,Math.floor(container.clientWidth-parseFloat(style.paddingLeft||0)-parseFloat(style.paddingRight||0)));
  };
  const repaint=()=>{selected?.replaceChildren();session.paint(root);};
  function close(){
    if(drag)repaint();drag=null;selected=null;panel.hidden=true;overlay.hidden=true;cancelAnimationFrame(raf);
  }
  function position(){
    if(selected&&!selected.isConnected){
      const key=selected.dataset.noteImage;
      selected=[...root.querySelectorAll('[data-note-image]')].find(element=>element.dataset.noteImage===key)||null;
    }
    if(!selected?.isConnected||!root.contains(selected)){close();return;}
    const image=bitmap();if(!image){overlay.hidden=true;raf=requestAnimationFrame(position);return;}
    const rect=image.getBoundingClientRect(),offset=frame?.getBoundingClientRect()||{left:0,top:0};
    const left=rect.left+offset.left,top=rect.top+offset.top;
    const bounds=(frame||root).getBoundingClientRect();
    const visible=top+rect.height>Math.max(0,bounds.top)&&top<Math.min(doc.documentElement.clientHeight,bounds.bottom)&&left+rect.width>Math.max(0,bounds.left)&&left<Math.min(doc.documentElement.clientWidth,bounds.right);
    overlay.hidden=!visible;panel.hidden=!visible;
    overlay.style.cssText=`left:${left}px;top:${top}px;width:${rect.width}px;height:${rect.height}px`;
    panel.style.left=`${Math.max(8,Math.min(left,doc.documentElement.clientWidth-panel.offsetWidth-8))}px`;
    const below=top+rect.height+12;
    panel.style.top=`${Math.max(8,Math.min(below,doc.documentElement.clientHeight-panel.offsetHeight-8))}px`;
    if(lastKey!==selected.dataset.noteImage){lastKey=selected.dataset.noteImage;input.value=String(Math.round(rect.width));}
    raf=requestAnimationFrame(position);
  }
  async function commit(width){
    if(busy||!selected?.isConnected)return;
    const dimensions=natural(),height=Math.max(1,Math.round(width*dimensions.height/dimensions.width));
    if(!Number.isInteger(width)||width<1||width>16384||!Number.isInteger(height)||height>16384){message.textContent=strings.invalidSize;return;}
    const target=selected;
    busy=true;message.textContent='';
    try{
      await session.onResize(target,width,height);
      if(target.isConnected&&selected===target){lastKey='';repaint();}
    }catch(error){if(target.isConnected&&selected===target)repaint();onError(error);}
    finally{busy=false;}
  }
  function select(element,focus=false){
    close();selected=element;if(!bitmap()||!natural().width){selected=null;return;}
    panel.hidden=false;overlay.hidden=false;lastKey='';position();if(focus){input.focus();input.select();}
  }
  const open=event=>{
    const element=event.target.closest?.('[data-note-image]');
    if(!element||event.target.closest('.note-image-remove'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='click')select(element,!!event.target.closest('.note-image-size'));
  };
  const outside=event=>{if(panel.contains(event.target)||overlay.contains(event.target)||selected?.contains(event.target))return;close();};
  const keydown=event=>{if(event.key==='Escape'&&selected){event.preventDefault();event.stopPropagation();const target=selected;close();target.querySelector('.note-image-size')?.focus();}};
  panel.addEventListener('submit',event=>{event.preventDefault();commit(Number(input.value));});
  for(const corner of ['nw','ne','sw','se']){
    const handle=doc.createElement('button');handle.type='button';handle.className=`image-size-handle ${corner}`;handle.tabIndex=-1;handle.setAttribute('aria-label',strings.drag);overlay.append(handle);
    handle.addEventListener('pointerdown',event=>{
      if(busy||event.button!==0||!bitmap())return;
      event.preventDefault();event.stopPropagation();
      const rect=bitmap().getBoundingClientRect();drag={x:event.clientX,y:event.clientY,width:rect.width,height:rect.height,corner,id:event.pointerId};handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const ratio=natural().height/natural().width;
      const dx=(event.clientX-drag.x)*(drag.corner.endsWith('w')?-1:1),dy=(event.clientY-drag.y)*(drag.corner.startsWith('n')?-1:1);
      const delta=Math.abs(dx)>=Math.abs(dy/ratio)?dx:dy/ratio;
      const width=Math.max(1,Math.min(Math.floor(16384/Math.max(1,ratio)),Math.round(drag.width+delta)));
      const image=bitmap();image.style.width=`${width}px`;image.style.height='auto';if(image.classList.contains('image-bitmap')){image.style.height='';image.style.aspectRatio=`1 / ${ratio}`;}
      input.value=String(width);
    });
    handle.addEventListener('pointerup',event=>{if(!drag||event.pointerId!==drag.id)return;drag=null;commit(Number(input.value));});
    handle.addEventListener('pointercancel',()=>{if(drag){drag=null;repaint();}});
  }
  root.addEventListener('pointerdown',open,true);root.addEventListener('click',open,true);
  owner.addEventListener('pointerdown',outside,true);owner.addEventListener('keydown',keydown,true);
  if(owner!==doc){doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',keydown,true);}
  return ()=>{close();panel.remove();overlay.remove();root.removeEventListener('pointerdown',open,true);root.removeEventListener('click',open,true);owner.removeEventListener('pointerdown',outside,true);owner.removeEventListener('keydown',keydown,true);if(owner!==doc){doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',keydown,true);}};
}
