// Автотесты «Кабинета математики» (окружение A): локальная копия сайта + имитация Supabase.
// Запуск: CONTENT_KEY=<ключ> SITE=http://127.0.0.1:8765/ node tests/e2e.js
// Тестовые аккаунты существуют только внутри имитации.
const { chromium } = require('playwright');
const KEY = process.env.CONTENT_KEY; const SITE = process.env.SITE || 'http://127.0.0.1:8765/';
if (!KEY) { console.error('нужен CONTENT_KEY'); process.exit(2); }

const QK = process.env.QUIZ_KEYS ? JSON.parse(require('fs').readFileSync(process.env.QUIZ_KEYS, 'utf8')) : {};
const BK = (l => Array.isArray(l) ? Object.fromEntries(l.map(t => [t.id, {num: t.num, answer: t.answer, solution: t.solution}])) : l)(process.env.BANK_KEYS ? JSON.parse(require('fs').readFileSync(process.env.BANK_KEYS, 'utf8')) : {});
const MOCK = require('./mock.js')(KEY, QK, BK);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');

const results = []; let errors = [];
function rec(id, ok, note) { results.push({id, ok: !!ok, note: note || ''}); console.log((ok ? 'PASS ' : 'FAIL ') + id + (note ? ' — ' + note : '')); }
const TEACHER_PAGES = ['index','math','geometry','algebra','ege-math','ege-inf','library','g1','g2','g3','g4','g5','ws1','ws2','ws3','ws4','ws5','test-geo1','test-alg1','test-alg2'];
const PUBLIC = ['index','homework','geometry','algebra','ege-math','ege-14','ege-inf','quiz-geo1','ege-bank','board','reference','library','help','g1','g2','g3','g4','g5','ws1','ws2','ws3','ws4','ws5','s1','s2','s3','s4','s5'];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(); await ctx.route(/jsdelivr|googleapis|gstatic/, r => r.abort()); await ctx.addInitScript(MOCK);
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(p.url() + ' :: ' + e.message));
  const go = async (u, w) => { await p.goto(SITE + u); await p.waitForTimeout(w || 700); };
  const path = () => p.url().replace(SITE, '');
  const login = async (email, pw) => { await p.evaluate(([e, w]) => localStorage.setItem('mockSession', JSON.stringify({user:{id: {'teacher@test.local':'u1','kid@test.local':'u2','new@test.local':'u3'}[e], email: e}})), [email, pw]); };
  const logout = async () => p.evaluate(() => { localStorage.removeItem('mockSession'); sessionStorage.clear(); });
  const navText = () => p.evaluate(() => [...document.querySelectorAll('.top .nav a')].map(a => a.textContent).join('|'));
  await go('help.html'); await p.evaluate(() => localStorage.clear());

  // ── 1. Вход
  await go('g1.html'); rec('AUTH-01', path().startsWith('login.html?next=g1.html'), path());
  await go('help.html'); rec('AUTH-02', path() === 'help.html' && (await navText()) === 'Войти', await navText());
  await go('login.html');
  await p.click('#authbox [data-m="up"]'); const h1 = await p.textContent('#authbox h2');
  await p.click('#authbox [data-m="in"]'); await p.click('#authbox [data-m="forgot"]'); const h2 = await p.textContent('#authbox h2');
  await p.click('#authbox [data-m="in"]'); const helpLink = await p.$('#authbox a[href="help.html"]');
  rec('AUTH-03', h1 === 'Создать аккаунт' && h2 === 'Восстановление пароля' && !!helpLink, h1 + ' / ' + h2);
  await p.fill('#em', 'teacher@test.local'); await p.fill('#pw', 'wrong-pass'); await p.click('#authbox button[type=submit]'); await p.waitForTimeout(400);
  rec('AUTH-09', ((await p.textContent('#authbox')) || '').includes('Неверная почта или пароль'));
  await p.fill('#em', 'teacher@test.local'); await p.fill('#pw', 'test-pass-1'); await p.click('#authbox button[type=submit]'); await p.waitForTimeout(900);
  rec('AUTH-04', path() === 't.html#index', path());
  await go('login.html'); rec('AUTH-07', path() === 't.html#index', 'учитель на login.html → ' + path());
  await p.click('.top .nav [data-k="out"]'); await p.waitForTimeout(700);
  rec('AUTH-08', path().startsWith('login.html') && !(await p.evaluate(() => localStorage.getItem('mockSession'))), path());
  await p.fill('#em', 'kid@test.local'); await p.fill('#pw', 'test-pass-2'); await p.click('#authbox button[type=submit]'); await p.waitForTimeout(900);
  rec('AUTH-05', path() === 'index.html', path());
  await logout(); await go('login.html?next=reference.html');
  await p.fill('#em', 'kid@test.local'); await p.fill('#pw', 'test-pass-2'); await p.click('#authbox button[type=submit]'); await p.waitForTimeout(900);
  rec('AUTH-06', path() === 'reference.html', path());

  // ── 2. Роли (ученик)
  const blocked = [];
  for (const u of ['t.html#g1', 'journal.html', 'students.html']) { await go(u); if (path() !== 'index.html') blocked.push(u + '→' + path()); }
  rec('ROLE-02', !blocked.length, blocked.join(', '));
  await go('index.html'); const sn = await navText();
  rec('ROLE-04', sn === 'Главная|Домашка|Доска|Геометрия|Алгебра|ЕГЭ|Информатика|Справочник|Материалы|Помощь|Выйти', sn);
  await go('homework.html'); rec('HW-04', ((await p.textContent('#hwBox')) || '').includes('Пока нет домашних заданий'));

  // ── UI-03 ученик, ширина 390 + UI-01 ссылки на публичных страницах
  await p.setViewportSize({width: 390, height: 800});
  const wide = [], broken = new Set();
  for (const n of PUBLIC) { await go(n + '.html', 500);
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(n);
    const refs = await p.evaluate(() => [...document.querySelectorAll('a[href], img[src]')].map(e => e.getAttribute('href') || e.getAttribute('src'))
      .filter(h => h && !/^(https?:|mailto:|#|t\.html|javascript:)/.test(h)).map(h => h.split('#')[0]).filter(Boolean));
    for (const r of new Set(refs)) { const st = await p.evaluate(async (u) => (await fetch(u, {method:'HEAD'})).status, r); if (st !== 200) broken.add(n + ': ' + r + ' ' + st); } }
  rec('UI-03 (ученик)', !wide.length, wide.join(', '));
  rec('UI-01 (публичные)', !broken.size, [...broken].slice(0, 8).join(' | '));
  await p.setViewportSize({width: 1280, height: 860});

  // ── UI-04 презентация
  await go('s1.html'); await p.keyboard.press('ArrowRight'); const c1 = await p.textContent('#cnt');
  await p.click('#next'); const c2 = await p.textContent('#cnt'); await p.click('#prev'); const c3 = await p.textContent('#cnt');
  const back = await p.getAttribute('#ui a', 'href');
  rec('UI-04', c1.startsWith('2 /') && c2.startsWith('3 /') && c3.startsWith('2 /') && back === 'g1.html', [c1, c2, c3, back].join(' '));

  // ── 3. Учитель
  await logout(); await login('teacher@test.local');
  await go('g1.html'); rec('ROLE-01', path() === 't.html#g1', path());
  const tn = await navText();
  rec('ROLE-03', tn === 'Главная|Геометрия|Алгебра|ЕГЭ|Информатика|Справочник|Материалы|Журнал|Доска|Ученики|Глазами ученика|Выйти', tn);
  const encFail = [], tWide = [], tBroken = new Set();
  await p.setViewportSize({width: 390, height: 800});
  for (const n of TEACHER_PAGES) { await go('t.html#' + n, 900);
    const h = await p.evaluate(() => (document.querySelector('#tview h1') || {}).textContent || '');
    if (!h || h === 'Нет доступа' || h === 'Открываю…') encFail.push(n + ':' + h);
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) tWide.push(n);
    const refs = await p.evaluate(() => [...document.querySelectorAll('#tview a[href], #tview img[src]')].map(e => e.getAttribute('href') || e.getAttribute('src'))
      .filter(h => h && !/^(https?:|mailto:|#|t\.html|javascript:)/.test(h)).map(h => h.split('#')[0]).filter(Boolean));
    const TF = await p.evaluate(() => window.KABINET && 1);
    for (const r of new Set(refs)) { const target = /^files\/(ws\d-teacher|test-|geo-solutions|geo-drawings|ege-lecture-1)/.test(r) ? 't/' + r + '.bin' : r;
      const st = await p.evaluate(async (u) => (await fetch(u, {method:'HEAD'})).status, target); if (st !== 200) tBroken.add(n + ': ' + r + ' ' + st); } }
  await p.setViewportSize({width: 1280, height: 860});
  rec('ENC-01', !encFail.length, encFail.join(', ') || TEACHER_PAGES.length + ' страниц');
  rec('UI-03 (учитель)', !tWide.length, tWide.join(', '));
  rec('UI-01 (учительские)', !tBroken.size, [...tBroken].slice(0, 8).join(' | '));
  await go('t.html#geometry'); const gl = await p.getAttribute('#tview a[href*="g1"]', 'href');
  await go('t.html#g2'); const anchor = await p.getAttribute('#tview a[href*="practice"]', 'href');
  await go('t.html#g2/practice', 900); const scrolled = await p.evaluate(() => scrollY > 500);
  rec('ENC-02', gl === 't.html#g1' && anchor === 't.html#g2/practice' && scrolled, gl + ' ' + anchor + ' scrolled=' + scrolled);
  await go('t.html#library');
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#tview a[href="files/geo-drawings-1-33.png"]')]);
  await pop.waitForTimeout(1500); const img = await pop.evaluate(() => (document.querySelector('img') || {}).naturalWidth || 0).catch(() => 0);
  rec('ENC-03', pop.url().startsWith('blob:') && img > 0, pop.url().slice(0, 20) + ' w=' + img); await pop.close();
  await p.evaluate(() => localStorage.setItem('mockNoKey', 'true')); await go('help.html', 300); await go('t.html#g3', 900);
  rec('ENC-04', ((await p.textContent('#tview h1')) || '') === 'Нет доступа');
  await p.evaluate(() => localStorage.removeItem('mockNoKey'));
  await go('t.html#ws1', 1200); await p.click('[data-mode="student"]');
  const hid = await p.evaluate(() => getComputedStyle(document.querySelector('.teacher.ans')).display);
  await p.click('[data-mode="teacher"]'); const shown = await p.evaluate(() => getComputedStyle(document.querySelector('.teacher.ans')).display);
  rec('UI-05', hid === 'none' && shown !== 'none', hid + '/' + shown);
  await go('students.html', 900); const rows = await p.$$eval('#list .lesson-row', r => r.length);
  await p.selectOption('select[data-id="u3"]', 'teacher'); await p.waitForTimeout(400);
  const changed = await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '{}').edu_profiles?.find(x => x.user_id === 'u3')?.role);
  await p.selectOption('select[data-id="u3"]', 'student'); await p.waitForTimeout(400);
  rec('ROLE-06', rows === 3 && changed === 'teacher', 'строк ' + rows + ', роль u3 → ' + changed);
  await go('index.html'); await go('t.html#index'); await p.click('.top .nav [data-k="student"]'); await p.waitForTimeout(800);
  const asS = path(); await go('g1.html'); const stay = path(); const nn = await navText();
  await p.click('.top .nav [data-k="teacher"]'); await p.waitForTimeout(800);
  rec('ROLE-05', asS === 'index.html' && stay === 'g1.html' && nn.includes('Режим учителя') && path() === 't.html#index', [asS, stay, path()].join(' → '));
  // ROLE-07: учитель в режиме «Глазами ученика» открывает учительскую страницу → снова режим учителя, «Информатика» в меню
  await p.click('.top .nav [data-k="student"]'); await p.waitForTimeout(800); await go('t.html#index', 1200); const tn7 = await navText();
  rec('ROLE-07', tn7.includes('Информатика') && !tn7.includes('Режим учителя') && !(await p.evaluate(() => sessionStorage.getItem('asStudent'))), tn7);

  // ── 4. Журнал
  await go('journal.html', 900); rec('JR-01', ((await p.textContent('#status')) || '').includes('Добавьте первого ученика'));
  await p.click('#tabs button.primary'); await p.fill('#sName', 'Миша'); await p.fill('#sGrade', '10'); await p.fill('#sGoal', 'ЕГЭ профиль');
  await p.selectOption('#sUser', 'u2'); await p.click('#sSave'); await p.waitForTimeout(900);
  rec('JR-02', (await p.textContent('#cName')) === 'Миша' && (await p.textContent('#cLink')).includes('kid@test.local'));
  await p.selectOption('#lTopic', 'g2'); await p.fill('#lHw', '№ 18, 23, 27'); await p.selectOption('#lMark', '5'); await p.fill('#lNotes', 'СЕКРЕТНАЯ-ЗАМЕТКА');
  await p.click('#lSave'); await p.waitForTimeout(1600);
  const prog = await p.$$eval('#progress .t-work', e => e.map(x => x.textContent).join('|'));
  rec('JR-03', ((await p.textContent('#log')) || '').includes('№ 18, 23, 27') && prog.includes('Урок 2'), 'прогресс: ' + prog);
  await p.click('#log button:has-text("Изменить")'); const pre = await p.inputValue('#lHw');
  await p.fill('#lHw', '№ 18, 23, 27, 30'); await p.selectOption('#lHwStatus', 'done'); await p.click('#lSave'); await p.waitForTimeout(1200);
  rec('JR-04', pre === '№ 18, 23, 27' && ((await p.textContent('#log')) || '').includes('27, 30'), 'было: ' + pre);
  await p.selectOption('#lTopic', 'g3'); await p.fill('#lHw', 'Рабочий лист 3'); await p.selectOption('#lMark', '4'); await p.click('#lSave'); await p.waitForTimeout(1400);
  const stats = await p.evaluate(() => ['stLessons','stHw','stMark','stLast'].map(i => document.getElementById(i).textContent).join(' '));
  rec('JR-07', /^2 100% 4,5 \d\d\.\d\d\.\d{4}$/.test(stats), stats);
  await p.click('#progress button:has-text("Урок 4")'); await p.waitForTimeout(900); await go('journal.html', 900);
  const p4 = await p.$$eval('#progress .t-work', e => e.map(x => x.textContent).join('|'));
  rec('JR-06', p4.includes('Урок 4'), p4);

  // JR-09: следующее занятие и ссылка на звонок в карточке ученика
  const next = new Date(Date.now() + 2 * 864e5); next.setHours(18, 0, 0, 0);
  const nextLocal = new Date(next.getTime() - next.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  await p.fill('#nAt', nextLocal); await p.fill('#nUrl', 'https://example.test/call/abc'); await p.click('#nSave'); await p.waitForTimeout(600);
  const stRow = await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')).edu_students[0]);
  rec('JR-09', stRow.call_url === 'https://example.test/call/abc' && Math.abs(new Date(stRow.next_at) - next) < 6e4, stRow.next_at);

  // ── HW ученик
  await logout(); await login('kid@test.local');
  await go('index.html', 1200); const home = (await p.textContent('#hwBox')) || ''; const me = (await p.textContent('#meBox')) || '';
  const callHref = await p.getAttribute('#meBox a.btn', 'href').catch(() => null);
  rec('ST-01', me.includes('Следующее занятие') && me.includes('18:00') && me.includes('послезавтра') && callHref === 'https://example.test/call/abc', me.slice(0, 90));
  rec('ST-02', me.includes('Мой прогресс') && me.includes('в работе 3') && me.includes('0 из 35 тем освоено'), (me.match(/\d+ из \d+ тем освоено/) || [''])[0]);
  await go('homework.html', 1200); const hwAll = (await p.textContent('#hwBox')) || ''; const html = await p.content();
  rec('HW-01', home.includes('Рабочий лист 3') && hwAll.includes('№ 18, 23, 27, 30') && hwAll.includes('Урок 2'), 'на главной последнее, в «Домашке» оба');
  const raw = await p.evaluate(async () => (await window.KABINET.sb.rpc('edu_my_homework')).data);
  rec('HW-02', !html.includes('СЕКРЕТНАЯ-ЗАМЕТКА') && raw.every(x => !('notes' in x) && !('mark' in x)), 'заметок и отметок за урок в ответе нет');
  // HW-03: сдача с двумя фото и комментарием (вторая карточка — ДЗ к уроку 2)
  const hc2 = '#hwBox .hw-card >> nth=1';
  await p.setInputFiles(hc2 + ' >> input[type=file]', [{name: 'a.png', mimeType: 'image/png', buffer: PNG}, {name: 'b.png', mimeType: 'image/png', buffer: PNG}]);
  await p.waitForTimeout(300); const previews = await p.$$eval('#hwBox .hw-card:nth-child(2) .hw-ph', e => e.length);
  await p.fill(hc2 + ' >> textarea', 'Не понял № 27'); await p.click(hc2 + ' >> button[type=submit]'); await p.waitForTimeout(1500);
  const card2 = (await p.textContent(hc2)) || ''; const thumbs2 = await p.$$eval('#hwBox .hw-card:nth-child(2) .hw-ph img', e => e.length);
  const f1 = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mockfiles') || '{}')));
  rec('HW-03', previews === 2 && card2.includes('сдано') && card2.includes('Не понял № 27') && thumbs2 === 2 && f1.length === 2 && f1.every(k => k.startsWith('u2/')), `превью ${previews}, фото ${thumbs2}, файлов ${f1.length}`);
  // HW-05: правка сдачи — убрать одно фото
  await p.click(hc2 + ' >> button:has-text("Изменить сдачу")'); await p.click(hc2 + ' >> .hw-ph .x >> nth=0'); await p.click(hc2 + ' >> button[type=submit]'); await p.waitForTimeout(1200);
  const thumbs3 = await p.$$eval('#hwBox .hw-card:nth-child(2) .hw-ph img', e => e.length); const f2 = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mockfiles') || '{}')).length);
  rec('HW-05', thumbs3 === 1 && f2 === 1, `фото ${thumbs3}, файлов ${f2}`);
  // QZ-01/02: самопроверка
  await go('quiz-geo1.html', 1000); const keys = QK['quiz-geo1'] || [];
  for (let i = 0; i < keys.length; i++) { const k = keys[i].split('|')[0]; const sel = `[data-q="${i + 1}"]`;
    if (await p.$(sel + ' input[type=radio]')) await p.check(`${sel} input[value="${i === 0 ? 'a' : k}"]`); else await p.fill(sel + ' input[type=text]', i === 1 ? 'ни одной' : k); }
  await p.click('#qzGo'); await p.waitForTimeout(800);
  const sc = (await p.textContent('#qzScore')) || ''; const bad1 = (await p.textContent('[data-q="1"] .qz-res')) || '';
  rec('QZ-01', sc.startsWith(`${keys.length - 1} из ${keys.length}`) && sc.includes('сохранён'), sc.slice(0, 60));
  rec('QZ-02', bad1.includes('Неверно') && bad1.includes('скрещиваются') && ((await p.textContent('#qzHist')) || '').includes('Попыток: 1'), bad1);

  // BK-01…05: банк заданий ЕГЭ (ученик)
  const bkIds = Object.keys(BK); const neg = bkIds.find(id => BK[id].answer.startsWith('-') && BK[id].answer.includes('.') && BK[id].num === 2) || bkIds.find(id => BK[id].answer.startsWith('-'));
  await go('ege-bank.html#n=8', 1200);
  const bk1 = await p.evaluate(() => ({tabs: document.querySelectorAll('#bkTabs .bk-tab').length, tasks: document.querySelectorAll('#bkList .bk-task').length,
    h: (document.querySelector('#bkList h2') || {}).textContent, imgs: [...document.querySelectorAll('#bkList img.bk-fig')].filter(i => i.complete && i.naturalWidth > 0).length,
    solDis: document.querySelector('#bkList .bk-task .bk-btn.soft').disabled}));
  rec('BK-01', bk1.tabs === 13 && bk1.tasks === 10 && (bk1.h || '').startsWith('№ 8') && bk1.imgs >= 6 && bk1.solDis, JSON.stringify(bk1));
  const nN = String(BK[neg].num); await p.click(`#bkTabs [data-n="${nN}"]`); await p.waitForTimeout(300);
  const tc = `[data-task="${neg}"]`; await p.fill(tc + ' input', '12345'); await p.click(tc + ' button[type=submit]'); await p.waitForTimeout(500);
  const m1 = (await p.textContent(tc + ' .bk-msg')) || ''; const cls1 = await p.getAttribute(tc, 'class');
  await p.click(tc + ' .bk-btn.soft'); await p.waitForTimeout(500); const sol1 = (await p.textContent(tc + ' .bk-sol')) || '';
  rec('BK-02', m1.includes('Неверно') && cls1.includes('bad') && sol1.includes('Ответ: ' + BK[neg].answer.replace('.', ',').replace('-', '−')) && sol1.length > 30, m1 + ' | ' + sol1.slice(0, 50));
  await p.fill(tc + ' input', BK[neg].answer.replace('-', '−').replace('.', ',')); await p.click(tc + ' button[type=submit]'); await p.waitForTimeout(500);
  const m2 = (await p.textContent(tc + ' .bk-msg')) || ''; const sum1 = (await p.textContent('#bkSum')) || '';
  const bar = await p.$eval(`#bkTabs [data-n="${nN}"] .bk-bar i`, e => e.style.width);
  rec('BK-03', m2.includes('Верно') && sum1.includes('Решено 1 из 120') && bar === '10%', m2 + ' | ' + sum1 + ' | ' + bar);
  const ok1 = bkIds.find(id => BK[id].num === 1); await p.click('#bkTabs [data-n="1"]'); await p.waitForTimeout(200);
  await p.fill(`[data-task="${ok1}"] input`, BK[ok1].answer.replace('.', ',')); await p.press(`[data-task="${ok1}"] input`, 'Enter'); await p.waitForTimeout(500);
  await p.click('#bkVar'); await p.waitForTimeout(300);
  const v1 = await p.$$eval('#bkList .bk-task', e => e.map(x => x.getAttribute('data-task')));
  const nums = v1.map(id => +id.slice(1, 3)).join(','); await p.click('#bkNewVar'); await p.waitForTimeout(300);
  const v2 = await p.$$eval('#bkList .bk-task', e => e.map(x => x.getAttribute('data-task')));
  rec('BK-04', v1.length === 12 && nums === '1,2,3,4,5,6,7,8,9,10,11,12' && v2.length === 12 && !v1.includes(ok1) && !v1.includes(neg), nums);
  await go('help.html', 200); await go('ege-bank.html#n=' + nN, 1200);
  const chips = (await p.textContent(tc + ' .bk-h')) || ''; await go('ege-bank.html#n=1', 1000); const chips1 = (await p.textContent(`[data-task="${ok1}"] .bk-h`)) || '';
  const st5 = await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')).edu_bank_attempts.map(a => [a.task, a.ok, a.revealed]));
  rec('BK-05', chips.includes('решено') && !chips.includes('с первой') && chips.includes('решение открыто') && chips1.includes('решено с первой попытки') && st5.length === 4, chips + ' | ' + chips1 + ' | ' + JSON.stringify(st5));

  // QZ-04: тест к уроку (вариант «в классе») со страницы урока
  await go('g2.html', 900); const tl4 = await p.$('a[href="quiz-g2a.html"]'); await go('quiz-g2a.html', 1000); const k4 = QK['quiz-g2a'] || [];
  for (let i = 0; i < k4.length; i++) { const k = k4[i].split('|')[0]; const sel = `[data-q="${i + 1}"]`;
    if (await p.$(sel + ' input[type=radio]')) await p.check(`${sel} input[value="${k}"]`); else await p.fill(sel + ' input[type=text]', k); }
  await p.click('#qzGo'); await p.waitForTimeout(800); const sc4 = (await p.textContent('#qzScore')) || ''; const cr4 = (await p.textContent('.crumbs')) || '';
  rec('QZ-04', !!tl4 && k4.length === 8 && sc4.startsWith('8 из 8') && cr4.includes('Урок 2'), sc4.slice(0, 30) + ' · ' + cr4.replace(/\s+/g, ' ').slice(0, 50));

  // ── учитель видит сдачу и тест, отвечает
  await logout(); await login('teacher@test.local'); await go('journal.html', 1200);
  const logT = (await p.textContent('#log')) || ''; const imgT = await p.$$eval('#log .ph img', e => e.filter(i => i.src.startsWith('data:')).length);
  rec('HW-06', logT.includes('сдано') && logT.includes('1 фото') && logT.includes('Ученик: Не понял № 27') && imgT === 1, `фото у учителя ${imgT}`);
  const qzT = (await p.textContent('#quiz')) || '';
  rec('QZ-03', qzT.includes('Самопроверка · Глава I') && qzT.includes(`${keys.length - 1} из ${keys.length}`) && qzT.includes('Ошибки в вопросах № 1'), qzT.slice(0, 80));
  const bkT = (await p.textContent('#bank')) || ''; const cells = await p.$$eval('#bank .bk', e => e.map(x => x.className + ':' + x.textContent));
  rec('BK-06', bkT.includes('Решено 2 из 2') && bkT.includes('с первой попытки 1') && bkT.includes('решение открывал в 1') && cells.length === 12 && cells.filter(c => c.includes('c-')).length === 2, bkT.slice(0, 90));
  await go('ege-bank.html#n=3', 1200); const t7 = await p.evaluate(() => ({sum: document.getElementById('bkSum').textContent, ans: [...document.querySelectorAll('#bkList .bk-task')].filter(x => x.textContent.includes('Ответ: ')).length,
    sol: !document.querySelector('#bkList .bk-btn.soft').disabled}));
  await p.click('#bkList .bk-task >> nth=0 >> .bk-btn.soft'); await p.waitForTimeout(300); const tsol = (await p.textContent('#bkList .bk-task >> nth=0 >> .bk-sol')) || '';
  rec('BK-07', t7.sum.includes('Режим учителя') && t7.ans === 10 && t7.sol && tsol.includes('Решение.'), JSON.stringify(t7));
  await go('journal.html', 1200);
  await p.click('#log .lesson >> nth=1 >> button:has-text("Ответить на ДЗ")'); await p.fill('#log .fbform textarea', 'Молодец, № 27 разберём');
  await p.selectOption('#log .fbform select', '5'); await p.click('#log .fbform button.primary'); await p.waitForTimeout(700);
  const logT2 = (await p.textContent('#log')) || '';
  await logout(); await login('kid@test.local'); await go('homework.html', 1200); const c2s = (await p.textContent(hc2)) || '';
  rec('HW-07', logT2.includes('Ваш ответ: Молодец') && logT2.includes('за ДЗ 5') && c2s.includes('проверено · 5') && c2s.includes('Молодец, № 27 разберём'), c2s.slice(0, 60));
  await logout(); await login('teacher@test.local'); await go('journal.html', 1200);

  // HW-08…10: тест самопроверки как домашнее задание
  const qo = await p.$$eval('#lQuiz option', o => o.map(x => x.textContent));
  rec('QZ-05', [1, 2, 3, 4, 5].every(n => qo.includes(`Урок ${n} · тест домой`) && qo.includes(`Урок ${n} · тест в классе`)), qo.length + ' тестов в списке ДЗ');
  await p.selectOption('#lTopic', 'g4'); await p.fill('#lHw', ''); await p.selectOption('#lQuiz', 'quiz-geo1'); await p.click('#lSave'); await p.waitForTimeout(1400);
  const lq = (await p.textContent('#log')) || '';
  rec('HW-08', lq.includes('Тест в ДЗ: Самопроверка · Глава I — ещё не пройден'), 'журнал: тест задан');
  await logout(); await login('kid@test.local'); await go('homework.html', 1200);
  const hq1 = (await p.textContent('#hwBox .hw-card >> nth=0')) || ''; await p.click('#hwBox .hw-card >> nth=0 >> a:has-text("Пройти тест")'); await p.waitForTimeout(1200);
  const hwNote = (await p.textContent('#qzHw')) || '';
  for (let i = 0; i < keys.length; i++) { const k = keys[i].split('|')[0]; const sel = `[data-q="${i + 1}"]`;
    if (await p.$(sel + ' input[type=radio]')) await p.check(`${sel} input[value="${i < 2 ? (k === 'a' ? 'b' : 'a') : k}"]`); else await p.fill(sel + ' input[type=text]', i < 2 ? '999' : k); }
  await p.click('#qzGo'); await p.waitForTimeout(800); const hs1 = (await p.textContent('#qzScore')) || '';
  await p.click('#qzAgain'); for (let i = 0; i < keys.length; i++) { const k = keys[i].split('|')[0]; const sel = `[data-q="${i + 1}"]`;
    if (await p.$(sel + ' input[type=radio]')) await p.check(`${sel} input[value="${k}"]`); else await p.fill(sel + ' input[type=text]', k); }
  await p.click('#qzGo'); await p.waitForTimeout(800); const hs2 = (await p.textContent('#qzScore')) || '';
  rec('HW-09', hq1.includes('тест не пройден') && hwNote.includes('первой попытки') && hs1.includes('Засчитано как домашнее задание') && hs2.includes('тренировочная попытка'), hs1.slice(0, 40) + ' / ' + hs2.slice(0, 30));
  await go('homework.html', 1200); const hq2 = (await p.textContent('#hwBox .hw-card >> nth=0')) || '';
  await logout(); await login('teacher@test.local'); await go('journal.html', 1200); const lq2 = (await p.textContent('#log')) || '';
  rec('HW-10', hq2.includes(`Засчитана первая попытка: ${keys.length - 2} из ${keys.length}`) && hq2.includes(`лучшая ${keys.length} из ${keys.length}`) && hq2.includes('сдано')
    && lq2.includes(`тест ${keys.length - 2} из ${keys.length} · лучшая ${keys.length} · попыток 2`), 'ученик и журнал видят первую и лучшую');

  // ── Доска: учитель и ученик в двух окнах
  const mk = async (email, id) => { const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push('board ' + email + ' :: ' + e.message)); pg.on('dialog', d => d.accept());
    await pg.addInitScript(([id, email]) => sessionStorage.setItem('mockSessionTab', JSON.stringify({user:{id, email}})), [id, email]); await pg.setViewportSize({width: 1280, height: 820}); return pg; };
  const pT = await mk('teacher@test.local', 'u1'), pS = await mk('kid@test.local', 'u2');
  const scr = async (pg, wx, wy) => { const v = await pg.evaluate(() => window.__board.view()); const b = await pg.locator('#bdCanvas').boundingBox(); return {x: b.x + (wx - v.x) * v.z, y: b.y + (wy - v.y) * v.z}; };
  const E = pg => pg.evaluate(() => window.__board ? JSON.parse(JSON.stringify(window.__board.els())) : null);
  const mdb = () => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  await pT.goto(SITE + 'journal.html'); await pT.waitForTimeout(1000); await pT.click('#boardLink'); await pT.waitForTimeout(1500);
  const bT = await pT.textContent('#bdTitle'); const nb = (await mdb()).edu_boards.length;
  rec('BD-01', /^Занятие \d\d\.\d\d$/.test(bT) && nb === 1 && pT.url().includes('board.html?b='), bT + ', досок ' + nb);
  await pS.goto(SITE + 'board.html'); await pS.waitForTimeout(1500);
  const ch28 = await pS.evaluate(() => ({vis: !!document.getElementById('bdChoose'), n: document.querySelectorAll('#bdChoose [data-b]').length, t: (document.getElementById('bdChoose') || {}).textContent || '', st: document.getElementById('bdStage').hidden}));
  await pS.click('#bdChoose [data-b] >> nth=0'); await pS.waitForTimeout(1300);
  const bS = await pS.textContent('#bdTitle'); const peerT = await pT.textContent('#bdPeer'), peerS = await pS.textContent('#bdPeer');
  rec('BD-02', bS === bT && peerT.includes('Ученик на доске') && peerS.includes('Учитель на доске'), peerT + ' / ' + peerS);
  rec('BD-28', ch28.vis && ch28.n === 1 && ch28.t.includes(bT) && ch28.t.includes('новая') && ch28.st, 'ученик сначала видит выбор: ' + ch28.t.slice(0, 60));
  const bx = await pT.locator('#bdCanvas').boundingBox(), sx = await pS.locator('#bdCanvas').boundingBox();
  await pT.mouse.move(bx.x + 200, bx.y + 200); await pT.mouse.down(); for (let i = 1; i <= 12; i++) await pT.mouse.move(bx.x + 200 + i * 10, bx.y + 200 + i * 5); await pT.mouse.up();
  await pS.waitForTimeout(500); const e3 = await E(pS); await pT.waitForTimeout(1200); const saved3 = (await mdb()).edu_boards[0].data.els.length;
  rec('BD-03', e3.length === 1 && e3[0].t === 'pen' && saved3 === 1, `у ученика ${e3.length}, в базе ${saved3}`);
  await pS.click('[data-tool=line]'); await pS.mouse.move(sx.x + 300, sx.y + 320); await pS.mouse.down(); await pS.mouse.move(sx.x + 380, sx.y + 321); await pS.mouse.move(sx.x + 460, sx.y + 320); await pS.mouse.up();
  await pT.waitForTimeout(500); const e4 = await E(pT);
  rec('BD-04', e4.length === 2 && e4[1].t === 'line' && e4[1].by === 'u2', e4.map(e => e.t).join(','));
  await pT.click('[data-tool=pt]'); await pT.mouse.click(bx.x + 600, bx.y + 150); await pT.mouse.click(bx.x + 700, bx.y + 150); await pS.waitForTimeout(500);
  const e5 = (await E(pS)).filter(e => e.t === 'pt').map(e => e.l).join('');
  rec('BD-05', e5 === 'AB', e5);
  await pT.click('[data-tool=text]'); await pT.mouse.click(bx.x + 600, bx.y + 420); await pT.waitForTimeout(100); await pT.keyboard.type('x'); await pT.click('#bdSyms button:text-is("²")');
  await pT.keyboard.type(' + 1'); await pT.keyboard.press('Enter'); await pS.waitForTimeout(500);
  const e6 = (await E(pS)).find(e => e.t === 'text');
  rec('BD-06', e6 && e6.s === 'x² + 1', e6 && e6.s);
  await pT.click('#bdUndo'); await pS.waitForTimeout(500); const e7 = await E(pS);
  rec('BD-07', !e7.some(e => e.t === 'text') && e7.length === 4, e7.map(e => e.t).join(','));
  const pen = (await E(pS)).find(e => e.t === 'pen'); const ep = await scr(pS, pen.pts[8], pen.pts[9]); await pS.click('[data-tool=eraser]'); await pS.mouse.click(ep.x, ep.y); await pT.waitForTimeout(500); const e8 = await E(pT);
  rec('BD-08', !e8.some(e => e.t === 'pen') && e8.length === 3, e8.map(e => e.t).join(','));
  const l0 = (await E(pT)).find(e => e.t === 'line'); const lp = await scr(pT, (l0.x1 + l0.x2) / 2, l0.y1); const z9 = (await pT.evaluate(() => window.__board.view())).z;
  await pT.click('[data-tool=select]'); await pT.mouse.move(lp.x, lp.y); await pT.mouse.down(); await pT.mouse.move(lp.x, lp.y + 30); await pT.mouse.move(lp.x, lp.y + 60); await pT.mouse.up();
  await pS.waitForTimeout(500); const ln = (await E(pS)).find(e => e.t === 'line'), ln0 = (await E(pT)).find(e => e.t === 'line');
  rec('BD-09', ln && Math.abs(ln.y1 - ln0.y1) < 0.5 && Math.abs(ln0.y1 - (l0.y1 + 60 / z9)) < 1, `${l0.y1} → ${ln && ln.y1}`);
  await pT.click('#bdFigBtn'); await pT.click('#bdFigs [data-fig="ws_cube.png"]'); await pS.waitForTimeout(600);
  const e10 = (await E(pS)).find(e => e.t === 'img');
  rec('BD-10', e10 && e10.src === 'fig:ws_cube.png' && e10.ww > 50, e10 && e10.src);
  await pS.setInputFiles('#bdFile', {name: 'tetrad.png', mimeType: 'image/png', buffer: PNG}); await pS.waitForTimeout(1200);
  const bid = (await mdb()).edu_boards[0].id; const e11 = (await E(pT)).filter(e => e.t === 'img' && e.src.startsWith('st:'));
  const f11 = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mockfiles') || '{}')));
  rec('BD-11', e11.length === 1 && e11[0].src.startsWith('st:' + bid + '/') && f11.some(k => k.startsWith(bid + '/')), e11.length + ' картинка у учителя');
  await pT.waitForTimeout(3000); await pS.evaluate(() => localStorage.setItem('bdPollMs', '700')); await pS.reload(); await pS.waitForTimeout(1500);
  const nT = (await E(pT)).length, nS = (await E(pS)).length;
  rec('BD-12', nT === nS && nS === 5, `учитель ${nT}, ученик после перезагрузки ${nS}`);
  const p3 = await mk('new@test.local', 'u3'); await p3.goto(SITE + 'board.html?b=' + bid); await p3.waitForTimeout(1200);
  const e13 = (await p3.textContent('#bdEmpty')) || ''; await p3.close();
  rec('BD-13', e13.includes('Нет доступа'), e13.slice(0, 40));
  const [dl] = await Promise.all([pT.waitForEvent('download', {timeout: 5000}).catch(() => null), pT.click('#bdExport')]);
  rec('BD-14', dl && dl.suggestedFilename().endsWith('.png'), dl && dl.suggestedFilename());
  await pT.click('#bdPick'); await pT.fill('#bmTitle', 'Повторение'); await pT.selectOption('#bmLesson', {index: 1}); await pT.click('#bmNew'); await pT.waitForTimeout(800);
  await pS.waitForTimeout(1600); const ban = (await pS.textContent('#bdBanner')) || ''; await pS.click('#bdBanner button >> nth=0'); await pS.waitForTimeout(800);
  rec('BD-15', (await pT.textContent('#bdTitle')) === 'Повторение' && ban.includes('Повторение') && (await pS.textContent('#bdTitle')) === 'Повторение', ban.slice(0, 50));
  await go('journal.html', 1200); const lg = (await p.textContent('#log')) || '';
  rec('BD-16', lg.includes('доска: Повторение') && (await p.getAttribute('#boardLink', 'href')).startsWith('board.html?s='), 'ссылка из журнала');
  // BD-18…20: слайды урока на доске
  await pT.click('#bdSlBtn'); await pT.click('#bdSl [data-d="geo3"]'); await pT.click('#bdSl [data-k="5"]'); await pS.waitForTimeout(1200);
  const s18 = (await E(pS)).filter(e => e.src && e.src.startsWith('sl:')); const ok18 = await pS.evaluate(() => window.__board.imgOk('sl:geo3/05'));
  const v18 = await pS.evaluate(() => window.__board.view()); const sl = s18[0];
  const inView = sl && v18.x < sl.x + sl.ww / 2 && sl.x + sl.ww / 2 < v18.x + 1280 / v18.z && v18.y < sl.y + sl.hh / 2;
  rec('BD-18', s18.length === 1 && sl.src === 'sl:geo3/05' && ok18 && inView, `слайд ${sl && sl.src}, загружен ${ok18}, экран ученика на слайде ${inView}`);
  const nb19 = await pT.isVisible('#bdSlNext'); await pT.click('#bdSlNext'); await pS.waitForTimeout(800);
  const s19 = (await E(pS)).filter(e => e.src && e.src.startsWith('sl:geo3/'));
  rec('BD-19', nb19 && s19.length === 2 && s19[1].src === 'sl:geo3/06' && s19[1].x === s19[0].x + s19[0].ww + 60 && s19[1].y === s19[0].y, s19.map(e => e.src + '@' + e.x).join(' '));
  await pT.click('#bdSlBtn'); await pT.click('#bdSl [data-d="alg15"]'); await pT.click('#bdSl [data-all]'); await pS.waitForTimeout(1200);
  const s20 = (await E(pS)).filter(e => e.src && e.src.startsWith('sl:alg15/'));
  rec('BD-20', s20.length === 29 && s20[28].src === 'sl:alg15/29', s20.length + ' слайдов');
  await pT.click('#bdUndo'); await pT.click('#bdUndo'); await pT.click('#bdUndo'); await pS.waitForTimeout(600);
  await pS.evaluate(() => localStorage.setItem('mockRtFails', '1')); await pS.reload(); await pS.waitForTimeout(800); const off = await pS.textContent('#bdPeer');
  await pS.waitForTimeout(2600); const on = await pS.textContent('#bdPeer');
  rec('BD-17', off.includes('без живой связи') && on.includes('Учитель на доске'), off + ' → ' + on);
  // BD-21…27: шаблоны и формулы
  await pT.evaluate(() => { const v = window.__board.view(); v.x += 4000; v.y += 4000; });
  await pT.click('#bdTplBtn'); await pT.fill('#tcX0', '-4'); await pT.fill('#tcX1', '4'); await pT.fill('#tcY0', '-3'); await pT.fill('#tcY1', '3'); await pT.check('#tcN');
  await pT.click('[data-tpl=coord]'); await pS.waitForTimeout(700);
  let cp = (await E(pS)).find(e => e.t === 'tpl' && e.kind === 'coord');
  rec('BD-21', cp && cp.o.x0 === -4 && cp.o.x1 === 4 && cp.o.y1 === 3 && cp.o.n === 1 && cp.ww === 384 && cp.hh === 288 && cp.x % 24 === 0, cp && JSON.stringify(cp.o) + ' ' + cp.ww + '×' + cp.hh);
  const zz = (await pT.evaluate(() => window.__board.view())).z, hd = await scr(pT, cp.x + cp.ww + 6 / zz, cp.y + cp.hh + 6 / zz);
  await pT.mouse.move(hd.x, hd.y); await pT.mouse.down(); await pT.mouse.move(hd.x + 40, hd.y); await pT.mouse.move(hd.x + 96 * zz, hd.y + 3); await pT.mouse.up(); await pS.waitForTimeout(600);
  cp = (await E(pS)).find(e => e.t === 'tpl' && e.kind === 'coord');
  rec('BD-27', cp && Math.abs(cp.ww - (384 + 96 + 6 / zz)) < 1.5 && Math.abs(cp.hh / cp.ww - 0.75) < 0.01, cp && cp.ww + '×' + cp.hh + ' при масштабе ' + zz.toFixed(2));
  const L = {x: cp.x + (2 - cp.o.x0) * cp.ww / 8, y: cp.y + (cp.o.y1 - 1) * cp.hh / 6};
  await pT.click('[data-tool=pt]'); const q22 = await scr(pT, L.x + 3, L.y - 3); await pT.mouse.click(q22.x, q22.y); await pS.waitForTimeout(500);
  const pts22 = (await E(pS)).filter(e => e.t === 'pt'), p22 = pts22[pts22.length - 1];
  rec('BD-22', p22 && Math.abs(p22.x - L.x) < .11 && Math.abs(p22.y - L.y) < .11, p22 && `точка ${p22.x}; ${p22.y}, узел (2; 1) = ${L.x.toFixed(1)}; ${L.y.toFixed(1)}`);
  await pT.evaluate(() => { const v = window.__board.view(); v.x += 3000; });
  await pT.click('#bdTplBtn'); await pT.selectOption('#tuM', 'deg'); await pT.click('[data-tpl=unit]'); await pT.waitForTimeout(400);
  const uc = (await E(pT)).find(e => e.t === 'tpl' && e.kind === 'unit'); const in1 = await scr(pT, uc.x + uc.ww * .6, uc.y + uc.hh * .62);
  await pT.click('[data-tool=eraser]'); await pT.mouse.move(in1.x, in1.y); await pT.mouse.down(); await pT.mouse.move(in1.x + 25, in1.y + 6); await pT.mouse.up(); await pT.waitForTimeout(200);
  const still = (await E(pT)).some(e => e.id === uc.id);
  await pT.click('[data-tool=select]'); await pT.mouse.click(in1.x, in1.y); await pT.keyboard.press('Delete'); await pS.waitForTimeout(500); const gone = !(await E(pS)).some(e => e.id === uc.id);
  await pT.click('#bdUndo'); await pS.waitForTimeout(500); const back23 = (await E(pS)).some(e => e.id === uc.id);
  rec('BD-23', uc && uc.o.m === 'deg' && uc.ww === 480 && still && gone && back23, `ластик не стёр шаблон ${still}, Delete ${gone}, отмена вернула ${back23}`);
  await pT.evaluate(() => { const v = window.__board.view(); v.y += 3000; }); const cb = await pT.locator('#bdCanvas').boundingBox();
  await pT.click('[data-tool=math]'); await pT.mouse.click(cb.x + 150, cb.y + 150); await pT.waitForTimeout(150);
  await pT.click('#bdMath [title="Дробь"]'); await pT.keyboard.type('x+1'); await pT.keyboard.press('ArrowRight'); await pT.keyboard.press('ArrowRight'); await pT.keyboard.press('ArrowRight');
  await pT.keyboard.type('x-1'); const pv = await pT.evaluate(() => { const c = document.getElementById('bdMathPv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  await pT.keyboard.press('Enter'); await pS.waitForTimeout(600);
  const fm = (await E(pS)).find(e => e.t === 'math'); const fh = fm && await pS.evaluate(s => window.__board.mf.size(s, 30), fm.s), lh = await pS.evaluate(() => window.__board.mf.size('x+1', 30));
  rec('BD-24', fm && fm.s === '(x+1)/(x-1)' && fm.fs === 30 && fh.h > lh.h * 1.8 && pv > 200, fm && fm.s + ', высота ' + (fh && fh.h.toFixed(0)) + ' против ' + lh.h.toFixed(0));
  const fp = await scr(pT, fm.x + 12, fm.y + 12); await pT.click('[data-tool=select]'); await pT.mouse.dblclick(fp.x, fp.y); await pT.waitForTimeout(200);
  const was = await pT.inputValue('#bdMathIn'); await pT.fill('#bdMathIn', 'sqrt(x^2+1) <= 3'); await pT.selectOption('#bdMathSz', '44'); await pT.click('#bdMathOk'); await pS.waitForTimeout(600);
  const fm2 = (await E(pS)).find(e => e.t === 'math'); await pT.click('#bdUndo'); await pS.waitForTimeout(500); const fm3 = (await E(pS)).find(e => e.t === 'math');
  rec('BD-25', was === '(x+1)/(x-1)' && fm2.s === 'sqrt(x^2+1) <= 3' && fm2.fs === 44 && fm2.id === fm.id && fm3.s === '(x+1)/(x-1)', `правка: ${fm2.s} (${fm2.fs}px), отмена → ${fm3.s}`);
  const m26 = await pT.evaluate(() => { const M = window.__board.mf, S = s => M.size(s, 30); let bad = [];
    ['((', ')/^_', 'sqrt', '1/', '^^', '|||', 'root(3)', '', 'x^', '/', 'a_', '}{', '√', 'sin^2', 'log_(', 'в + 1'].forEach(s => { try { const z = S(s); if (!(z.w >= 0 && z.h > 0)) bad.push(s); } catch (e) { bad.push(s + ':' + e.message); } });
    return {bad, frac: S('a/b').h > S('ab').h * 1.5, root: S('sqrt(x)').w > S('x').w * 1.5, pow: S('x^2').h > S('x').h, nested: S('1/(1+1/x)').h > S('1/x').h * 1.3,
      parens: S('((a)/(b))').h > S('(a)').h * 1.5, rad: S('(3pi)/4').h > S('3pi').h * 1.5, plain: S('2x + 3 = 7').h < 45}; });
  rec('BD-26', !m26.bad.length && m26.frac && m26.root && m26.pow && m26.nested && m26.parens && m26.rad && m26.plain, JSON.stringify(m26));
  await pT.close(); await pS.close();

  await p.click('#log button:has-text("Удалить") >> nth=0'); await p.click('#log button:has-text("Нет")'); const after1 = await p.$$eval('#log .lesson', e => e.length);
  await p.click('#log button:has-text("Удалить") >> nth=0'); await p.click('#log button:has-text("Да")'); await p.waitForTimeout(900);
  const after2 = await p.$$eval('#log .lesson', e => e.length);
  rec('JR-05', after1 === 3 && after2 === 2, after1 + ' → ' + after2);
  await p.click('#delBox button'); await p.click('#delBox button.danger'); await p.waitForTimeout(900);
  const leftFiles = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mockfiles') || '{}')).length);
  rec('JR-08', ((await p.textContent('#status')) || '').includes('Добавьте первого ученика') &&
    (await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')).edu_lessons.length)) === 0 && leftFiles === 0, 'файлов осталось ' + leftFiles);

  rec('UI-02', !errors.length, errors.slice(0, 5).join(' | '));
  require('fs').writeFileSync(__dirname + '/results.json', JSON.stringify(results, null, 1));
  const failed = results.filter(r => !r.ok); console.log(`\nИтого: ${results.length - failed.length}/${results.length} пройдено`);
  await b.close(); process.exit(failed.length ? 1 : 0);
})();
