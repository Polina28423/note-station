import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notebookCounts, visibleNotebooks, visibleNotes, noteCountLabel, notebookCountLabel, groupNotebooks, notesInShelf, shelfKey, frequentNotes, restoredNoteLocation } from '../ui/library.js';
const books = [{object_id:'a',title:'Работа 10'},{object_id:'b',title:'Работа 2'},{object_id:'c',title:'Личное'}];
const notes = [{object_id:'1',parent_id:'a',title:'План'},{object_id:'2',parent_id:'b',title:'Встреча'},{object_id:'3',parent_id:'b',title:'Планы'}];
test('frequent notes rank by openings then recency and unavailable IDs are ignored on restore', () => {
  const activity = { notebookId: 'a', noteId: '2', opened: [{ id: '3', count: 1 }, { id: '2', count: 1 }, { id: 'gone', count: 99 }, { id: '1', count: 2 }] };
  assert.deepEqual(frequentNotes(notes, activity).map(note => note.object_id), ['1', '3', '2']);
  assert.deepEqual(restoredNoteLocation(notes, books, activity), { notebookId: 'b', noteId: '2' });
  assert.deepEqual(restoredNoteLocation(notes, books, { ...activity, noteId: 'gone' }), { notebookId: 'a', noteId: '' });
  assert.deepEqual(restoredNoteLocation(notes, books, { ...activity, notebookId: 'gone', noteId: 'gone' }), { notebookId: '', noteId: '' });
});
test('counts include only their notebook and count order does not mutate source', () => {
 const counts = notebookCounts(notes);
 assert.equal(counts.get('b'),2);
 assert.deepEqual(visibleNotebooks(books,'работа','title',counts).map(n=>n.object_id),['b','a']);
 assert.deepEqual(visibleNotebooks(books,'','count',counts).map(n=>n.object_id),['b','a','c']);
 assert.equal(books[0].object_id,'a');
});
test('search is scoped to selected notebook, all-notes includes every notebook', () => {
 assert.deepEqual(visibleNotes(notes,'b',' план ','original').map(n=>n.object_id),['3']);
 assert.equal(visibleNotes(notes,'','план','asc').length,2);
 assert.deepEqual(visibleNotes(notes,'b','','desc').map(n=>n.object_id),['3','2']);
 assert.equal(visibleNotes(notes,'c','','original').length,0);
});
test('Russian count labels', () => {
 for (const [n,text] of [[0,'0 заметок'],[1,'1 заметка'],[2,'2 заметки'],[11,'11 заметок'],[21,'21 заметка'],[112,'112 заметок']]) assert.equal(noteCountLabel(n),text);
});

const shelved = [
 {object_id:'a',title:'Проект A',stack:'Работа',owner:{uid:1,display_name:'Анна'}},
 {object_id:'b',title:'Проект B',stack:'Работа',owner:{uid:1,display_name:'Анна'}},
 {object_id:'c',title:'Проект C',stack:'Работа',owner:{uid:2,display_name:'Иван'}},
 {object_id:'d',title:'Личное',stack:null},
 {object_id:'e',title:'Без полки'},
 {object_id:'f',title:'Пустая полка',stack:''},
];
test('shelves preserve membership, distinguish owners and retain unshelved notebooks', () => {
 const {shelves,standalone} = groupNotebooks(shelved);
 assert.equal(shelves.length,2);
 assert.deepEqual(shelves.find(s=>s.owner==='Анна').notebooks.map(n=>n.object_id),['a','b']);
 assert.deepEqual(standalone.map(n=>n.object_id),['d','e','f']);
 assert.notEqual(shelfKey(shelved[0]),shelfKey(shelved[2]));
 assert.equal(shelves.find(s=>s.owner==='Анна').label,'Работа · Анна');
});
test('shelf search reveals every notebook, notebook search keeps only matching child', () => {
 assert.equal(visibleNotebooks(shelved,'работа','title',new Map()).length,3);
 assert.deepEqual(visibleNotebooks(shelved,'проект b','title',new Map()).map(n=>n.object_id),['b']);
 assert.equal(shelved[0].stack,'Работа');
});
test('shelf note filter spans member notebooks and tracks moved notebooks after refresh', () => {
 const key = shelfKey(shelved[0]);
 assert.deepEqual(notesInShelf(notes,shelved,key).map(n=>n.object_id),['1','2','3']);
 const moved = shelved.map(n=>n.object_id==='b'?{...n,stack:'Другая полка'}:n);
 assert.deepEqual(notesInShelf(notes,moved,key).map(n=>n.object_id),['1']);
 assert.equal(notesInShelf(notes,shelved,'missing').length,0);
 assert.equal(notesInShelf(notes,shelved,''),notes);
});
test('shelf names are exact keys, including object prototype names', () => {
 const groups = groupNotebooks([{object_id:'x',title:'X',stack:'__proto__'},{object_id:'y',title:'Y',stack:'constructor'}]);
 assert.equal(groups.shelves.length,2);
 assert.deepEqual(groups.shelves.map(s=>s.name).sort(),['__proto__','constructor']);
 for(const [n,label] of [[1,'1 блокнот'],[2,'2 блокнота'],[11,'11 блокнотов']]) assert.equal(notebookCountLabel(n),label);
});
