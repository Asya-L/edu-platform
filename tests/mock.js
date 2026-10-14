// Имитация Supabase для локальных тестов: вход, таблицы журнала, функции ДЗ и самопроверки, хранилище фото.
// QUIZKEYS — ключи ответов (передаются при запуске из файла вне репозитория).
module.exports = function(KEY, QUIZKEYS){
  return `(() => {
  const KEY = ${JSON.stringify(KEY)}, QK = ${JSON.stringify(QUIZKEYS || {})};
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v } catch(e) { return d } };
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const USERS = {'teacher@test.local': {id:'u1', pw:'test-pass-1', role:'teacher'}, 'kid@test.local': {id:'u2', pw:'test-pass-2', role:'student'}, 'new@test.local': {id:'u3', pw:'test-pass-3', role:'student'}};
  const db = () => { const D = get('mockdb', {edu_students:[], edu_lessons:[], edu_progress:[], edu_profiles:[
    {user_id:'u1',email:'teacher@test.local',role:'teacher',created_at:'2026-10-01'},
    {user_id:'u2',email:'kid@test.local',role:'student',created_at:'2026-10-02'},
    {user_id:'u3',email:'new@test.local',role:'student',created_at:'2026-10-03'}]}); D.edu_quiz_results = D.edu_quiz_results || []; return D; };
  const sess = () => get('mockSession', null);
  const me = () => { const s = sess(); if (!s) return null; const p = db().edu_profiles.find(x => x.user_id === s.user.id); return {id: s.user.id, role: p ? p.role : 'student'}; };
  let n = 0; const uid = () => 'id' + Date.now() + '_' + (n++);
  const byDate = (a, b) => a.date === b.date ? (b.created_at > a.created_at ? 1 : -1) : (a.date < b.date ? 1 : -1);
  function from(t) {
    const st = {op:'select', f:[], data:null, single:false};
    const run = () => { const D = db(), u = me(); if (!u) return {data: st.single ? null : []};
      const teacher = u.role === 'teacher';
      if (t === 'edu_secrets') return {data: teacher && !get('mockNoKey', false) ? {value: KEY} : null};
      const match = r => st.f.every(([k, v]) => r[k] === v);
      if (t === 'edu_profiles') { let rows = D.edu_profiles.filter(r => teacher || r.user_id === u.id);
        if (st.op === 'update') { if (!teacher) return {data:null}; D.edu_profiles = D.edu_profiles.map(r => match(r) ? Object.assign({}, r, st.data) : r); put('mockdb', D); return {data:null}; }
        rows = rows.filter(match); return {data: st.single ? (rows[0] || null) : rows}; }
      if (!teacher) return {data: st.single ? null : []};
      if (st.op === 'insert') { const row = Object.assign({id: uid(), created_at: new Date().toISOString(), student_done:false, hw_status:'none', photos:[]}, st.data); D[t].push(row); put('mockdb', D); return {data: st.single ? row : [row]}; }
      if (st.op === 'upsert') { D[t] = D[t].filter(r => r.student_id !== st.data.student_id); D[t].push(st.data); put('mockdb', D); return {data:null}; }
      if (st.op === 'update') { let out = null; D[t] = D[t].map(r => match(r) ? (out = Object.assign({}, r, st.data)) : r); put('mockdb', D); return {data: st.single ? out : null}; }
      if (st.op === 'delete') { D[t] = D[t].filter(r => !match(r)); if (t === 'edu_students') { const ok = l => D.edu_students.some(s => s.id === l.student_id);
        D.edu_lessons = D.edu_lessons.filter(ok); D.edu_progress = D.edu_progress.filter(ok); D.edu_quiz_results = D.edu_quiz_results.filter(ok); } put('mockdb', D); return {data:null}; }
      let rows = D[t].filter(match); if (t === 'edu_lessons') rows.sort(byDate);
      if (t === 'edu_quiz_results') rows.sort((a, b) => a.created_at < b.created_at ? 1 : -1);
      return {data: st.single ? (rows[0] || null) : rows}; };
    const b = { select(){ return b }, order(){ return b }, limit(){ return b }, eq(k, v){ st.f.push([k, v]); return b },
      insert(d){ st.op='insert'; st.data=d; return b }, update(d){ st.op='update'; st.data=d; return b }, upsert(d){ st.op='upsert'; st.data=d; return b },
      delete(){ st.op='delete'; return b }, single(){ st.single=true; return b }, maybeSingle(){ st.single=true; return b },
      then(res, rej){ return new Promise(function(ok, no){ try { ok(Object.assign({error:null}, run())) } catch(e) { no(e) } }).then(res, rej) } };
    return b;
  }
  const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/ /g, '').replace(/,/g, '.').replace(/ё/g, 'е').replace(/°/g, '');
  function rpc(name, args) { const D = db(), u = me(); if (!u) return Promise.resolve({data:null, error:{message:'not allowed'}});
    const s = D.edu_students.find(x => x.user_id === u.id); const R = data => Promise.resolve({data, error:null});
    if (name === 'edu_my_homework') return R(s ? D.edu_lessons.filter(l => l.student_id === s.id && l.homework).sort(byDate)
      .map(l => ({id:l.id, date:l.date, topic:l.topic, topic_text:l.topic_text, homework:l.homework, student_done:l.student_done,
        student_comment:l.student_comment || null, photos:l.photos || [], submitted_at:l.submitted_at || null, feedback:l.feedback || null, hw_mark:l.hw_mark || null, feedback_at:l.feedback_at || null})) : []);
    if (name === 'edu_set_done') { D.edu_lessons.forEach(l => { if (s && l.id === args.p_lesson && l.student_id === s.id) l.student_done = args.p_done; }); put('mockdb', D); return R(null); }
    if (name === 'edu_submit') { const pref = u.id + '/' + args.p_lesson + '/';
      if ((args.p_photos || []).some(p => !p.startsWith(pref))) return Promise.resolve({data:null, error:{message:'photos'}});
      let hit = false; D.edu_lessons.forEach(l => { if (s && l.id === args.p_lesson && l.student_id === s.id) { hit = true;
        Object.assign(l, {student_comment: args.p_comment || null, photos: args.p_photos || [], submitted_at: new Date().toISOString(), student_done: true}); } });
      put('mockdb', D); return R(hit); }
    if (name === 'edu_my_info') { if (!s) return R([]); const p = D.edu_progress.find(x => x.student_id === s.id);
      return R([{name: s.name, next_at: s.next_at || null, call_url: s.call_url || null, topics: p ? p.topics : {}}]); }
    if (name === 'edu_check_quiz') { const keys = QK[args.p_quiz]; if (!keys) return Promise.resolve({data:null, error:{message:'unknown quiz'}});
      const items = keys.map((k, i) => { const g = norm(args.p_answers[String(i + 1)]);
        const ok = g !== '' && k.split('|').some(a => norm(a) === g || (!isNaN(parseFloat(norm(a))) && !isNaN(Number(g)) && Number(norm(a)) === Number(g)));
        return {q: i + 1, ok, answer: k.split('|')[0]}; });
      const score = items.filter(x => x.ok).length;
      if (s) { D.edu_quiz_results.push({id: uid(), student_id: s.id, quiz: args.p_quiz, score, total: items.length, answers: args.p_answers,
        wrong: items.filter(x => !x.ok).map(x => x.q), created_at: new Date().toISOString()}); put('mockdb', D); }
      return R({score, total: items.length, items, saved: !!s}); }
    if (name === 'edu_my_quiz_results') return R(s ? D.edu_quiz_results.filter(r => r.student_id === s.id).map(r => ({quiz:r.quiz, score:r.score, total:r.total, created_at:r.created_at})) : []);
    return Promise.resolve({data:null, error:{message:'unknown rpc ' + name}});
  }
  const files = () => get('mockfiles', {});
  const storage = { from(bucket) { return {
    async upload(path, blob) { const u = me(); if (!u) return {error:{message:'auth'}}; const [owner, lesson] = path.split('/');
      const D = db(), s = D.edu_students.find(x => x.user_id === u.id);
      if (owner !== u.id || !D.edu_lessons.some(l => l.id === lesson && s && l.student_id === s.id)) return {data:null, error:{message:'new row violates row-level security policy'}};
      const url = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      const F = files(); F[path] = url; put('mockfiles', F); return {data:{path}, error:null}; },
    async createSignedUrls(paths) { const u = me(), F = files(), teacher = u && u.role === 'teacher';
      return {data: paths.map(p => ({path: p, signedUrl: u && F[p] && (teacher || p.startsWith(u.id + '/')) ? F[p] : null})), error:null}; },
    async remove(paths) { const u = me(), F = files(), teacher = u && u.role === 'teacher';
      paths.forEach(p => { if (u && (teacher || p.startsWith(u.id + '/'))) delete F[p]; }); put('mockfiles', F); return {data:null, error:null}; } }; } };
  const auth = {
    getSession: async () => ({data:{session: sess()}}),
    signInWithPassword: async ({email, password}) => { const u = USERS[email]; if (!u || u.pw !== password) return {error:{message:'Invalid login credentials'}};
      put('mockSession', {user:{id:u.id, email}}); return {data:{session: sess()}, error:null}; },
    signUp: async ({email}) => ({data:{session:null}, error:null}),
    resetPasswordForEmail: async () => ({error:null}),
    updateUser: async () => ({error:null}),
    signOut: async () => { localStorage.removeItem('mockSession'); return {error:null}; },
    onAuthStateChange(){} };
  Object.defineProperty(window, 'supabase', {value: {createClient(){ return {from, rpc, auth, storage}; }}, writable:false});
})()`;
};
