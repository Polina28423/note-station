import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindSettingsTabs } from '../ui/settings.js';
class Element {
  constructor() { this.children=[];this.listeners={};this.attributes={};this.textContent='';this.open=true; }
  addEventListener(name,fn){this.listeners[name]=fn;}
  setAttribute(name,value){this.attributes[name]=value;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  focus(){this.focused=true;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(invoke){const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};globalThis.document={getElementById:get,createElement:()=>new Element()};return {get,controller:bindSettingsTabs({invoke})};}
test('settings tabs select one panel and load only public saved-account metadata',async()=>{
 const calls=[];const ui=setup(async command=>{calls.push(command);return [{account:'<img onerror=x>',server:'https://nas.example',mode:'strict',sid:'must-not-render'}];});
 ui.controller.reset();assert.equal(ui.get('settings-sessions-panel').hidden,true);assert.equal(calls.length,0);
 ui.get('settings-sessions-tab').listeners.click();await tick();
 assert.deepEqual(calls,['list_accounts']);assert.equal(ui.get('settings-editor-panel').hidden,true);
 const card=ui.get('settings-sessions-list').children[0];assert.equal(card.children[0].textContent,'<img onerror=x>');assert.ok(!JSON.stringify(card).includes('must-not-render'));
 assert.equal(ui.get('settings-sessions-tab').attributes['aria-selected'],'true');
});
test('keyboard tab navigation updates focus and reset discards late results',async()=>{
 let resolve;const ui=setup(()=>new Promise(done=>{resolve=done;}));ui.controller.reset();
 ui.get('settings-editor-tab').listeners.keydown({key:'ArrowRight',preventDefault(){}});
 assert.equal(ui.get('settings-sessions-tab').focused,true);ui.controller.reset();
 resolve([{account:'stale',server:'https://nas.example',mode:'strict'}]);await tick();
 assert.equal(ui.get('settings-sessions-list').children.length,0);assert.equal(ui.get('settings-sessions-panel').hidden,true);
});
test('empty lists and failures have separate states and support retry',async()=>{
 let fail=true;const ui=setup(async()=>{if(fail)throw Error('private backend detail');return [];});
 ui.get('settings-sessions-tab').listeners.click();await tick();assert.match(ui.get('settings-sessions-status').textContent,/Не удалось/);assert.equal(ui.get('settings-sessions-refresh').disabled,false);
 fail=false;await ui.get('settings-sessions-refresh').listeners.click();assert.match(ui.get('settings-sessions-status').textContent,/пока нет/);
});
