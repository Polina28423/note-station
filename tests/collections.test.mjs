import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenTodos, filteredCollection, accessContext, taskDueEpoch } from '../ui/collections.js';

test('task dates are local end-of-day epoch seconds and reject invalid dates',()=>{
  assert.equal(taskDueEpoch(''),null);
  const value=taskDueEpoch('2026-11-20');
  const date=new Date(value*1000);
  assert.equal(date.getFullYear(),2026);assert.equal(date.getMonth(),10);assert.equal(date.getDate(),20);
  assert.equal(date.getHours(),23);assert.equal(date.getMinutes(),59);assert.equal(date.getSeconds(),59);
  for(const bad of ['2026-02-30','1969-12-31','2026-13-01','not-date'])assert.throws(()=>taskDueEpoch(bad));
});
test('nested tasks flatten once and preserve depth and completion filters',()=>{
 const child={object_id:'child',title:'Материалы',done:true};const tasks=[{object_id:'parent',title:'План',done:false,items:[child]},child];
 const rows=flattenTodos(tasks);assert.equal(rows.length,2);assert.equal(rows[1].depth,1);
 assert.equal(filteredCollection(rows,'МАТЕР','done')[0].object_id,'child');assert.equal(filteredCollection(rows,'','open')[0].object_id,'parent');
 assert.equal(tasks.length,2);
});
test('only access context fields are copied to note reads and restores',()=>{
 assert.deepEqual(accessContext({object_id:'note',perm_from:'shared-book',smart_id:'smart',sid:'secret',url:'https://evil'}),{perm_from:'shared-book',smart_id:'smart'});
 assert.deepEqual(accessContext({}),{});
});
test('deep task structures are rejected and duplicated task IDs cannot loop',()=>{
 const task={object_id:'a',title:'Task',items:[]};task.items.push(task);assert.equal(flattenTodos([task]).length,1);
 let nested={object_id:'last'};for(let i=0;i<23;i++)nested={object_id:String(i),items:[nested]};assert.throws(()=>flattenTodos([nested]),/вложенный/);
});
