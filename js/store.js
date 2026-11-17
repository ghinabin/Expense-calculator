/* Expense Calculator: data and sign-in layer.
   Cloud mode (Supabase keys set in js/config.js): sign-in with Supabase Auth,
   data in Postgres tables, bills and slips in a private Storage bucket.
   Local mode (no keys): everything stays in this browser via LocalAuth.
   The app keeps one in-memory state object; save() diffs it against what the
   database already has and writes only the rows that changed. */
(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var CLOUD = !!(C.supabaseUrl && C.supabaseAnonKey && window.supabase && window.supabase.createClient);
  var BUCKET = 'attachments';

  // ---------- helpers ----------
  var listeners = [], statusText = CLOUD ? 'Connected' : 'Saved on this device';
  function setStatus(t) { statusText = t; listeners.forEach(function (f) { try { f(t); } catch (e) {} }); }
  function friendly(err) {
    var m = (err && (err.message || err.error_description || err)) + '';
    if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
    if (/email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link.';
    if (/already registered|already exists/i.test(m)) return 'An account with this email already exists. Log in instead.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    if (/failed to fetch|network/i.test(m)) return 'No connection. Check your internet and try again.';
    if (/password should be/i.test(m)) return m;
    return m || 'Something went wrong. Try again.';
  }
  var nz = function (v) { return v === undefined || v === '' ? null : v; };
  var num = function (v) { return v === null || v === undefined ? v : Number(v); };

  // ---------- Supabase client ----------
  var client = null, clientRemember = null;
  function sb(remember) {
    if (remember === undefined) remember = localStorage.getItem('xt-remember') !== '0';
    if (!client || clientRemember !== remember) {
      clientRemember = remember;
      client = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'xt-sb-auth', storage: remember ? localStorage : sessionStorage }
      });
    }
    return client;
  }

  // ---------- row mapping (app state <-> tables) ----------
  var uid = null;
  var map = {
    accounts: {
      to: function (a) { return { user_id: uid, id: a.id, name: a.name, type: a.type, opening_balance: Number(a.open) || 0, archived: !!a.archived }; },
      from: function (r) { var a = { id: r.id, name: r.name, type: r.type, open: num(r.opening_balance) }; if (r.archived) a.archived = true; return a; }
    },
    commitments: {
      to: function (c) {
        return { user_id: uid, id: c.id, name: c.name, type: c.type, amount: Number(c.amt), variable: !!c.variable, category: c.cat || 'other', account_id: nz(c.acc), due_day: c.due,
          total_instalments: c.total == null ? null : Number(c.total), instalments_paid: Number(c.done) || 0, lender: nz(c.lender), remind_days: Number(c.remind) || 2,
          paid_dates: c.paid || [], skipped_dates: c.skip || [] };
      },
      from: function (r) {
        var c = { id: r.id, name: r.name, type: r.type, amt: num(r.amount), cat: r.category, acc: r.account_id, due: r.due_day, remind: r.remind_days, paid: r.paid_dates || [], skip: r.skipped_dates || [] };
        if (r.variable) c.variable = true;
        if (r.total_instalments != null) { c.total = r.total_instalments; c.done = r.instalments_paid || 0; }
        if (r.lender) c.lender = r.lender;
        return c;
      }
    },
    transactions: {
      to: function (t) {
        return { user_id: uid, id: t.id, type: t.type, amount: Number(t.amt), account_id: t.acc, to_account_id: nz(t.to), category: nz(t.cat), person: nz(t.person), note: nz(t.note),
          date: t.date, commitment_id: nz(t.cid), linked_id: nz(t.lk),
          attachments: (t.att || []).map(function (x) { return { id: x.id, label: x.label, name: x.name || null, pdf: !!x.pdf, path: x.path || null }; }) };
      },
      from: function (r) {
        var t = { id: r.id, type: r.type, amt: num(r.amount), acc: r.account_id, date: r.date, note: r.note || '', att: (r.attachments || []).map(function (x) { return { id: x.id, label: x.label, name: x.name, pdf: !!x.pdf, path: x.path }; }) };
        if (r.to_account_id) t.to = r.to_account_id;
        if (r.category) t.cat = r.category;
        if (r.person) t.person = r.person;
        if (r.commitment_id) t.cid = r.commitment_id;
        if (r.linked_id) t.lk = r.linked_id;
        return t;
      }
    }
  };
  var KEYS = { accounts: 'acc', commitments: 'com', transactions: 'tx' };
  function profRow(S, name) {
    return { user_id: uid, name: name || '', month_start: S.set.start, default_account: nz(S.set.def), theme: S.set.theme || 'light', budget_total: Number(S.bud.all) || 0, budget_categories: S.bud.cat || {} };
  }

  // ---------- cloud sync ----------
  var snap = null, user = null, latest = null, timer = null, chain = Promise.resolve(), retry = null;
  function snapshot(S) {
    var s = { accounts: new Map(), commitments: new Map(), transactions: new Map(), profile: JSON.stringify(profRow(S, user.name)), paths: new Set() };
    Object.keys(KEYS).forEach(function (tbl) { S[KEYS[tbl]].forEach(function (it) { s[tbl].set(it.id, JSON.stringify(map[tbl].to(it))); }); });
    S.tx.forEach(function (t) { (t.att || []).forEach(function (x) { if (x.path) s.paths.add(x.path); }); });
    return s;
  }
  function check(res) { if (res && res.error) throw res.error; return res; }

  async function flush() {
    var S = latest; if (!S || !snap) return;
    var db = sb();
    // 1. upload new attachments
    for (var i = 0; i < S.tx.length; i++) {
      var att = S.tx[i].att || [];
      for (var j = 0; j < att.length; j++) {
        var x = att[j];
        if (!x.path && x.url && x.url.indexOf('data:') === 0) {
          var blob = await (await fetch(x.url)).blob();
          var safe = String(x.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
          var path = uid + '/' + x.id + '-' + safe;
          check(await db.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' }));
          x.path = path;
        }
      }
    }
    // 2. upserts (parents first)
    var order = ['accounts', 'commitments', 'transactions'];
    for (var k = 0; k < order.length; k++) {
      var tbl = order[k], rows = S[KEYS[tbl]].map(map[tbl].to);
      var changed = rows.filter(function (r) { return snap[tbl].get(r.id) !== JSON.stringify(r); });
      if (changed.length) check(await db.from(tbl).upsert(changed, { onConflict: 'user_id,id' }));
    }
    var prof = profRow(S, user.name);
    if (JSON.stringify(prof) !== snap.profile) check(await db.from('profiles').upsert(prof, { onConflict: 'user_id' }));
    // 3. deletes (children first)
    for (var d = order.length - 1; d >= 0; d--) {
      var t2 = order[d], ids = new Set(S[KEYS[t2]].map(function (it) { return it.id; }));
      var gone = Array.from(snap[t2].keys()).filter(function (id) { return !ids.has(id); });
      if (gone.length) check(await db.from(t2).delete().eq('user_id', uid).in('id', gone));
    }
    // 4. remove files no longer attached
    var next = snapshot(S);
    var orphan = Array.from(snap.paths).filter(function (p) { return !next.paths.has(p); });
    if (orphan.length) await db.storage.from(BUCKET).remove(orphan);
    snap = next;
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      chain = chain.then(flush).then(function () {
        clearTimeout(retry);
        var d = new Date();
        setStatus('All changes saved · ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'));
      }).catch(function (e) {
        console.error('Sync failed', e);
        setStatus("Couldn't save to the cloud: " + friendly(e) + ' Retrying…');
        clearTimeout(retry);
        retry = setTimeout(function () { schedule(0); }, 8000);
      });
    }, delay);
  }

  async function fetchAll(tbl, orderCol) {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var res = check(await sb().from(tbl).select('*').eq('user_id', uid).order(orderCol, { ascending: true }).range(from, from + size - 1));
      out = out.concat(res.data || []);
      if (!res.data || res.data.length < size) return out;
      from += size;
    }
  }

  // ---------- public API ----------
  var Store = {
    mode: CLOUD ? 'cloud' : 'local',
    onStatus: function (f) { listeners.push(f); },
    statusText: function () { return statusText; },

    hasSession: async function () {
      if (!CLOUD) return !!(window.LocalAuth && LocalAuth.current());
      var r = await sb().auth.getSession();
      return !!(r.data && r.data.session);
    },

    signIn: async function (email, pw, remember) {
      try { localStorage.setItem('xt-remember', remember ? '1' : '0'); } catch (e) {}
      if (!CLOUD) return LocalAuth.login(email, pw, remember) ? { ok: true } : { error: 'Email or password is incorrect.' };
      try {
        var r = await sb(remember).auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password: pw });
        return r.error ? { error: friendly(r.error) } : { ok: true };
      } catch (e) { return { error: friendly(e) }; }
    },

    signUp: async function (name, email, pw) {
      if (!CLOUD) { var l = LocalAuth.register(name, email, pw); return l.error ? { error: l.error } : { ok: true }; }
      try {
        var redirect = location.href.replace(/[^/]*([?#].*)?$/, '') + 'index.html';
        var r = await sb(true).auth.signUp({ email: String(email).trim().toLowerCase(), password: pw, options: { data: { name: name }, emailRedirectTo: redirect } });
        if (r.error) return { error: friendly(r.error) };
        if (r.data && r.data.user && r.data.user.identities && r.data.user.identities.length === 0) return { error: 'An account with this email already exists. Log in instead.' };
        return { ok: true, needsConfirm: !(r.data && r.data.session) };
      } catch (e) { return { error: friendly(e) }; }
    },

    resetPassword: async function (email) {
      if (!CLOUD) return { error: 'Password reset needs Supabase. In local mode, create a new account.' };
      var redirect = location.href.replace(/[^/]*([?#].*)?$/, '') + 'reset.html';
      var r = await sb().auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo: redirect });
      return r.error ? { error: friendly(r.error) } : { ok: true };
    },

    updatePassword: async function (pw) {
      var r = await sb().auth.updateUser({ password: pw });
      return r.error ? { error: friendly(r.error) } : { ok: true };
    },

    signOut: async function () {
      if (!CLOUD) { LocalAuth.logout(); return; }
      try { await chain; } catch (e) {}
      await sb().auth.signOut();
    },

    // Returns null when signed out, else { user, state } (state null = brand-new user)
    boot: async function () {
      if (!CLOUD) {
        var s = window.LocalAuth && LocalAuth.current();
        if (!s) return null;
        user = { email: s.email, name: s.name || '', demo: !!s.demo };
        var st = null;
        try { st = JSON.parse(localStorage.getItem('xt-data-' + s.email) || 'null'); } catch (e) {}
        return { user: user, state: st && st.acc ? st : null };
      }
      var ses = (await sb().auth.getSession()).data.session;
      if (!ses) return null;
      uid = ses.user.id;
      var res = await Promise.all([
        sb().from('profiles').select('*').eq('user_id', uid).maybeSingle(),
        fetchAll('accounts', 'created_at'),
        fetchAll('commitments', 'created_at'),
        fetchAll('transactions', 'date')
      ]);
      var p = check(res[0]).data;
      user = { id: uid, email: ses.user.email, name: (p && p.name) || (ses.user.user_metadata && ses.user.user_metadata.name) || '', demo: false };
      var S = {
        set: { start: (p && p.month_start) || 1, def: (p && p.default_account) || 'cash', theme: (p && p.theme) || localStorage.getItem('xt-theme') || 'light' },
        bud: { all: p ? num(p.budget_total) : 30000, cat: (p && p.budget_categories) || {} },
        acc: res[1].map(map.accounts.from),
        com: res[2].map(map.commitments.from),
        tx: res[3].map(map.transactions.from)
      };
      // signed links so bills and slips can be shown
      var paths = [];
      S.tx.forEach(function (t) { t.att.forEach(function (x) { if (x.path) paths.push(x.path); }); });
      if (paths.length) {
        var signed = await sb().storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 12);
        var byPath = {};
        (signed.data || []).forEach(function (o) { if (o.signedUrl) byPath[o.path] = o.signedUrl; });
        S.tx.forEach(function (t) { t.att.forEach(function (x) { if (byPath[x.path]) x.url = byPath[x.path]; }); });
      }
      snap = p ? snapshot(S) : Object.assign(snapshot(S), { profile: '' });
      if (!S.acc.length) { S.acc.push({ id: 'cash', name: 'Cash', type: 'cash', open: 0 }); }
      latest = S;
      setStatus('All changes saved');
      return { user: user, state: S };
    },

    save: function (S) {
      latest = S;
      if (!CLOUD) {
        try { localStorage.setItem('xt-data-' + user.email, JSON.stringify(S)); setStatus('Saved on this device'); }
        catch (e) { setStatus("Couldn't save: this browser's storage is full."); }
        return;
      }
      setStatus('Saving…');
      schedule(400);
    }
  };

  if (CLOUD) {
    window.addEventListener('online', function () { if (latest) schedule(0); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && latest && timer) schedule(0); });
  }
  window.Store = Store;
})();
