/* «Повторение пройденного»: собирает тест из вопросов, в которых ученик ошибался раньше.
   KRV.candidates(sb, sid) — список ошибок {quiz, q, at, days}; KRV.build(sb, sid, QUIZ, n) — создаёт повторение и возвращает его id. */
(function(){
  var DAY = 864e5, pageCache = {};
  async function results(sb, sid){
    var r = await sb.from('edu_quiz_results').select('quiz,total,wrong,created_at').eq('student_id', sid).order('created_at', {ascending: true}).limit(2000);
    return (r.data || []).filter(function(x){ return x.quiz && x.quiz.indexOf('rv-') !== 0; });
  }
  async function usedRecently(sb, sid, days){
    var r = await sb.from('edu_reviews').select('items,created_at').eq('student_id', sid);
    var used = {}, now = Date.now();
    (r.data || []).forEach(function(v){ if (now - new Date(v.created_at) < days * DAY) (v.items || []).forEach(function(it){ used[it.quiz + '|' + it.q] = 1; }); });
    return used;
  }
  // последнее состояние каждого вопроса: ошибка, если в последней попытке этого теста он неверный
  async function candidates(sb, sid){
    var st = {}, rows = await results(sb, sid);
    rows.forEach(function(x){ var w = x.wrong || [];
      for (var q = 1; q <= (x.total || 0); q++) { var k = x.quiz + '|' + q;
        if (w.indexOf(q) >= 0) st[k] = {quiz: x.quiz, q: q, at: x.created_at}; else delete st[k]; } });
    var now = Date.now();
    return Object.keys(st).map(function(k){ var c = st[k]; c.days = Math.floor((now - new Date(c.at)) / DAY); return c; });
  }
  async function question(quiz, q){
    if (!pageCache[quiz]) pageCache[quiz] = fetch(quiz + '.html', {cache: 'no-cache'}).then(function(r){ return r.ok ? r.text() : ''; });
    var html = await pageCache[quiz]; if (!html) return null;
    var doc = new DOMParser().parseFromString(html, 'text/html'), b = doc.querySelector('.qz-q[data-q="' + q + '"]'); if (!b) return null;
    var opts = [].map.call(b.querySelectorAll('.qz-opts label span'), function(s){ return s.innerHTML; });
    return {text: b.querySelector('.qz-t').innerHTML, options: opts.length ? opts : null};
  }
  // порядок: сначала ошибки двух–шестинедельной давности, потом более старые, потом свежие (от 3 дней); не больше двух вопросов из одного теста
  async function pick(sb, sid, n){
    var used = await usedRecently(sb, sid, 14), all = (await candidates(sb, sid)).filter(function(c){ return !used[c.quiz + '|' + c.q] && c.days >= 3; });
    function band(c){ return c.days >= 10 && c.days <= 45 ? 0 : c.days > 45 ? 1 : 2; }
    all.sort(function(a, b){ return band(a) - band(b) || b.days - a.days; });
    var per = {}, out = [];
    all.forEach(function(c){ if (out.length < n && (per[c.quiz] || 0) < 2) { out.push(c); per[c.quiz] = (per[c.quiz] || 0) + 1; } });
    return out;
  }
  async function build(sb, sid, QUIZ, n){
    var list = await pick(sb, sid, n || 6), items = [];
    for (var i = 0; i < list.length; i++) { var c = list[i], qq = await question(c.quiz, c.q); if (!qq) continue;
      items.push({quiz: c.quiz, q: c.q, text: qq.text, options: qq.options, src: (QUIZ[c.quiz] || c.quiz).replace(/ · тест (в классе|домой)$/, '')}); }
    if (!items.length) return {id: null, n: 0};
    var r = await sb.rpc('edu_make_review', {p_student: sid, p_items: items});
    if (r.error) throw r.error;
    return {id: r.data, n: items.length};
  }
  function title(v){ var d = new Date(v.created_at); return 'Повторение · ' + (v.items || []).length + ' вопр. · ' + ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2); }
  window.KRV = {candidates: candidates, pick: pick, build: build, title: title, question: question};
})();
