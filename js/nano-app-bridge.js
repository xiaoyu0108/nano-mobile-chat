// ============================================================
// nano-app-bridge.js — 在「应用」iframe 内注入 window.Nano
// 与 app-host.html 通过 postMessage 通信，应用无需关心底层存储细节。
// ============================================================
(function () {
  'use strict';
  if (window.Nano) return;

  var seq = 0;
  var pending = {};

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++seq) + '_' + Date.now();
      pending[id] = { resolve: resolve, reject: reject };
      try {
        parent.postMessage({ __nanoApp: true, id: id, method: method, args: args || [] }, '*');
      } catch (e) {
        delete pending[id];
        reject(e);
      }
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.__nanoAppResp || !d.id) return;
    var p = pending[d.id];
    if (!p) return;
    delete pending[d.id];
    if (d.ok) p.resolve(d.result);
    else p.reject(new Error(d.error || '调用失败'));
  });

  // 手势返回：应用可以注册处理器自己决定怎么返回；不注册则默认退回 AppStore
  var backHandler = null;
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.__nanoBack) return;
    var handled = false;
    try { if (typeof backHandler === 'function') handled = backHandler() !== false; } catch (err) { handled = false; }
    try { parent.postMessage({ __nanoBackHandled: !!handled }, '*'); } catch (err) {}
  });

  var appId = '';
  try { appId = window.__NANO_APP_ID__ || new URLSearchParams(location.search).get('nanoApp') || ''; } catch (e) { appId = window.__NANO_APP_ID__ || ''; }

  window.Nano = {
    version: 1,
    appId: appId,

    ready: function () { return call('ready'); },

    store: {
      get: function (key) { return call('store.get', [key]); },
      set: function (key, value) { return call('store.set', [key, value]); },
      remove: function (key) { return call('store.remove', [key]); }
    },

    characters: function () { return call('characters'); },
    currentUser: function () { return call('currentUser'); },
    // 用户资料（含头像 avatar）
    user: function () { return call('currentUser'); },
    avatar: function () { return call('avatar'); },
    persona: function (charId) { return call('persona', [charId]); },

    worldbook: function (charId) { return call('worldbook', [charId]); },
    memory: function (charId) { return call('memory', [charId]); },
    apiConfig: function () { return call('apiConfig'); },

    // 传入 { charIds, messages, system, useCharPersona, useUserPersona, useWorldbook, useMemory, maxTokens, temperature }
    // 返回模型回复文本
    chat: function (opts) { return call('chat', [opts || {}]); },

    openUrl: function (url, title) { return call('openUrl', [url, title]); },
    toast: function (text) { return call('toast', [text]); },

    // 已安装应用：列表 / 打开别人
    apps: function () { return call('apps'); },
    openApp: function (id, title) { return call('openApp', [id, title]); },

    // 自己的清单：读取 / 改名 / 换图标（会写回 AppStore 的已安装区）
    manifest: function () { return call('getManifest'); },
    setManifest: function (o) { return call('setManifest', [o || {}]); },
    setIcon: function (icon, color) {
      var o = {};
      if (typeof icon === 'string') o.icon = icon;
      else if (icon && typeof icon === 'object') { o.icon = icon.image || icon.letter || icon.emoji || ''; o.color = icon.color || color; }
      if (color) o.color = color;
      return call('setManifest', [o]);
    },

    // 关闭当前应用：默认回到 AppStore
    close: function () { return call('close'); },
    back: function () { return call('close'); },
    // 自定义返回：注册后手势返回 / 返回键由应用自己处理；不注册或返回 false 则默认回 AppStore
    onBack: function (cb) { backHandler = (typeof cb === 'function') ? cb : null; },

    notify: function (title, body) { return call('notify', [title, body]); }
  };
})();
