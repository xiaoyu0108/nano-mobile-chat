/* ============================================================
   账号 / 设备会话 / 导入权限
   - 进入应用先登录；一个账号一个密码
   - 同一账号最多 3 台设备在线，第 4 台自动顶掉最久未活动的一台
   - 同一浏览器最多保存 3 个账号，可切换
   - 设备列表里可下线单台设备或全部其他设备
   - 导入角色卡 / 世界书 / 规则等默认仅管理员可用；
     管理员可在隐藏页一键放开给所有登录用户
   - 需要 push-worker 已部署 /account/* 与 /gate/* 路由
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoAccount) return;

  var API_DEFAULT = 'https://nanopush.nano315.online';
  var LS_TOKEN = 'nano_account_token';
  var LS_USER = 'nano_account_user';
  var LS_SID = 'nano_account_sid';
  var LS_SESS = 'nano_account_sessions';
  var LS_ROLE = 'nano_account_role';
  var LS_POLICY = 'nano_account_policy';
  var LS_CHECKED = 'nano_account_checked_at';
  var LS_DEVICE = 'nano_account_device';
  var LS_NEEDS = 'nano_account_needs_activation';
  var LS_API = 'nano_account_api';
  var SESSION_VERIFY_MS = 0;

  var overlayEl = null;
  var toastEl = null;
  var toastTimer = null;

  function lsGet(k) {
    try { return localStorage.getItem(k) || ''; } catch (e) { return ''; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, String(v)); } catch (e) {}
  }
  function lsDel(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  }
  function readJSON(k, fallback) {
    try {
      var raw = lsGet(k);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rand(n) {
    var b = new Uint8Array(n || 16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }

  function apiBase() {
    var v = lsGet(LS_API) || API_DEFAULT;
    v = String(v || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(v)) v = API_DEFAULT;
    return v;
  }

  function applyServerParam() {
    try {
      var qs = new URLSearchParams(location.search);
      var s = String(qs.get('server') || '').trim().replace(/\/+$/, '');
      // 只有带 admin=1 的地址才允许写入，避免普通链接把人带到假服务器。
      if (s && qs.get('admin') === '1' && /^https?:\/\//i.test(s)) lsSet(LS_API, s);
    } catch (e) {}
  }

  function deviceId() {
    var id = lsGet('nano_device_id');
    if (!id) {
      id = 'dev_' + rand(10);
      lsSet('nano_device_id', id);
    }
    return id;
  }

  function deviceName() {
    var ua = navigator.userAgent || '';
    var os = '设备';
    if (/iPhone/.test(ua)) os = 'iPhone';
    else if (/iPad/.test(ua)) os = 'iPad';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Macintosh|Mac OS X/.test(ua)) os = 'Mac';
    else if (/Linux/.test(ua)) os = 'Linux';
    var br = '浏览器';
    if (/MicroMessenger/i.test(ua)) br = '微信';
    else if (/Edg\//.test(ua)) br = 'Edge';
    else if (/CriOS|Chrome\//.test(ua)) br = 'Chrome';
    else if (/FxiOS|Firefox\//.test(ua)) br = 'Firefox';
    else if (/Safari\//.test(ua)) br = 'Safari';
    return os + ' · ' + br;
  }

  function currentAuth() {
    var token = lsGet(LS_TOKEN);
    var username = lsGet(LS_USER);
    if (!token || !username) return null;
    return { token: token, username: username, sid: lsGet(LS_SID) };
  }

  function currentRole() {
    return lsGet(LS_ROLE) === 'admin' ? 'admin' : 'user';
  }
  function isAdmin() {
    return currentRole() === 'admin';
  }
  function currentPolicy() {
    var p = readJSON(LS_POLICY, null);
    return { allowUserImport: !!(p && p.allowUserImport === true) };
  }
  function applyPolicy(p) {
    if (!p || typeof p !== 'object') return;
    writeJSON(LS_POLICY, { allowUserImport: p.allowUserImport === true });
  }

  function currentDevice() {
    var d = readJSON(LS_DEVICE, null);
    return d && typeof d === 'object' ? d : null;
  }
  function needsActivation() {
    return lsGet(LS_NEEDS) === '1';
  }
  function applyAuth(data) {
    if (!data || !data.token || !data.username) return;
    lsSet(LS_TOKEN, data.token);
    lsSet(LS_USER, data.username);
    lsSet(LS_SID, data.sid || '');
    if (data.role) lsSet(LS_ROLE, data.role);
    if (data.policy) applyPolicy(data.policy);
    if (data.device) writeJSON(LS_DEVICE, data.device);
    lsSet(LS_NEEDS, data.needsActivation ? '1' : '0');
    lsSet(LS_CHECKED, Date.now());
    if (data.sessions) applySessions(data.sessions);
  }

  function applySessions(data) {
    if (data && Array.isArray(data.sessions)) writeJSON(LS_SESS, data.sessions);
    if (data && data.role) lsSet(LS_ROLE, data.role);
    if (data && data.policy) applyPolicy(data.policy);
    if (data && data.device) writeJSON(LS_DEVICE, data.device);
    if (data && typeof data.needsActivation !== 'undefined') lsSet(LS_NEEDS, data.needsActivation ? '1' : '0');
    lsSet(LS_CHECKED, Date.now());
  }

  function clearAuth() {
    lsDel(LS_TOKEN);
    lsDel(LS_USER);
    lsDel(LS_SID);
    lsDel(LS_ROLE);
    lsDel(LS_POLICY);
    lsDel(LS_SESS);
    lsDel(LS_CHECKED);
    lsDel(LS_DEVICE);
    lsDel(LS_NEEDS);
    try { localStorage.removeItem('nano_account_saved'); } catch (e) {}
  }

  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'nacc-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = String(msg || '');
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
  }

  function resetServer() {
    lsDel(LS_API);
    toast('已还原默认账号服务器');
  }

  function copyText(text) {
    text = String(text || '');
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }).catch(function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('已复制');
    } catch (e) { toast('复制失败，请手动选择'); }
  }

  function request(path, body, opts) {
    opts = opts || {};
    var controller = null;
    var timer = null;
    var init = {
      method: opts.method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json' }
    };
    if (init.method !== 'GET' && body !== undefined) init.body = JSON.stringify(body);
    if (opts.adminToken) init.headers['X-Admin-Token'] = String(opts.adminToken);
    try {
      if (window.AbortController) {
        controller = new AbortController();
        init.signal = controller.signal;
        timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, opts.timeout || 12000);
      }
    } catch (e) {}

    return fetch(apiBase() + path, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        var parseOk = true;
        try { data = text ? JSON.parse(text) : null; } catch (e) { parseOk = false; }
        if (!parseOk) {
          var bad = new Error('账号服务器返回了非 JSON。请检查服务器地址，或先部署 push-worker 的 /account/* 路由。');
          bad.status = res.status;
          throw bad;
        }
        if (!res.ok || !data || data.ok !== true) {
          var err = new Error((data && data.error) || ('请求失败 HTTP ' + res.status));
          err.status = res.status;
          err.data = data || {};
          err.code = data && data.code;
          throw err;
        }
        return data;
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        var e2 = new Error('连接账号服务器超时');
        e2.status = 0;
        throw e2;
      }
      if (!err.status) {
        try { err.status = 0; } catch (e) {}
      }
      throw err;
    });
  }

  function login(username, password) {
    return request('/account/login', {
      username: username,
      password: password,
      deviceId: deviceId(),
      deviceName: deviceName(),
      ua: navigator.userAgent || ''
    }).then(function (data) {
      if (!data || !data.token || !data.username) {
        throw new Error('账号服务器返回异常：没有拿到登录凭证');
      }
      applyAuth(data);
      return data;
    });
  }

  function register(username, password, invite) {
    return request('/account/register', {
      username: username,
      password: password,
      invite: invite || '',
      deviceId: deviceId(),
      deviceName: deviceName(),
      ua: navigator.userAgent || ''
    }).then(function (data) {
      if (!data || !data.token || !data.username) {
        throw new Error('账号服务器返回异常：没有拿到登录凭证');
      }
      applyAuth(data);
      return data;
    });
  }

  function refreshSessions() {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/sessions', { token: auth.token }).then(function (data) {
      applySessions(data);
      return data;
    });
  }

  function logout() {
    var auth = currentAuth();
    if (!auth) return Promise.resolve();
    return request('/account/logout', { token: auth.token }).catch(function () {}).then(function () {
      clearAuth();
    });
  }

  function logoutOthers() {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/logout-others', { token: auth.token }).then(function (data) {
      applySessions(data);
      return data;
    });
  }

  function logoutDevice(sid) {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/logout-device', { token: auth.token, sid: sid }).then(function (data) {
      applySessions(data);
      return data;
    });
  }

  function activateDevice(code) {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('请先登录账号'));
    return request('/account/activate-device', { token: auth.token, code: code }).then(function (data) {
      if (data.device) writeJSON(LS_DEVICE, data.device);
      lsSet(LS_NEEDS, '0');
      return data;
    });
  }

  function exitAdmin() {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/admin-exit', { token: auth.token }).then(function (data) {
      lsSet(LS_ROLE, 'user');
      return data;
    });
  }

  function adminDevices() {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/admin/devices', { token: auth.token });
  }
  function adminDeviceKey(deviceCode, force) {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/admin/device-key', { token: auth.token, deviceCode: deviceCode, force: !!force });
  }
  function adminDeviceRevoke(deviceCode) {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/admin/device-revoke', { token: auth.token, deviceCode: deviceCode });
  }
  function adminUsers() {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/admin/users', { token: auth.token });
  }
  function adminKick(username) {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/admin/kick', { token: auth.token, username: username });
  }
  function adminBan(username, banned) {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/admin/ban', { token: auth.token, username: username, banned: !!banned });
  }

  function checkImport(opts) {
    opts = opts || {};
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('请先登录账号'));
    var needActivation = opts.needActivation !== false;
    return request('/gate/check', { token: auth.token, needActivation: needActivation }).then(function (data) {
      if (data.role) lsSet(LS_ROLE, data.role);
      if (data.policy) applyPolicy(data.policy);
      if (data.device) writeJSON(LS_DEVICE, data.device);
      if (typeof data.needsActivation !== 'undefined') lsSet(LS_NEEDS, data.needsActivation ? '1' : '0');
      return data;
    });
  }

  function claimAdmin(adminToken) {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('请先登录账号'));
    return request('/account/admin-claim', { token: auth.token, adminToken: adminToken }).then(function (data) {
      lsSet(LS_ROLE, 'admin');
      return data;
    });
  }

  function setUserImportPolicy(allow) {
    var auth = currentAuth();
    if (!auth) return Promise.reject(new Error('未登录'));
    return request('/account/admin/policy', { token: auth.token, allowUserImport: !!allow }).then(function (data) {
      applyPolicy(data.policy);
      return data;
    });
  }

  function resetAccount(adminToken, username) {
    var auth = currentAuth();
    return request('/account/admin-reset', {
      token: auth ? auth.token : '',
      adminToken: adminToken || '',
      username: username
    }, { adminToken: adminToken || '' });
  }

  function overlay(html, opts) {
    opts = opts || {};
    if (overlayEl) return null;
    var el = document.createElement('div');
    el.className = 'nacc-overlay';
    el.innerHTML = html;
    document.body.appendChild(el);
    overlayEl = el;
    var closeBtn = el.querySelector('[data-nacc-close]');
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (el.parentNode) el.parentNode.removeChild(el);
      if (overlayEl === el) overlayEl = null;
      if (opts.onClose) { try { opts.onClose(); } catch (e) {} }
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        close();
        if (opts.onCancel) { try { opts.onCancel(); } catch (e) {} }
      });
    }
    el.addEventListener('click', function (e) {
      if (e.target === el && opts.dismiss !== false) {
        close();
        if (opts.onCancel) { try { opts.onCancel(); } catch (e) {} }
      }
    });
    return { el: el, close: close };
  }

  function loginOverlay(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var mode = 'login';
      var html = '' +
        '<div class="nacc-card" role="dialog" aria-modal="true">' +
          '<div class="nacc-head">' +
            (opts.force ? '' : '<button type="button" class="nacc-close" data-nacc-close aria-label="关闭">×</button>') +
            '<h2 class="nacc-title">' + (opts.force ? '登录后继续' : '账号登录') + '</h2>' +
            '<div class="nacc-sub">' + esc(opts.reason || '一个账号对应一个密码；同一账号最多 3 台设备在线。') + '</div>' +
          '</div>' +
          '<div class="nacc-body">' +
            '<div class="nacc-tabs">' +
              '<button type="button" class="nacc-tab active" data-mode="login">登录</button>' +
              '<button type="button" class="nacc-tab" data-mode="register">注册</button>' +
            '</div>' +
            '<div class="nacc-error" id="naccErr"></div>' +
            '<div class="nacc-actions" style="margin:-4px 0 8px">' +
              '<button type="button" class="nacc-btn nacc-btn-soft" id="naccResetServerBtn" style="min-height:30px;padding:0 10px;font-size:11px">还原默认</button>' +
              '<button type="button" class="nacc-btn nacc-btn-soft" id="naccServerBtn" style="min-height:30px;padding:0 10px;font-size:11px">服务器设置</button>' +
            '</div>' +
            '<div id="naccForm"></div>' +
          '</div>' +
        '</div>';
      var ui = overlay(html, {
        dismiss: !opts.force,
        onCancel: function () { resolve(false); }
      });
      if (!ui) { resolve(false); return; }
      var errEl = ui.el.querySelector('#naccErr');
      var formEl = ui.el.querySelector('#naccForm');
      var serverBtn = ui.el.querySelector('#naccServerBtn');
      if (serverBtn) serverBtn.addEventListener('click', function () {
        var v = window.prompt('账号服务器地址（push-worker 地址）', apiBase());
        if (v === null) return;
        v = String(v || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(v)) { showErr('服务器地址必须以 http:// 或 https:// 开头'); return; }
        lsSet(LS_API, v);
        showErr('');
        toast('已保存服务器地址，请重新登录');
      });
      var resetServerBtn = ui.el.querySelector('#naccResetServerBtn');
      if (resetServerBtn) resetServerBtn.addEventListener('click', function () {
        resetServer();
        showErr('');
      });

      function showErr(msg) {
        errEl.textContent = msg || '';
        errEl.classList.toggle('show', !!msg);
      }

      function renderForm() {
        showErr('');
        ui.el.querySelectorAll('[data-mode]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-mode') === mode);
        });
        if (mode === 'login') {
          formEl.innerHTML = '' +
            '<label class="nacc-field"><span class="nacc-field-label">账号</span>' +
              '<input class="nacc-input" id="naccUser" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="用户名"></label>' +
            '<label class="nacc-field"><span class="nacc-field-label">密码</span>' +
              '<input class="nacc-input" id="naccPass" type="password" autocomplete="current-password" placeholder="密码"></label>' +
            '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-primary" id="naccSubmit">登录</button></div>' +
            '<p class="nacc-hint">忘记密码无法在本机找回；请联系管理员在管理页删除账号后重新注册。</p>';
        } else {
          formEl.innerHTML = '' +
            '<label class="nacc-field"><span class="nacc-field-label">账号</span>' +
              '<input class="nacc-input" id="naccUser" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="2-24 位，可用中英文、数字、_ . -"></label>' +
            '<label class="nacc-field"><span class="nacc-field-label">密码</span>' +
              '<input class="nacc-input" id="naccPass" type="password" autocomplete="new-password" placeholder="至少 6 位"></label>' +
            '<label class="nacc-field"><span class="nacc-field-label">确认密码</span>' +
              '<input class="nacc-input" id="naccPass2" type="password" autocomplete="new-password" placeholder="再输入一次"></label>' +
            '<label class="nacc-field"><span class="nacc-field-label">注册邀请码（如果服务器开启了）</span>' +
              '<input class="nacc-input" id="naccInvite" autocapitalize="none" spellcheck="false" placeholder="没有就留空"></label>' +
            '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-primary" id="naccSubmit">注册并登录</button></div>';
        }
        var submit = formEl.querySelector('#naccSubmit');
        submit.addEventListener('click', function () { submitForm(submit); });
        formEl.querySelectorAll('input').forEach(function (inp) {
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); submitForm(submit); }
          });
        });
      }

      function submitForm(btn) {
        var username = (formEl.querySelector('#naccUser').value || '').trim();
        var password = formEl.querySelector('#naccPass').value || '';
        if (!username) { showErr('请输入账号'); return; }
        if (!password) { showErr('请输入密码'); return; }
        if (mode === 'register') {
          var p2 = formEl.querySelector('#naccPass2').value || '';
          if (password.length < 6) { showErr('密码至少 6 位'); return; }
          if (password !== p2) { showErr('两次输入的密码不一致'); return; }
        }
        var invite = mode === 'register' ? (formEl.querySelector('#naccInvite').value || '').trim() : '';
        btn.disabled = true;
        btn.textContent = mode === 'register' ? '注册中…' : '登录中…';
        var task = mode === 'register' ? register(username, password, invite) : login(username, password);
        task.then(function (data) {
          ui.close();
          toast('已登录：' + data.username + (data.needsActivation ? '（本机未激活，PNG 导入前需激活）' : ''));
          resolve(true);
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = mode === 'register' ? '注册并登录' : '登录';
          var msg = (err && err.message) || '请求失败';
          if (err && err.status === 404) msg = '账号服务未部署：请先在 push-worker 中部署 /account/* 路由。';
          showErr(msg + '\n服务器：' + apiBase());
        });
      }

      ui.el.querySelectorAll('[data-mode]').forEach(function (b) {
        b.addEventListener('click', function () {
          mode = b.getAttribute('data-mode');
          renderForm();
        });
      });
      renderForm();
      setTimeout(function () {
        var u = ui.el.querySelector('#naccUser');
        if (u) u.focus({ preventScroll: true });
      }, 80);
    });
  }

  function activationOverlay(message) {
    return new Promise(function (resolve) {
      var html = '' +
        '<div class="nacc-card" role="dialog" aria-modal="true">' +
          '<div class="nacc-head">' +
            '<button type="button" class="nacc-close" data-nacc-close aria-label="关闭">×</button>' +
            '<h2 class="nacc-title">激活本机</h2>' +
            '<div class="nacc-sub">' + esc(message || '把本机设备码发给管理员，拿到激活码后在这里输入。') + '</div>' +
          '</div>' +
          '<div class="nacc-body">' +
            '<div class="nacc-error" id="naccActErr"></div>' +
            '<label class="nacc-field"><span class="nacc-field-label">管理员给你的激活码</span>' +
              '<input class="nacc-input" id="naccActCode" autocapitalize="characters" spellcheck="false" placeholder="ACT-XXXX-XXXX"></label>' +
            '<div class="nacc-actions">' +
              '<button type="button" class="nacc-btn nacc-btn-ghost" id="naccActCancel">取消</button>' +
              '<button type="button" class="nacc-btn nacc-btn-primary" id="naccActOk">激活本机</button>' +
            '</div>' +
            '<p class="nacc-hint">设备码在「设置 → 账号与设备 → 本机设备与导入授权」里。激活码只由管理员生成。PNG 图片导入需要激活，并且只允许导入作者允许导入的文件。</p>' +
          '</div>' +
        '</div>';
      var ui = overlay(html, { onCancel: function () { resolve(false); } });
      if (!ui) { resolve(false); return; }
      var errEl = ui.el.querySelector('#naccActErr');
      var input = ui.el.querySelector('#naccActCode');
      var ok = ui.el.querySelector('#naccActOk');
      function showErr(msg) {
        errEl.textContent = msg || '';
        errEl.classList.toggle('show', !!msg);
      }
      ui.el.querySelector('#naccActCancel').addEventListener('click', function () {
        ui.close();
        resolve(false);
      });
      function submit() {
        var code = (input.value || '').trim().toUpperCase();
        if (!code) { showErr('请输入管理员给你的激活码'); return; }
        ok.disabled = true;
        ok.textContent = '激活中…';
        activateDevice(code).then(function () {
          ui.close();
          toast('本机已激活');
          resolve(true);
        }).catch(function (err) {
          ok.disabled = false;
          ok.textContent = '激活本机';
          showErr((err && err.message) || '激活失败');
        });
      }
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      setTimeout(function () { input.focus({ preventScroll: true }); }, 80);
    });
  }

  function noticeOverlay(title, message) {
    return new Promise(function (resolve) {
      var html = '' +
        '<div class="nacc-card" role="dialog" aria-modal="true">' +
          '<div class="nacc-head"><h2 class="nacc-title">' + esc(title) + '</h2></div>' +
          '<div class="nacc-body">' +
            '<p class="nacc-section-desc" style="font-size:12.5px;line-height:1.7;margin:0 0 14px">' + esc(message) + '</p>' +
            '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-primary" id="naccNoticeOk">知道了</button></div>' +
          '</div>' +
        '</div>';
      var ui = overlay(html, { onCancel: function () { resolve(false); } });
      if (!ui) { resolve(false); return; }
      ui.el.querySelector('#naccNoticeOk').addEventListener('click', function () {
        ui.close();
        resolve(false);
      });
    });
  }

  function confirmImportPolicy() {
    var KEY = 'nano_import_policy_ack_v1';
    try { if (sessionStorage.getItem(KEY) === '1') return Promise.resolve(true); } catch (e) {}
    return new Promise(function (resolve) {
      var html = '' +
        '<div class="nacc-card" role="dialog" aria-modal="true">' +
          '<div class="nacc-head"><h2 class="nacc-title">导入须知</h2>' +
          '<div class="nacc-sub">文件导入 / PNG 导入前请确认</div></div>' +
          '<div class="nacc-body">' +
            '<p class="nacc-section-desc" style="font-size:12.5px;line-height:1.8;margin:0 0 14px">' +
              '只允许导入<strong>作者明确允许导入</strong>、且你有权使用的文件与资源。' +
              '未经作者允许，<strong>不得私自导入、搬运、二传、转售或公开分享</strong>任何角色卡、世界书、规则、图片与资源；' +
              '也不得绕过作者的授权限制。继续即表示你已获得相应授权，并自行承担由此产生的责任。' +
            '</p>' +
            '<div class="nacc-actions">' +
              '<button type="button" class="nacc-btn nacc-btn-ghost" id="naccPolicyCancel">取消</button>' +
              '<button type="button" class="nacc-btn nacc-btn-primary" id="naccPolicyOk">我已知晓，继续</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      var ui = overlay(html, { onCancel: function () { resolve(false); } });
      if (!ui) { resolve(true); return; }
      ui.el.querySelector('#naccPolicyCancel').addEventListener('click', function () {
        ui.close();
        resolve(false);
      });
      ui.el.querySelector('#naccPolicyOk').addEventListener('click', function () {
        try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
        ui.close();
        resolve(true);
      });
    });
  }

  function ensureImport(opts) {
    opts = opts || {};
    var needActivation = opts.needActivation === true;
    function attempt(retry) {
      if (!currentAuth()) {
        return loginOverlay({ reason: '导入前请先登录账号。' }).then(function (ok) {
          if (!ok) return false;
          return attempt(false);
        });
      }
      return checkImport({ needActivation: needActivation }).then(function () {
        return confirmImportPolicy();
      }).catch(function (err) {
        if (err && err.status === 401 && retry) {
          clearAuth();
          return loginOverlay({ reason: '登录已失效，请重新登录后再导入。' }).then(function (ok) {
            if (!ok) return false;
            return attempt(false);
          });
        }
        if (err && err.code === 'DEVICE_LOCKED') {
          var lockMsg = (err && err.message) || '本机还没有获得导入授权。';
          var lockedCode = err && err.data && err.data.device && err.data.device.deviceCode;
          if (lockedCode) lockMsg += ' 本机设备码：' + lockedCode;
          return activationOverlay(lockMsg).then(function (ok) {
            if (!ok) return false;
            return attempt(false);
          });
        }
        if (err && (err.status === 403 || err.code === 'IMPORT_FORBIDDEN')) {
          var denyMsg = (err.message || '当前账号没有导入权限，请联系管理员。') +
            '\n\n提醒：只允许导入作者明确允许导入、且你有权使用的文件；未经作者允许，不得私自导入、搬运、二传、转售或公开分享任何角色卡、世界书、规则、图片与资源。';
          return noticeOverlay('没有导入权限', denyMsg).then(function () { return false; });
        }
        toast((err && err.message) || '无法连接账号服务器，暂不能导入');
        return false;
      });
    }
    return attempt(true);
  }

  var gateStarted = false;
  function maybeGate() {
    if (gateStarted) return;
    gateStarted = true;
    var auth = currentAuth();
    if (!auth) {
      loginOverlay({ force: true, reason: '请登录后继续。首次使用请先注册。' });
      return;
    }
    // 每次打开应用校验一次会话（1 个请求）；下线设备后，对方下次打开就会要求重新登录。
    var last = Number(lsGet(LS_CHECKED) || 0);
    if (last && Date.now() - last < SESSION_VERIFY_MS) return;
    refreshSessions().catch(function (err) {
      if (err && err.status === 401) {
        clearAuth();
        loginOverlay({ force: true, reason: '登录已失效，请重新登录。' });
      }
      // 网络失败时允许先进入本机；数据本来就在本机。
    });
  }

  function waitAdultThenGate() {
    if (window.NanoAdultGate && NanoAdultGate.accepted && NanoAdultGate.accepted()) {
      maybeGate();
      return;
    }
    document.addEventListener('nano-adult-accepted', maybeGate, { once: true });
  }

  /* ==================== 账号中心页面 ==================== */
  function pageSection(title, desc, inner) {
    return '<section class="nacc-section">' +
      '<div class="nacc-section-title">' + esc(title) + '</div>' +
      (desc ? '<p class="nacc-section-desc">' + desc + '</p>' : '') +
      inner +
      '</section>';
  }

  function fmtTime(ts) {
    if (!ts) return '未知';
    try {
      var d = new Date(Number(ts));
      var diff = Date.now() - d.getTime();
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return '未知'; }
  }

  function renderPage() {
    var root = document.getElementById('naccRoot');
    if (!root) return;
    var auth = currentAuth();
    var admin = isAdmin();
    var sessions = readJSON(LS_SESS, []);
    if (!Array.isArray(sessions)) sessions = [];
    var policy = currentPolicy();
    var showClaim = !admin && new URLSearchParams(location.search).get('admin') === '1';

    var profile = '';
    if (auth) {
      profile = '<div class="nacc-profile">' +
        '<div class="nacc-avatar">' + esc((auth.username || '?').slice(0, 1).toUpperCase()) + '</div>' +
        '<div class="nacc-profile-main"><div class="nacc-name">' + esc(auth.username) + '</div>' +
        '<div class="nacc-meta">' + (admin ? '管理员' : '普通用户') + ' · 当前设备：' + esc(deviceName()) + '</div></div>' +
        '<button type="button" class="nacc-mini-btn" id="naccLogout">退出</button>' +
        '</div>';
    } else {
      profile = '<div class="nacc-profile"><div class="nacc-avatar">?</div>' +
        '<div class="nacc-profile-main"><div class="nacc-name">未登录</div>' +
        '<div class="nacc-meta">登录后才能管理设备</div></div></div>' +
        '<div class="nacc-actions" style="margin-top:12px">' +
        '<button type="button" class="nacc-btn nacc-btn-primary" id="naccLogin">登录 / 注册</button></div>';
    }

    var dev = currentDevice();
    var needs = needsActivation();
    var activationHtml = '';
    if (!auth) {
      activationHtml = pageSection('本机设备与导入授权', '登录后查看设备码和导入授权状态。',
        '<div class="nacc-empty">登录后显示</div>');
    } else {
      var inner = '';
      inner += '<div class="nacc-row"><div class="nacc-row-main">' +
        '<div class="nacc-row-label">本机设备码</div>' +
        '<div class="nacc-row-sub">把这个码发给管理员，用来申请导入授权</div></div>' +
        '<div class="nacc-row-value">' + esc(dev && dev.deviceCode ? dev.deviceCode : '读取中') + '</div>' +
        (dev && dev.deviceCode ? '<button type="button" class="nacc-mini-btn" data-copy="' + esc(dev.deviceCode) + '">复制</button>' : '') +
        '</div>';
      var statusText = admin ? '管理员账号可直接导入（无需激活码）' : (needs ? '未激活： PNG 导入受限' : '已激活：PNG 导入已授权');
      var statusColor = admin ? '#eef8f0' : (needs ? '#fff4e5' : '#eef8f0');
      var statusInk = admin ? '#3f8b53' : (needs ? '#a56a1a' : '#3f8b53');
      inner += '<div class="nacc-row"><div class="nacc-row-main">' +
        '<div class="nacc-row-label">导入授权状态</div>' +
        '<div class="nacc-row-sub"> PNG 导入需要激活</div></div>' +
        '<span class="nacc-badge-now" style="background:' + statusColor + ';color:' + statusInk + '">' + esc(statusText) + '</span>' +
        '</div>';
      if (needs && !admin) {
        inner += '<div class="nacc-actions" style="margin-top:10px;flex-direction:column;align-items:stretch">' +
          '<label class="nacc-field" style="margin:0 0 8px"><span class="nacc-field-label">输入管理员给你的激活码</span>' +
          '<input class="nacc-input" id="naccActivateInput" autocapitalize="characters" spellcheck="false" placeholder="例如 ACT-XXXX-XXXX"></label>' +
          '<button type="button" class="nacc-btn nacc-btn-primary" id="naccActivateBtn">提交激活码</button></div>' +
          '<p class="nacc-hint">激活码只由管理员生成和保管；用户端不会显示已保存的激活码。</p>';
      }
      activationHtml = pageSection('本机设备与导入授权', ' PNG 导入需要设备激活。设备码不是密码，不能直接用于登录。', inner);
    }

    var deviceHtml = sessions.length ? sessions.map(function (s) {
      return '<div class="nacc-device">' +
        '<div class="nacc-device-icon"><svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/></svg></div>' +
        '<div class="nacc-device-main"><div class="nacc-device-name">' + esc(s.deviceName || '未知设备') + (s.current ? '（本机）' : '') + '</div>' +
        '<div class="nacc-device-sub">' + (s.current ? '正在使用' : '最近活动：' + esc(fmtTime(s.lastSeen || s.at))) + '</div></div>' +
        (s.current ? '<span class="nacc-badge-now">本机</span>' :
          '<button type="button" class="nacc-mini-btn" data-kick="' + esc(s.sid) + '">下线</button>') +
        '</div>';
    }).join('') : '<div class="nacc-empty">' + (auth ? '点“刷新设备”查看在线设备' : '登录后可查看在线设备') + '</div>';

    var adminHtml = '';
    if (admin) {
      adminHtml =
        pageSection('导入权限', '默认只有管理员能导入角色卡、世界书、规则等文件。开启下面开关后，所有已登录的普通用户都可以导入。',
          '<div class="nacc-row"><div class="nacc-row-main"><div class="nacc-row-label">允许普通账号导入</div>' +
          '<div class="nacc-row-sub">' + (policy.allowUserImport ? '已开启：所有登录用户都能导入' : '已关闭：仅管理员可导入') + '</div></div>' +
          '<label class="nacc-switch"><input type="checkbox" id="naccAllowImport"' + (policy.allowUserImport ? ' checked' : '') + '><i></i></label></div>') +
        pageSection('管理员模式', '退出后当前账号变回普通用户，需要 ACCOUNT_ADMIN_TOKEN 才能重新升级。', '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-danger" id="naccExitAdmin">退出管理员模式</button></div>') +
        pageSection('设备授权', '把用户发来的设备码填进来，生成激活码。激活码只在这里显示，用户端看不到。',
          '<label class="nacc-field"><span class="nacc-field-label">设备码</span>' +
          '<input class="nacc-input" id="naccAdminDeviceCode" autocapitalize="characters" spellcheck="false" placeholder="DEV-XXXX-XXXX"></label>' +
          '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-primary" id="naccMakeKey">生成 / 查看激活码</button>' +
          '<button type="button" class="nacc-btn nacc-btn-soft" id="naccRefreshDevices">刷新设备列表</button></div>' +
          '<div id="naccAdminKeyOut" class="nacc-codes" style="min-height:0;white-space:pre-wrap">输入设备码后点「生成 / 查看激活码」</div>' +
          '<div id="naccAdminDeviceList" style="margin-top:10px"></div>') +
        pageSection('用户管理', '查看账号、最后登录和在线设备；可踢下线、封禁或删除。',
          '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-soft" id="naccRefreshUsers">刷新用户列表</button></div>' +
          '<div id="naccAdminUserList" style="margin-top:10px"></div>') +
        pageSection('账号服务器', '账号、设备、激活码与导入权限都保存在这台 Worker 的 D1 / KV 里。',
          '<label class="nacc-field"><span class="nacc-field-label">服务器地址</span>' +
          '<input class="nacc-input" id="naccApiBase" type="url" autocapitalize="none" spellcheck="false" placeholder="https://你的worker.workers.dev" value="' + esc(apiBase()) + '"></label>' +
          '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-soft" id="naccSaveApi">保存地址</button>' +
          '<button type="button" class="nacc-btn nacc-btn-soft" id="naccTestApi">测试连接</button>' +
          '<button type="button" class="nacc-btn nacc-btn-soft" id="naccResetApi">还原默认</button></div>' +
          '<p class="nacc-hint">部署时给 Worker 加 secret：<b>ACCOUNT_ADMIN_TOKEN</b>；想限制注册再加 <b>ACCOUNT_REGISTER_CODE</b>。</p>');
    }

    var claimHtml = '';
    if (showClaim) {
      claimHtml = pageSection('管理员验证', '只有知道服务端 ACCOUNT_ADMIN_TOKEN 的人才能把当前账号升级为管理员。',
        '<label class="nacc-field"><span class="nacc-field-label">管理员密钥</span>' +
        '<input class="nacc-input" id="naccClaimToken" type="password" autocomplete="off" placeholder="ACCOUNT_ADMIN_TOKEN"></label>' +
        '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-primary" id="naccClaimBtn">升级为管理员</button></div>');
    }

    root.innerHTML = '<div class="nacc-page">' +
      pageSection('当前账号', '一个账号对应一个密码；同一账号最多 3 台设备在线，第 4 台会自动顶掉最久未活动的一台。', profile) +
      activationHtml +
      pageSection('设备管理', '这里只显示当前账号的设备。点击“下线”后，那台设备需要重新输入密码。', deviceHtml +
        '<div class="nacc-actions" style="margin-top:12px">' +
        '<button type="button" class="nacc-btn nacc-btn-soft" id="naccRefresh">刷新设备</button>' +
        (auth ? '<button type="button" class="nacc-btn nacc-btn-danger" id="naccKickOthers">下线其他设备</button>' : '') +
        '</div>') +
      adminHtml +
      claimHtml +
      pageSection('免责声明', '18+ 年龄要求、导入授权与内容版权、虚拟游戏声明与账号保管责任。', '<div class="nacc-actions"><button type="button" class="nacc-btn nacc-btn-soft" id="naccShowTerms">重新查看免责声明</button></div>') +
      '</div>';

    bindPage();
  }

  function bindPage() {
    var root = document.getElementById('naccRoot');
    if (!root) return;
    var auth = currentAuth();

    var loginBtn = root.querySelector('#naccLogin');
    if (loginBtn) loginBtn.addEventListener('click', function () {
      loginOverlay({}).then(function (ok) { if (ok) renderPage(); });
    });
    var logoutBtn = root.querySelector('#naccLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      if (!confirm('退出当前账号？本机聊天数据不会删除。')) return;
      logout().then(function () {
        toast('已退出登录');
        setTimeout(function () { location.reload(); }, 300);
      });
    });
    root.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () { copyText(b.getAttribute('data-copy')); });
    });
    var actBtn = root.querySelector('#naccActivateBtn');
    if (actBtn) actBtn.addEventListener('click', function () {
      var input = root.querySelector('#naccActivateInput');
      var code = input ? (input.value || '').trim().toUpperCase() : '';
      if (!code) { toast('请输入管理员给你的激活码'); return; }
      actBtn.disabled = true;
      actBtn.textContent = '激活中…';
      activateDevice(code).then(function () {
        toast('本机已激活');
        renderPage();
      }).catch(function (err) {
        actBtn.disabled = false;
        actBtn.textContent = '激活本机';
        toast((err && err.message) || '激活失败');
      });
    });
    var refresh = root.querySelector('#naccRefresh');
    if (refresh) refresh.addEventListener('click', function () {
      if (!auth) { toast('请先登录'); return; }
      refresh.disabled = true;
      refreshSessions().then(function (data) {
        applySessions(data);
        toast('设备列表已更新');
        renderPage();
      }).catch(function (err) {
        toast((err && err.message) || '刷新失败');
        refresh.disabled = false;
      });
    });
    root.querySelectorAll('[data-kick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-kick');
        if (!confirm('下线这台设备？它需要重新输入密码。')) return;
        logoutDevice(sid).then(function (data) {
          applySessions(data);
          toast('该设备已下线');
          renderPage();
        }).catch(function (err) { toast((err && err.message) || '下线失败'); });
      });
    });
    var kickOthers = root.querySelector('#naccKickOthers');
    if (kickOthers) kickOthers.addEventListener('click', function () {
      if (!confirm('下线除本机以外的所有设备？')) return;
      logoutOthers().then(function (data) {
        applySessions(data);
        toast('其他设备已全部下线');
        renderPage();
      }).catch(function (err) { toast((err && err.message) || '操作失败'); });
    });

    var allow = root.querySelector('#naccAllowImport');
    if (allow) allow.addEventListener('change', function () {
      allow.disabled = true;
      setUserImportPolicy(allow.checked).then(function () {
        toast(allow.checked ? '已允许所有登录用户导入' : '已改为仅管理员可导入');
        renderPage();
      }).catch(function (err) {
        allow.checked = !allow.checked;
        allow.disabled = false;
        toast((err && err.message) || '保存失败');
      });
    });
    var exitAdminBtn = root.querySelector('#naccExitAdmin');
    if (exitAdminBtn) exitAdminBtn.addEventListener('click', function () {
      if (!confirm('退出管理员模式？当前账号会变回普通用户。')) return;
      exitAdminBtn.disabled = true;
      exitAdmin().then(function () {
        toast('已退出管理员模式');
        refreshSessions().catch(function () {}).then(function () { renderPage(); });
      }).catch(function (err) {
        exitAdminBtn.disabled = false;
        toast((err && err.message) || '操作失败');
      });
    });

    var adminKeyOut = root.querySelector('#naccAdminKeyOut');
    var adminDeviceInput = root.querySelector('#naccAdminDeviceCode');
    function showAdminKey(data) {
      if (!adminKeyOut) return;
      var d = data.device || {};
      adminKeyOut.innerHTML =
        '<div>用户：' + esc(data.username || '') + '</div>' +
        '<div>设备码：' + esc(d.deviceCode || '') + '</div>' +
        '<div>激活码：<b>' + esc(d.activationCode || '') + '</b></div>' +
        '<div>状态：' + (d.activated ? '已授权' : '未授权') + '</div>' +
        (d.activationCode ? '<div class="nacc-actions" style="margin-top:8px"><button type="button" class="nacc-btn nacc-btn-soft" id="naccCopyAdminKey">复制激活码</button></div>' : '');
      var copy = adminKeyOut.querySelector('#naccCopyAdminKey');
      if (copy) copy.addEventListener('click', function () { copyText(d.activationCode); });
    }
    function makeDeviceKey(code) {
      if (!code) { toast('请输入设备码'); return; }
      adminDeviceInput.value = code;
      adminDeviceKey(code).then(function (data) {
        showAdminKey(data);
        toast('激活码已生成');
      }).catch(function (err) { toast((err && err.message) || '生成失败'); });
    }
    function loadAdminDevices() {
      var box = root.querySelector('#naccAdminDeviceList');
      if (!box) return;
      box.innerHTML = '<div class="nacc-empty">加载中…</div>';
      adminDevices().then(function (data) {
        var list = data.devices || [];
        if (!list.length) { box.innerHTML = '<div class="nacc-empty">还没有设备</div>'; return; }
        box.innerHTML = list.map(function (d) {
          return '<div class="nacc-row">' +
            '<div class="nacc-row-main"><div class="nacc-row-label">' + esc(d.username) + ' · ' + esc(d.deviceName || '未知设备') + '</div>' +
            '<div class="nacc-row-sub">' + esc(d.deviceCode) + ' · ' + (d.activated ? '已授权' : '未授权') + ' · ' + esc(fmtTime(d.lastSeen || d.at)) + '</div></div>' +
            '<button type="button" class="nacc-mini-btn" data-make-key="' + esc(d.deviceCode) + '">激活码</button>' +
            '<button type="button" class="nacc-mini-btn" data-revoke-key="' + esc(d.deviceCode) + '" style="border-color:#eee;background:#fafafa;color:#8e8e93">撤销</button>' +
            '</div>';
        }).join('');
        box.querySelectorAll('[data-make-key]').forEach(function (b) {
          b.addEventListener('click', function () { makeDeviceKey(b.getAttribute('data-make-key')); });
        });
        box.querySelectorAll('[data-revoke-key]').forEach(function (b) {
          b.addEventListener('click', function () {
            var code = b.getAttribute('data-revoke-key');
            if (!confirm('撤销这个设备的导入授权？设备需要重新输入同一个激活码才能恢复。')) return;
            adminDeviceRevoke(code).then(function () { toast('已撤销授权'); loadAdminDevices(); })
              .catch(function (err) { toast((err && err.message) || '撤销失败'); });
          });
        });
      }).catch(function (err) {
        box.innerHTML = '<div class="nacc-empty">' + esc((err && err.message) || '加载失败') + '</div>';
      });
    }
    function loadAdminUsers() {
      var box = root.querySelector('#naccAdminUserList');
      if (!box) return;
      box.innerHTML = '<div class="nacc-empty">加载中…</div>';
      adminUsers().then(function (data) {
        var list = data.users || [];
        if (!list.length) { box.innerHTML = '<div class="nacc-empty">还没有用户</div>'; return; }
        box.innerHTML = list.map(function (u) {
          return '<div class="nacc-row">' +
            '<div class="nacc-row-main"><div class="nacc-row-label">' + esc(u.username) +
            (u.role === 'admin' ? ' · 管理员' : '') + (u.banned ? ' · 已封禁' : '') + '</div>' +
            '<div class="nacc-row-sub">最后登录：' + esc(fmtTime(u.lastLoginAt || u.at)) + ' · 在线设备：' + (u.sessions || 0) + '</div></div>' +
            '<button type="button" class="nacc-mini-btn" data-kick-user="' + esc(u.username) + '">踢下线</button>' +
            '<button type="button" class="nacc-mini-btn" data-ban-user="' + esc(u.username) + '" data-banned="' + (u.banned ? '1' : '0') + '" style="border-color:#f2e3b8;background:#fff9e9;color:#8a6d1f">' + (u.banned ? '解封' : '封禁') + '</button>' +
            '<button type="button" class="nacc-mini-btn" data-del-user="' + esc(u.username) + '" style="border-color:#f0d9de;background:#fff7f9;color:#b45462">删除</button>' +
            '</div>';
        }).join('');
        box.querySelectorAll('[data-kick-user]').forEach(function (b) {
          b.addEventListener('click', function () {
            var u = b.getAttribute('data-kick-user');
            if (!confirm('把 ' + u + ' 的所有设备踢下线？')) return;
            adminKick(u).then(function () { toast('已踢下线'); loadAdminUsers(); })
              .catch(function (err) { toast((err && err.message) || '操作失败'); });
          });
        });
        box.querySelectorAll('[data-ban-user]').forEach(function (b) {
          b.addEventListener('click', function () {
            var u = b.getAttribute('data-ban-user');
            var banned = b.getAttribute('data-banned') === '1';
            if (!confirm((banned ? '解封 ' : '封禁 ') + u + '？')) return;
            adminBan(u, !banned).then(function () { toast(banned ? '已解封' : '已封禁'); loadAdminUsers(); })
              .catch(function (err) { toast((err && err.message) || '操作失败'); });
          });
        });
        box.querySelectorAll('[data-del-user]').forEach(function (b) {
          b.addEventListener('click', function () {
            var u = b.getAttribute('data-del-user');
            if (!confirm('删除账号 ' + u + '？所有设备都会下线，且无法恢复。')) return;
            resetAccount('', u).then(function () { toast('已删除账号'); loadAdminUsers(); })
              .catch(function (err) { toast((err && err.message) || '删除失败'); });
          });
        });
      }).catch(function (err) {
        box.innerHTML = '<div class="nacc-empty">' + esc((err && err.message) || '加载失败') + '</div>';
      });
    }
    var makeKeyBtn = root.querySelector('#naccMakeKey');
    if (makeKeyBtn) makeKeyBtn.addEventListener('click', function () {
      makeDeviceKey(adminDeviceInput ? adminDeviceInput.value.trim().toUpperCase() : '');
    });
    var refreshDevices = root.querySelector('#naccRefreshDevices');
    if (refreshDevices) refreshDevices.addEventListener('click', loadAdminDevices);
    var refreshUsers = root.querySelector('#naccRefreshUsers');
    if (refreshUsers) refreshUsers.addEventListener('click', loadAdminUsers);

    var resetBtn = root.querySelector('#naccResetAccount');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      var username = (root.querySelector('#naccResetUser').value || '').trim();
      if (!username) { toast('请输入要删除的账号'); return; }
      if (!confirm('确定删除账号「' + username + '」？该账号在所有设备上的登录都会失效，且无法恢复。')) return;
      resetBtn.disabled = true;
      resetBtn.textContent = '删除中…';
      resetAccount('', username).then(function (data) {
        toast('账号已删除：' + data.username);
      }).catch(function (err) {
        toast((err && err.message) || '删除失败');
      }).then(function () {
        resetBtn.disabled = false;
        resetBtn.textContent = '删除账号';
      });
    });
    var saveApi = root.querySelector('#naccSaveApi');
    if (saveApi) saveApi.addEventListener('click', function () {
      var v = (root.querySelector('#naccApiBase').value || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(v)) { toast('请输入 http(s) 地址'); return; }
      lsSet(LS_API, v);
      toast('已保存账号服务器地址');
    });
    var resetApi = root.querySelector('#naccResetApi');
    if (resetApi) resetApi.addEventListener('click', function () {
      resetServer();
      var input = root.querySelector('#naccApiBase');
      if (input) input.value = apiBase();
    });
    var testApi = root.querySelector('#naccTestApi');
    if (testApi) testApi.addEventListener('click', function () {
      testApi.disabled = true;
      testApi.textContent = '测试中…';
      request('/account/sessions', { token: '' }, { timeout: 8000 }).then(function () {
        toast('账号服务正常');
      }).catch(function (err) {
        if (err && err.status === 401) toast('账号服务已部署（未登录）');
        else if (err && err.status === 404) toast('这个地址没有账号路由，请重新部署 Worker');
        else toast((err && err.message) || '连接失败');
      }).then(function () {
        testApi.disabled = false;
        testApi.textContent = '测试连接';
      });
    });
    var claimBtn = root.querySelector('#naccClaimBtn');
    if (claimBtn) claimBtn.addEventListener('click', function () {
      var token = (root.querySelector('#naccClaimToken').value || '').trim();
      if (!token) { toast('请输入管理员密钥'); return; }
      claimBtn.disabled = true;
      claimBtn.textContent = '验证中…';
      claimAdmin(token).then(function () {
        toast('已升级为管理员');
        renderPage();
      }).catch(function (err) {
        toast((err && err.message) || '验证失败');
        claimBtn.disabled = false;
        claimBtn.textContent = '升级为管理员';
      });
    });
    var terms = root.querySelector('#naccShowTerms');
    if (terms) terms.addEventListener('click', function () {
      var gate = window.NanoAdultGate;
      try {
        if (window.parent && window.parent !== window && window.parent.NanoAdultGate) gate = window.parent.NanoAdultGate;
      } catch (e) {}
      if (gate && gate.open) gate.open();
      else toast('免责声明组件未加载');
    });
  }

  function init() {
    if (document.body && document.body.getAttribute('data-page') === 'account') {
      applyServerParam();
      renderPage();
      // 隐藏入口：连点标题 7 下显示管理员验证，普通用户不会看到入口。
      try {
        var titleEl = document.querySelector('.nav h1');
        if (titleEl) {
          var taps = 0, lastTap = 0;
          titleEl.addEventListener('click', function () {
            var now = Date.now();
            if (now - lastTap > 900) taps = 0;
            lastTap = now;
            taps++;
            if (taps >= 7) {
              taps = 0;
              try {
                var u = new URL(location.href);
                u.searchParams.set('admin', '1');
                history.replaceState(null, '', u.pathname + u.search);
              } catch (e) {}
              renderPage();
              toast('管理员验证已显示');
            }
          });
        }
      } catch (e) {}
      return;
    }
    // iframe 里只提供 NanoImportGate，不弹出登录层；顶层页面才做登录保护。
    if (window.top !== window.self) return;
    if (window.NanoAdultGate) waitAdultThenGate();
    else maybeGate();
  }

  window.NanoAccount = {
    apiBase: apiBase,
    currentAuth: currentAuth,
    currentRole: currentRole,
    isAdmin: isAdmin,
    currentPolicy: currentPolicy,
    login: login,
    register: register,
    logout: logout,
    refreshSessions: refreshSessions,
    logoutOthers: logoutOthers,
    logoutDevice: logoutDevice,
    checkImport: checkImport,
    activateDevice: activateDevice,
    currentDevice: currentDevice,
    needsActivation: needsActivation,
    claimAdmin: claimAdmin,
    setUserImportPolicy: setUserImportPolicy,
    resetAccount: resetAccount,
    exitAdmin: exitAdmin,
    adminDevices: adminDevices,
    adminDeviceKey: adminDeviceKey,
    adminDeviceRevoke: adminDeviceRevoke,
    adminUsers: adminUsers,
    adminKick: adminKick,
    adminBan: adminBan,
    openLogin: loginOverlay,
    renderPage: renderPage,
    toast: toast,
    maxDevices: 3
  };

  window.NanoImportGate = {
    ensure: ensureImport,
    check: checkImport
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
