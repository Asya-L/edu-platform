// Автотесты «Кабинета математики» (окружение A): локальная копия сайта + имитация Supabase.
// Запуск: CONTENT_KEY=<ключ> SITE=http://127.0.0.1:8765/ node tests/e2e.js
// Тестовые аккаунты существуют только внутри имитации.
const { chromium } = require('playwright');
const KEY = process.env.CONTENT_KEY; const SITE = process.env.SITE || 'http://127.0.0.1:8765/';
if (!KEY) { console.error('нужен CONTENT_KEY'); process.exit(2); }

const MOCK = require('./mock.js')(KEY);

const results = []; let errors = [];
function rec(id, ok, note) { results.push({id, ok: !!ok, note: note || ''}); console.log((ok ? 'PASS ' : 'FAIL ') + id + (note ? ' — ' + note : '')); }
const TEACHER_PAGES = ['index','math','geometry','algebra','ege-math','ege-inf','library','g1','g2','g3','g4','g5','ws1','ws2','ws3','ws4','ws5','test-geo1','test-alg1','test-alg2'];
const PUBLIC = ['index','homework','geometry','algebra','ege-math','ege-14','ege-inf','reference','library','help','g1','g2','g3','g4','g5','ws1','ws2','ws3','ws4','ws5','s1','s2','s3','s4','s5'];

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
  rec('ROLE-04', sn === 'Главная|Домашка|Геометрия|Алгебра|ЕГЭ|Информатика|Справочник|Материалы|Помощь|Выйти', sn);
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
  rec('ROLE-03', tn === 'Главная|Геометрия|Алгебра|ЕГЭ|Информатика|Справочник|Материалы|Журнал|Ученики|Глазами ученика|Выйти', tn);
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

  // ── HW ученик
  await logout(); await login('kid@test.local');
  await go('index.html', 900); const home = (await p.textContent('#hwBox')) || '';
  await go('homework.html', 900); const hwAll = (await p.textContent('#hwBox')) || ''; const html = await p.content();
  rec('HW-01', home.includes('Рабочий лист 3') && hwAll.includes('№ 18, 23, 27, 30') && hwAll.includes('Урок 2'), 'на главной последнее, в «Домашке» оба');
  rec('HW-02', !html.includes('СЕКРЕТНАЯ-ЗАМЕТКА') && !html.includes('отметка'), 'заметок и отметок нет');
  await p.check('#hwBox input[type=checkbox] >> nth=1'); await p.waitForTimeout(500);
  await logout(); await login('teacher@test.local'); await go('journal.html', 900);
  rec('HW-03', ((await p.textContent('#log')) || '').includes('ученик отметил'));
  await p.click('#log button:has-text("Удалить") >> nth=0'); await p.click('#log button:has-text("Нет")'); const after1 = await p.$$eval('#log .lesson', e => e.length);
  await p.click('#log button:has-text("Удалить") >> nth=0'); await p.click('#log button:has-text("Да")'); await p.waitForTimeout(900);
  const after2 = await p.$$eval('#log .lesson', e => e.length);
  rec('JR-05', after1 === 2 && after2 === 1, after1 + ' → ' + after2);
  await p.click('#delBox button'); await p.click('#delBox button.danger'); await p.waitForTimeout(900);
  rec('JR-08', ((await p.textContent('#status')) || '').includes('Добавьте первого ученика') &&
    (await p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')).edu_lessons.length)) === 0);

  rec('UI-02', !errors.length, errors.slice(0, 5).join(' | '));
  require('fs').writeFileSync(__dirname + '/results.json', JSON.stringify(results, null, 1));
  const failed = results.filter(r => !r.ok); console.log(`\nИтого: ${results.length - failed.length}/${results.length} пройдено`);
  await b.close(); process.exit(failed.length ? 1 : 0);
})();
