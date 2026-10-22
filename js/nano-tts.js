// ============================================================
// nano-tts.js - 全局 TTS：读取「API → TTS」配置，把文字合成语音并播放
// 用法：
//   window.NanoTTS.speak('你好呀')        -> Promise<boolean>
//   window.NanoTTS.stop()                 -> 停止当前播放
//   window.NanoTTS.isConfigured(cb)       -> cb(boolean)
// 支持的接口类型：openai(/audio/speech)、minimax(/t2a_v2)、fishaudio(/v1/tts)、custom(同 openai)
// 配置来源：nano_api_db / api_data / nano_api_config 里的
//   ttsUrl / ttsKey / ttsModel / ttsType / ttsGroupId / ttsVoice(可选)
// ============================================================
(function () {
    'use strict';

    var currentAudio = null;
    var currentUrl = '';
    var lastError = '';

    function parseLocalConfig() {
        try {
            var raw = localStorage.getItem('nano_api_config');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function getConfig() {
        return new Promise(function (resolve) {
            try {
                if (!('indexedDB' in window)) { resolve(parseLocalConfig()); return; }
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
                        if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var db = e.target.result;
                        var g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                        g.onsuccess = function () { resolve((g.result && g.result.value) || parseLocalConfig()); };
                        g.onerror = function () { resolve(parseLocalConfig()); };
                    } catch (err) { resolve(parseLocalConfig()); }
                };
                req.onerror = function () { resolve(parseLocalConfig()); };
            } catch (err) { resolve(parseLocalConfig()); }
        });
    }

    // ===== 读取「API → TTS 预设」（api.js 存在 nano_api_db/api_data 里）=====
    var PRESET_DATA_KEY = 'nano_api_presets_data';
    var PRESET_LIST_KEY = 'nano_api_preset_list';
    function lsGet(key) { try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
    function idbGetKey(key) {
        return new Promise(function (resolve) {
            try {
                if (!('indexedDB' in window)) { resolve(lsGet(key)); return; }
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
                        if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var db = e.target.result;
                        var g = db.transaction('api_data', 'readonly').objectStore('api_data').get(key);
                        g.onsuccess = function () { resolve((g.result && g.result.value) || lsGet(key)); };
                        g.onerror = function () { resolve(lsGet(key)); };
                    } catch (err) { resolve(lsGet(key)); }
                };
                req.onerror = function () { resolve(lsGet(key)); };
            } catch (err) { resolve(lsGet(key)); }
        });
    }
    // 名称 -> TTS 配置（用于「私聊 → 语音音色」给角色绑定音色）
    function getPresetConfig(name) {
        var nm = String(name == null ? '' : name).trim();
        if (!nm) return Promise.resolve(null);
        return idbGetKey(PRESET_DATA_KEY).then(function (all) {
            var cfg = all && all['tts_' + nm];
            if (!cfg) return null;
            return {
                ttsUrl: cfg.url || '',
                ttsKey: cfg.key || '',
                ttsModel: cfg.modelValue || cfg.modelText || '',
                ttsGroupId: cfg.groupId || '',
                ttsMinimaxRegion: cfg.region || 'auto',
                ttsType: cfg.type || 'openai',
                ttsVoice: cfg.voice || cfg.voiceId || '' // 音色 ID 与语音模型分开存
            };
        });
    }
    // 所有 TTS 预设名（给设置页下拉用）
    function listPresets() {
        return idbGetKey(PRESET_LIST_KEY).then(function (data) {
            return (data && Array.isArray(data.tts)) ? data.tts.slice() : [];
        });
    }

    function cleanUrl(u) { return String(u == null ? '' : u).trim().replace(/\/+$/, ''); }
    function toV1(u) {
        var s = cleanUrl(u);
        if (!s) return s;
        if (!/\/v1$/i.test(s)) s += '/v1';
        return s;
    }
    function isConfigured(cfg) {
        cfg = cfg || {};
        return !!(cleanUrl(cfg.ttsUrl) && cfg.ttsKey && (cfg.ttsModel || cfg.ttsVoice));
    }
    function hexToBytes(hex) {
        var h = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
        if (!h || h.length % 2) return null;
        var m = h.match(/.{1,2}/g) || [];
        var a = new Uint8Array(m.length);
        for (var i = 0; i < m.length; i++) a[i] = parseInt(m[i], 16);
        return a;
    }

    async function synth(text, cfg) {
        var base = toV1(cfg.ttsUrl);
        var type = String(cfg.ttsType || 'openai').toLowerCase();
        if (type.indexOf('fish') === 0) type = 'fishaudio';
        if (type === 'minimax') {
            // MiniMax 国内版 / 海外版域名都兼容；当前域名失败时自动尝试另一个
            var mmBases = [base];
            var mmAlt = /minimaxi\.com/i.test(base) ? 'https://api.minimax.chat/v1' : 'https://api.minimaxi.com/v1';
            if (mmAlt !== base) mmBases.push(mmAlt);
            var mmBody = {
                model: cfg.ttsModel,
                text: text,
                stream: false,
                voice_setting: { voice_id: cfg.ttsVoice || cfg.ttsModel, speed: 1, vol: 1, pitch: 0 },
                audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' }
            };
            var mmJson = null, mmLastErr = null;
            for (var mi = 0; mi < mmBases.length && !mmJson; mi++) {
                var mmBase = mmBases[mi];
                var mmUrl = mmBase + '/t2a_v2' + (cfg.ttsGroupId ? ('?GroupId=' + encodeURIComponent(cfg.ttsGroupId)) : '');
                try {
                    var mmResp = await fetch(mmUrl, {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + cfg.ttsKey, 'Content-Type': 'application/json' },
                        body: JSON.stringify(mmBody)
                    });
                    if (!mmResp.ok) {
                        var mmMsg = 'HTTP ' + mmResp.status;
                        try { var mmData = await mmResp.json(); mmMsg = (mmData.base_resp && mmData.base_resp.status_msg) || (mmData.error && mmData.error.message) || mmMsg; } catch (e) {}
                        var mmErr = new Error(mmMsg);
                        mmErr.status = mmResp.status;
                        throw mmErr;
                    }
                    mmJson = await mmResp.json();
                } catch (e) {
                    mmLastErr = e;
                    // 鉴权失败通常是 Key 与区域不匹配，换域名也不会成功；404/网络错误才继续尝试
                    if (e && e.status && e.status >= 400 && e.status < 500 && e.status !== 404) break;
                }
            }
            if (!mmJson) throw mmLastErr || new Error('MiniMax 请求失败');
            var audioHex = mmJson && mmJson.data && mmJson.data.audio;
            if (audioHex) {
                var bytes = hexToBytes(audioHex);
                if (bytes) return new Blob([bytes], { type: 'audio/mpeg' });
            }
            if (mmJson && mmJson.audio_file) {
                var af = await fetch(mmJson.audio_file);
                return await af.blob();
            }
            throw new Error('TTS 未返回音频');
        }
        if (type === 'fishaudio') {
            // Fish Audio：model 是语音模型（如 s1 / s2.1-pro），reference_id 是用户手填的音色 ID。
            // 注意：必须先声明 fishBody，再写 fishBody.model；旧代码顺序反了会抛
            // “Cannot set properties of undefined”，语音气泡点击后完全没有声音。
            var rawFish = cleanUrl(cfg.ttsUrl);
            var fishRoot = rawFish.replace(/\/v1\/tts$/i, '').replace(/\/v1$/i, '').replace(/\/tts$/i, '');
            var fishEndpoint = /\/tts$/i.test(rawFish) ? rawFish : (fishRoot + '/v1/tts');
            var fishVoice = String(cfg.ttsVoice || '').trim();
            var fishModel = String(cfg.ttsModel || '').trim();
            var fishHeaders = { 'Authorization': 'Bearer ' + cfg.ttsKey, 'Content-Type': 'application/json' };
            var fishBody = {
                text: text,
                format: 'mp3',
                mp3_bitrate: 128,
                chunk_length: 200,
                normalize: true
            };
            if (fishModel) {
                fishHeaders['model'] = fishModel;
                fishBody.model = fishModel;
            }
            var fishRef = fishVoice || fishModel;
            if (fishRef) fishBody.reference_id = fishRef;
            async function fishRequest(withModel) {
                var headers = Object.assign({}, fishHeaders);
                var body = Object.assign({}, fishBody);
                if (!withModel) { delete headers.model; delete body.model; }
                var resp = await fetch(fishEndpoint, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(body)
                });
                if (!resp.ok) {
                    var fMsg = 'HTTP ' + resp.status;
                    try { var fData = await resp.json(); fMsg = fData.message || (fData.error && fData.error.message) || fMsg; } catch (e) {}
                    var err = new Error('Fish Audio：' + fMsg);
                    err.status = resp.status;
                    throw err;
                }
                return resp;
            }
            var fishResp;
            try {
                fishResp = await fishRequest(true);
            } catch (e) {
                // 旧版内置的模型名（例如 s2.1-pro-free）在 Fish Audio 某些账号/旧接口上不识别。
                // 400/422 时去掉 model 头重试一次，让 Fish 用默认模型，避免整个 TTS 直接不可用。
                if (e && (e.status === 400 || e.status === 422) && fishModel) fishResp = await fishRequest(false);
                else throw e;
            }
            // Fish Audio 在参数/音色错误时有时仍返回 200 + JSON，直接当音频播放会静默失败。
            var fType = String(fishResp.headers.get('content-type') || '').toLowerCase();
            if (fType.indexOf('json') > -1) {
                var fJson = await fishResp.json().catch(function () { return {}; });
                throw new Error(fJson.message || (fJson.error && fJson.error.message) || 'Fish Audio 未返回音频');
            }
            var fBlob = await fishResp.blob();
            if (!fBlob || !fBlob.size) throw new Error('Fish Audio 返回了空音频');
            return fBlob;
        }
        if (type === 'elevenlabs' || type === 'eleven') {
            // ElevenLabs：POST /v1/text-to-speech/{voice_id}，鉴权用 xi-api-key。
            // 音色 ID 必填（可以点 API 页的「拉取音色」从账号里选）。
            var elVoice = String(cfg.ttsVoice || '').trim();
            if (!elVoice) throw new Error('ElevenLabs 需要填写音色 ID（可在 API 页点「拉取音色」）');
            var elRoot = base.replace(/\/v1\/text-to-speech.*$/i, '').replace(/\/v1$/i, '');
            var elModel = String(cfg.ttsModel || 'eleven_multilingual_v2').trim() || 'eleven_multilingual_v2';
            var elUrl = elRoot + '/v1/text-to-speech/' + encodeURIComponent(elVoice) + '?output_format=mp3_44100_128';
            var elResp = await fetch(elUrl, {
                method: 'POST',
                headers: { 'xi-api-key': cfg.ttsKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    model_id: elModel,
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                })
            });
            if (!elResp.ok) {
                var elMsg = 'HTTP ' + elResp.status;
                try {
                    var elData = await elResp.json();
                    elMsg = (elData.detail && (elData.detail.message || (Array.isArray(elData.detail) && elData.detail[0] && elData.detail[0].msg))) || elData.message || elMsg;
                } catch (e) {}
                throw new Error('ElevenLabs：' + elMsg);
            }
            var elBlob = await elResp.blob();
            if (!elBlob || !elBlob.size) throw new Error('ElevenLabs 返回了空音频');
            return elBlob;
        }
        // openai / custom
        var body = {
            model: cfg.ttsModel,
            input: text,
            voice: cfg.ttsVoice || 'alloy',
            response_format: 'mp3'
        };
        var resp = await fetch(base + '/audio/speech', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + cfg.ttsKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            var msg = 'HTTP ' + resp.status;
            try { var d = await resp.json(); msg = (d.error && d.error.message) || d.message || msg; } catch (e) {}
            throw new Error(msg);
        }
        return await resp.blob();
    }

    function playBlob(blob) {
        return new Promise(function (resolve, reject) {
            try {
                stop();
                var url = URL.createObjectURL(blob);
                currentUrl = url;
                var audio = new Audio(url);
                currentAudio = audio;
                audio.onended = function () {
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    if (currentUrl === url) currentUrl = '';
                    if (currentAudio === audio) currentAudio = null;
                    resolve(true);
                };
                audio.onerror = function () {
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    if (currentUrl === url) currentUrl = '';
                    if (currentAudio === audio) currentAudio = null;
                    reject(new Error('音频播放失败'));
                };
                var p = audio.play();
                if (p && typeof p.catch === 'function') p.catch(reject);
            } catch (e) { reject(e); }
        });
    }

    function stop() {
        if (currentAudio) {
            try { currentAudio.pause(); } catch (e) {}
            currentAudio = null;
        }
        if (currentUrl) {
            try { URL.revokeObjectURL(currentUrl); } catch (e) {}
            currentUrl = '';
        }
        try {
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        } catch (e) {}
    }

    function hasNativeVoice() {
        return !!(window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function');
    }

    // 没有配置远端 TTS / 远端失败时的兜底：用浏览器自带语音真正读出声音，
    // 避免只有「语音波形动画」而没有声音的假语音气泡。
    function speakNative(text, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
            if (!hasNativeVoice()) { reject(new Error('当前浏览器不支持语音合成')); return; }
            try {
                window.speechSynthesis.cancel();
                var u = new SpeechSynthesisUtterance(String(text));
                var autoLang = 'zh-CN';
                if (/[\uac00-\ud7af]/.test(String(text))) autoLang = 'ko-KR';
                else if (/[\u3040-\u30ff]/.test(String(text))) autoLang = 'ja-JP';
                else if (!/[\u4e00-\u9fff]/.test(String(text)) && /[a-zA-Z]/.test(String(text))) autoLang = 'en-US';
                u.lang = opts.lang || autoLang;
                u.rate = typeof opts.rate === 'number' ? opts.rate : 1;
                u.pitch = typeof opts.pitch === 'number' ? opts.pitch : 1;
                try {
                    var voices = window.speechSynthesis.getVoices() || [];
                    var want = String(u.lang).toLowerCase().slice(0, 2);
                    var v = voices.find(function (x) { return String(x.lang || '').toLowerCase().indexOf(want) === 0; });
                    if (v) u.voice = v;
                } catch (e) {}
                u.onend = function () { resolve(true); };
                u.onerror = function (e) { reject(new Error((e && e.error) || '语音播放失败')); };
                window.speechSynthesis.speak(u);
            } catch (e) { reject(e); }
        });
    }

    async function speak(text, opts) {
        opts = opts || {};
        var t = String(text == null ? '' : text).trim();
        if (!t) return false;
        var cfg = await getConfig();
        if (opts.config) cfg = Object.assign({}, cfg, opts.config);
        if (!isConfigured(cfg)) {
            if (opts.browserFallback === false) {
                console.warn('[TTS] 未配置：需要 地址 + Key + 语音模型（Fish Audio / MiniMax 还需手动填写音色 ID）');
                return false;
            }
            try { await speakNative(t, opts); return true; }
            catch (e) { console.warn('[TTS] 浏览器语音不可用：', e && e.message ? e.message : e); return false; }
        }
        try {
            var blob = await synth(t, cfg);
            lastError = '';
            return await playBlob(blob);
        } catch (e) {
            lastError = String((e && e.message) || e || 'TTS 合成失败');
            console.warn('[TTS] 远端合成失败，改用浏览器语音：', lastError);
            if (opts.browserFallback === false) throw e;
            try { await speakNative(t, opts); return true; }
            catch (e2) { return false; }
        }
    }

    // 试听/诊断用：配置不完整或接口报错时直接抛错，方便在界面上看到原因
    async function preview(text, opts) {
        opts = opts || {};
        var t = String(text == null ? '' : text).trim() || '这是一段语音测试。';
        var cfg = await getConfig();
        if (opts.config) cfg = Object.assign({}, cfg, opts.config);
        if (!isConfigured(cfg)) throw new Error('配置不完整：需要 地址 + Key + 语音模型（Fish Audio / MiniMax 还需手动填写音色 ID）');
        var blob = await synth(t, cfg);
        return await playBlob(blob);
    }

    window.NanoTTS = {
        speak: function (text, opts) { return speak(text, opts).catch(function (e) { console.warn('[TTS] 失败:', e && e.message ? e.message : e); return false; }); },
        speakNative: function (text, opts) { return speakNative(text, opts).catch(function () { return false; }); },
        preview: function (text, opts) { return preview(text, opts); },
        stop: stop,
        lastError: function () { return lastError; },
        canSpeakNative: hasNativeVoice,
        isConfigured: function (cb) {
            getConfig().then(function (cfg) { try { cb(isConfigured(cfg)); } catch (e) {} });
        },
        getPresetConfig: getPresetConfig,
        listPresets: listPresets
    };
})();
