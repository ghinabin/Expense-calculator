/* Expense Tracker: data and sign-in layer.
   Cloud mode (Supabase keys in js/config.js): passwordless sign-in (Google, Apple,
   6-digit email code) with Supabase Auth; data in Postgres tables; bills, slips and
   QR codes in a private Storage bucket.
   Local mode (no keys): everything stays in this browser.
   The app keeps one in-memory state object S. Store.save(S) diffs it against what
   the database already has and writes only the rows that changed. Each row keeps
   the full app object in a "data" jsonb column next to the queryable columns. */
(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var CLOUD = !!(C.supabaseUrl && C.supabaseAnonKey && window.supabase && window.supabase.createClient);
  var BUCKET = 'attachments';
  var TABLES = ['accounts', 'commitments', 'incomes', 'transactions'];
  var KEYS = { accounts: 'acc', commitments: 'com', incomes: 'inc', transactions: 'tx' };
  var CTYPES = ['EMI', 'Rent', 'Bill', 'Subscription', 'Insurance', 'Other', 'Goal', 'Saving'];
  var TTYPES = ['exp', 'inc', 'tr', 'lend', 'borrow', 'repayIn', 'repayOut', 'adj'];

  var listeners = [], statusText = CLOUD ? 'Connected' : 'Saved on this device';
  function setStatus(t) { statusText = t; listeners.forEach(function (f) { try { f(t); } catch (e) {} }); }
  function friendly(err) {
    var m = (err && (err.message || err.error_description || err)) + '';
    if (/token has expired|invalid.*(otp|token)|otp.*(expired|invalid)/i.test(m)) return 'That code didn’t match or has expired. Try again or resend.';
    if (/rate limit|too many|security purposes/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    if (/failed to fetch|network/i.test(m)) return 'No connection. Check your internet and try again.';
    if (/provider is not enabled|unsupported provider/i.test(m)) return 'This sign-in option isn’t set up yet. Use email for now.';
    return m || 'Something went wrong. Try again.';
  }
  var nz = function (v) { return v === undefined || v === '' ? null : v; };
  var num = function (v) { return v === null || v === undefined ? v : Number(v); };
  var day = function (v) { v = Number(v); return v >= 1 && v <= 32 ? Math.round(v) : null; };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  // ---------- Supabase client ----------
  var client = null;
  function sb() {
    if (!client) client = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'xt-sb-auth' }
    });
    return client;
  }
  function check(res) { if (res && res.error) throw res.error; return res; }

  // ---------- row mapping ----------
  var uid = null, user = null;
  // Data for storage: files are kept as paths, not as data URLs or signed links.
  function cleanTx(t) { var o = clone(t); o.att = (o.att || []).map(function (x) { var y = Object.assign({}, x); if (y.path) delete y.url; return y; }); return o; }
  function cleanAcc(a) { var o = clone(a); if (o.det && o.det.qrPath) delete o.det.qr; return o; }
  var map = {
    accounts: function (a) {
      return { user_id: uid, id: a.id, name: a.name || 'Account', type: ['bank', 'wallet', 'cash', 'card'].indexOf(a.type) > -1 ? a.type : 'bank',
        opening_balance: Number(a.open) || 0, archived: !!a.archived, savings: !!a.sav, data: cleanAcc(a) };
    },
    commitments: function (c) {
      return { user_id: uid, id: c.id, name: c.name || 'Plan', type: CTYPES.indexOf(c.type) > -1 ? c.type : 'Other', amount: Number(c.amt) > 0 ? Number(c.amt) : 1,
        variable: !!c.variable, category: c.cat || 'other', account_id: nz(c.acc), due_day: day(c.due),
        total_instalments: c.total == null ? null : Number(c.total), instalments_paid: Number(c.done) || 0, lender: nz(c.lender),
        remind_days: Number.isFinite(+c.remind) ? +c.remind : 2, paid_dates: c.paid || [], skipped_dates: c.skip || [], data: clone(c) };
    },
    incomes: function (r) {
      return { user_id: uid, id: r.id, name: r.name || 'Income', amount: Number(r.amt) > 0 ? Number(r.amt) : 1, account_id: nz(r.acc), day: day(r.day), data: clone(r) };
    },
    transactions: function (t) {
      return { user_id: uid, id: t.id, type: TTYPES.indexOf(t.type) > -1 ? t.type : 'adj', amount: Number(t.amt) || 0, account_id: t.acc || 'cash', to_account_id: nz(t.to),
        category: nz(t.cat), person: nz(t.person), note: nz(t.note), date: t.date, commitment_id: nz(t.cid), linked_id: nz(t.lk),
        attachments: (t.att || []).map(function (x) { return { id: x.id, label: x.label, name: x.name || null, pdf: !!x.pdf, path: x.path || null }; }),
        data: cleanTx(t) };
    }
  };
  // Rows written by the older version of the app have no "data"; rebuild from columns.
  var legacy = {
    accounts: function (r) { var a = { id: r.id, name: r.name, type: r.type, open: num(r.opening_balance) }; if (r.archived) a.archived = true; if (r.savings) a.sav = true; return a; },
    commitments: function (r) {
      var c = { id: r.id, name: r.name, type: r.type, amt: num(r.amount), cat: r.category, acc: r.account_id, due: r.due_day, remind: r.remind_days, paid: r.paid_dates || [], skip: r.skipped_dates || [] };
      if (r.variable) c.variable = true;
      if (r.total_instalments != null) { c.total = r.total_instalments; c.done = r.instalments_paid || 0; }
      if (r.lender) c.lender = r.lender;
      return c;
    },
    incomes: function (r) { return { id: r.id, name: r.name, amt: num(r.amount), acc: r.account_id, day: r.day, cal: 'ad', src: 'salary', got: [], skip: [], snooze: null }; },
    transactions: function (r) {
      var t = { id: r.id, type: r.type, amt: num(r.amount), acc: r.account_id, date: r.date, note: r.note || '', att: (r.attachments || []).map(function (x) { return { id: x.id, label: x.label, name: x.name, pdf: !!x.pdf, path: x.path }; }) };
      if (r.to_account_id) t.to = r.to_account_id; if (r.category) t.cat = r.category; if (r.person) t.person = r.person;
      if (r.commitment_id) t.cid = r.commitment_id; if (r.linked_id) t.lk = r.linked_id;
      return t;
    }
  };
  function fromRow(tbl, r) { return r.data && r.data.id ? r.data : legacy[tbl](r); }
  function profRow(S) {
    var set = clone(S.set || {});
    return { user_id: uid, name: set.name || (user && user.name) || '', month_start: 1, default_account: nz(set.def),
      theme: ['light', 'dark', 'system'].indexOf(set.theme) > -1 ? set.theme : 'light',
      budget_total: Number(S.bud && S.bud.all) || 0, budget_categories: (S.bud && S.bud.cat) || {}, settings: set };
  }

  // ---------- cloud sync ----------
  var snap = null, latest = null, timer = null, chain = Promise.resolve(), retry = null;
  function filePaths(S) {
    var p = new Set();
    S.tx.forEach(function (t) { (t.att || []).forEach(function (x) { if (x.path) p.add(x.path); }); });
    S.acc.forEach(function (a) { if (a.det && a.det.qrPath) p.add(a.det.qrPath); });
    return p;
  }
  function snapshot(S) {
    var s = { profile: JSON.stringify(profRow(S)), paths: filePaths(S) };
    TABLES.forEach(function (tbl) { s[tbl] = new Map(); (S[KEYS[tbl]] || []).forEach(function (it) { s[tbl].set(it.id, JSON.stringify(map[tbl](it))); }); });
    return s;
  }
  async function upload(dataUrl, path) {
    var blob = await (await fetch(dataUrl)).blob();
    check(await sb().storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' }));
    return path;
  }
  var ext = function (u) { var m = /^data:([^;,]+)/.exec(u || ''); var t = m ? m[1] : ''; return t === 'image/svg+xml' ? 'svg' : t === 'application/pdf' ? 'pdf' : (t.split('/')[1] || 'bin'); };

  async function flush() {
    var S = latest; if (!S || !snap || !uid) return;
    var db = sb();
    // 1. upload new files (bills and slips, QR codes)
    for (var i = 0; i < S.tx.length; i++) {
      var att = S.tx[i].att || [];
      for (var j = 0; j < att.length; j++) {
        var x = att[j];
        if (!x.path && x.url && x.url.indexOf('data:') === 0) {
          var safe = String(x.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
          x.path = await upload(x.url, uid + '/' + x.id + '-' + safe);
        }
      }
    }
    for (var a = 0; a < S.acc.length; a++) {
      var d = S.acc[a].det;
      if (d && d.qr && d.qr.indexOf('data:') === 0 && !d.qrPath) d.qrPath = await upload(d.qr, uid + '/qr-' + S.acc[a].id + '-' + Date.now().toString(36) + '.' + ext(d.qr));
      if (d && !d.qr && d.qrPath) delete d.qrPath;
    }
    // 2. upserts (parents first)
    for (var k = 0; k < TABLES.length; k++) {
      var tbl = TABLES[k], rows = (S[KEYS[tbl]] || []).map(map[tbl]);
      var changed = rows.filter(function (r) { return snap[tbl].get(r.id) !== JSON.stringify(r); });
      for (var b = 0; b < changed.length; b += 500) check(await db.from(tbl).upsert(changed.slice(b, b + 500), { onConflict: 'user_id,id' }));
    }
    var prof = profRow(S);
    if (JSON.stringify(prof) !== snap.profile) check(await db.from('profiles').upsert(prof, { onConflict: 'user_id' }));
    // 3. deletes (children first)
    for (var n = TABLES.length - 1; n >= 0; n--) {
      var t2 = TABLES[n], ids = new Set((S[KEYS[t2]] || []).map(function (it) { return it.id; }));
      var gone = Array.from(snap[t2].keys()).filter(function (id) { return !ids.has(id); });
      if (gone.length) check(await db.from(t2).delete().eq('user_id', uid).in('id', gone));
    }
    // 4. remove files no longer used
    var next = snapshot(S);
    var orphan = Array.from(snap.paths).filter(function (p) { return !next.paths.has(p); });
    if (orphan.length) await db.storage.from(BUCKET).remove(orphan);
    snap = next;
  }
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      chain = chain.then(flush).then(function () {
        clearTimeout(retry);
        var d = new Date();
        setStatus('All changes saved · ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'));
      }).catch(function (e) {
        console.error('Sync failed', e);
        setStatus('Couldn’t back up: ' + friendly(e) + ' Retrying…');
        clearTimeout(retry);
        retry = setTimeout(function () { schedule(0); }, 8000);
      });
    }, delay);
  }
  async function fetchAll(tbl) {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var res = check(await sb().from(tbl).select('*').eq('user_id', uid).order('created_at', { ascending: true }).order('id').range(from, from + size - 1));
      out = out.concat(res.data || []);
      if (!res.data || res.data.length < size) return out;
      from += size;
    }
  }
  async function signFiles(S) {
    var paths = Array.from(filePaths(S));
    if (!paths.length) return;
    var byPath = {};
    for (var i = 0; i < paths.length; i += 200) {
      var signed = await sb().storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 200), 60 * 60 * 12);
      (signed.data || []).forEach(function (o) { if (o.signedUrl) byPath[o.path] = o.signedUrl; });
    }
    S.tx.forEach(function (t) { (t.att || []).forEach(function (x) { if (byPath[x.path]) x.url = byPath[x.path]; }); });
    S.acc.forEach(function (a) { if (a.det && byPath[a.det.qrPath]) a.det.qr = byPath[a.det.qrPath]; });
  }
  function userFrom(ses) {
    var u = ses.user, md = u.user_metadata || {}, prov = (u.app_metadata && u.app_metadata.provider) || 'email';
    return { id: u.id, email: u.email || md.email || '', name: md.full_name || md.name || '', method: prov === 'google' || prov === 'apple' ? prov : 'email' };
  }

  // ---------- public API ----------
  var Store = {
    mode: CLOUD ? 'cloud' : 'local',
    onStatus: function (f) { listeners.push(f); },
    statusText: function () { return statusText; },
    friendly: friendly,

    // Cloud only. Returns null when signed out, else { user, state }.
    // state is null when the account has no data yet (new user).
    boot: async function () {
      if (!CLOUD) return null;
      var ses = (await sb().auth.getSession()).data.session;
      if (!ses) return null;
      user = userFrom(ses); uid = user.id;
      var res = await Promise.all([sb().from('profiles').select('*').eq('user_id', uid).maybeSingle()].concat(TABLES.map(fetchAll)));
      var p = check(res[0]).data;
      if (p && p.name && !user.name) user.name = p.name;
      var S = { set: Object.assign({}, (p && p.settings) || {}), bud: { all: p ? num(p.budget_total) : 30000, cat: (p && p.budget_categories) || {} } };
      TABLES.forEach(function (tbl, i) { S[KEYS[tbl]] = res[i + 1].map(function (r) { return fromRow(tbl, r); }); });
      if (!S.set.theme && p) S.set.theme = p.theme;
      if (!S.set.def && p) S.set.def = p.default_account;
      snap = snapshot(S);
      if (!p) snap.profile = '';
      var empty = !(p && p.settings && Object.keys(p.settings).length) && !S.tx.length && !S.com.length && !S.inc.length;
      if (empty) return { user: user, state: null };
      await signFiles(S);
      setStatus('All changes saved');
      return { user: user, state: S };
    },

    // Start syncing S to the signed-in account (writes the differences now).
    adopt: function (S) { latest = S; setStatus('Backing up…'); schedule(0); },
    save: function (S) { if (!CLOUD || !uid) return; latest = S; setStatus('Saving…'); schedule(400); },
    flushNow: function () { if (CLOUD && uid && latest) { schedule(0); } return new Promise(function (r) { setTimeout(function () { chain.then(r, r); }, 10); }); },

    oauth: async function (provider) {
      var r = await sb().auth.signInWithOAuth({ provider: provider, options: { redirectTo: location.origin + location.pathname } });
      return r.error ? { error: friendly(r.error) } : { ok: true };
    },
    sendCode: async function (email) {
      var r = await sb().auth.signInWithOtp({ email: String(email).trim().toLowerCase(), options: { shouldCreateUser: true } });
      return r.error ? { error: friendly(r.error) } : { ok: true };
    },
    verifyCode: async function (email, code, name) {
      var r = await sb().auth.verifyOtp({ email: String(email).trim().toLowerCase(), token: String(code).trim(), type: 'email' });
      if (r.error) return { error: friendly(r.error) };
      if (name) await sb().auth.updateUser({ data: { name: name } });
      return { ok: true };
    },
    signOut: async function () {
      if (!CLOUD) return;
      try { await Store.flushNow(); } catch (e) {}
      try { await sb().auth.signOut({ scope: 'local' }); } catch (e) {}
      uid = null; user = null; snap = null; latest = null;
    },
    deleteAccount: async function () {
      var r = await sb().rpc('delete_my_account');
      if (r.error) return { error: friendly(r.error) };
      clearTimeout(timer); clearTimeout(retry); uid = null; user = null; snap = null; latest = null;
      try { await sb().auth.signOut({ scope: 'local' }); } catch (e) {}
      return { ok: true };
    }
  };

  if (CLOUD) {
    window.addEventListener('online', function () { if (latest && uid) schedule(0); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && latest && timer) schedule(0); });
  }
  window.Store = Store;
})();
