/* Durable per-board operation queue. Browser and Node share the same controller. */
(function(root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EDU_BOARD_SYNC = factory();
})(typeof globalThis === 'object' ? globalThis : this, function(){
  'use strict';
  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function uuid(){
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){ var n = Math.floor(Math.random()*16); return (c === 'x' ? n : (n&3)|8).toString(16); });
  }
  function applyOps(data, ops){
    var out = clone(data || {els:[],bg:'grid'}); out.els = out.els || [];
    ops.forEach(function(op){
      if (op.k === 'add') op.els.forEach(function(e){ if (!out.els.some(function(x){ return x.id === e.id; })) out.els.push(clone(e)); });
      else if (op.k === 'upd') op.els.forEach(function(e){ out.els = out.els.map(function(x){ return x.id === e.id ? clone(e) : x; }); });
      else if (op.k === 'del') out.els = out.els.filter(function(e){ return op.ids.indexOf(e.id) < 0; });
      else if (op.k === 'bg') out.bg = op.bg;
      else throw new Error('Unsupported board operation');
    });
    return out;
  }
  function create(options){
    var o = options, key = 'edu.board.pending:' + o.userId + ':' + o.boardId + ':' + (o.clientId || 'main');
    var base = clone(o.initialData || {els:[],bg:'grid'}), revision = Number(o.initialRevision || 0);
    var pending = [], batch = null, running = null, timer = null, closed = false, hints = new Map(), storageError = false;
    try {
      var saved = o.storage && JSON.parse(o.storage.getItem(key) || 'null');
      if (saved && saved.version === 1 && Array.isArray(saved.pending)) {
        pending = saved.pending; batch = saved.batch || null;
      }
    } catch(e){ storageError = true; }
    function dirty(){ return pending.length > 0; }
    function view(){ return applyOps(applyOps(base, Array.from(hints.values())), pending.map(function(p){ return p.op; })); }
    function state(s){ if (!closed && o.onStatus) o.onStatus(s || (dirty() ? 'pending' : hints.size ? 'remote-pending' : 'saved')); }
    function render(){ if (!closed && o.onState) o.onState(view()); }
    function persist(){
      try {
        if (o.storage) {
          if (pending.length) o.storage.setItem(key, JSON.stringify({version:1,pending:pending,batch:batch}));
          else o.storage.removeItem(key);
        }
        storageError = false;
      } catch(e){ storageError = true; state('storage-error'); }
    }
    function schedule(ms){ clearTimeout(timer); if (!closed && dirty()) timer = setTimeout(flush, ms); }
    function hydrate(data, rev){
      rev = Number(rev || 0);
      if (rev >= revision) { revision = rev; base = clone(data); delete base._revision; }
    }
    async function refresh(){
      if (closed) return false;
      try {
        var r = await o.rpc('edu_board_get', {p_board:o.boardId}), b = r.data && r.data[0];
        if (r.error || !b) return false;
        hydrate(b.data, b.data && b.data._revision); render(); return true;
      } catch(e){ return false; }
    }
    function request(args){
      var timeout;
      return Promise.race([
        Promise.resolve().then(function(){ return o.rpc('edu_board_apply', args); }),
        new Promise(function(resolve,reject){ timeout = setTimeout(function(){ reject(new Error('Board save timeout')); }, o.timeout || 12000); })
      ]).finally(function(){ clearTimeout(timeout); });
    }
    function flush(){
      clearTimeout(timer);
      if (running) return running;
      if (!dirty()) return Promise.resolve(true);
      if (!batch) batch = {id:uuid(),items:clone(pending.slice(0,200))};
      persist(); state('saving');
      var sent = clone(batch);
      var rejected = false;
      running = (async function(){
        try {
          var r = await request({p_board:o.boardId,p_batch:sent.id,p_ops:sent.items.map(function(p){ return p.op; })});
          if (r.error) {
            rejected = ['22023','42501','P0002','PGRST202'].indexOf(r.error.code) >= 0;
            throw new Error(r.error.message || 'Board save rejected');
          }
          if (!r.data || !r.data.data) throw new Error('Board save rejected');
          var ids = sent.items.map(function(p){ return p.id; });
          pending = pending.filter(function(p){ return ids.indexOf(p.id) < 0; }); batch = null;
          hydrate(r.data.data, r.data.revision); persist(); render(); state();
          if (!closed && o.onSaved) o.onSaved(ids, revision);
          return true;
        } catch(e){
          persist(); state(storageError ? 'storage-error' : rejected ? 'rejected' : 'offline'); return false;
        } finally {
          running = null;
          if (dirty() && !rejected) schedule(batch ? (o.retry || 5000) : 0);
        }
      })();
      return running;
    }
    function enqueue(op){
      if (closed) throw new Error('Board session is closed');
      // Validate before writing a potentially unreplayable draft.
      applyOps({els:[]}, [op]);
      var item = {id:uuid(),op:clone(op)}; pending.push(item); persist(); render();
      state(storageError ? 'storage-error' : 'pending'); schedule(o.delay == null ? 800 : o.delay);
      return item.id;
    }
    function receive(op, id){ if (closed || !id) return; hints.set(id,clone(op)); render(); state(); }
    async function ack(ids){ (ids || []).forEach(function(id){ hints.delete(id); }); var ok = await refresh(); state(); return ok; }
    function close(){ closed = true; clearTimeout(timer); }
    render(); state(storageError ? 'storage-error' : null);
    if (dirty()) schedule(o.delay == null ? 800 : o.delay);
    return {enqueue:enqueue,flush:flush,refresh:refresh,receive:receive,ack:ack,close:close,dirty:dirty,view:view,render:render};
  }
  return {create:create,applyOps:applyOps};
});
