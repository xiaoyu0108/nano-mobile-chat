(function () {
  'use strict';

  // 把打包好的安装包放到站点 apk/nano.apk，本页会自动启用下载。
  // 也可以改成完整直链（https://.../nano.apk）；跨域地址不再检测文件是否存在。
  var APK_URL = '../apk/nano.apk?v=2.1.1';
  var IS_NANO_APP = /NanoApp/i.test(navigator.userAgent || '');

  var $ = function (id) { return document.getElementById(id); };
  var state = { ready: false, size: 0, external: false, standalone: false, android: false, installEvent: null };
  var toastTimer = null;

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function isStandalone() {
    try {
      if (IS_NANO_APP) return true;
      if (navigator.standalone) return true;
      if (window.matchMedia) {
        if (matchMedia('(display-mode: standalone)').matches) return true;
        if (matchMedia('(display-mode: fullscreen)').matches) return true;
        if (matchMedia('(display-mode: minimal-ui)').matches) return true;
      }
      if (/^android-app:\/\//i.test(document.referrer || '')) return true;
    } catch (e) {}
    return false;
  }

  function absolute(url) {
    try { return new URL(url, location.href).href; } catch (e) { return url; }
  }

  function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  function appUrl() {
    try { return new URL('../', location.href).href; } catch (e) { return location.href; }
  }

  function fmtSize(n) {
    if (!n || n < 0) return '下载';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function setBadge(text, tone) {
    var el = $('apkBadge');
    if (!el) return;
    el.textContent = text;
    el.className = 'apk-badge' + (tone ? ' ' + tone : '');
  }

  function renderPwa() {
    var meta = $('pwaMeta');
    if (!meta) return;
    if (state.standalone) { meta.textContent = '已安装'; return; }
    if (state.installEvent) { meta.textContent = '可安装'; return; }
    if (isIOS()) meta.textContent = 'Safari 分享';
    else if (state.android) meta.textContent = '浏览器菜单';
    else meta.textContent = '浏览器';
  }

  function render() {
    var dl = $('apkDownload');
    var meta = $('apkMeta');
    var status = $('apkStatus');
    var hint = $('apkHint');
    if (!dl || !meta || !status) return;

    var env = $('envMeta');
    if (env) env.textContent = state.standalone ? '已安装 App' : (state.android ? '安卓浏览器' : '浏览器');

    if (state.ready) {
      if (IS_NANO_APP) {
        dl.href = '#';
        dl.classList.add('is-disabled');
        dl.removeAttribute('download');
        dl.removeAttribute('target');
        dl.removeAttribute('rel');
        meta.textContent = '已内置';
        status.textContent = '当前是离线安装版，无需再下载';
        setBadge('已安装', 'ok');
        if (hint) hint.textContent = '离线版已把网页资源打包进 APK，断网也能打开；网页功能更新后需要重新打包。';
      } else {
        dl.href = state.external ? absolute(APK_URL) : APK_URL;
        dl.classList.remove('is-disabled');
        if (state.external) {
          dl.setAttribute('target', '_blank');
          dl.setAttribute('rel', 'noopener');
          dl.removeAttribute('download');
        } else {
          dl.removeAttribute('target');
          dl.removeAttribute('rel');
          dl.setAttribute('download', 'nano.apk');
        }
        meta.textContent = state.size ? fmtSize(state.size) : '下载';
        status.textContent = '安装包已就绪，下载后直接安装';
        setBadge(state.standalone ? '已安装' : '可下载', 'ok');
        if (hint) hint.textContent = '下载后如提示“未知来源”，请在系统设置中允许当前浏览器安装应用。';
      }
    } else {
      dl.href = '#';
      dl.removeAttribute('download');
      dl.removeAttribute('target');
      dl.removeAttribute('rel');
      dl.classList.add('is-disabled');
      meta.textContent = '准备中';
      status.textContent = '安装包还未上传，可先安装网页版';
      setBadge('待上传', 'warn');
      if (hint) {
        hint.textContent = state.android
          ? '可先用下方的「直接安装到桌面」获得同样的图标和全屏体验。'
          : '当前不是安卓设备，可复制安装地址，在安卓手机上打开本页下载。';
      }
    }
    renderPwa();
  }

  function probe() {
    if (IS_NANO_APP) {
      state.ready = true;
      state.external = false;
      state.size = 0;
      render();
      return;
    }
    if (!sameOrigin(APK_URL)) {
      state.ready = true;
      state.external = true;
      state.size = 0;
      render();
      return;
    }
    fetch(APK_URL, { method: 'HEAD', cache: 'no-store' }).then(function (res) {
      if (!res || !res.ok) return;
      var type = String(res.headers.get('content-type') || '');
      if (/text\/html/i.test(type)) return;
      state.ready = true;
      state.external = false;
      state.size = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    }).catch(function () {}).then(render);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('copy failed'));
      } catch (e) { reject(e); }
    });
  }

  function init() {
    state.android = isAndroid();
    state.standalone = isStandalone();

    var site = $('siteMeta');
    if (site) {
      if (IS_NANO_APP) {
        site.textContent = '内置资源（离线版）';
      } else {
        site.textContent = appUrl();
      }
      site.title = site.textContent;
    }

    var dl = $('apkDownload');
    if (dl) {
      dl.addEventListener('click', function (e) {
        if (!state.ready) {
          e.preventDefault();
          toast('安装包还未上传，先用网页版安装到桌面');
          return;
        }
        if (!state.android && !state.standalone) toast('已开始下载，请传到安卓手机安装');
      });
    }

    var pwa = $('pwaInstall');
    if (pwa) {
      pwa.addEventListener('click', function () {
        if (state.standalone) { toast('已经安装，当前就在 App 中运行'); return; }
        if (state.installEvent) {
          var ev = state.installEvent;
          state.installEvent = null;
          try { ev.prompt(); } catch (e) {}
          if (ev.userChoice && ev.userChoice.then) {
            ev.userChoice.then(function (r) {
              toast(r && r.outcome === 'accepted' ? '已开始安装' : '已取消安装');
              renderPwa();
            });
          }
          return;
        }
        if (isIOS()) toast('Safari：点底部「分享」→「添加到主屏幕」');
        else if (state.android) toast('Chrome：右上角 ⋮ →「安装应用」或「添加到主屏幕」');
        else toast('点浏览器地址栏右侧的安装图标，或在菜单里选择「安装」');
      });
    }

    var copy = $('copyLink');
    if (copy) {
      if (IS_NANO_APP) {
        copy.style.display = 'none';
      } else {
        copy.addEventListener('click', function () {
          copyText(appUrl()).then(function () {
            toast('安装地址已复制');
          }).catch(function () {
            toast('复制失败，请手动复制地址');
          });
        });
      }
    }

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.installEvent = e;
      renderPwa();
    });

    window.addEventListener('appinstalled', function () {
      state.standalone = true;
      render();
      toast('已安装到桌面');
    });

    render();
    probe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
