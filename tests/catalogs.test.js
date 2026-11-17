const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const catalog=require('../assets/catalogs.js');

test('public topic identifiers are unique and every quiz names an existing page',()=>{
  const ids=catalog.groups.flatMap(group=>group[1].map(topic=>topic[0]));
  assert.equal(new Set(ids).size,ids.length,'ambiguous topic identifier');
  for(const [id,title] of Object.entries(catalog.quizzes)){
    assert(title.trim(),id+' needs a display name');
    assert(fs.existsSync(path.join(__dirname,'..',id+'.html')),id+' needs a quiz page');
  }
  for(const [id,hint] of Object.entries(catalog.homeworkHints)){
    assert(catalog.topics[id],id+' must be a known topic');
    assert(hint.text.trim() && hint.src.trim(),id+' needs homework text and its source');
    if(hint.quiz)assert(catalog.quizzes[hint.quiz],id+' references an unknown quiz');
  }
  for(const [id,title] of Object.entries(catalog.worksheets))assert(title.trim(),id+' needs a display name');
});

test('journal homework overrides cannot change shared hints or another consumer',()=>{
  const journal=catalog.copyHomeworkHints(),student=catalog.copyHomeworkHints();
  const original=catalog.homeworkHints.el2.text;
  journal.el2.text='Индивидуальное задание';journal.el2.full='Полные условия из урока';
  delete journal.g1;
  assert.equal(catalog.homeworkHints.el2.text,original);
  assert.equal(student.el2.text,original);
  assert(student.g1);
  assert.throws(()=>{ 'use strict';catalog.homeworkHints.el2.text='Accidental shared mutation'; },TypeError);
});
