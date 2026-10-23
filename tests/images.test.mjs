import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageSession, imageResources, resizedImageHtml } from '../ui/images.js';
import { EditorDocument } from '../ui/editor-document.js';
import { normalizePastedHtml } from '../ui/paste-normalizer.js';

test('image dimensions replace conflicting sizes while preserving references and other attributes',()=>{
  const raw='<img ref="original" src="relative.png" alt="A &amp; B" style="width:100%;height:10px;color:red" width="20" height="10">';
  const resized=resizedImageHtml(raw,120,60);
  assert.equal(resized,'<img ref="original" src="relative.png" alt="A &amp; B" style="color:red" width="120" height="60">');
  assert.throws(()=>resizedImageHtml(raw,0,10));assert.throws(()=>resizedImageHtml(raw,16385,10));assert.throws(()=>resizedImageHtml(raw,20.5,10));
});

test('resized image variants preserve undo tokens and do not count as removed attachments',()=>{
  const session=new ImageSession({}),raw='<img ref="original" width="30">';session.encode(raw);
  const original=[...session.records.keys()][0],resized=session.resized(original,120,60),again=session.resized(resized,240,120);
  assert.equal(session.records.get(original),raw);assert.equal(session.decode(session.token(resized)),'<img ref="original" width="120" height="60">');
  assert.equal(session.removed(session.decode(session.token(again))),0);assert.equal(session.removed(''),1);
  session.local.set('local',{reference:'ns-image-local',file:{name:'local.png'},url:'data:image/png;base64,DATA'});session.records.set('local','<img ref="ns-image-local">');
  const local=session.resized('local',40,20),content=raw+session.decode(session.token(local));
  assert.equal(session.uploads(content).length,1);assert.equal(session.removed(content),0);
  const repeated=new ImageSession({});repeated.encode('<img ref="same" width="20"><img ref="same" width="40">');
  const resizedCopies=[...repeated.records.keys()].map(key=>repeated.resized(key,80,40));
  const copies=resizedCopies.map(key=>repeated.decode(repeated.token(key))).join('');assert.equal(repeated.removed(copies),0);assert.equal(repeated.removed(copies.slice(copies.length/2)),1);
});

test('image tokens retain raw source and mixed editable paragraphs byte for byte',()=>{
  const source='<!-- keep -->\n<P>Before <IMG ref="a" file_id="legacy" src="relative.png" width="80"> After</P>\n';
  const images=new ImageSession({content:source});const encoded=images.encode(source),document=new EditorDocument(encoded);
  assert.equal(document.fragments.size,0);assert.equal(images.decode(encoded),source);
  const blocks=structuredClone(document.blocks);document.bindBaseline(blocks);blocks[0].data.text=blocks[0].data.text.replace('Before','Edited');
  const output=images.decode(document.serialize(blocks));assert.match(output,/<IMG ref="a" file_id="legacy" src="relative.png" width="80">/);assert.match(output,/Edited /);assert.match(output,/ After/);assert.ok(!output.includes('data-note-image'));
});
test('removal counts duplicate references and leaves local drafts out of confirmation',()=>{
  const raw='<img ref="same">',images=new ImageSession({});images.encode(raw+raw);assert.equal(images.removed(raw),1);assert.equal(images.removed(raw+raw),0);
  const key='local';images.records.set(key,'<img ref="local">');images.local.set(key,{});assert.equal(images.removed(raw+raw),0);
});
test('resource caches are version scoped and failed reads can be retried',async()=>{
  let calls=0;const load=async()=>{calls++;if(calls===1)throw Error('offline');return {data_url:'fixture'};};
  const first=imageResources({},load),args={id:'a',fileId:'f',version:'v1'};await assert.rejects(first.load(args));
  await Promise.all([first.load(args),first.load(args)]);assert.equal(calls,2);
  await first.load({...args,version:'v2'});assert.equal(calls,3);
  await imageResources({},load).load(args);assert.equal(calls,4);
});
test('clipboard normalization restores managed image HTML and keeps local aliases staged',()=>{
  const session=new ImageSession({}),raw='<img file_id="known-file" src="relative.png" alt="Image">',token=session.encode(raw);
  const normalized=normalizePastedHtml(session.clipboardHtml(token));assert.ok(normalized.includes('file_id="known-file"'));assert.ok(normalized.includes('relative.png'));assert.ok(!normalized.includes('data-note-image'));
  session.records.set('local','<img ref="ns-image-one">');session.local.set('local',{});session.records.set('alias','<img ref="ns-image-one">');
  assert.equal(session.removed(raw),0);
});
