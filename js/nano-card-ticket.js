// ============================================================
// nano-card-ticket.js — Nano 专属票根 PNG
// ------------------------------------------------------------
// · 黑白灰票根：头像 / 姓名 / 性别 / 国籍 / 设定摘要
// · 打印动画：从票根机出票口缓慢吐出
// · PNG 的 tEXt 块内嵌完整角色数据（设定、世界书、开场白）
// · 导出的 PNG 可以直接在 Nano 角色页 / 人设页导入
// ============================================================
(function () {
  'use strict';
  if (window.NanoCardTicket) return;

  var TICKET_W = 720;
  var TICKET_H = 1180;
  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",-apple-system,BlinkMacSystemFont,sans-serif';
  var MONO = '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace';

  // ---------- 小工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function safeName(s) {
    return String(s || 'Nano票根').replace(/[\\/:*?"<>|\n\r\t]+/g, '_').slice(0, 40) || 'Nano票根';
  }
  function hash(str) {
    var h = 2166136261;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function serialOf(payload) {
    var h = hash((payload.id || '') + '|' + (payload.name || '') + '|' + (payload.createdAt || 0));
    return 'NC-' + h.toString(36).toUpperCase().padStart(7, '0').slice(-7);
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var img = new Image();
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      img.crossOrigin = 'anonymous';
      img.onload = function () { finish(img); };
      img.onerror = function () { finish(null); };
      try { img.src = src; } catch (e) { finish(null); }
      setTimeout(function () { if (!done && !img.complete) finish(null); }, 6000);
    });
  }
  function drawTextFit(ctx, text, x, y, maxWidth, size, weight, color) {
    var t = String(text || '');
    ctx.font = (weight || 600) + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color || '#141416';
    if (ctx.measureText(t).width <= maxWidth) {
      ctx.fillText(t, x, y);
      return t;
    }
    var cut = t;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
    ctx.fillText(cut + '…', x, y);
    return cut + '…';
  }
  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines, size, weight, color) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) return y;
    ctx.font = (weight || 400) + ' ' + (size || 22) + 'px ' + FONT;
    ctx.fillStyle = color || '#141416';
    var lines = [];
    var cur = '';
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (ctx.measureText(cur + ch).width > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
        if (lines.length >= (maxLines || 3)) break;
      } else {
        cur += ch;
      }
    }
    if (lines.length < (maxLines || 3) && cur) lines.push(cur);
    lines.forEach(function (line, idx) { ctx.fillText(line, x, y + idx * lineHeight); });
    return y + lines.length * lineHeight;
  }
  function letterSpace(ctx, text, x, y, spacing) {
    var cur = x;
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text.charAt(i), cur, y);
      cur += ctx.measureText(text.charAt(i)).width + spacing;
    }
  }
  function drawTicketAvatar(ctx, img, name, x, y, w, h, radius) {
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    if (img) {
      // 票根头像保留原色（不转灰），只做 cover 裁切
      try {
        var scale = Math.max(w / img.width, h / img.height);
        var dw = img.width * scale;
        var dh = img.height * scale;
        ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } catch (e) {
        ctx.fillStyle = '#8c8c90';
        ctx.fillRect(x, y, w, h);
      }
    } else {
      // 初始头像：灰色底 + 白色线条人头
      ctx.fillStyle = '#8c8c90';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, w * 0.035);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h * 0.37, w * 0.17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y + h * 0.82);
      ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.56, x + w * 0.8, y + h * 0.82);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.strokeStyle = 'rgba(20,20,22,.16)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  function drawBarcode(ctx, seed, x, y, w, h) {
    var hseed = hash(seed);
    var cur = x;
    ctx.fillStyle = '#141416';
    while (cur < x + w) {
      hseed = (Math.imul(hseed, 1664525) + 1013904223) >>> 0;
      var bar = 2 + (hseed % 5);
      var gap = 2 + ((hseed >>> 3) % 4);
      if (cur + bar > x + w) break;
      ctx.fillRect(cur, y, bar, h);
      cur += bar + gap;
    }
  }

  // ---------- 票根绘制 ----------
  function drawTicket(ctx, payload, avatarImg) {
    var isUser = payload.kind === 'user';
    var W = TICKET_W, H = TICKET_H;

    // 背景：深色票夹，中间一张浅色票纸
    ctx.fillStyle = '#0c0c0e';
    ctx.fillRect(0, 0, W, H);
    // 细网点，增加印刷质感
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#ffffff';
    for (var yy = 0; yy < H; yy += 14) {
      for (var xx = (yy / 14) % 2 ? 8 : 0; xx < W; xx += 16) ctx.fillRect(xx, yy, 1.2, 1.2);
    }
    ctx.restore();

    var px = 48, py = 48, pw = W - 96, ph = H - 96;
    // 票纸阴影
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#f3f1ea';
    roundRect(ctx, px, py, pw, ph, 26);
    ctx.fill();
    ctx.restore();

    // 票纸底色 + 极淡的纸纹
    ctx.save();
    roundRect(ctx, px, py, pw, ph, 26);
    ctx.clip();
    ctx.fillStyle = '#f3f1ea';
    ctx.fillRect(px, py, pw, ph);
    ctx.globalAlpha = 0.06;
    for (var i = 0; i < 90; i++) {
      var ly = py + ((i * 53) % ph);
      ctx.fillStyle = i % 2 ? '#141416' : '#ffffff';
      ctx.fillRect(px, ly, pw, 1);
    }
    ctx.globalAlpha = 1;

    // 顶部字标
    var topY = py + 74;
    ctx.fillStyle = '#141416';
    ctx.font = '800 46px ' + FONT;
    letterSpace(ctx, 'NANO', px + 40, topY, 2);
    ctx.font = '600 13px ' + MONO;
    ctx.fillStyle = '#6c6c70';
    letterSpace(ctx, isUser ? 'USER PASS' : 'CHARACTER PASS', px + 42, topY + 26, 3);

    ctx.textAlign = 'right';
    ctx.font = '600 13px ' + MONO;
    ctx.fillStyle = '#6c6c70';
    ctx.fillText('NO. ' + serialOf(payload), px + pw - 38, topY - 4);
    ctx.fillText('NANO CARD SYSTEM', px + pw - 38, topY + 18);
    ctx.textAlign = 'left';

    // 分割线
    ctx.strokeStyle = 'rgba(20,20,22,.16)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px + 38, py + 132); ctx.lineTo(px + pw - 38, py + 132); ctx.stroke();

    // 头像
    var avX = px + 40, avY = py + 166, avS = 196;
    drawTicketAvatar(ctx, avatarImg, payload.name, avX, avY, avS, avS, 18);

    // 姓名 / 性别 / 国籍
    var infoX = avX + avS + 34;
    var infoRight = px + pw - 40;
    ctx.fillStyle = '#141416';
    ctx.font = '700 44px ' + FONT;
    var nameShown = drawTextFit(ctx, payload.name || '未命名', infoX, avY + 58, infoRight - infoX, 44, 700, '#141416');

    var rowY = avY + 116;
    function metaRow(label, value) {
      ctx.font = '600 12px ' + MONO;
      ctx.fillStyle = '#8a8a8f';
      letterSpace(ctx, label, infoX, rowY, 1.5);
      ctx.font = '600 24px ' + FONT;
      ctx.fillStyle = '#222226';
      drawTextFit(ctx, value || '—', infoX + 78, rowY + 1, infoRight - infoX - 78, 24, 600, '#222226');
      rowY += 44;
    }
    metaRow('GENDER', payload.gender || '未填写');
    metaRow('NATION', payload.nationality || '未填写');

    // 档案摘要
    var profileY = py + 430;
    ctx.strokeStyle = 'rgba(20,20,22,.12)';
    ctx.beginPath(); ctx.moveTo(px + 38, profileY); ctx.lineTo(px + pw - 38, profileY); ctx.stroke();

    ctx.font = '700 12px ' + MONO;
    ctx.fillStyle = '#8a8a8f';
    letterSpace(ctx, isUser ? 'USER PROFILE' : 'CHARACTER PROFILE', px + 40, profileY + 34, 2);
    ctx.font = '600 13px ' + FONT;
    ctx.fillStyle = '#8a8a8f';
    ctx.textAlign = 'right';
    ctx.fillText(serialOf(payload), px + pw - 40, profileY + 34);
    ctx.textAlign = 'left';

    var setting = String(payload.setting || '').replace(/\s+/g, ' ').trim();
    if (setting) {
      wrapText(ctx, setting, px + 40, profileY + 78, pw - 80, 32, 3, 20, 400, '#3a3a3e');
    } else {
      ctx.font = '400 20px ' + FONT;
      ctx.fillStyle = '#8a8a8f';
      ctx.fillText('这张票根没有额外的文字设定，翻开它，故事就从空白开始。', px + 40, profileY + 78);
    }

    // 统计行
    var statsY = py + 646;
    var stats = [];
    if (isUser) {
      stats.push(['设定', String(payload.setting || '').length + ' 字']);
      stats.push(['票根', 'USER PASS']);
    } else {
      stats.push(['设定', String(payload.setting || '').length + ' 字']);
      stats.push(['世界书', (payload.worldbooks || []).length + ' 本']);
      stats.push(['开场白', (payload.greetings || []).length + ' 条']);
    }
    var colW = (pw - 80) / stats.length;
    stats.forEach(function (s, idx) {
      var sx = px + 40 + colW * idx;
      ctx.font = '700 30px ' + FONT;
      ctx.fillStyle = '#141416';
      ctx.fillText(s[1], sx, statsY + 20);
      ctx.font = '600 11px ' + MONO;
      ctx.fillStyle = '#8a8a8f';
      letterSpace(ctx, s[0], sx, statsY + 42, 1.2);
    });

    // 打孔线（票根撕线）
    var perfY = py + 760;
    ctx.save();
    ctx.strokeStyle = 'rgba(20,20,22,.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 9]);
    ctx.beginPath(); ctx.moveTo(px + 22, perfY); ctx.lineTo(px + pw - 22, perfY); ctx.stroke();
    ctx.restore();
    // 左右半圆缺口：用背景色覆盖
    ctx.fillStyle = '#0c0c0e';
    ctx.beginPath(); ctx.arc(px, perfY, 17, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + pw, perfY, 17, 0, Math.PI * 2); ctx.fill();

    // 票根下半部分
    var stubY = perfY + 34;
    ctx.font = '700 15px ' + MONO;
    ctx.fillStyle = '#141416';
    letterSpace(ctx, isUser ? 'NANO USER TICKET' : 'NANO CHARACTER TICKET', px + 40, stubY + 24, 2.4);

    ctx.font = '400 15px ' + FONT;
    ctx.fillStyle = '#6c6c70';
    ctx.fillText(isUser ? '一张可以导入 Nano 的用户人设票根' : '一张可以导入 Nano 的角色票根', px + 40, stubY + 54);

    drawBarcode(ctx, (payload.id || '') + '|' + (payload.name || ''), px + 40, stubY + 84, pw - 210, 70);

    ctx.font = '600 12px ' + MONO;
    ctx.fillStyle = '#6c6c70';
    ctx.fillText(isUser ? 'SETTING · USER PROFILE' : 'SETTING · WORLDBOOK · OPENINGS', px + 40, stubY + 186);
    ctx.textAlign = 'right';
    ctx.fillText('IMPORT TO NANO', px + pw - 40, stubY + 186);
    ctx.textAlign = 'left';

    ctx.font = '400 11px ' + FONT;
    ctx.fillStyle = '#9a9a9f';
    ctx.fillText('这张 PNG 不只是一张图：完整设定、世界书与开场白都封装在图片里。', px + 40, stubY + 208);
    ctx.fillText('在 Nano 角色页 / 人设页选择「导入 PNG」即可读取。', px + 40, stubY + 226);

    // 圆形印章
    ctx.save();
    ctx.translate(px + pw - 96, stubY + 126);
    ctx.rotate(-0.18);
    ctx.strokeStyle = 'rgba(20,20,22,.18)';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(0, 0, 48, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(20,20,22,.18)';
    ctx.textAlign = 'center';
    ctx.font = '800 17px ' + FONT;
    ctx.fillText('NANO', 0, -6);
    ctx.font = '600 9px ' + MONO;
    ctx.fillText('PASS', 0, 10);
    ctx.fillText(serialOf(payload), 0, 24);
    ctx.restore();
    ctx.textAlign = 'left';

    // 最底部细线
    ctx.strokeStyle = 'rgba(20,20,22,.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px + 38, py + ph - 34); ctx.lineTo(px + pw - 38, py + ph - 34); ctx.stroke();
    ctx.font = '400 10px ' + MONO;
    ctx.fillStyle = '#9a9a9f';
    ctx.fillText('PRINTED BY NANO · ' + new Date().getFullYear(), px + 40, py + ph - 14);
    ctx.textAlign = 'right';
    ctx.fillText(nameShown ? ('ID ' + serialOf(payload)) : '', px + pw - 40, py + ph - 14);
    ctx.textAlign = 'left';

    ctx.restore();
  }

  // ---------- 数据 → V2 角色卡（兼容酒馆结构，Nano 字段放在 data.nano） ----------
  function buildCardJson(payload) {
    var greetings = Array.isArray(payload.greetings) ? payload.greetings.filter(function (s) { return String(s || '').trim(); }) : [];
    var books = Array.isArray(payload.worldbooks) ? payload.worldbooks : [];
    var flatEntries = [];
    books.forEach(function (b) {
      (b && Array.isArray(b.entries) ? b.entries : []).forEach(function (e) { flatEntries.push(e); });
    });
    var nanoPayload = {
      format: 'nano_card_v1',
      kind: payload.kind === 'user' ? 'user' : 'character',
      version: 1,
      id: payload.id || '',
      name: payload.name || '',
      gender: payload.gender || '',
      nationality: payload.nationality || '',
      avatar: payload.avatar || '',
      setting: payload.setting || '',
      greetings: greetings,
      worldbooks: books,
      createdAt: payload.createdAt || Date.now(),
      serial: serialOf(payload)
    };
    var data = {
      name: payload.name || '未命名',
      description: payload.setting || '',
      personality: '',
      scenario: '',
      first_mes: greetings[0] || '',
      alternate_greetings: greetings.slice(1),
      mes_example: '',
      creator_notes: 'Nano 专属票根 · 内含完整设定、世界书与开场白。导入 Nano 即可使用。',
      tags: ['Nano', payload.kind === 'user' ? '用户人设' : '角色卡'],
      extensions: { nano: nanoPayload },
      nano: nanoPayload
    };
    if (flatEntries.length) {
      data.character_book = {
        name: (books[0] && books[0].name) || ((payload.name || '') + ' 的世界书'),
        entries: flatEntries
      };
    }
    return { spec: 'chara_card_v2', spec_version: '2.0', data: data };
  }

  // ---------- 渲染 PNG + 内嵌数据 ----------
  async function renderBlob(payload) {
    payload = payload || {};
    if (!window.NanoPngJson || !NanoPngJson.embedJson) throw new Error('PNG 数据模块未加载');
    var canvas = document.createElement('canvas');
    canvas.width = TICKET_W;
    canvas.height = TICKET_H;
    var ctx = canvas.getContext('2d');
    var avatar = await loadImage(payload.avatar || '');
    drawTicket(ctx, payload, avatar);

    var blob = await new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('票根生成失败')); }, 'image/png');
      } catch (e) { reject(e); }
    });
    var buf = await blob.arrayBuffer();
    var card = buildCardJson(payload);
    var out = NanoPngJson.embedJson(buf, 'nano_card', card);
    return new Blob([out], { type: 'image/png' });
  }

  // ---------- 保存 ----------
  function toast(msg) {
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483647;'
        + 'background:rgba(0,0,0,.82);color:#fff;font-size:13px;padding:9px 16px;border-radius:12px;'
        + 'font-family:' + FONT + ';pointer-events:none;opacity:0;transition:opacity .2s;';
      document.body.appendChild(t);
      requestAnimationFrame(function () { t.style.opacity = '1'; });
      setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { try { t.remove(); } catch (e) {} }, 250); }, 1800);
    } catch (e) {}
  }

  function isIOS() {
    try {
      return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    } catch (e) { return false; }
  }

  // 不触发浏览器「下载」栏：把图片铺满屏幕，让用户长按保存到相册
  function showLongPressPreview(blob) {
    var url = URL.createObjectURL(blob);
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(8,8,9,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;';
    ov.innerHTML = '<img alt="Nano 票根" style="max-width:100%;max-height:calc(100% - 90px);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.5);" src="' + url + '">'
      + '<div style="margin-top:16px;color:#e8e8ee;font:500 13px/1.5 ' + FONT + ';text-align:center;">长按图片保存到相册</div>'
      + '<button type="button" style="margin-top:12px;height:40px;padding:0 22px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font:600 14px ' + FONT + ';">关闭</button>';
    var close = function () {
      try { URL.revokeObjectURL(url); } catch (e) {}
      try { ov.remove(); } catch (e) {}
    };
    ov.querySelector('button').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    toast('长按票根图片即可保存到相册');
    return true;
  }

  async function saveBlob(blob, name, silent) {
    var filename = safeName(name) + '-Nano票根.png';
    // iOS / 移动端：优先系统分享（可以存到相册）
    try {
      if (navigator.canShare && navigator.share) {
        var file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          toast('票根已保存 / 分享');
          return true;
        }
      }
    } catch (e) {
      // 用户在系统分享里点了取消：不要紧接着又强制下载一次
      if (e && (e.name === 'AbortError' || /cancel|取消/i.test(String(e.message || '')))) return false;
    }
    // iOS 不支持分享时不要走 <a download>（会弹下载按钮/下载管理器），直接给长按保存预览
    if (isIOS()) return showLongPressPreview(blob);
    // 桌面 / 其它移动端：直接下载
    try {
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 1600);
      toast('票根已导出到「下载」目录');
      return true;
    } catch (e2) {}
    // 最后兜底：长按保存
    return showLongPressPreview(blob);
  }

  // ---------- 打印动画 ----------
  function injectCss() {
    if (document.getElementById('nano-card-ticket-css')) return;
    var style = document.createElement('style');
    style.id = 'nano-card-ticket-css';
    style.textContent = [
      '.nct-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(8,8,9,.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 18px 110px;font-family:' + FONT + ';overflow:auto;}',
      '.nct-stage{width:100%;max-width:380px;display:flex;flex-direction:column;align-items:center;position:relative;}',
      '.nct-head{width:100%;display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;color:#cfcfd4;font:600 11px/1 ' + MONO + ';letter-spacing:.18em;}',
      '.nct-head span:last-child{color:#77777d;}',
      '.nct-printer{width:100%;border-radius:18px 18px 8px 8px;background:linear-gradient(180deg,#2b2b2f 0%,#17171a 58%,#0e0e10 100%);border:1px solid rgba(255,255,255,.08);box-shadow:0 24px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);padding:16px 18px 0;position:relative;}',
      '.nct-printer:before{content:"";position:absolute;left:18px;right:18px;top:10px;height:1px;background:rgba(255,255,255,.08);}',
      '.nct-printer-top{display:flex;align-items:center;justify-content:space-between;padding:6px 2px 13px;}',
      '.nct-printer-brand{color:#e9e9ee;font:800 13px/1 ' + MONO + ';letter-spacing:.22em;}',
      '.nct-printer-led{width:7px;height:7px;border-radius:50%;background:#8b8b92;box-shadow:0 0 0 3px rgba(255,255,255,.04);animation:nctLed 1.4s ease-in-out infinite;}',
      '.nct-slot{height:16px;margin:0 2px;border-radius:6px;background:linear-gradient(180deg,#050506,#18181b 42%,#050506);box-shadow:inset 0 6px 10px rgba(0,0,0,.9),inset 0 -1px 0 rgba(255,255,255,.06);position:relative;z-index:2;}',
      '.nct-out{width:100%;position:relative;overflow:hidden;background:transparent;z-index:1;border-radius:0 0 10px 10px;}',
      '.nct-paper{display:block;width:100%;height:auto;transform:translateY(-108%);will-change:transform;filter:drop-shadow(0 8px 24px rgba(0,0,0,.38));}',
      '.nct-paper.nct-start{animation:nctFeed 3s cubic-bezier(.22,.72,.18,1) forwards;}',
      '.nct-paper.nct-done{animation:none;transform:translateY(0);}',
      '.nct-status{margin-top:16px;min-height:20px;color:#d8d8de;font:500 12px/1.4 ' + FONT + ';letter-spacing:.04em;text-align:center;}',
      '.nct-status .nct-dots{display:inline-block;width:20px;text-align:left;animation:nctDots 1.2s steps(4) infinite;}',
      '.nct-actions{position:fixed;left:0;right:0;bottom:0;padding:14px 18px calc(14px + env(safe-area-inset-bottom,0px));display:flex;gap:10px;justify-content:center;background:linear-gradient(180deg,rgba(8,8,9,0),rgba(8,8,9,.94) 38%);}',
      '.nct-btn{height:44px;padding:0 22px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f4f4f7;font:600 14px ' + FONT + ';backdrop-filter:blur(8px);}',
      '.nct-btn.primary{background:#f3f1ea;color:#141416;border-color:#f3f1ea;box-shadow:0 10px 26px rgba(0,0,0,.35);}',
      '.nct-btn:active{transform:scale(.97);}',
      '.nct-btn[hidden]{display:none;}',
      '@keyframes nctFeed{0%{transform:translateY(-108%);}56%{transform:translateY(-12%);}62%{transform:translateY(-17%);}68%{transform:translateY(-6%);}76%{transform:translateY(-9%);}86%{transform:translateY(-2%);}100%{transform:translateY(0);}}',
      '@keyframes nctLed{0%,100%{opacity:.35;}50%{opacity:1;}}',
      '@keyframes nctDots{0%{clip-path:inset(0 100% 0 0);}100%{clip-path:inset(0 0 0 0);}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function animate(blob, payload) {
    injectCss();
    // 同一时间只保留一个打印层
    var old = document.querySelector('.nct-overlay');
    if (old) old.remove();

    var url = URL.createObjectURL(blob);
    var overlay = document.createElement('div');
    overlay.className = 'nct-overlay';
    overlay.innerHTML =
      '<div class="nct-stage">' +
        '<div class="nct-head"><span>NANO CARD PRESS</span><span>' + esc(serialOf(payload)) + '</span></div>' +
        '<div class="nct-printer">' +
          '<div class="nct-printer-top"><span class="nct-printer-brand">NANO / TICKET</span><span class="nct-printer-led"></span></div>' +
          '<div class="nct-slot"></div>' +
          '<div class="nct-out"><img class="nct-paper" alt="Nano 票根" /></div>' +
        '</div>' +
        '<div class="nct-status">正在打印票根<span class="nct-dots">…</span></div>' +
      '</div>' +
      '<div class="nct-actions">' +
        '<button class="nct-btn" data-nct-close>关闭</button>' +
        '<button class="nct-btn primary" data-nct-save hidden>保存 / 分享</button>' +
      '</div>';
    var img = overlay.querySelector('.nct-paper');
    img.addEventListener('load', function () { img.classList.add('nct-start'); }, { once: true });
    img.src = url;
    document.body.appendChild(overlay);

    var status = overlay.querySelector('.nct-status');
    var saveBtn = overlay.querySelector('[data-nct-save]');
    var closeBtn = overlay.querySelector('[data-nct-close]');
    var finished = false;
    var reduceMotion = false;
    try { reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

    function finish() {
      if (finished || !overlay.isConnected) return;
      finished = true;
      img.classList.add('nct-done');
      status.textContent = '打印完成 · 点下方「保存 / 分享」保存到相册或分享';
      saveBtn.hidden = false;
    }
    img.addEventListener('animationend', finish, { once: true });
    var fallbackTimer = setTimeout(finish, reduceMotion ? 320 : 5200); // 兜底：动画被系统关闭时也能继续

    function closeOverlay() {
      clearTimeout(fallbackTimer);
      try { URL.revokeObjectURL(url); } catch (e) {}
      overlay.remove();
    }
    saveBtn.addEventListener('click', function () { saveBlob(blob, payload.name); });
    closeBtn.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeOverlay();
    });
  }

  async function printPayload(payload) {
    if (!payload || !payload.name) throw new Error('缺少名字');
    var blob = await renderBlob(payload);
    animate(blob, payload);
    return blob;
  }

  // ---------- 数据读取 ----------
  function openDb(name, version, store) {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(name, version || 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: store === 'worldbook_data' || store === 'settings' || store === 'api_data' ? 'key' : 'id' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  async function readWorldbookData() {
    try {
      var db = await openDb('nano_worldbook_db', 1, 'worldbook_data');
      if (db) {
        var data = await new Promise(function (resolve) {
          try {
            var r = db.transaction('worldbook_data', 'readonly').objectStore('worldbook_data').get('data');
            r.onsuccess = function () { resolve(r.result ? r.result.value : null); };
            r.onerror = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
        try { db.close(); } catch (e) {}
        if (data && Array.isArray(data.files)) return data;
      }
    } catch (e) {}
    try {
      var raw = localStorage.getItem('nano_worldbook_data_v5');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.files)) return parsed;
      }
    } catch (e) {}
    return { groups: [], files: [] };
  }

  async function loadWorldbooksForCharacter(item) {
    if (!item) return [];
    var data = await readWorldbookData();
    var ids = {};
    (Array.isArray(item.worldbookBindings) ? item.worldbookBindings : []).forEach(function (b) {
      if (b && b.id) ids[String(b.id)] = 1;
    });
    var cid = String(item.id || '');
    return (data.files || []).filter(function (f) {
      if (!f) return false;
      var scope = f.scope || 'global';
      if (scope === 'global') return false;
      if (ids[String(f.id)]) return true;
      return cid && Array.isArray(f.boundCharacters) && f.boundCharacters.map(String).indexOf(cid) > -1;
    }).map(function (f) {
      return {
        id: f.id || '',
        name: f.name || '',
        group: f.group || '',
        scope: f.scope || 'local',
        entries: Array.isArray(f.entries) ? f.entries : []
      };
    });
  }

  function fromCharacter(item, worldbooks) {
    item = item || {};
    return {
      kind: 'character',
      id: item.id || '',
      name: item.name || '未命名',
      gender: item.gender || '',
      nationality: item.nationality || '',
      avatar: item.avatar || '',
      setting: item.setting || item.desc || item.persona || '',
      greetings: Array.isArray(item.greetings) ? item.greetings.slice() : [],
      worldbooks: Array.isArray(worldbooks) ? worldbooks : [],
      createdAt: Date.now()
    };
  }

  function fromUser(mask, extra) {
    mask = mask || {};
    return {
      kind: 'user',
      id: mask.id || '',
      name: mask.name || '未命名',
      gender: mask.gender || '',
      nationality: mask.nationality || '中国',
      avatar: (extra && extra.avatar) || mask.avatar || '',
      setting: mask.setting || '',
      greetings: Array.isArray(mask.greetings) ? mask.greetings.slice() : [],
      worldbooks: [],
      createdAt: Date.now()
    };
  }

  window.NanoCardTicket = {
    VERSION: 1,
    TICKET_W: TICKET_W,
    TICKET_H: TICKET_H,
    fromCharacter: fromCharacter,
    fromUser: fromUser,
    loadWorldbooksForCharacter: loadWorldbooksForCharacter,
    buildCardJson: buildCardJson,
    renderBlob: renderBlob,
    printPayload: printPayload,
    saveBlob: saveBlob,
    serialOf: serialOf
  };
})();
