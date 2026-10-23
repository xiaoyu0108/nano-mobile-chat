// nano-call-audio.js - 通话语音缓存 / 播放 / 下载（IndexedDB + 简单 ZIP）
(function () {
    'use strict';

    var DB_NAME = 'nano_call_audio_db';
    var DB_VERSION = 1;
    var STORE = 'clips';
    var dbPromise = null;
    var currentAudio = null;
    var currentUrl = '';
    var activeClipId = '';
    var paused = false;
    var stateListeners = [];

    var PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    var PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>';

    function getState() {
        return { clipId: activeClipId, playing: !!currentAudio && !paused, paused: !!paused };
    }

    // 统一刷新所有「播放/暂停」按钮，页面上新增按钮后调用 sync() 即可。
    function syncButtons(state) {
        state = state || getState();
        var list = document.querySelectorAll('[data-call-audio-clip]');
        Array.prototype.forEach.call(list, function (btn) {
            var id = btn.getAttribute('data-call-audio-clip');
            var playing = state.clipId === id && state.playing && !state.paused;
            var isPaused = state.clipId === id && state.paused;
            btn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
            btn.title = playing ? '暂停' : (isPaused ? '继续播放' : '播放本轮语音');
            btn.setAttribute('aria-label', btn.title);
            btn.classList.toggle('is-playing', playing);
            btn.classList.toggle('is-paused', isPaused);
        });
    }

    function emitState() {
        var st = getState();
        stateListeners.slice().forEach(function (fn) {
            try { fn(st); } catch (e) {}
        });
        syncButtons(st);
    }

    function onStateChange(fn) {
        if (typeof fn !== 'function') return function () {};
        stateListeners.push(fn);
        try { fn(getState()); } catch (e) {}
        return function () {
            var i = stateListeners.indexOf(fn);
            if (i >= 0) stateListeners.splice(i, 1);
        };
    }

    function pause() {
        if (!currentAudio || paused) return false;
        try { currentAudio.pause(); } catch (e) {}
        paused = true;
        emitState();
        return true;
    }

    function resume() {
        if (!currentAudio || !paused) return Promise.resolve(false);
        paused = false;
        emitState();
        try {
            var p = currentAudio.play();
            if (p && typeof p.catch === 'function') {
                return p.then(function () { return true; }).catch(function () {
                    paused = true; emitState(); return false;
                });
            }
        } catch (e) {
            paused = true; emitState(); return Promise.resolve(false);
        }
        return Promise.resolve(true);
    }

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE)) {
                        var st = db.createObjectStore(STORE, { keyPath: 'clipId' });
                        try { st.createIndex('callId', 'callId', { unique: false }); } catch (err) {}
                    }
                };
                req.onsuccess = function (e) {
                    var db = e.target.result;
                    try {
                        db.onversionchange = function () {
                            try { db.close(); } catch (err) {}
                            dbPromise = null;
                        };
                    } catch (err) {}
                    resolve(db);
                };
                req.onerror = function (e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
        return dbPromise;
    }

    function saveClip(clipId, blob, meta) {
        if (!clipId || !blob) return Promise.resolve(false);
        meta = meta || {};
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put({
                    clipId: String(clipId),
                    callId: String(meta.callId || ''),
                    turnSeq: Number(meta.turnSeq) || 0,
                    isUser: !!meta.isUser,
                    text: String(meta.text || ''),
                    at: Number(meta.at) || Date.now(),
                    mime: blob.type || 'audio/mpeg',
                    blob: blob
                });
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function (e) { reject(e.target.error); };
            });
        }).catch(function () { return false; });
    }

    function getClip(clipId) {
        if (!clipId) return Promise.resolve(null);
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).get(String(clipId));
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { resolve(null); };
            });
        }).catch(function () { return null; });
    }

    function getClips(ids) {
        var list = (Array.isArray(ids) ? ids : []).filter(Boolean);
        if (!list.length) return Promise.resolve([]);
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE, 'readonly');
                var store = tx.objectStore(STORE);
                var out = new Array(list.length);
                var left = list.length;
                list.forEach(function (id, idx) {
                    var req = store.get(String(id));
                    req.onsuccess = function () {
                        out[idx] = req.result || null;
                        if (--left === 0) resolve(out.filter(Boolean));
                    };
                    req.onerror = function () {
                        out[idx] = null;
                        if (--left === 0) resolve(out.filter(Boolean));
                    };
                });
            });
        }).catch(function () { return []; });
    }

    function stop() {
        if (currentAudio) {
            try { currentAudio.pause(); } catch (e) {}
            try { currentAudio.currentTime = 0; } catch (e) {}
            currentAudio = null;
        }
        if (currentUrl) {
            try { URL.revokeObjectURL(currentUrl); } catch (e) {}
            currentUrl = '';
        }
        activeClipId = '';
        paused = false;
        emitState();
    }

    function playClip(clipId) {
        var id = String(clipId);
        // 同一轮再点一次：播放中就暂停，暂停中就继续。
        if (activeClipId === id && currentAudio) {
            if (paused) return resume();
            pause();
            return Promise.resolve(true);
        }
        return getClip(id).then(function (row) {
            if (!row || !row.blob) return false;
            stop();
            activeClipId = id;
            paused = false;
            currentUrl = URL.createObjectURL(row.blob);
            currentAudio = new Audio(currentUrl);
            currentAudio.onended = function () { stop(); };
            currentAudio.onerror = function () { stop(); };
            var p = currentAudio.play();
            if (p && typeof p.then === 'function') {
                return p.then(function () { emitState(); return true; }).catch(function () { stop(); return false; });
            }
            emitState();
            return true;
        }).catch(function () { return false; });
    }

    function downloadBlob(blob, filename) {
        if (!blob) return false;
        var url = URL.createObjectURL(blob);
        try {
            var a = document.createElement('a');
            a.href = url;
            a.download = filename || 'nano-call.mp3';
            a.rel = 'noopener';
            a.style.display = 'none';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(function () {
                try { a.remove(); } catch (e) {}
                try { URL.revokeObjectURL(url); } catch (e) {}
            }, 5000);
            return true;
        } catch (e) {
            try { window.open(url, '_blank'); } catch (err) {}
            return false;
        }
    }

    function safeName(name) {
        return String(name || 'audio').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    }

    function downloadClip(clipId, filename) {
        return getClip(clipId).then(function (row) {
            if (!row || !row.blob) return false;
            return downloadBlob(row.blob, filename || (safeName(row.text) || 'nano-call') + '.mp3');
        });
    }

    // ===== 极简 ZIP（store，不压缩）：把整通电话的 MP3 打包下载 =====
    var crcTable = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        var c = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function u16(view, off, v) { view.setUint16(off, v & 0xFFFF, true); }
    function u32(view, off, v) { view.setUint32(off, v >>> 0, true); }

    function dosTime(d) {
        var year = d.getFullYear();
        if (year < 1980) year = 1980;
        var dateVal = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        var timeVal = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
        return { date: dateVal, time: timeVal };
    }

    function buildZip(files) {
        var entries = [];
        var offset = 0;
        var localParts = [];
        var centralParts = [];
        var enc = new TextEncoder();
        var now = new Date();

        files.forEach(function (file, idx) {
            var data = file.bytes;
            var nameBytes = enc.encode(file.name);
            var crc = crc32(data);
            var dt = dosTime(file.date || now);
            var local = new Uint8Array(30 + nameBytes.length);
            var lv = new DataView(local.buffer);
            u32(lv, 0, 0x04034b50);
            u16(lv, 4, 20);
            u16(lv, 6, 0x0800);
            u16(lv, 8, 0);
            u16(lv, 10, dt.time);
            u16(lv, 12, dt.date);
            u32(lv, 14, crc);
            u32(lv, 18, data.length);
            u32(lv, 22, data.length);
            u16(lv, 26, nameBytes.length);
            u16(lv, 28, 0);
            local.set(nameBytes, 30);
            localParts.push(local, data);
            entries.push({ nameBytes: nameBytes, crc: crc, size: data.length, offset: offset, time: dt.time, date: dt.date });
            offset += local.length + data.length;
        });

        var centralSize = 0;
        entries.forEach(function (e) {
            var central = new Uint8Array(46 + e.nameBytes.length);
            var cv = new DataView(central.buffer);
            u32(cv, 0, 0x02014b50);
            u16(cv, 4, 20);
            u16(cv, 6, 20);
            u16(cv, 8, 0x0800);
            u16(cv, 10, 0);
            u16(cv, 12, e.time);
            u16(cv, 14, e.date);
            u32(cv, 16, e.crc);
            u32(cv, 20, e.size);
            u32(cv, 24, e.size);
            u16(cv, 28, e.nameBytes.length);
            u16(cv, 30, 0);
            u16(cv, 32, 0);
            u16(cv, 34, 0);
            u16(cv, 36, 0);
            u32(cv, 38, 0);
            u32(cv, 42, e.offset);
            central.set(e.nameBytes, 46);
            centralParts.push(central);
            centralSize += central.length;
        });

        var end = new Uint8Array(22);
        var ev = new DataView(end.buffer);
        u32(ev, 0, 0x06054b50);
        u16(ev, 4, 0);
        u16(ev, 6, 0);
        u16(ev, 8, entries.length);
        u16(ev, 10, entries.length);
        u32(ev, 12, centralSize);
        u32(ev, 16, offset);
        u16(ev, 20, 0);

        return new Blob(localParts.concat(centralParts, [end]), { type: 'application/zip' });
    }

    function downloadAllZip(clipIds, filename) {
        return getClips(clipIds).then(function (rows) {
            if (!rows.length) return false;
            return Promise.all(rows.map(function (row, idx) {
                return row.blob.arrayBuffer().then(function (buf) {
                    var seq = String(idx + 1).padStart(2, '0');
                    var base = row.isUser ? '用户' : '角色';
                    return {
                        name: seq + '_' + base + '_' + safeName(row.text || '语音') + '.mp3',
                        bytes: new Uint8Array(buf),
                        date: new Date(row.at || Date.now())
                    };
                });
            })).then(function (files) {
                var zip = buildZip(files);
                return downloadBlob(zip, filename || ('nano-call-' + Date.now() + '.zip'));
            });
        }).catch(function () { return false; });
    }

    // 整通电话的语音按顺序拼成一个 MP3：去掉后续音频片段开头的 ID3 标签，
    // 这样文件在播放器里能连续读完，而不是只播第一段。
    function id3v2Size(bytes) {
        if (!bytes || bytes.length < 10) return 0;
        if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
        var size = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14) | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F);
        var footer = (bytes[5] & 0x10) ? 10 : 0;
        return Math.min(bytes.length, 10 + size + footer);
    }

    function stripMp3Wrapper(bytes, keepHeadTag) {
        var start = keepHeadTag ? 0 : id3v2Size(bytes);
        var end = bytes.length;
        if (end - start >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47) {
            end -= 128;
        }
        return bytes.subarray(start, end);
    }

    function mergeMp3Buffers(buffers) {
        var parts = [];
        var total = 0;
        (buffers || []).forEach(function (buf, idx) {
            var bytes = stripMp3Wrapper(new Uint8Array(buf), idx === 0);
            if (!bytes.length) return;
            parts.push(bytes);
            total += bytes.length;
        });
        var out = new Uint8Array(total);
        var offset = 0;
        parts.forEach(function (bytes) {
            out.set(bytes, offset);
            offset += bytes.length;
        });
        return out;
    }

    function downloadAll(clipIds, filename) {
        return getClips(clipIds).then(function (rows) {
            if (!rows.length) return false;
            rows.sort(function (a, b) {
                return (Number(a.turnSeq) || 0) - (Number(b.turnSeq) || 0) ||
                    (Number(a.at) || 0) - (Number(b.at) || 0);
            });
            if (rows.length === 1) {
                return downloadBlob(rows[0].blob, filename || ('nano-call-' + Date.now() + '.mp3'));
            }
            return Promise.all(rows.map(function (row) {
                return row.blob.arrayBuffer();
            })).then(function (buffers) {
                var merged = mergeMp3Buffers(buffers);
                if (!merged.length) return false;
                return downloadBlob(new Blob([merged], { type: 'audio/mpeg' }), filename || ('nano-call-' + Date.now() + '.mp3'));
            });
        }).catch(function () { return false; });
    }

    window.NanoCallAudio = {
        saveClip: saveClip,
        getClip: getClip,
        getClips: getClips,
        play: playClip,
        stop: stop,
        pause: pause,
        resume: resume,
        getState: getState,
        sync: function () { syncButtons(); },
        onStateChange: onStateChange,
        download: downloadClip,
        downloadAll: downloadAll,
        downloadAllZip: downloadAllZip,
        _buildZip: buildZip,
        _mergeMp3: mergeMp3Buffers
    };
})();
