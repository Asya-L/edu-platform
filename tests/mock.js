// Имитация Supabase для локальных тестов.
module.exports = function(KEY){
  return `(() => {
  const KEY = ${JSON.stringify(KEY)};
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v } catch(e) { return d } };
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const USERS = {'teacher@test.local': {id:'u1', pw:'test-pass-1', role:'teacher'}, 'kid@test.local': {id:'u2', pw:'test-pass-2', role:'student'}, 'new@test.local': {id:'u3', pw:'test-pass-3', role:'student'}};
  const db = () => get('mockdb', {edu_students:[], edu_lessons:[], edu_progress:[], edu_profiles:[
    {user_id:'u1',email:'teacher@test.local',role:'teacher',created_at:'2026-10-01'},
    {user_id:'u2',email:'kid@test.local',role:'student',created_at:'2026-10-02'},
    {user_id:'u3',email:'new@test.local',role:'student',created_at:'2026-10-03'}]});
  const sess = () => get('mockSession', null);
  const me = () => { const s = sess(); if (!s) return null; const p = db().edu_profiles.find(x => x.user_id === s.user.id); return {id: s.user.id, role: p ? p.role : 'student'}; };
  let n = 0; const uid = () => 'id' + Date.now() + '_' + (n++);
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
      if (st.op === 'insert') { const row = Object.assign({id: uid(), created_at: new Date().toISOString(), student_done:false, hw_status:'none'}, st.data); D[t].push(row); put('mockdb', D); return {data: st.single ? row : [row]}; }
      if (st.op === 'upsert') { D[t] = D[t].filter(r => r.student_id !== st.data.student_id); D[t].push(st.data); put('mockdb', D); return {data:null}; }
      if (st.op === 'update') { let out = null; D[t] = D[t].map(r => match(r) ? (out = Object.assign({}, r, st.data)) : r); put('mockdb', D); return {data: st.single ? out : null}; }
      if (st.op === 'delete') { D[t] = D[t].filter(r => !match(r)); if (t === 'edu_students') { D.edu_lessons = D.edu_lessons.filter(l => D.edu_students.some(s => s.id === l.student_id)); D.edu_progress = D.edu_progress.filter(p => D.edu_students.some(s => s.id === p.student_id)); } put('mockdb', D); return {data:null}; }
      let rows = D[t].filter(match); if (t === 'edu_lessons') rows.sort((a, b) => a.date === b.date ? (b.created_at > a.created_at ? 1 : -1) : (a.date < b.date ? 1 : -1));
      return {data: st.single ? (rows[0] || null) : rows}; };
    const b = { select(){ return b }, order(){ return b }, limit(){ return b }, eq(k, v){ st.f.push([k, v]); return b },
      insert(d){ st.op='insert'; st.data=d; return b }, update(d){ st.op='update'; st.data=d; return b }, upsert(d){ st.op='upsert'; st.data=d; return b },
      delete(){ st.op='delete'; return b }, single(){ st.single=true; return b }, maybeSingle(){ st.single=true; return b },
      then(res, rej){ return new Promise(function(ok, no){ try { ok(Object.assign({error:null}, run())) } catch(e) { no(e) } }).then(res, rej) } };
    return b;
  }
  function rpc(name, args) { const D = db(), u = me(); if (!u) return Promise.resolve({data:null, error:{message:'not allowed'}});
    const s = D.edu_students.find(x => x.user_id === u.id);
    if (name === 'edu_my_homework') return Promise.resolve({error:null, data: s ? D.edu_lessons.filter(l => l.student_id === s.id && l.homework)
      .sort((a, b) => a.date === b.date ? (b.created_at > a.created_at ? 1 : -1) : (a.date < b.date ? 1 : -1)).map(l => ({id:l.id, date:l.date, topic:l.topic, topic_text:l.topic_text, homework:l.homework, student_done:l.student_done})) : []});
    if (name === 'edu_set_done') { D.edu_lessons.forEach(l => { if (s && l.id === args.p_lesson && l.student_id === s.id) l.student_done = args.p_done; }); put('mockdb', D); return Promise.resolve({data:null, error:null}); } }
  const auth = {
    getSession: async () => ({data:{session: sess()}}),
    signInWithPassword: async ({email, password}) => { const u = USERS[email]; if (!u || u.pw !== password) return {error:{message:'Invalid login credentials'}};
      put('mockSession', {user:{id:u.id, email}}); return {data:{session: sess()}, error:null}; },
    signUp: async ({email}) => ({data:{session:null}, error:null}),
    resetPasswordForEmail: async () => ({error:null}),
    updateUser: async () => ({error:null}),
    signOut: async () => { localStorage.removeItem('mockSession'); return {error:null}; },
    onAuthStateChange(){} };
  Object.defineProperty(window, 'supabase', {value: {createClient(){ return {from, rpc, auth}; }}, writable:false});
})()`;
};
