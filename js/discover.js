// ============================================================
// discover.js — 照片墙（点击换图）+ 入口跳转
// ============================================================
(function () {
  'use strict';

  /* ---------------- 1. 照片轮播 ---------------- */
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var total = cards.length;
  var current = 0;
  var targetPhoto = 0;

  /* ---------------- 1.1 照片持久化（IndexedDB） ---------------- */
  var PHOTO_DB = 'nano_discover_db';
  var PHOTO_STORE = 'photos';
  function openPhotoDB() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(PHOTO_DB, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(PHOTO_STORE)) {
            db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }
  function savePhoto(id, dataUrl) {
    return openPhotoDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(PHOTO_STORE, 'readwrite');
          tx.objectStore(PHOTO_STORE).put({ id: id, data: dataUrl });
          tx.oncomplete = function () { db.close(); resolve(true); };
          tx.onerror = function () { db.close(); resolve(false); };
        } catch (e) { try { db.close(); } catch (err) {} resolve(false); }
      });
    }).catch(function () { return false; });
  }
  function getAllPhotos() {
    return openPhotoDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(PHOTO_STORE, 'readonly');
          var rq = tx.objectStore(PHOTO_STORE).getAll();
          rq.onsuccess = function () { resolve(rq.result || []); db.close(); };
          rq.onerror = function () { resolve([]); db.close(); };
        } catch (e) { resolve([]); }
      });
    }).catch(function () { return []; });
  }
  function cardImg(index) {
    var card = cards.filter(function (c) { return Number(c.dataset.index) === Number(index); })[0];
    return card ? card.querySelector('img') : null;
  }
  // 压缩到最长边 1400 的 JPEG；优先 createImageBitmap（自动校正方向、兼容 HEIC 等）
  async function compressImage(file) {
    if (window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        var max = 1400, w = bmp.width, h = bmp.height;
        if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
        else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
        try { bmp.close && bmp.close(); } catch (e) {}
        return cv.toDataURL('image/jpeg', 0.85);
      } catch (e) { /* 回退到 <img> 方案 */ }
    }
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var max = 1400, w = img.width, h = img.height;
            if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
            else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
            var cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(cv.toDataURL('image/jpeg', 0.85));
          } catch (e) { resolve(reader.result); }
        };
        img.onerror = function () { resolve(reader.result); };
        img.src = reader.result;
      };
      reader.onerror = function () { resolve(''); };
      reader.readAsDataURL(file);
    });
  }
  // 启动时恢复已保存的照片
  getAllPhotos().then(function (rows) {
    rows.forEach(function (row) {
      if (!row || row.data == null) return;
      var img = cardImg(row.id);
      if (img) img.src = row.data;
    });
  });

  function positionCards() {
    if (!total) return;
    cards.forEach(function (card) {
      var i = Number(card.dataset.index);
      var diff = (i - current + total) % total;
      card.className = 'card';
      if (diff === 0) card.classList.add('center');
      else if (diff === 1) card.classList.add('right');
      else if (diff === total - 1) card.classList.add('left');
      else if (diff === 2) card.classList.add('farright');
      else card.classList.add('farleft');
    });
  }

  if (total) {
    positionCards();

    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        var i = Number(card.dataset.index);
        if (i === current) {
          // 直接打开相册换图，不再弹选择框
          targetPhoto = i;
          if (fileInput) { fileInput.value = ''; fileInput.click(); }
        } else {
          current = i;
          positionCards();
        }
      });
    });

    var startX = 0;
    var carousel = document.getElementById('carousel');
    if (carousel) {
      carousel.addEventListener('touchstart', function (e) {
        startX = e.touches[0].clientX;
      }, { passive: true });

      carousel.addEventListener('touchend', function (e) {
        var dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 35) {
          current = (current + (dx < 0 ? 1 : -1) + total) % total;
          positionCards();
        }
      }, { passive: true });
    }
  }

  /* ---------------- 2. 换图（点击照片直接选图） ---------------- */
  var fileInput = document.getElementById('fileInput');
  var toast = document.getElementById('toast');

  function showToast(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast = setTimeout(function () {
      toast.classList.remove('show');
    }, 1100);
  }

  if (fileInput) {
    fileInput.addEventListener('change', async function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var dataUrl = await compressImage(file);
      if (!dataUrl) return;
      var img = cardImg(targetPhoto);
      if (img) img.src = dataUrl;
      await savePhoto(targetPhoto, dataUrl);
      showToast('photo saved');
    });
  }

  /* ---------------- 3. 入口跳转 ---------------- */
  var APPS = {
    moments: { url: 'moments.html', title: 'Moments' },
    ins:     { url: 'ins.html?v=14', title: 'Instagram' },
    couple:  { url: 'couple-spaces.html', title: 'Couple Spaces' },
    halo:    { url: 'halo.html', title: 'Halo' },
    books:   { url: 'books.html', title: 'Books' },
    music:   { url: 'music.html', title: 'Music' },
    memorypalace: { url: 'memory palace.html', title: 'Memory Palace', showBack: true },
    imessage: { url: 'imessage.html', title: 'iMessage', showBack: true },
    market:   { url: 'market.html', title: '共享集市', showBack: true },
    mcp:      { url: 'mcp.html', title: 'MCP', showBack: true },
    cycle:    { url: 'cycle.html', title: 'Moon Tide', showBack: true },
    fanfic:   { url: 'fanfic.html', title: 'Fanfic', showBack: true },
    mall:     { url: 'mall.html', title: 'Store 商城', showBack: true },
  appstore: { url: 'appstore.html', title: 'App Store', showBack: true },
    screenpeek: { url: 'ios-setting.html', title: '窥屏', showBack: true }
  };

  Array.prototype.forEach.call(document.querySelectorAll('.entry[data-app]'), function (el) {
    el.addEventListener('click', function () {
      var app = APPS[el.getAttribute('data-app')];
      if (!app) return;
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'openFullscreen',
            url: app.url,
            title: app.title,
            showBack: app.showBack === true,
            source: 'discover'
          }, '*');
          return;
        }
      } catch (e) { /* ignore */ }
      window.location.href = app.url;
    });
  });
})();