const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const ids=['a18','ma26','g21','mg24'],privateDir=process.env.LESSON_PRIVATE_INPUT;
const catalog=require('../assets/catalogs.js'),keys={};
const root=path.resolve(__dirname,'..');
for(const id of ids)for(const suffix of 'ab'){
 const source=fs.readFileSync(path.join(root,'quiz-'+id+suffix+'.html'),'utf8');
 keys['quiz-'+id+suffix]=Array.from(source.matchAll(/class="qz-q" data-q="\d+">([\s\S]*?)(?=<div class="qz-q"|<div class="qz-bar")/g),m=>m[1].includes('type="radio"')?'a':'0');
 assert.equal(keys['quiz-'+id+suffix].length,6);
}
let contentKey='test-key-unused';
if(privateDir){
 contentKey=fs.readFileSync(path.join(privateDir,'content-key.txt'),'utf8').trim();
 for(const fixture of JSON.parse(fs.readFileSync(path.join(privateDir,'quiz-fixtures.json'),'utf8')))keys[fixture.quiz]=Object.keys(fixture.answers).sort((a,b)=>a-b).map(k=>fixture.answers[k]);
}
const mock=require('./mock.js')(contentKey,keys,{}),SITE=process.env.SITE;
(async()=>{
 const browser=await chromium.launch();
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];await ctx.route(/googleapis|gstatic/,r=>r.abort());await ctx.addInitScript(mock);
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(SITE+'help.html');
  await p.evaluate(()=>{localStorage.setItem('mockSession',JSON.stringify({user:{id:'u2',email:'kid@test.local'}}));localStorage.setItem('mockdb',JSON.stringify({edu_profiles:[{user_id:'u1',email:'teacher@test.local',role:'teacher'},{user_id:'u2',email:'kid@test.local',role:'student'}],edu_students:[{id:'s1',user_id:'u2',name:'Тестовый ученик'}],edu_lessons:[],edu_progress:[]}));});
  for(const id of ids){
   const suffix=/^g\d+$/.test(id)?id.slice(1):id,slide='s'+suffix,ws='ws'+suffix;
   await p.goto(SITE+id+'.html');await p.waitForSelector('#homework .task-no');
   assert.equal(await p.locator('#homework .task-no').count(),6);assert.equal(await p.locator('#practice .practice-task').count(),6);
   assert.equal(await p.locator('[data-teacher-check]').count(),0);
   await p.setViewportSize({width:390,height:844});
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,id+' mobile overflow');await p.setViewportSize({width:1280,height:900});
   await p.goto(SITE+slide+'.html');await p.waitForSelector('.slide.on');assert.equal(await p.textContent('#cnt'),'1 / 10');await p.click('#next');assert.equal(await p.textContent('#cnt'),'2 / 10');
   const png=await ctx.request.get(SITE+'assets/slides/'+id+'/01.png');assert.equal(png.status(),200);
   const pdf=await ctx.request.get(SITE+'files/'+ws+'-student.pdf');assert.equal(pdf.status(),200);assert((await pdf.body()).subarray(0,5).equals(Buffer.from('%PDF-')));
   await p.goto(SITE+ws+'.html');await p.waitForSelector('.wsf');await p.locator('textarea.wsf').first().fill('Проверяем сохранение рассуждений');await p.locator('#wsBar button.go').click();
   await p.waitForFunction(()=>document.querySelector('#wsSt').textContent.includes('Нажми «Сдать» ещё раз'));
   await p.locator('#wsBar button.go').click();
   await p.waitForFunction(ws=>JSON.parse(localStorage.getItem('mockdb')).edu_ws_answers.some(w=>w.ws===ws&&w.submitted_at),ws);
   for(const variant of 'ab'){
    const qid='quiz-'+id+variant;await p.goto(SITE+qid+'.html');await p.waitForSelector('#qzForm [data-q]');
    for(let i=1;i<=6;i++){
     const box=p.locator('[data-q="'+i+'"]'),radios=box.locator('input[type=radio]');
     if(await radios.count())await box.locator('input[value="'+keys[qid][i-1]+'"]').check();else await box.locator('input[type=text]').fill(keys[qid][i-1]);
    }
    await p.click('#qzGo');await p.waitForSelector('#qzScore:not([hidden])');
    assert.match(await p.textContent('#qzScore'),/6 из 6/);
   }
  }
  console.log('PASS LESSON-UI-01: 4 lessons, 40 slides, 4 printable worksheets and 8 self-checks work for a pupil');
  const pupilAnswerRequests=[];
  p.on('request',req=>{if(new URL(req.url()).pathname.endsWith('/t/g5-section-solutions.bin'))pupilAnswerRequests.push(req.url());});
  await p.setViewportSize({width:390,height:844});
  await p.goto(SITE+'g5.html#section-practice');
  const g5=p.locator('#section-practice .section-drills img');
  await g5.last().scrollIntoViewIfNeeded();
  assert.deepEqual(await g5.evaluateAll(imgs=>imgs.map(img=>img.getAttribute('src'))),
    Array.from({length:14},(_,i)=>'assets/fig/g5-section-'+(i+1)+'.svg'));
  assert.equal(await p.locator('#section-solutions').count(),0);
  assert.equal(pupilAnswerRequests.length,0);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'g5 mobile overflow');
  await p.setViewportSize({width:1280,height:900});
  console.log('PASS LESSON-UI: 14 drawings in lesson 5; pupil does not load the teacher explanations');
  await p.goto(SITE+'t.html#a18');await p.waitForURL('**/index.html');
  console.log('PASS LESSON-UI-02: pupil cannot enter teacher materials');
  await p.evaluate(()=>{localStorage.setItem('mockSession',JSON.stringify({user:{id:'u1',email:'teacher@test.local'}}));localStorage.setItem('ws.student','s1');});
  await p.goto(SITE+'journal.html');await p.waitForSelector('#lTopic option[value="a18"]',{state:'attached'});
  for(const id of ids){await p.fill('#lHw','');await p.selectOption('#lTopic',id);const text=await p.inputValue('#lHw');assert.equal((text.match(/^Д\d+\./gm)||[]).length,6);assert.equal(await p.inputValue('#lQuiz'),'quiz-'+id+'b');assert.equal(text,catalog.homeworkHints[id].text);}
  console.log('PASS LESSON-UI-03: all four lessons can be assigned as complete homework with the matching quiz');
  if(privateDir){
   for(const id of ids){
    await p.goto(SITE+'t.html#'+id);await p.waitForSelector('[data-teacher-check="TEACHER-ONLY-'+id+'-CONTENT"]');
    const suffix=/^g\d+$/.test(id)?id.slice(1):id;
    await p.goto(SITE+'t.html#ws'+suffix);await p.waitForSelector('[data-teacher-check="TEACHER-ONLY-'+id+'-CONTENT"]');
   }
   for(const book of ['algebra','algebra-m','geometry','geometry-m']){await p.goto(SITE+'t.html#'+book);await p.waitForSelector('[data-lesson-pack]');}
   console.log('PASS LESSON-UI-04: actual encrypted teacher lessons, worksheets and course indexes open with the owner key');
  }
  assert.deepEqual(errors,[]);await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
