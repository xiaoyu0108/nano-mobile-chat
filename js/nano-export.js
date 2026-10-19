// ============================================================
// nano-export.js — 统一的「导出文件」入口
// ------------------------------------------------------------
// 用法： window.NanoExport.file({ name: 'xx.json', text: '...', blob: Blob })
//   与「表情包导出」同一套行为：
//     - iOS：走系统分享（navigator.share）→ iOS 原生的半屏底部弹出（分享/存储到文件），
//            不再自建内置弹窗、也不会卡在“存储到文件”页面出不来；
//            不支持分享时退回复制到剪贴板。
//     - 其它平台：直接下载到本地。
//     - 极少数都不支持时：给一个可长按复制的兜底。
// ============================================================
(function () {
  'use strict';
  if (window.NanoExport) return;

  function isIOS() {
    try {
      return /iP(hone|ad|od)/.test(navigator.platform || '') ||
        ((navigator.userAgent || '').indexOf('Mac') >= 0 && 'ontouchend' in document);
    } catch (e) { return false; }
  }

  function toast(msg) {
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:2147483647;'
        + 'background:rgba(0,0,0,.8);color:#fff;font-size:13px;padding:9px 16px;border-radius:12px;'
        + 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:none;opacity:0;transition:opacity .2s;';
      document.body.appendChild(t);
      requestAnimationFrame(function () { t.style.opacity = '1'; });
      setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { try { t.remove(); } catch (e) {} }, 250); }, 1600);
    } catch (e) {}
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      return Promise.resolve(true);
    } catch (e) { return Promise.resolve(false); }
  }

  function textareaFallback(text, filename) {
    try {
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;';
      var card = document.createElement('div');
      card.style.cssText = 'width:100%;max-width:460px;background:#fff;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;';
      card.innerHTML = '<div style="font-size:14px;font-weight:600;color:#222;">' + filename + '（长按全选复制）</div>';
      var ta = document.createElement('textarea');
      ta.style.cssText = 'width:100%;height:240px;font-size:12px;border:1px solid #eee;border-radius:10px;padding:8px;';
      ta.value = text;
      var close = document.createElement('button');
      close.textContent = '关闭';
      close.style.cssText = 'height:40px;border:0;border-radius:10px;background:#1f1f1f;color:#fff;font-size:14px;';
      close.onclick = function () { ov.remove(); };
      card.appendChild(ta); card.appendChild(close); ov.appendChild(card);
      document.body.appendChild(ov);
      ta.focus(); ta.select();
    } catch (e) { toast('导出失败'); }
  }

  function downloadBlob(blob, filename) {
    try {
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 1500);
      toast('已导出到「下载」目录');
      return true;
    } catch (e) { return false; }
  }

  // opts: { name, text, blob }
  function file(opts) {
    opts = opts || {};
    var filename = opts.name || 'nano-export.json';
    var text = opts.text != null ? String(opts.text) : '';
    var blob = opts.blob || new Blob([text], { type: 'application/json' });
    var type = blob.type || 'application/json';

    if (isIOS()) {
      // iOS 原生半屏弹出（与表情包导出一致）
      try {
        if (navigator.canShare && navigator.share) {
          var f = new File([blob], filename, { type: type });
          if (navigator.canShare({ files: [f] })) {
            navigator.share({ files: [f], title: filename })
              .then(function () { toast('已导出'); }, function () { /* 用户取消 */ });
            return;
          }
        }
      } catch (e) {}
      copyText(text).then(function (ok) {
        if (ok) toast('已复制到剪贴板，可粘贴保存');
        else textareaFallback(text, filename);
      });
      return;
    }

    if (!downloadBlob(blob, filename)) {
      copyText(text).then(function (ok) {
        if (ok) toast('已复制到剪贴板');
        else textareaFallback(text, filename);
      });
    }
  }

  window.NanoExport = { file: file, isIOS: isIOS };
})();
