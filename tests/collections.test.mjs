import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenTodos, filteredCollection, accessContext } from '../ui/collections.js';
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
