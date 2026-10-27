(function () {
    'use strict';
    function readLocal() {
        try {
            var raw = localStorage.getItem('nano_api_config');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function getConfig() {
        return new Promise(function (resolve) {
            var local = readLocal();
            var done = false;
            function finish(v) { if (done) return; done = true; resolve(v && (v.value || v) || local); }
            try {
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
                };
                req.onerror = function () { finish(local); };
                req.onsuccess = function (e) {
                    var db = e.target.result;
                    try {
                        var g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                        g.onsuccess = function () { finish(g.result ? (g.result.value || g.result) : local); };
                        g.onerror = function () { finish(local); };
                    } catch (err) { finish(local); }
                };
            } catch (e) { finish(local); }
        });
    }
    function toV1(url) {
        url = String(url || '').trim().replace(/\/+$/, '');
        if (/\/v1$/i.test(url)) return url;
        if (/\/images\/generations$/i.test(url) || /\/images\/edits$/i.test(url)) return url.replace(/\/images\/(generations|edits)$/i, '/v1');
        return url + '/v1';
    }
    function dataUrlToBlob(u) {
        var comma = u.indexOf(',');
        var mime = (u.slice(5, comma).split(';')[0]) || 'image/png';
        var bstr = atob(u.slice(comma + 1));
        var arr = new Uint8Array(bstr.length);
        for (var i = 0; i < bstr.length; i++) arr[i] = bstr.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }
    async function generate(prompt, opts) {
        opts = opts || {};
        var cfg = await getConfig();
        if (!cfg) throw new Error('未配置 API');
        var rawUrl = String(cfg.imgUrl || '').trim();
        var key = String(cfg.imgKey || '').trim();
        var model = String(cfg.imgModel || '').trim();
        if (!rawUrl || !key || !model) throw new Error('请先在 API → 生图里配置地址、Key 和模型');
        var base = toV1(rawUrl);
        var faceRef = String(opts.faceRef || '');
        var persist = async function (u) {
            try {
                if (u && window.NanoImageCache && /^https?:\/\//i.test(u)) {
                    var d = await NanoImageCache.toDataUrl(u);
                    if (d) return d;
                }
            } catch (e) {}
            return u;
        };
        if (faceRef && faceRef.indexOf('data:') === 0) {
            try {
                var fd = new FormData();
                fd.append('model', model);
                fd.append('prompt', prompt);
                fd.append('n', '1');
                fd.append('size', opts.size || '1024x1024');
                fd.append('image', dataUrlToBlob(faceRef), 'ref.png');
                var er = await fetch(base + '/images/edits', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key }, body: fd });
                if (er.ok) {
                    var ed = await er.json();
                    var ei = ed && ed.data && ed.data[0];
                    if (ei && ei.url) return await persist(ei.url);
                    if (ei && ei.b64_json) return 'data:image/png;base64,' + ei.b64_json;
                }
            } catch (e) {}
        }
        var body = { model: model, prompt: prompt, n: 1, size: opts.size || '1024x1024' };
        if (faceRef) { body.image = faceRef; body.reference_image = [faceRef]; body.input_reference_image = [faceRef]; }
        var resp = await fetch(base + '/images/generations', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            var msg = 'HTTP ' + resp.status;
            try { var d = await resp.json(); msg = (d.error && d.error.message) || d.message || msg; } catch (e) {}
            throw new Error(msg);
        }
        var data = await resp.json();
        var item = data && data.data && data.data[0];
        if (item && item.url) return await persist(item.url);
        if (item && item.b64_json) return 'data:image/png;base64,' + item.b64_json;
        throw new Error('生图接口未返回图片');
    }
    window.NanoImage = { generate: generate, getConfig: getConfig };
})();
