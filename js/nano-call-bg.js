// nano-call-bg.js - 语音 / 视频通话背景（图片、GIF、短视频 / Live 图）
(function () {
    'use strict';

    var DB_NAME = 'nano_call_media_db';
    var STORE = 'media';
    var KEY = 'background';
    var KEY_PREFIX = 'background:';
    var LEGACY_KEY = 'video_call_bg';
    var dbPromise = null;
    var videoUrl = '';
    var videoEl = null;

    function keyFor(chatId) {
        chatId = String(chatId || '').trim();
        return chatId ? (KEY_PREFIX + chatId) : KEY;
    }

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
            } catch (e) { reject(e); }
        }).catch(function (e) { dbPromise = null; throw e; });
        return dbPromise;
    }

    function readRaw(chatId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(keyFor(chatId));
                    req.onsuccess = function () { resolve(req.result || null); };
                    req.onerror = function () { resolve(null); };
                } catch (e) { resolve(null); }
            });
        }).catch(function () { return null; });
    }

    function writeRaw(rec) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put(rec);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { reject(tx.error); };
                    tx.onabort = function () { reject(tx.error); };
                } catch (e) { reject(e); }
            });
        }).catch(function () { return false; });
    }

    function load(chatId) {
        return readRaw(chatId).then(function (rec) {
            if (rec && rec.kind === 'image' && rec.value) return { kind: 'image', value: rec.value };
            if (rec && rec.kind === 'video' && rec.blob) return { kind: 'video', blob: rec.blob, url: rec.url || '' };
            if (chatId) return readRaw('').then(function (globalRec) {
                if (globalRec && globalRec.kind === 'image' && globalRec.value) return { kind: 'image', value: globalRec.value };
                if (globalRec && globalRec.kind === 'video' && globalRec.blob) return { kind: 'video', blob: globalRec.blob, url: globalRec.url || '' };
                var legacy = '';
                try { legacy = localStorage.getItem(LEGACY_KEY) || ''; } catch (e) {}
                if (legacy) return { kind: 'image', value: legacy };
                return null;
            });
            var legacy = '';
            try { legacy = localStorage.getItem(LEGACY_KEY) || ''; } catch (e) {}
            if (legacy) return { kind: 'image', value: legacy };
            return null;
        });
    }

    function setImage(dataUrl, chatId) {
        dataUrl = String(dataUrl || '');
        if (!dataUrl) return Promise.resolve(false);
        try { if (!chatId) localStorage.setItem(LEGACY_KEY, dataUrl); } catch (e) {}
        stopVideo();
        return writeRaw({ key: keyFor(chatId), kind: 'image', value: dataUrl, at: Date.now() });
    }

    function setVideo(blob, name, chatId) {
        if (!blob) return Promise.resolve(false);
        try { if (!chatId) localStorage.removeItem(LEGACY_KEY); } catch (e) {}
        return writeRaw({ key: keyFor(chatId), kind: 'video', blob: blob, name: String(name || 'live'), at: Date.now() }).then(function (ok) {
            if (ok) {
                var rc = document.querySelector('.nano-call-bg-video');
                if (rc) {
                    try { rc.src = URL.createObjectURL(blob); rc.play().catch(function () {}); } catch (e) {}
                }
            }
            return ok;
        });
    }

    function clear(chatId) {
        try { if (!chatId) localStorage.removeItem(LEGACY_KEY); } catch (e) {}
        stopVideo();
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).delete(keyFor(chatId));
                    if (!chatId) tx.objectStore(STORE).delete(KEY);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { resolve(false); };
                } catch (e) { resolve(false); }
            });
        }).catch(function () { return false; });
    }

    function previewElement() {
        return document.getElementById('callBgVideo');
    }

    function stopVideo() {
        if (videoEl) {
            try { videoEl.pause(); } catch (e) {}
        }
        if (videoUrl) {
            try { URL.revokeObjectURL(videoUrl); } catch (e) {}
            videoUrl = '';
        }
        var el = previewElement();
        if (el) {
            try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
            el.style.display = 'none';
        }
        try { document.body.classList.remove('has-call-video-bg'); } catch (e) {}
        videoEl = null;
    }

    function playElement(el, blob, keepUrl) {
        if (!el || !blob) return false;
        try {
            if (!keepUrl) {
                if (videoUrl) { try { URL.revokeObjectURL(videoUrl); } catch (e) {} }
                videoUrl = URL.createObjectURL(blob);
            }
            el.src = keepUrl ? URL.createObjectURL(blob) : videoUrl;
            el.muted = true;
            el.loop = true;
            el.playsInline = true;
            el.style.display = 'block';
            var p = el.play();
            if (p && p.catch) p.catch(function () {});
            return true;
        } catch (e) { return false; }
    }

    function showVideo(blob) {
        if (!blob) return false;
        stopVideo();
        var el = previewElement();
        if (!el) return false;
        var ok = playElement(el, blob, false);
        if (ok) {
            videoEl = el;
            try { document.body.classList.add('has-call-video-bg'); } catch (e) {}
        }
        return ok;
    }

    window.NanoCallBg = {
        load: load,
        setImage: setImage,
        setVideo: setVideo,
        clear: clear,
        showVideo: showVideo,
        stopVideo: stopVideo
    };
})();
