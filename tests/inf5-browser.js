const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {randomBytes,createCipheriv}=require('node:crypto');
const SITE=process.env.SITE;
const mockKeys={'quiz-inf5b':['1','2','3','4','5','6']}; // Synthetic scoring fixture, not the lesson's answers.
(async()=>{const b=await chromium.launch();try{
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const notes=Buffer.concat([iv,cipher.update(JSON.stringify({
   plan:'<p>План проверки на 90 минут</p>',
   practice:'<p>Закрытые проверочные решения урока 5</p>',
   test:'<p>Разбор тестов</p>',homework:'<p>Разбор Д1</p>'
 })),cipher.final(),cipher.getAuthTag()]);
 const ctx=await b.newContext({viewport:{width:1200,height:800}});
 await ctx.route(/googleapis|gstatic/,r=>r.abort());
 await ctx.route('**/t/inf5-notes.bin?*',r=>r.fulfill({body:notes}));
 await ctx.addInitScript(require('./mock.js')(randomBytes(32).toString('base64'),mockKeys,{}));
 const p=await ctx.newPage(), errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(SITE+'help.html');
 await p.evaluate(testKey=>{
  localStorage.setItem('mockSession',JSON.stringify({user:{id:'u1',email:'teacher@test.local'}}));
  localStorage.setItem('mockContentKeys',JSON.stringify({informatics_content_key:testKey}));
  localStorage.setItem('mockdb',JSON.stringify({edu_profiles:[{user_id:'u1',role:'teacher'},{user_id:'u2',role:'student'}],edu_students:[{id:'inf-student',user_id:'u2',name:'Тестовый ученик'}],edu_lessons:[],edu_progress:[],edu_boards:[{id:'inf5-board',student_id:'inf-student',title:'Доска к уроку',data:{els:[],bg:'grid'},revision:0}]}));
 },key.toString('base64'));
 await p.goto(SITE+'t.html#ege-inf/inf5-teacher');
 await p.waitForSelector('#teacher-plan[open] .plan, #teacher-plan[open] p');
 assert.match(await p.locator('#teacher-plan').textContent(),/90 минут/);
 await p.locator('#teacher-practice summary').click();
 assert(await p.getByText('Закрытые проверочные решения урока 5').isVisible());
 await p.goto(SITE+'inf5.html#inf5-homework');
 await p.waitForURL('**/t.html#inf5/inf5-homework');
 await p.waitForSelector('#teacher-homework summary');
 assert.equal(await p.locator('nav .on').textContent(),'Информатика');
 await p.evaluate(()=>sessionStorage.setItem('asStudent','1'));
 await p.goto(SITE+'inf5.html');
 await p.waitForSelector('nav [data-k="teacher"]');
 assert.equal(await p.locator('#teacher-practice').count(),0);
 await p.evaluate(()=>sessionStorage.removeItem('asStudent'));
 await p.goto(SITE+'board.html?b=inf5-board');
 await p.waitForFunction(()=>window.__board?.board()?.id==='inf5-board');
 await p.evaluate(()=>localStorage.setItem('bdSlLast',JSON.stringify({_: 'inf5', 'Информатика':'inf5'})));
 await p.reload();
 await p.waitForFunction(()=>window.__board?.board()?.id==='inf5-board');
 await p.locator('#bdSlBtn').click();
 assert.equal(await p.inputValue('#bdSlD'),'inf5-lesson');
 assert.equal(await p.locator('#bdSl [data-k]').count(),12);
 await p.locator('#bdSl [data-k="11"]').click();
 await p.locator('#bdSlNext').click();
 const slides=await p.evaluate(()=>window.__board.els().map(x=>x.src));
 assert.deepEqual(slides,['sl:inf5-lesson/11','sl:inf5-lesson/12']);
 for (const id of ['inf5/10','inf5-90/21','inf5-lesson/11','inf5-lesson/12']) {
  assert((await p.request.get(SITE+'assets/slides/'+id+'.jpg')).ok());
 }
 await p.goto(SITE+'journal.html');
 await p.selectOption('#lTopic','inf5');
 assert.equal(await p.inputValue('#lQuiz'),'quiz-inf5b');
 assert.equal((await p.inputValue('#lHw')).match(/^Д[1-6]\./gm).length,6);
 await p.click('#lSend');
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('mockdb')).edu_lessons.some(x=>x.topic==='inf5'&&x.hw_sent_at));
 await p.evaluate(()=>localStorage.setItem('mockSession',JSON.stringify({user:{id:'u2',email:'kid@test.local'}})));
 await p.goto(SITE+'t.html#inf5');
 await p.waitForURL('**/index.html');
 await p.goto(SITE+'ege-inf.html');
 await p.getByRole('link',{name:'Урок №5 · Двоичные алгоритмы'}).click();
 assert.equal(await p.locator('#inf5-practice > .task').count(),8);
 assert.equal(await p.locator('#inf5-reserve .task').count(),12);
 assert.equal(await p.locator('#inf5-theory .ex').count(),5);
 assert.equal(await p.locator('#inf5-homework .task').count(),10);
 assert.equal(await p.locator('#teacher-practice').count(),0);
 await p.setViewportSize({width:390,height:844});
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 await p.goto(SITE+'sinf5.html');
 assert.equal(await p.textContent('#cnt'),'1 / 12');
 await p.keyboard.press('End');assert.equal(await p.textContent('#cnt'),'12 / 12');
 await p.goto(SITE+'wsinf5.html');assert.equal(await p.locator('.sheet .worksheet-exercises > li').count(),8);
 await p.goto(SITE+'homework.html');
 await p.locator('a[href^="quiz-inf5b.html?hw="]').click();
 await p.waitForSelector('#fano-assigned:not([hidden])');
 for(let i=1;i<=6;i++)await p.locator('[data-q="'+i+'"] input').fill(String(i));
 await p.click('#qzGo');
 await p.waitForFunction(()=>document.getElementById('fano-score').textContent.includes('первая попытка засчитана'));
 assert.match(await p.textContent('#fano-score'),/6 из 6/);
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('mockdb')).edu_quiz_results.some(r=>r.lesson_id&&r.quiz==='quiz-inf5b'&&r.score===6));
 assert.deepEqual(errors,[]);
 console.log('PASS INF5: teacher HTML, worksheet, slides, new homework assignment and observed first test attempt');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
