// nano-call-audio.js - 通话语音缓存 / 播放 / 下载（IndexedDB + 简单 ZIP）
(function () {
    'use strict';

    var DB_NAME = 'nano_call_audio_db';
    var DB_VERSION = 1;
    var STORE = 'clips';
    var dbPromise = null;
    var currentAudio = null;
    var currentUrl = '';

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
                req.onsuccess = function (e) { resolve(e.target.result); };
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
                tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(true); };
                tx.onerror = function (e) { try { db.close(); } catch (err) {} reject(e.target.error); };
            });
        }).catch(function () { return false; });
    }

    function getClip(clipId) {
        if (!clipId) return Promise.resolve(null);
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).get(String(clipId));
                req.onsuccess = function () { try { db.close(); } catch (e) {} resolve(req.result || null); };
                req.onerror = function () { try { db.close(); } catch (e) {} resolve(null); };
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
                        if (--left === 0) { try { db.close(); } catch (e) {} resolve(out.filter(Boolean)); }
                    };
                    req.onerror = function () {
                        out[idx] = null;
                        if (--left === 0) { try { db.close(); } catch (e) {} resolve(out.filter(Boolean)); }
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
    }

    function playClip(clipId) {
        return getClip(clipId).then(function (row) {
            if (!row || !row.blob) return false;
            stop();
            currentUrl = URL.createObjectURL(row.blob);
            currentAudio = new Audio(currentUrl);
            currentAudio.onended = function () { stop(); };
            currentAudio.onerror = function () { stop(); };
            return currentAudio.play().then(function () { return true; }).catch(function () { stop(); return false; });
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

    function downloadAll(clipIds, filename) {
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

    window.NanoCallAudio = {
        saveClip: saveClip,
        getClip: getClip,
        getClips: getClips,
        play: playClip,
        stop: stop,
        download: downloadClip,
        downloadAll: downloadAll,
        _buildZip: buildZip
    };
})();
