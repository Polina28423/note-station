import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseTagName,normalizeTagName} from '../ui/note-tags.js';
test('new tag names reuse existing spelling without changing catalog names',()=>{
  const catalog=['Работа','Reference','Архитектура::Паттерны'];
  assert.equal(normalizeTagName('  РАБОТА '),'работа');
  assert.equal(chooseTagName('REFERENCE',catalog),'Reference');
  assert.equal(chooseTagName(' новый ',catalog),'новый');
  assert.deepEqual(catalog,['Работа','Reference','Архитектура::Паттерны']);
});
