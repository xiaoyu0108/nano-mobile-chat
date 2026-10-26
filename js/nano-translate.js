/* nano-translate.js — 不消耗 API 额度的翻译插件
 *
 * 优先使用 Chrome 端侧 Translator API（本地模型、零 token）；
 * 不支持时退回免 key 的公共翻译接口；全部失败才返回空字符串，
 * 由 chat-core 决定是否再走用户自己的主 API。
 *
 * 用法：
 *   NanoTranslate.toZh(text)            // 翻译成简体中文
 *   NanoTranslate.translate(text, 'zh-CN')
 *   NanoTranslate.detectLang(text)
 */
(function () {
    'use strict';

    var CACHE_KEY = 'nano_translate_cache_v1';
    var CACHE_MAX = 240;
    var cache = {};

    function loadCache() {
        try {
            var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            if (raw && typeof raw === 'object') cache = raw;
        } catch (e) { cache = {}; }
    }
    function saveCache() {
        try {
            var keys = Object.keys(cache);
            if (keys.length > CACHE_MAX) {
                keys.slice(0, keys.length - CACHE_MAX).forEach(function (k) { delete cache[k]; });
            }
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {}
    }
    loadCache();

    function normalizeTarget(target) {
        target = String(target || 'zh-CN');
        if (/^zh/i.test(target)) return 'zh-CN';
        return target;
    }

    function heuristicLang(text) {
        var s = String(text || '');
        if (!s.trim()) return '';
        if (/[\u3040-\u30ff]/.test(s)) return 'ja';
        if (/[\uac00-\ud7af]/.test(s)) return 'ko';
        if (/[\u0400-\u04ff]/.test(s)) return 'ru';
        if (/[\u0600-\u06ff]/.test(s)) return 'ar';
        if (/[\u0e00-\u0e7f]/.test(s)) return 'th';
        if (/[\u0900-\u097f]/.test(s)) return 'hi';
        // 汉字单独统计（不含假名），假名已在上面优先判为日文。
        var cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
        var latin = (s.match(/[A-Za-z]/g) || []).length;
        if (cjk && !latin) return 'zh';
        if (cjk && cjk > latin * 2) return 'zh';
        if (/[À-ÖØ-öø-ÿĀ-ž]/.test(s)) return '';   // 法/德/西等拉丁语系：交给 sl=auto 的免费接口
        if (latin >= 2) return 'en';
        return '';
    }

    async function detectLang(text) {
        var D = (typeof self !== 'undefined' && (self.LanguageDetector || (self.ai && self.ai.languageDetector)));
        if (D && D.create) {
            try {
                var d = await D.create();
                var res = await d.detect(String(text || '').slice(0, 500));
                try { d.destroy && d.destroy(); } catch (e) {}
                var first = Array.isArray(res) ? res[0] : res;
                var lang = first && (first.detectedLanguage || first.language);
                if (lang && Number(first.confidence == null ? 1 : first.confidence) >= 0.5) return String(lang);
            } catch (e) {}
        }
        return heuristicLang(text);
    }

    async function builtinTranslate(text, target) {
        var T = (typeof self !== 'undefined' && (self.Translator || (self.ai && self.ai.translator)));
        if (!T || !T.create) return '';
        try {
            var src = await detectLang(text);
            var btTarget = /^zh/i.test(target) ? 'zh' : target;
            if (!src || src === btTarget || (/^zh/i.test(src) && /^zh/i.test(btTarget))) return '';
            if (T.availability) {
                var avail = await T.availability({ sourceLanguage: src, targetLanguage: btTarget });
                if (avail === 'unavailable') return '';
            }
            var tr = await T.create({ sourceLanguage: src, targetLanguage: btTarget });
            var out = await tr.translate(String(text || ''));
            try { tr.destroy && tr.destroy(); } catch (e) {}
            return String(out || '').trim();
        } catch (e) {
            return '';
        }
    }

    function googleTranslate(text, target) {
        var u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
            encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(String(text || ''));
        return fetch(u, { cache: 'no-store' }).then(function (r) {
            return r && r.ok ? r.json() : null;
        }).then(function (j) {
            if (!Array.isArray(j) || !Array.isArray(j[0])) return '';
            return j[0].map(function (x) { return (x && x[0]) || ''; }).join('').trim();
        }).catch(function () { return ''; });
    }

    // 通过已有的推送 Worker 转发翻译：Cloudflare 出口通常能访问 Google/MyMemory，
    // 也能绕开浏览器 CORS 和部分地区网络限制；仍然不消耗模型 API。
    function workerTranslate(text, target) {
        try {
            var base = (localStorage.getItem('nano_push_endpoint') || '').trim();
            if (!base) base = 'https://nanopush.nano315.online';
            base = base.replace(/\/+$/, '');
            var token = '';
            try {
                token = localStorage.getItem('nano_push_token') || localStorage.getItem('nano_peek_token') || '';
            } catch (e) {}
            var u = base + '/translate?text=' + encodeURIComponent(String(text || '')) +
                '&to=' + encodeURIComponent(target) + (token ? ('&token=' + encodeURIComponent(token)) : '');
            return fetch(u, { cache: 'no-store' }).then(function (r) {
                return r && r.ok ? r.json() : null;
            }).then(function (j) {
                return (j && j.ok && String(j.text || '').trim()) || '';
            }).catch(function () { return ''; });
        } catch (e) { return Promise.resolve(''); }
    }

    function myMemoryTranslate(text, target) {
        var src = heuristicLang(text) || 'en';
        if (src === 'zh') return Promise.resolve('');
        var pair = src + '|' + (target === 'zh-CN' ? 'zh-CN' : target);
        var u = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(String(text || '').slice(0, 500)) +
            '&langpair=' + encodeURIComponent(pair);
        return fetch(u, { cache: 'no-store' }).then(function (r) {
            return r && r.ok ? r.json() : null;
        }).then(function (j) {
            if (!j || j.quotaFinished || Number(j.responseStatus) !== 200) return '';
            return (j.responseData && String(j.responseData.translatedText || '').trim()) || '';
        }).catch(function () { return ''; });
    }

    function withTimeout(p, ms) {
        return Promise.race([
            Promise.resolve(p).catch(function () { return ''; }),
            new Promise(function (resolve) { setTimeout(function () { resolve(''); }, ms); })
        ]);
    }

    async function translate(text, target) {
        var src = String(text || '').trim();
        if (!src) return '';
        target = normalizeTarget(target);
        var key = target + '|' + src;
        if (cache[key]) return cache[key];
        var out = '';
        try { out = await withTimeout(builtinTranslate(src, target), 8000); } catch (e) {}
        if (!out) {
            try { out = await withTimeout(workerTranslate(src, target), 8000); } catch (e) {}
        }
        if (!out) {
            try { out = await withTimeout(googleTranslate(src, target), 6000); } catch (e) {}
        }
        if (!out) {
            try { out = await withTimeout(myMemoryTranslate(src, target), 6000); } catch (e) {}
        }
        if (out && out !== src) {
            cache[key] = out;
            saveCache();
            return out;
        }
        return '';
    }

    function toZh(text) {
        return translate(text, 'zh-CN');
    }

    window.NanoTranslate = {
        translate: translate,
        toZh: toZh,
        detectLang: detectLang
    };
})();
