// Имитация Supabase для локальных тестов: вход, таблицы журнала, функции ДЗ и самопроверки, хранилище фото.
// QUIZKEYS, BANK — ключи ответов (передаются при запуске из файлов вне репозитория).
module.exports = function(KEY, QUIZKEYS, BANK){
  return `(() => {
  const KEY = ${JSON.stringify(KEY)}, QK = ${JSON.stringify(QUIZKEYS || {})}, BK = ${JSON.stringify(BANK || {})};
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v } catch(e) { return d } };
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const USERS = {'teacher@test.local': {id:'u1', pw:'test-pass-1', role:'teacher'}, 'kid@test.local': {id:'u2', pw:'test-pass-2', role:'student'}, 'new@test.local': {id:'u3', pw:'test-pass-3', role:'student'}};
  const db = () => { const D = get('mockdb', {edu_students:[], edu_lessons:[], edu_progress:[], edu_profiles:[
    {user_id:'u1',email:'teacher@test.local',role:'teacher',created_at:'2026-10-01'},
    {user_id:'u2',email:'kid@test.local',role:'student',created_at:'2026-10-02'},
    {user_id:'u3',email:'new@test.local',role:'student',created_at:'2026-10-03'}]}); D.edu_quiz_results = D.edu_quiz_results || []; D.edu_boards = D.edu_boards || []; D.edu_bank_attempts = D.edu_bank_attempts || []; D.edu_ws_answers = D.edu_ws_answers || []; return D; };
  const sess = () => { try { const t = sessionStorage.getItem('mockSessionTab'); if (t) return JSON.parse(t); } catch(e) {} return get('mockSession', null); };
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
      if (t === 'edu_bank') return {data: Object.keys(BK).map(id => Object.assign({id}, BK[id]))};
      if (st.op === 'insert') { const row = Object.assign({id: uid(), created_at: new Date().toISOString()}, t === 'edu_lessons' ? {student_done:false, hw_status:'none', photos:[]} : t === 'edu_boards' ? {data:{els:[]}, title:'Доска', updated_at: new Date().toISOString()} : {}, st.data); D[t].push(row); put('mockdb', D); return {data: st.single ? row : [row]}; }
      if (st.op === 'upsert') { D[t] = D[t].filter(r => r.student_id !== st.data.student_id); D[t].push(st.data); put('mockdb', D); return {data:null}; }
      if (st.op === 'update') { let out = null; D[t] = D[t].map(r => match(r) ? (out = Object.assign({}, r, st.data)) : r); put('mockdb', D); return {data: st.single ? out : null}; }
      if (st.op === 'delete') { D[t] = D[t].filter(r => !match(r)); if (t === 'edu_students') { const ok = l => D.edu_students.some(s => s.id === l.student_id);
        D.edu_lessons = D.edu_lessons.filter(ok); D.edu_progress = D.edu_progress.filter(ok); D.edu_quiz_results = D.edu_quiz_results.filter(ok); D.edu_boards = D.edu_boards.filter(ok); D.edu_bank_attempts = D.edu_bank_attempts.filter(ok); D.edu_ws_answers = D.edu_ws_answers.filter(ok); } put('mockdb', D); return {data:null}; }
      let rows = D[t].filter(match); if (t === 'edu_lessons') rows.sort(byDate);
      if (t === 'edu_quiz_results' || t === 'edu_boards' || t === 'edu_bank_attempts') rows.sort((a, b) => a.created_at < b.created_at ? 1 : -1);
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
    const qs = (lid, best) => { const a = D.edu_quiz_results.filter(r => r.lesson_id === lid).sort((x, y) => x.created_at < y.created_at ? -1 : 1); if (!a.length) return null;
      const r = best ? a.reduce((m, q) => q.score > m.score ? q : m, a[0]) : a[0]; return r.score + '/' + r.total; };
    if (name === 'edu_my_homework') return R(s ? D.edu_lessons.filter(l => l.student_id === s.id && (l.homework || l.quiz)).sort(byDate)
      .map(l => ({id:l.id, date:l.date, topic:l.topic, topic_text:l.topic_text, homework:l.homework, student_done:l.student_done,
        student_comment:l.student_comment || null, photos:l.photos || [], submitted_at:l.submitted_at || null, feedback:l.feedback || null, hw_mark:l.hw_mark || null, feedback_at:l.feedback_at || null,
        quiz:l.quiz || null, quiz_first: qs(l.id, false), quiz_best: qs(l.id, true), quiz_tries: D.edu_quiz_results.filter(r => r.lesson_id === l.id).length})) : []);
    if (name === 'edu_ws_save') { if (!s) return Promise.resolve({data:null, error:{message:'no student'}}); if (!/^wsa?[0-9]{1,2}$/.test(args.p_ws)) return Promise.resolve({data:null, error:{message:'bad worksheet'}});
      let w = D.edu_ws_answers.find(x => x.student_id === s.id && x.ws === args.p_ws); const now = new Date().toISOString();
      if (!w) { w = {student_id: s.id, ws: args.p_ws, submitted_at: null, seen_at: null}; D.edu_ws_answers.push(w); }
      w.answers = args.p_answers; w.updated_at = now; if (args.p_submit) w.submitted_at = now; put('mockdb', D); return R({updated_at: w.updated_at, submitted_at: w.submitted_at}); }
    if (name === 'edu_ws_mine') { const w = s && D.edu_ws_answers.find(x => x.student_id === s.id && x.ws === args.p_ws); return R(w ? {answers: w.answers, updated_at: w.updated_at, submitted_at: w.submitted_at} : null); }
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
      let lid = null, first = false;
      if (s && args.p_lesson) { const l = D.edu_lessons.find(x => x.id === args.p_lesson && x.student_id === s.id && x.quiz === args.p_quiz); if (l) { lid = l.id; first = !D.edu_quiz_results.some(r => r.lesson_id === lid);
        if (first) { l.student_done = true; l.submitted_at = l.submitted_at || new Date().toISOString(); } } }
      if (s) { D.edu_quiz_results.push({id: uid(), student_id: s.id, quiz: args.p_quiz, score, total: items.length, answers: args.p_answers, lesson_id: lid,
        wrong: items.filter(x => !x.ok).map(x => x.q), created_at: new Date().toISOString()}); put('mockdb', D); }
      return R({score, total: items.length, items, saved: !!s, homework: !!lid, first}); }
    if (name === 'edu_my_quiz_results') return R(s ? D.edu_quiz_results.filter(r => r.student_id === s.id).map(r => ({quiz:r.quiz, score:r.score, total:r.total, created_at:r.created_at})) : []);
    if (name === 'edu_bank_check') { const k = BK[args.p_task]; if (!k) return Promise.resolve({data:null, error:{message:'unknown task'}});
      const g = norm(String(args.p_answer || '').slice(0, 40)).replace(/−/g, '-'), a = norm(k.answer);
      const ok = g !== '' && (a === g || (!isNaN(Number(g)) && g !== '' && Number(a) === Number(g))); let tries = 0;
      if (s && g !== '') { D.edu_bank_attempts.push({id: uid(), student_id: s.id, task: args.p_task, num: k.num, answer: args.p_answer, ok, revealed: false, created_at: new Date().toISOString()}); put('mockdb', D);
        tries = D.edu_bank_attempts.filter(x => x.student_id === s.id && x.task === args.p_task && !x.revealed).length; }
      return R({ok, saved: !!(s && g !== ''), tries}); }
    if (name === 'edu_bank_solution') { const k = BK[args.p_task]; if (!k) return Promise.resolve({data:null, error:{message:'unknown task'}});
      if (u.role !== 'teacher' && s) { const mine = D.edu_bank_attempts.filter(x => x.student_id === s.id && x.task === args.p_task);
        if (!mine.length) return Promise.resolve({data:null, error:{message:'сначала ответь сам'}});
        if (!mine.some(x => x.revealed)) { D.edu_bank_attempts.push({id: uid(), student_id: s.id, task: args.p_task, num: k.num, answer: null, ok: false, revealed: true, created_at: new Date().toISOString()}); put('mockdb', D); } }
      return R({answer: k.answer, solution: k.solution}); }
    if (name === 'edu_bank_my_stats') { if (!s) return R([]); const by = {};
      D.edu_bank_attempts.filter(x => x.student_id === s.id).sort((a, b) => a.created_at < b.created_at ? -1 : 1).forEach(x => {
        const t = by[x.task] || (by[x.task] = {task: x.task, num: x.num, tries: 0, solved: false, first_ok: null, revealed: false});
        if (x.revealed) { t.revealed = true; return; } t.tries++; if (t.first_ok === null) t.first_ok = x.ok; if (x.ok) t.solved = true; });
      return R(Object.values(by).map(t => Object.assign(t, {first_ok: !!t.first_ok}))); }
    const can = id => { const b = D.edu_boards.find(x => x.id === id); return !!b && (u.role === 'teacher' || (s && b.student_id === s.id)); };
    if (name === 'edu_my_boards') return R(s ? D.edu_boards.filter(b => b.student_id === s.id).sort((a, b) => a.created_at < b.created_at ? 1 : -1)
      .map(b => { const l = D.edu_lessons.find(x => x.id === b.lesson_id); return {id:b.id, title:b.title, lesson_id:b.lesson_id || null, lesson_date: l ? l.date : null, created_at:b.created_at, updated_at:b.updated_at}; }) : []);
    if (name === 'edu_board_get') { const b = D.edu_boards.find(x => x.id === args.p_board); return R(b && can(b.id) ? [{id:b.id, student_id:b.student_id, title:b.title, data:b.data, updated_at:b.updated_at}] : []); }
    if (name === 'edu_board_save') { const b = D.edu_boards.find(x => x.id === args.p_board); if (!b || !can(b.id)) return R(false);
      b.data = JSON.parse(JSON.stringify(args.p_data)); b.updated_at = new Date().toISOString(); put('mockdb', D); return R(true); }
    if (name === 'edu_board_new') { if (!s) return Promise.resolve({data:null, error:{message:'not linked'}});
      const b = {id: uid(), student_id: s.id, title: args.p_title || 'Черновик', data:{els:[]}, created_at: new Date().toISOString(), updated_at: new Date().toISOString()}; D.edu_boards.push(b); put('mockdb', D); return R(b.id); }
    return Promise.resolve({data:null, error:{message:'unknown rpc ' + name}});
  }
  const files = () => get('mockfiles', {});
  const storage = { from(bucket) { return {
    async upload(path, blob) { const u = me(); if (!u) return {error:{message:'auth'}}; const [owner, lesson] = path.split('/');
      const D = db(), s = D.edu_students.find(x => x.user_id === u.id);
      const okHw = owner === u.id && D.edu_lessons.some(l => l.id === lesson && s && l.student_id === s.id);
      const bd = D.edu_boards.find(x => x.id === owner), okBoard = bucket === 'edu-board' && bd && (u.role === 'teacher' || (s && bd.student_id === s.id));
      if (bucket === 'edu-board' ? !okBoard : !okHw) return {data:null, error:{message:'new row violates row-level security policy'}};
      const url = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      const F = files(); F[path] = url; put('mockfiles', F); return {data:{path}, error:null}; },
    async createSignedUrls(paths) { const u = me(), F = files(), teacher = u && u.role === 'teacher', D = db(), s = u && D.edu_students.find(x => x.user_id === u.id);
      const mine = p => bucket === 'edu-board' ? D.edu_boards.some(b => b.id === p.split('/')[0] && s && b.student_id === s.id) : p.startsWith(u.id + '/');
      return {data: paths.map(p => ({path: p, signedUrl: u && F[p] && (teacher || mine(p)) ? F[p] : null})), error:null}; },
    async remove(paths) { const u = me(), F = files(), teacher = u && u.role === 'teacher';
      paths.forEach(p => { if (u && (teacher || p.startsWith(u.id + '/'))) delete F[p]; }); put('mockfiles', F); return {data:null, error:null}; } }; } };
  function channel(name, opts) {
    const handlers = [], pres = {}; let bc = null, myState = null; const key = (opts && opts.config && opts.config.presence && opts.config.presence.key) || 'k' + Math.random();
    const fire = (type, ev, payload) => handlers.filter(h => h.type === type && (type !== 'broadcast' || h.ev === ev)).forEach(h => h.cb({payload}));
    const c = {
      on(type, filter, cb) { handlers.push({type, ev: filter && filter.event, cb}); return c; },
      subscribe(cb) { const u = me(), D = db(), id = name.split(':')[1], b = D.edu_boards.find(x => x.id === id), s = u && D.edu_students.find(x => x.user_id === u.id);
        const ok = u && b && (u.role === 'teacher' || (s && b.student_id === s.id));
        const fails = get('mockRtFails', 0); if (fails > 0) put('mockRtFails', fails - 1);
        if (!ok || get('mockNoRealtime', false) || fails > 0) { setTimeout(() => cb('CHANNEL_ERROR'), 50); return c; }
        bc = new BroadcastChannel('rt:' + name);
        bc.onmessage = m => { const d = m.data;
          if (d.type === 'broadcast') fire('broadcast', d.event, d.payload);
          if (d.type === 'presence') { if (d.state) pres[d.key] = d.state; else delete pres[d.key]; fire('presence');
            if (d.ask && myState) bc.postMessage({type:'presence', key, state:[myState]}); } };
        setTimeout(() => cb('SUBSCRIBED'), 50); return c; },
      send(m) { if (bc) bc.postMessage(m); return Promise.resolve('ok'); },
      track(state) { myState = state; pres[key] = [state]; if (bc) bc.postMessage({type:'presence', key, state:[state], ask:true}); fire('presence'); return Promise.resolve('ok'); },
      presenceState() { return pres; },
      unsubscribe() { if (bc) { bc.postMessage({type:'presence', key, state:null}); bc.close(); bc = null; } } };
    window.addEventListener('beforeunload', () => c.unsubscribe());
    return c;
  }
  const realtime = {setAuth(){}};
  const auth = {
    getSession: async () => { const s = sess(); return {data:{session: s ? Object.assign({access_token:'mock-token'}, s) : null}}; },
    signInWithPassword: async ({email, password}) => { const u = USERS[email]; if (!u || u.pw !== password) return {error:{message:'Invalid login credentials'}};
      put('mockSession', {user:{id:u.id, email}}); return {data:{session: sess()}, error:null}; },
    signUp: async ({email}) => ({data:{session:null}, error:null}),
    resetPasswordForEmail: async () => ({error:null}),
    updateUser: async () => ({error:null}),
    signOut: async () => { localStorage.removeItem('mockSession'); return {error:null}; },
    onAuthStateChange(){} };
  Object.defineProperty(window, 'supabase', {value: {createClient(){ return {from, rpc, auth, storage, channel, realtime, removeChannel(c){ c.unsubscribe(); }}; }}, writable:false});
})()`;
};
