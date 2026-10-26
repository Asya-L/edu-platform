
(function(){
'use strict';
var CFG = window.APP_CONFIG || {};
var READY = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
var TEACHER_PAGES = ["index", "math", "geometry", "algebra", "ege-math", "ege-inf", "library", "g1", "g2", "g3", "g4", "g5", "ws1", "ws2", "ws3", "ws4", "ws5", "test-geo1", "test-geo2", "test-alg1", "test-alg2", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "wsa1", "wsa2", "wsa3", "wsa4", "wsa5", "wsa6", "wsa7", "wsa8", "el1", "el2", "el3", "el4", "el5", "el6", "el7", "el8", "el9", "el10", "el11", "el12", "el13", "el14", "el15", "el16", "el17", "el18", "el19", "el20", "wse1", "wse2", "wse3", "wse4", "wse5", "wse6", "wse7", "wse8", "wse9", "wse10", "wse11", "wse12", "wse13", "wse14", "wse15", "wse16", "wse17", "wse18", "wse19", "wse20", "g6", "g7", "g8", "g9", "g10", "g11", "ws6", "ws7", "ws8", "ws9", "ws10", "ws11"];
var root = document.documentElement;
var page = root.dataset.page || '';
var K = window.KABINET = {ready: READY, teacherPages: TEACHER_PAGES};
var sb = READY ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey,
  {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}}) : null;
K.sb = sb;

function reveal(){ root.classList.remove('auth-wait'); }
function flag(){ try { return sessionStorage.getItem('asStudent') === '1'; } catch(e){ return false; } }
function setFlag(v){ try { v ? sessionStorage.setItem('asStudent','1') : sessionStorage.removeItem('asStudent'); } catch(e){} }
function here(){ return (location.pathname.split('/').pop() || 'index.html') + location.hash; }
K.esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };

var NAV_T = [['t.html#index','Главная','index'],['t.html#geometry','Геометрия','geometry'],['t.html#algebra','Алгебра','algebra'],
  ['t.html#ege-math','ЕГЭ','ege-math'],['t.html#ege-inf','Информатика','ege-inf'],['reference.html','Справочник','reference'],
  ['t.html#library','Материалы','library'],['journal.html','Журнал','journal'],['board.html','Доска','board'],['students.html','Ученики','students']];
var NAV_S = [['index.html','Главная','index'],['homework.html','Домашка','homework'],['board.html','Доска','board'],['geometry.html','Геометрия','geometry'],['algebra.html','Алгебра','algebra'],
  ['ege-math.html','ЕГЭ','ege-math'],['ege-inf.html','Информатика','ege-inf'],['reference.html','Справочник','reference'],['library.html','Материалы','library'],['help.html','Помощь','help']];

K.renderNav = function(state, current){
  var nav = document.querySelector('.top .nav'); if (!nav) return;
  var cur = current || page;
  var group = {g1:'geometry',g2:'geometry',g3:'geometry',g4:'geometry',g5:'geometry',ws1:'geometry',ws2:'geometry',ws3:'geometry',ws4:'geometry',ws5:'geometry',
    'test-geo1':'geometry','test-geo2':'geometry','quiz-geo1':'geometry','test-alg1':'algebra','test-alg2':'algebra','ege-14':'ege-math',math:'index'}[cur] || (/^quiz-g\d/.test(cur) ? 'geometry' : /^(a|sa|wsa)\d$|^quiz-a\d/.test(cur) ? 'algebra' : /^(el|sel|wse)\d+$|^quiz-el\d/.test(cur) ? 'ege-math' : cur);
  var teacherView = state.role === 'teacher' && !state.asStudent;
  var items = teacherView ? NAV_T : NAV_S;
  var h = items.map(function(i){ return '<a href="'+i[0]+'" class="'+(i[2]===group?'on':'')+'">'+i[1]+'</a>'; }).join('');
  if (state.role === 'teacher') {
    h += state.asStudent
      ? '<a href="#" data-k="teacher" class="as-student">← Режим учителя</a>'
      : '<a href="#" data-k="student" class="as-student">Глазами ученика</a>';
  }
  if (state.session) h += '<a href="#" data-k="out" class="acct" title="'+K.esc(state.email)+'">Выйти</a>';
  nav.innerHTML = h;
  nav.querySelectorAll('[data-k]').forEach(function(a){ a.addEventListener('click', function(ev){ ev.preventDefault();
    var k = a.getAttribute('data-k');
    if (k === 'student') { setFlag(true); location.href = 'index.html'; }
    else if (k === 'teacher') { setFlag(false); location.href = 't.html#index'; }
    else if (k === 'out') { setFlag(false); (sb ? sb.auth.signOut() : Promise.resolve()).finally(function(){ location.href = 'login.html'; }); }
  }); });
  var brand = document.querySelector('.brand .sub'); if (brand) brand.textContent = teacherView ? 'учителя' : 'математики';
};

K.state = (async function(){
  if (!READY) { reveal(); return {session: null, role: 'guest'}; }
  var res = await sb.auth.getSession(); var session = res.data && res.data.session;
  if (!session) {
    if (page !== 'login' && page !== 'help') { location.replace('login.html?next=' + encodeURIComponent(here())); return null; }
    var clear = function(){ var n = document.querySelector('.top .nav'); if (n) n.innerHTML = page === 'help' ? '<a href="login.html">Войти</a>' : ''; };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ clear(); reveal(); }); else { clear(); reveal(); }
    return {session: null, role: 'guest'};
  }
  var role = 'student';
  try { var r = await sb.from('edu_profiles').select('role').eq('user_id', session.user.id).maybeSingle(); if (r.data && r.data.role) role = r.data.role; } catch(e){}
  var st = {session: session, role: role, email: session.user.email, asStudent: role === 'teacher' && flag()};
  if (role === 'teacher' && page === 't' && st.asStudent) { setFlag(false); st.asStudent = false; }  // учительская страница — всегда режим учителя
  if (page === 'login') { location.replace(role === 'teacher' ? 't.html#index' : 'index.html'); return null; }
  if (role === 'teacher' && !st.asStudent && TEACHER_PAGES.indexOf(page) >= 0) {
    location.replace('t.html#' + page + (location.hash ? '/' + location.hash.slice(1) : '')); return null; }
  if (role !== 'teacher' && (page === 't' || page === 'students' || page === 'journal')) { location.replace('index.html'); return null; }
  document.addEventListener('DOMContentLoaded', function(){ K.renderNav(st); });
  if (document.readyState !== 'loading') K.renderNav(st);
  if (page !== 't') reveal();
  if (role !== 'teacher') track(page);
  return st;
})();
// посещения ученика: открытая страница и активные минуты (раз в минуту, если в последние 2 минуты были клики, ввод или прокрутка)
function track(pg){
  var last = Date.now(), bump = function(){ last = Date.now(); };
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function(e){ addEventListener(e, bump, {passive: true, capture: true}); });
  var ping = function(p, a){ try { sb.rpc('edu_ping', {p_page: p, p_active: a}).then(function(){}, function(){}); } catch(e){} };
  ping(/^[a-z0-9-]{1,40}$/.test(page) ? page : null, true);
  setInterval(function(){ if (document.visibilityState === 'visible' && Date.now() - last < 120000) ping(null, true); }, 60000);
}
})();
