// nano-call-ringtone.js - 视频 / 语音通话的自定义 MP3 铃声
(function () {
    'use strict';

    var DB_NAME = 'nano_app_storage';
    var STORE = 'kv';
    var KEY = 'nano_call_ringtone';
    var MAX_SIZE = 12 * 1024 * 1024;
    var dbPromise = null;
    var loadPromise = null;
    var url = '';
    var name = '';
    var audio = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
            } catch (e) { reject(e); }
        }).catch(function (e) { dbPromise = null; throw e; });
        return dbPromise;
    }

    function read() {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
                    req.onsuccess = function () { resolve(req.result || null); };
                    req.onerror = function () { resolve(null); };
                } catch (e) { resolve(null); }
            });
        }).catch(function () { return null; });
    }

    function write(data) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put(data, KEY);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { reject(tx.error); };
                    tx.onabort = function () { reject(tx.error); };
                } catch (e) { reject(e); }
            });
        }).catch(function () { return false; });
    }

    function remove() {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).delete(KEY);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { resolve(false); };
                } catch (e) { resolve(false); }
            });
        }).catch(function () { return false; });
    }

    function clearAudio() {
        if (audio) {
            try { audio.pause(); } catch (e) {}
            audio = null;
        }
        if (url) {
            try { URL.revokeObjectURL(url); } catch (e) {}
            url = '';
        }
    }

    function apply(data) {
        clearAudio();
        if (!data || !data.blob) {
            name = '';
            updateLabel();
            return;
        }
        try { url = URL.createObjectURL(data.blob); } catch (e) { url = ''; }
        name = String(data.name || '自定义铃声');
        updateLabel();
    }

    function updateLabel() {
        var el = document.getElementById('ringtoneName');
        if (!el) return;
        el.textContent = name || '默认铃声';
    }

    function load() {
        if (loadPromise) return loadPromise;
        loadPromise = read().then(function (data) {
            apply(data);
            return !!url;
        });
        return loadPromise;
    }

    function saveFile(file) {
        if (!file) return Promise.resolve(false);
        var isMp3 = /\.mp3$/i.test(file.name || '') || /^audio\/(mpeg|mp3)$/i.test(file.type || '');
        if (!isMp3) {
            alert('请选择 MP3 格式的铃声');
            return Promise.resolve(false);
        }
        if (file.size > MAX_SIZE) {
            alert('铃声文件不能超过 12MB');
            return Promise.resolve(false);
        }
        var data = { blob: file, name: file.name || '自定义铃声', at: Date.now() };
        return write(data).then(function (ok) {
            if (!ok) {
                alert('铃声保存失败，请重试');
                return false;
            }
            apply(data);
            return true;
        });
    }

    function reset() {
        return remove().then(function () {
            apply(null);
            return true;
        });
    }

    // 返回 true 表示已开始播放自定义铃声；没有自定义铃声时返回 false，让调用方播放默认音。
    function start(fallback) {
        if (!url) return false;
        try {
            var a = new Audio(url);
            a.loop = true;
            a.volume = 0.85;
            audio = a;
            var p = a.play();
            if (p && typeof p.catch === 'function') {
                p.catch(function () {
                    if (audio === a) audio = null;
                    try { a.pause(); } catch (e) {}
                    if (typeof fallback === 'function') fallback();
                });
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function stop() {
        if (audio) {
            try {
                audio.pause();
                audio.currentTime = 0;
            } catch (e) {}
            audio = null;
        }
    }

    function bind() {
        var pick = document.getElementById('ringtonePick');
        var input = document.getElementById('ringtoneInput');
        var resetBtn = document.getElementById('ringtoneReset');
        if (!pick || !input || !resetBtn) return;
        pick.addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () {
            var f = input.files && input.files[0];
            input.value = '';
            if (!f) return;
            saveFile(f).then(function (ok) {
                if (ok) {
                    var el = document.getElementById('ringtoneName');
                    if (el) el.textContent = name || '自定义铃声';
                }
            });
        });
        resetBtn.addEventListener('click', function () {
            reset().then(function () {
                var el = document.getElementById('ringtoneName');
                if (el) el.textContent = '默认铃声';
            });
        });
        updateLabel();
    }

    window.NanoCallRingtone = {
        load: load,
        bind: bind,
        save: saveFile,
        reset: reset,
        start: start,
        stop: stop,
        getName: function () { return name; }
    };

    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { bind(); load(); });
        } else {
            bind();
            load();
        }
    } catch (e) {}
})();
