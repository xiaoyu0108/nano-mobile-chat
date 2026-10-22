// ============================================================
// nano-app-bridge.js — 在「应用」iframe 内注入 window.Nano
// 与 app-host.html 通过 postMessage 通信，应用无需关心底层存储细节。
// v2：高权限。角色 / 人设 / 世界书 / 记忆 / API / 聊天 / 生图 /
//     TTS / 文件 / 图库 / 通知 / 剪贴板 / 应用互开 / 自定义返回。
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
  function runBackHandler() {
    var handled = false;
    try { if (typeof backHandler === 'function') handled = backHandler() !== false; } catch (err) { handled = false; }
    return handled;
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.__nanoBack) return;
    try { parent.postMessage({ __nanoBackHandled: !!runBackHandler() }, '*'); } catch (err) {}
  });

  var appId = '';
  try { appId = window.__NANO_APP_ID__ || new URLSearchParams(location.search).get('nanoApp') || ''; } catch (e) { appId = window.__NANO_APP_ID__ || ''; }

  function closeApp() { return call('close'); }

  window.Nano = {
    version: 2,
    appId: appId,

    ready: function () { return call('ready'); },
    permissions: function () { return call('permissions'); },

    env: {
      platform: (navigator.platform || ''),
      language: (navigator.language || 'zh-CN'),
      online: !!navigator.onLine,
      standalone: false
    },

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

    // 高权限：生图 / TTS / 文件 / 图库
    image: {
      generate: function (prompt, opts) { return call('image.generate', [prompt, opts || {}]); }
    },
    tts: {
      speak: function (text, opts) { return call('tts.speak', [text, opts || {}]); }
    },
    files: {
      add: function (file) { return call('files.add', [file || {}]); },
      list: function () { return call('files.list'); },
      remove: function (id) { return call('files.remove', [id]); }
    },
    gallery: {
      add: function (rec) { return call('gallery.add', [rec || {}]); },
      list: function () { return call('gallery.list'); },
      remove: function (url) { return call('gallery.remove', [url]); },
      clear: function () { return call('gallery.clear'); }
    },

    // 打开外部/内部页面（高权限：内部页面也能开）
    openUrl: function (url, title) { return call('openUrl', [url, title]); },
    openPage: function (url, title) { return call('openUrl', [url, title]); },
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

    clipboard: {
      write: function (text) { return call('clipboard.write', [String(text == null ? '' : text)]); },
      read: function () { return call('clipboard.read'); }
    },

    haptic: function (ms) {
      try { if (navigator.vibrate) navigator.vibrate(Number(ms) || 12); } catch (e) {}
      return true;
    },

    // 关闭当前应用：默认回到 AppStore
    close: closeApp,
    exit: closeApp,
    // 自定义返回：注册后手势返回 / 返回键由应用自己处理；不注册或返回 false 则默认回 AppStore
    onBack: function (cb) {
      backHandler = (typeof cb === 'function') ? cb : null;
      return function () { backHandler = null; };
    },
    // 主动走一次返回：先问应用自己的处理器，处理不了再退出
    back: function () {
      if (runBackHandler()) return Promise.resolve(true);
      return closeApp();
    },

    notify: function (title, body) { return call('notify', [title, body]); }
  };
})();
