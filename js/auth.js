/* Expense Calculator: accounts, login and registration.
   This is client-side only: users and sessions live in this browser's storage,
   and passwords are kept as SHA-256 hashes, never as plain text.
   Swap these functions for real API calls when a backend is added. */
(function () {
  'use strict';

  // ---- SHA-256 (pure JS, works on file:// and http) ----
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32), i, j, result = '';
    var words = [], bitLen = ascii.length * 8;
    var hash = [], k = [], pc = 0, isComposite = {};
    for (var c = 2; pc < 64; c++) {
      if (!isComposite[c]) {
        for (i = 0; i < 313; i += c) isComposite[i] = c;
        hash[pc] = (Math.pow(c, 0.5) * maxWord) | 0;
        k[pc++] = (Math.pow(c, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += String.fromCharCode(128);
    while (ascii.length % 64 - 56) ascii += String.fromCharCode(0);
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (bitLen / maxWord) | 0;
    words[words.length] = bitLen;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), old = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
    return result;
  }

  var USERS = 'xt-users', SESSION = 'xt-session';
  var norm = function (e) { return String(e || '').trim().toLowerCase(); };
  var hashPw = function (email, pw) { return sha256(unescape(encodeURIComponent(norm(email) + ':' + pw))); };
  var EMAIL_RE = /^[^@ ]+@[^@ ]+[.][^@ .]+$/;

  // Demo account (password stored only as a hash)
  var DEMO = { name: '', email: 'ghinabin@gmail.com', hash: '1a54e161616760b4f6275cf6736799ce231ac754fc2d44d44901df112d281f7a', demo: true };

  function read(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }
  function write(store, key, v) { try { store.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function users() {
    var list = read(localStorage, USERS) || [];
    if (!list.some(function (u) { return u.email === DEMO.email; })) list.unshift(DEMO);
    return list;
  }

  function startSession(u, remember) {
    var s = { email: u.email, name: u.name || '', demo: !!u.demo, at: Date.now() };
    try { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); } catch (e) {}
    write(remember ? localStorage : sessionStorage, SESSION, s);
    return s;
  }

  var Auth = {
    validEmail: function (e) { return EMAIL_RE.test(norm(e)); },
    passwordIssues: function (pw) {
      var out = [];
      if (String(pw).length < 8) out.push('at least 8 characters');
      if (!/[A-Za-z]/.test(pw)) out.push('a letter');
      if (!/[0-9]/.test(pw)) out.push('a number');
      return out;
    },
    login: function (email, pw, remember) {
      var u = users().find(function (x) { return x.email === norm(email); });
      if (!u || u.hash !== hashPw(email, pw)) return null;
      return startSession(u, remember);
    },
    register: function (name, email, pw) {
      var list = users();
      if (list.some(function (x) { return x.email === norm(email); })) return { error: 'An account with this email already exists. Log in instead.' };
      var u = { name: String(name).trim(), email: norm(email), hash: hashPw(email, pw), at: Date.now() };
      list.push(u);
      if (!write(localStorage, USERS, list)) return { error: 'Could not save your account in this browser.' };
      return { session: startSession(u, true) };
    },
    current: function () { return read(sessionStorage, SESSION) || read(localStorage, SESSION); },
    logout: function () { try { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); } catch (e) {} }
  };
  window.Auth = Auth;

  // ---- Page wiring for login.html and register.html ----
  function $(id) { return document.getElementById(id); }
  function showError(msg) { var el = $('err'); el.textContent = msg; el.hidden = !msg; }
  function busy(btn, on, label) { btn.disabled = on; btn.textContent = on ? 'Please wait…' : label; }
  function bindToggles() {
    document.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var input = $(b.dataset.toggle), show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.textContent = show ? 'Hide' : 'Show';
        b.setAttribute('aria-pressed', String(show));
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body.dataset.page;
    if (!page) return;
    if (Auth.current()) { location.replace('index.html'); return; }
    bindToggles();

    if (page === 'login') {
      var f = $('form'), btn = $('submit');
      f.addEventListener('submit', function (ev) {
        ev.preventDefault(); showError('');
        var email = $('email').value, pw = $('password').value;
        if (!Auth.validEmail(email)) return showError('Enter a valid email address.');
        if (!pw) return showError('Enter your password.');
        busy(btn, true, 'Log in');
        setTimeout(function () {
          var s = Auth.login(email, pw, $('remember').checked);
          if (!s) { busy(btn, false, 'Log in'); showError('Email or password is incorrect.'); $('password').select(); return; }
          location.replace('index.html');
        }, 350);
      });
    }

    if (page === 'register') {
      var rf = $('form'), rbtn = $('submit'), pw = $('password'), hint = $('pwhint');
      pw.addEventListener('input', function () {
        var issues = Auth.passwordIssues(pw.value);
        hint.textContent = pw.value ? (issues.length ? 'Needs ' + issues.join(', ') + '.' : 'Strong enough.') : 'At least 8 characters, with a letter and a number.';
        hint.classList.toggle('ok', !!pw.value && !issues.length);
      });
      rf.addEventListener('submit', function (ev) {
        ev.preventDefault(); showError('');
        var name = $('name').value.trim(), email = $('email').value, p1 = pw.value, p2 = $('confirm').value;
        if (name.length < 2) return showError('Enter your name.');
        if (!Auth.validEmail(email)) return showError('Enter a valid email address.');
        var issues = Auth.passwordIssues(p1);
        if (issues.length) return showError('Password needs ' + issues.join(', ') + '.');
        if (p1 !== p2) return showError('Passwords do not match.');
        busy(rbtn, true, 'Create account');
        setTimeout(function () {
          var r = Auth.register(name, email, p1);
          if (r.error) { busy(rbtn, false, 'Create account'); return showError(r.error); }
          location.replace('index.html');
        }, 350);
      });
    }
  });
})();
