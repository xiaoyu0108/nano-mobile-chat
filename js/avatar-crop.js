/* avatar-crop.js — 通用头像裁剪（默认 1:1，可拖动 / 双指缩放 / 自动裁剪）
   用法：NanoAvatarCrop.open(file, { outputSize: 320, quality: .9 })
   返回 Promise<string|null>：确认返回 dataURL，取消返回 null。 */
(function () {
  'use strict';
  if (window.NanoAvatarCrop) return;

  var STYLE_ID = 'nano-avatar-crop-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.nac-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;',
      'background:rgba(8,8,12,.74);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);',
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",sans-serif;}',
      '.nac-card{width:100%;max-width:420px;background:#1c1c1e;border:1px solid rgba(255,255,255,.1);border-radius:24px;',
      'padding:18px 18px 16px;color:#fff;box-shadow:0 24px 70px rgba(0,0,0,.55);}',
      '.nac-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:14px;}',
      '.nac-head b{font-size:17px;font-weight:700;letter-spacing:-.2px;}',
      '.nac-head span{font-size:10.5px;color:rgba(255,255,255,.52);}',
      '.nac-viewport{position:relative;margin:0 auto;overflow:hidden;border-radius:18px;background:#000;touch-action:none;cursor:grab;}',
      '.nac-viewport:active{cursor:grabbing;}',
      '.nac-viewport::after{content:"";position:absolute;inset:0;border-radius:18px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);pointer-events:none;z-index:3;}',
      '.nac-grid{position:absolute;inset:0;pointer-events:none;z-index:2;opacity:.34;',
      'background-image:linear-gradient(to right,rgba(255,255,255,.8) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.8) 1px,transparent 1px);',
      'background-size:33.333% 33.333%;}',
      '.nac-img{position:absolute;left:0;top:0;max-width:none;z-index:1;user-select:none;-webkit-user-drag:none;pointer-events:none;}',
      '.nac-zoom-row{display:flex;align-items:center;gap:10px;margin:13px 2px 0;color:rgba(255,255,255,.6);font-size:11px;}',
      '.nac-zoom-row input{flex:1;accent-color:#e85c8a;}',
      '.nac-actions{display:flex;align-items:center;gap:8px;margin-top:14px;}',
      '.nac-actions button{flex:1;height:40px;border:0;border-radius:13px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;}',
      '.nac-actions .nac-auto{background:rgba(255,255,255,.1);color:rgba(255,255,255,.82);flex:.9;}',
      '.nac-actions .nac-cancel{background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);flex:.7;}',
      '.nac-actions .nac-ok{background:#e85c8a;color:#fff;flex:1.2;}',
      '.nac-actions button:active{transform:scale(.97);}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  function open(file, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!file) { resolve(null); return; }
      if (!file.type || String(file.type).indexOf('image/') !== 0) { resolve(null); return; }
      var reader = new FileReader();
      reader.onload = function (e) {
        try { show(String(e.target.result || ''), opts, resolve); }
        catch (err) { resolve(null); }
      };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(file);
    });
  }

  function show(src, opts, resolve) {
    ensureStyle();
    var aspect = Number(opts.aspect) > 0 ? Number(opts.aspect) : 1;
    var maxCard = Math.max(180, Math.min(window.innerWidth - 48, 380));
    var vw = Math.max(180, Math.min(maxCard, window.innerHeight - 280, 360));
    var vh = Math.max(150, Math.round(vw / aspect));

    var root = document.createElement('div');
    root.className = 'nac-overlay';
    root.innerHTML =
      '<div class="nac-card">' +
        '<div class="nac-head"><b>' + (opts.title || '裁剪头像') + '</b><span>拖动 / 双指缩放</span></div>' +
        '<div class="nac-viewport"><img class="nac-img" alt=""><div class="nac-grid"></div></div>' +
        '<div class="nac-zoom-row"><span>缩放</span><input class="nac-zoom" type="range" min="1" max="5" step="0.01" value="1"></div>' +
        '<div class="nac-actions">' +
          '<button type="button" class="nac-auto">自动裁剪</button>' +
          '<button type="button" class="nac-cancel">取消</button>' +
          '<button type="button" class="nac-ok">使用</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    var view = root.querySelector('.nac-viewport');
    var img = root.querySelector('.nac-img');
    var zoom = root.querySelector('.nac-zoom');
    view.style.width = vw + 'px';
    view.style.height = vh + 'px';

    var iw = 0, ih = 0, baseScale = 1, scale = 1, x = 0, y = 0;
    var minScale = 1, maxScale = 1;
    var pointers = {};
    var pointerCount = 0;
    var dragStart = null;
    var pinchStart = null;

    function localPoint(e) {
      var r = view.getBoundingClientRect();
      return { x: (e.clientX - r.left), y: (e.clientY - r.top) };
    }

    function clampXY() {
      x = clamp(x, Math.min(0, vw - iw * scale), Math.max(0, vw - iw * scale));
      y = clamp(y, Math.min(0, vh - ih * scale), Math.max(0, vh - ih * scale));
      if (iw * scale <= vw) x = (vw - iw * scale) / 2;
      if (ih * scale <= vh) y = (vh - ih * scale) / 2;
    }

    function render() {
      img.style.width = (iw * scale) + 'px';
      img.style.height = (ih * scale) + 'px';
      img.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      try { zoom.value = String(scale / baseScale); } catch (e) {}
    }

    function setScaleAt(newScale, p) {
      newScale = clamp(newScale, minScale, maxScale);
      var px = p ? p.x : vw / 2;
      var py = p ? p.y : vh / 2;
      var wx = (px - x) / scale;
      var wy = (py - y) / scale;
      scale = newScale;
      x = px - wx * scale;
      y = py - wy * scale;
      clampXY();
      render();
    }

    function autoCrop() {
      if (!iw || !ih || !isFinite(iw) || !isFinite(ih)) return;
      baseScale = Math.max(vw / iw, vh / ih);
      minScale = baseScale;
      maxScale = baseScale * 5;
      scale = baseScale;
      x = (vw - iw * scale) / 2;
      y = (vh - ih * scale) / 2;
      clampXY();
      render();
    }

    img.onload = function () {
      iw = img.naturalWidth || img.width || 1;
      ih = img.naturalHeight || img.height || 1;
      autoCrop();
    };
    img.onerror = function () { cleanup(null); };
    img.src = src;

    function beginDrag(e) {
      var p = localPoint(e);
      pointers[e.pointerId] = p;
      pointerCount++;
      try { view.setPointerCapture(e.pointerId); } catch (err) {}
      if (pointerCount === 1) {
        dragStart = { x: p.x, y: p.y, ix: x, iy: y };
        pinchStart = null;
      } else if (pointerCount === 2) {
        var ids = Object.keys(pointers);
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinchStart = {
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          mx: (a.x + b.x) / 2,
          my: (a.y + b.y) / 2,
          scale: scale
        };
        dragStart = null;
      }
    }

    function moveDrag(e) {
      if (!pointers[e.pointerId]) return;
      var p = localPoint(e);
      pointers[e.pointerId] = p;
      if (pointerCount >= 2 && pinchStart) {
        var ids = Object.keys(pointers);
        var a = pointers[ids[0]], b = pointers[ids[1]];
        if (!a || !b) return;
        var dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        setScaleAt(pinchStart.scale * (dist / pinchStart.dist), mid);
      } else if (dragStart) {
        x = dragStart.ix + (p.x - dragStart.x);
        y = dragStart.iy + (p.y - dragStart.y);
        clampXY();
        render();
      }
    }

    function endDrag(e) {
      if (pointers[e.pointerId]) {
        delete pointers[e.pointerId];
        pointerCount = Math.max(0, pointerCount - 1);
      }
      try { view.releasePointerCapture(e.pointerId); } catch (err) {}
      if (pointerCount < 2) pinchStart = null;
      if (pointerCount === 1) {
        var ids = Object.keys(pointers);
        var p = pointers[ids[0]];
        if (p) dragStart = { x: p.x, y: p.y, ix: x, iy: y };
      } else if (pointerCount === 0) {
        dragStart = null;
      }
    }

    view.addEventListener('pointerdown', beginDrag);
    view.addEventListener('pointermove', moveDrag);
    view.addEventListener('pointerup', endDrag);
    view.addEventListener('pointercancel', endDrag);
    view.addEventListener('wheel', function (e) {
      e.preventDefault();
      var factor = Math.exp(-e.deltaY * 0.0016);
      setScaleAt(scale * factor, localPoint(e));
    }, { passive: false });
    zoom.addEventListener('input', function () {
      setScaleAt(baseScale * Number(zoom.value || 1), null);
    });

    root.querySelector('.nac-auto').addEventListener('click', function () {
      autoCrop();
    });

    function cleanup(result) {
      try { root.remove(); } catch (e) {}
      try { document.removeEventListener('keydown', onKey, true); } catch (e) {}
      resolve(result == null ? null : result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    }
    document.addEventListener('keydown', onKey, true);

    root.querySelector('.nac-cancel').addEventListener('click', function () { cleanup(null); });
    root.addEventListener('click', function (e) { if (e.target === root) cleanup(null); });
    root.querySelector('.nac-ok').addEventListener('click', function () {
      try {
        if (!iw || !ih || !scale) { cleanup(null); return; }
        var outSize = Math.max(96, Math.min(Number(opts.outputSize) || 320, 1024));
        var outW = outSize;
        var outH = Math.max(1, Math.round(outSize / aspect));
        var cv = document.createElement('canvas');
        cv.width = outW;
        cv.height = outH;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = opts.background || '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        var sx = -x / scale;
        var sy = -y / scale;
        var sw = vw / scale;
        var sh = vh / scale;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        var type = opts.format || 'image/jpeg';
        var quality = opts.quality != null ? Number(opts.quality) : 0.9;
        cleanup(cv.toDataURL(type, quality));
      } catch (err) {
        cleanup(null);
      }
    });
  }

  window.NanoAvatarCrop = { open: open };
})();
