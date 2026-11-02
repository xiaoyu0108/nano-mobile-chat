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
                    // 和 API / 表情包模块共用 nano_api_db：顺手补齐 emoji_data，避免这里先建库后表情包 store 丢失。
                    if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
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
    function readLocalPrompts() {
        try {
            var raw = localStorage.getItem('nano_api_prompts');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    // API → 生图 → 提示词预设；之前只有朋友圈/生图室读取，线下生图完全没用上，
    // 导致 NAI 画师串、负面词、NSFW 提示都丢了。
    function getPrompts() {
        return new Promise(function (resolve) {
            var local = readLocalPrompts();
            var done = false;
            function finish(v) { if (done) return; done = true; resolve(v || local || {}); }
            try {
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
                    if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
                };
                req.onerror = function () { finish(local); };
                req.onsuccess = function (e) {
                    var db = e.target.result;
                    try {
                        var g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_prompts');
                        g.onsuccess = function () { finish(g.result ? (g.result.value || g.result) : local); };
                        g.onerror = function () { finish(local); };
                    } catch (err) { finish(local); }
                };
            } catch (e) { finish(local); }
        });
    }
    function joinPrompt(v) {
        if (Array.isArray(v)) return v.filter(Boolean).join(', ');
        return String(v == null ? '' : v).trim();
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
        var prompts = {};
        try { prompts = await getPrompts(); } catch (e) { prompts = {}; }
        var positive = joinPrompt(prompts && prompts.positive);
        var negative = joinPrompt(prompts && prompts.negative);
        var finalPrompt = String(prompt || '').trim();
        // 已由生图室等调用方自己拼过的不要重复加；否则把 API 里的画师串/风格词放在最前面。
        if (positive && finalPrompt.indexOf(positive) < 0) finalPrompt = positive + ', ' + finalPrompt;
        // 有参考图时必须把“保持这张脸”写进提示词，否则不少中转站只把参考图当普通附件。
        if (faceRef) {
            if (!/face lock|same face|consistent facial|character reference/i.test(finalPrompt)) {
                finalPrompt += ', same face, consistent facial features, same hairstyle, character reference, (face lock:1.2)';
            }
            if (!/(锁脸|参考图是|保持.{0,8}脸)/.test(finalPrompt)) {
                finalPrompt += '\n【锁脸】必须严格按照参考图保持人物五官、脸型、发型和肤色一致，不要换脸或生成另一个人。';
            }
        }
        // 让调用方/图库能看到真正发出去的完整提示词（含 API 画师串和负面词）。
        try {
            if (window.NanoImage) {
                window.NanoImage.lastPrompt = finalPrompt;
                window.NanoImage.lastNegativePrompt = negative;
            }
        } catch (e) {}
        var size = opts.size || '1024x1024';
        var wh = String(size).match(/(\d+)\s*[x×]\s*(\d+)/i) || [];
        var width = Number(wh[1]) || 1024;
        var height = Number(wh[2]) || 1024;
        var isNai = /(?:^|[^a-z])(?:nai|novelai)/i.test(model) || /novelai/i.test(rawUrl);
        // 普通模型通常忽略 negative_prompt：把反面词并入正面提示词，画师串和负面词才都真正生效。
        if (negative && !isNai && finalPrompt.indexOf(negative) < 0) finalPrompt += '\n避免：' + negative;
        try { if (window.NanoImage) window.NanoImage.lastPrompt = finalPrompt; } catch (e) {}
        var persist = async function (u) {
            try {
                if (u && window.NanoImageCache && /^(https?:\/\/|blob:)/i.test(u)) {
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
                fd.append('prompt', finalPrompt);
                fd.append('n', '1');
                fd.append('size', size);
                if (negative && isNai) fd.append('negative_prompt', negative);
                if (opts.nsfw) fd.append('nsfw', 'true');
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
        var body = { model: model, prompt: finalPrompt, n: 1, size: size };
        if (negative && isNai) body.negative_prompt = negative;
        if (opts.nsfw) body.nsfw = true;
        // NovelAI / NAI 中转：再补一份 NAI 常见参数，OpenAI 兼容站会忽略它们；
        // 真正的 NAI 中转可以直接读取 negative_prompt / nsfw / width / height。
        if (isNai) {
            body.input = finalPrompt;
            body.width = width;
            body.height = height;
            body.parameters = {
                width: width,
                height: height,
                negative_prompt: negative,
                nsfw: !!opts.nsfw,
                qualityToggle: true,
                ucPreset: 0,
                sampler: 'k_euler_ancestral',
                steps: 28,
                scale: 5
            };
        }
        if (faceRef) { body.image = faceRef; body.reference_image = [faceRef]; body.input_reference_image = [faceRef]; body.reference_images = [faceRef]; body.ref_image = faceRef; }
        var resp = await fetch(base + '/images/generations', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        // 有些 NAI 中转不认 parameters/width/height 这类扩展字段：失败后去掉它们再试一次。
        if (!resp.ok && isNai) {
            var simple = { model: model, prompt: finalPrompt, n: 1, size: size };
            if (negative && isNai) simple.negative_prompt = negative;
            if (opts.nsfw) simple.nsfw = true;
            if (faceRef) { simple.image = faceRef; simple.reference_image = [faceRef]; }
            try {
                resp = await fetch(base + '/images/generations', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
                    body: JSON.stringify(simple)
                });
            } catch (e) {}
        }
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
    window.NanoImage = { generate: generate, getConfig: getConfig, getPrompts: getPrompts };
})();
