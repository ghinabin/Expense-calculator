/* Expense Calculator: wiring for login.html, register.html and reset.html */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function show(id, msg) { var el = $(id); if (!el) return; el.textContent = msg || ''; el.hidden = !msg; }
  function busy(btn, on, label) { btn.disabled = on; btn.textContent = on ? 'Please wait…' : label; }
  function pwIssues(pw) {
    var out = [];
    if (String(pw).length < 8) out.push('at least 8 characters');
    if (!/[A-Za-z]/.test(pw)) out.push('a letter');
    if (!/[0-9]/.test(pw)) out.push('a number');
    return out;
  }
  var EMAIL_RE = /^[^@ ]+@[^@ ]+[.][^@ .]+$/;
  function validEmail(e) { return EMAIL_RE.test(String(e).trim()); }

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body.dataset.page;
    var note = $('mode');
    if (note) note.textContent = Store.mode === 'cloud' ? 'Your data is saved securely to your account.' : 'Local mode: your data stays on this device.';

    document.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var input = $(b.dataset.toggle), vis = input.type === 'password';
        input.type = vis ? 'text' : 'password';
        b.textContent = vis ? 'Hide' : 'Show';
        b.setAttribute('aria-pressed', String(vis));
      });
    });

    if (page !== 'reset') Store.hasSession().then(function (yes) { if (yes) location.replace('index.html'); }).catch(function () {});

    if (page === 'login') {
      var btn = $('submit'), forgot = $('forgot');
      if (forgot) forgot.hidden = Store.mode !== 'cloud';
      if (forgot) forgot.addEventListener('click', function () {
        show('err'); show('ok');
        var email = $('email').value;
        if (!validEmail(email)) { show('err', 'Enter your email above, then tap “Forgot password?” again.'); $('email').focus(); return; }
        forgot.disabled = true;
        Store.resetPassword(email).then(function (r) {
          forgot.disabled = false;
          if (r.error) show('err', r.error); else show('ok', 'If ' + email.trim() + ' has an account, a reset link is on its way. Check your inbox.');
        });
      });
      $('form').addEventListener('submit', function (ev) {
        ev.preventDefault(); show('err'); show('ok');
        var email = $('email').value, pw = $('password').value;
        if (!validEmail(email)) return show('err', 'Enter a valid email address.');
        if (!pw) return show('err', 'Enter your password.');
        busy(btn, true, 'Log in');
        Store.signIn(email, pw, $('remember').checked).then(function (r) {
          if (r.error) { busy(btn, false, 'Log in'); show('err', r.error); $('password').select(); return; }
          location.replace('index.html');
        });
      });
    }

    if (page === 'register') {
      var rbtn = $('submit'), pw = $('password'), hint = $('pwhint');
      pw.addEventListener('input', function () {
        var issues = pwIssues(pw.value);
        hint.textContent = pw.value ? (issues.length ? 'Needs ' + issues.join(', ') + '.' : 'Strong enough.') : 'At least 8 characters, with a letter and a number.';
        hint.classList.toggle('good', !!pw.value && !issues.length);
      });
      $('form').addEventListener('submit', function (ev) {
        ev.preventDefault(); show('err'); show('ok');
        var name = $('name').value.trim(), email = $('email').value, p1 = pw.value, p2 = $('confirm').value;
        if (name.length < 2) return show('err', 'Enter your name.');
        if (!validEmail(email)) return show('err', 'Enter a valid email address.');
        var issues = pwIssues(p1);
        if (issues.length) return show('err', 'Password needs ' + issues.join(', ') + '.');
        if (p1 !== p2) return show('err', 'Passwords do not match.');
        busy(rbtn, true, 'Create account');
        Store.signUp(name, email, p1).then(function (r) {
          if (r.error) { busy(rbtn, false, 'Create account'); return show('err', r.error); }
          if (r.needsConfirm) {
            busy(rbtn, false, 'Create account'); rbtn.hidden = true;
            show('ok', 'Almost done. We sent a confirmation link to ' + email.trim() + '. Open it, then log in.');
            return;
          }
          location.replace('index.html');
        });
      });
    }

    if (page === 'reset') {
      var sbtn = $('submit');
      $('form').addEventListener('submit', function (ev) {
        ev.preventDefault(); show('err'); show('ok');
        var p1 = $('password').value, p2 = $('confirm').value, issues = pwIssues(p1);
        if (issues.length) return show('err', 'Password needs ' + issues.join(', ') + '.');
        if (p1 !== p2) return show('err', 'Passwords do not match.');
        busy(sbtn, true, 'Save new password');
        Store.updatePassword(p1).then(function (r) {
          if (r.error) { busy(sbtn, false, 'Save new password'); return show('err', r.error + ' The link may have expired; request a new one from the login page.'); }
          show('ok', 'Password updated. Opening the app…');
          setTimeout(function () { location.replace('index.html'); }, 900);
        });
      });
    }
  });
})();
