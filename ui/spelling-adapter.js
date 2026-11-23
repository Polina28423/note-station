// Snapshots keep live text-node references; HTML is never rebuilt for a spelling fix.
const EXCLUDED = 'code,pre,script,style,.mceNonEditable,.preserved-fragment,[contenteditable="false"]';
const BLOCK = /^(P|DIV|LI|UL|OL|TD|TH|TR|H[1-6]|BLOCKQUOTE|SECTION)$/;
export function captureTextRegions(elements) {
  return elements.map((element, index) => {
    if (element.tagName === 'TEXTAREA') return { id: String(index), text: element.value, element, nodes: null };
    const nodes = [];
    const boundary = () => { if (nodes.length && !nodes.at(-1).text.endsWith('\n')) nodes.push({ node: null, text: '\n' }); };
    function visit(node) {
      if (node.nodeType === 3) { nodes.push({ node, text: node.data }); return; }
      if (node.nodeType !== 1) return;
      if (node.matches(EXCLUDED)) { boundary(); return; }
      const block = BLOCK.test(node.tagName);
      if (block || node.tagName === 'BR') boundary();
      for (const child of node.childNodes) visit(child);
      if (block) boundary();
    }
    for (const child of element.childNodes) visit(child);
    return { id: String(index), text: nodes.map(part => part.text).join(''), element, nodes };
  }).filter(region => region.text.trim());
}
export function snapshotIsCurrent(snapshot) {
  return snapshot.every(region => {
    if (!region.element.isConnected) return false;
    if (!region.nodes) return region.element.value === region.text;
    const fresh = captureTextRegions([region.element])[0];
    return fresh?.text === region.text && fresh.nodes.length === region.nodes.length && fresh.nodes.every((part, index) => part.node === region.nodes[index].node && part.text === region.nodes[index].text);
  });
}
export function spellingRange(snapshot, issue) {
  if (!snapshotIsCurrent(snapshot)) return null;
  const region = snapshot.find(item => item.id === issue.segment);
  if (!region || !Number.isInteger(issue.start) || !Number.isInteger(issue.length) || issue.start < 0 || issue.length < 1 || region.text.slice(issue.start, issue.start + issue.length) !== issue.word) return null;
  if (!region.nodes) return { region, start: issue.start, end: issue.start + issue.length };
  const locate = offset => {
    for (const part of region.nodes) {
      if (part.node && offset <= part.text.length) return { node: part.node, offset };
      offset -= part.text.length;
    }
    return null;
  };
  const start = locate(issue.start), end = locate(issue.start + issue.length);
  if (!start || !end) return null;
  const range = region.element.ownerDocument.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  if (range.toString() !== issue.word) return null;
  return { region, range };
}

export function selectionInSnapshot(snapshot, range) {
  if (!range || range.collapsed) return null;
  for (const region of snapshot) {
    if (!region.nodes || !region.element.contains(range.startContainer) || !region.element.contains(range.endContainer)) continue;
    const offsetAt = (container, offset) => {
      let total = 0;
      for (const part of region.nodes) {
        if (!part.node) { total += part.text.length; continue; }
        if (container === part.node) return total + offset;
        const probe = region.element.ownerDocument.createRange(); probe.selectNodeContents(part.node);
        if (probe.comparePoint(container, offset) < 0) return total;
        total += part.text.length;
      }
      return total;
    };
    const start = offsetAt(range.startContainer, range.startOffset), end = offsetAt(range.endContainer, range.endOffset);
    if (end > start) return { segment: region.id, start, length: end - start };
  }
  return null;
}
