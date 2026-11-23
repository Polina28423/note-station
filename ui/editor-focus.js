// Restore a reader click to a matching editable text region, without changing data.
export function editableTarget(root, anchor) {
  const candidates=root.isContentEditable?[root,...root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote')]:[...root.querySelectorAll('[contenteditable="true"],textarea')];
  const value=node=>node.tagName==='TEXTAREA'?node.value:node.textContent;
  return (anchor?.text && candidates.find(node=>value(node)===anchor.text)) || candidates[0];
}
export function focusContent(root, anchor) {
  const value=node=>node.tagName==='TEXTAREA'?node.value:node.textContent;
  const target=editableTarget(root,anchor);
  if(!target){root.tabIndex=-1;root.focus();return;}
  target.focus({preventScroll:true});
  const offset=anchor?.text===value(target)?Math.max(0,anchor.offset || 0):0;
  if(target.tagName==='TEXTAREA')target.setSelectionRange(Math.min(offset,target.value.length),Math.min(offset,target.value.length));
  else {
    const doc=target.ownerDocument,walker=doc.createTreeWalker(target,4);let node,left=offset,last;
    while((node=walker.nextNode())){last=node;if(left<=node.textContent.length)break;left-=node.textContent.length;}
    const range=doc.createRange();
    if(node||last)range.setStart(node||last,Math.min(left,(node||last).textContent.length));
    else {range.selectNodeContents(target);range.collapse(true);}
    range.collapse(true);const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
  }
  target.scrollIntoView({block:'nearest'});
}
