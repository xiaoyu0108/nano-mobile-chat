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
    var currentClipKey = '';
    var lastError = '';
    var voiceCache = {};   // key -> { blob, text, preset }

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

    // ===== 每个角色自己的语音设置（与私聊设置共用 chat_setting_* 键）=====
    function chatStoreKey(chatId, key) {
        return 'chat_setting_' + key + '_' + String(chatId || '');
    }
    function chatSetting(chatId, key, defVal) {
        try {
            var raw = localStorage.getItem(chatStoreKey(chatId, key));
            if (raw === null) return defVal;
            try { return JSON.parse(raw); } catch (e) { return raw; }
        } catch (e) { return defVal; }
    }
    function writeChatSetting(chatId, key, val) {
        try { localStorage.setItem(chatStoreKey(chatId, key), JSON.stringify(val)); } catch (e) {}
        try {
            if (typeof localforage !== 'undefined') {
                localforage.setItem(chatStoreKey(chatId, key), val).catch(function () {});
            }
        } catch (e) {}
    }
    function isChatTtsEnabled(chatId) {
        return chatSetting(chatId, 'ttsEnabled', false) !== false;
    }
    function setChatTtsEnabled(chatId, on) {
        writeChatSetting(chatId, 'ttsEnabled', !!on);
    }
    function getChatPresetName(chatId) {
        return String(chatSetting(chatId, 'ttsPreset', '') || '').trim();
    }
    function setChatPresetName(chatId, name) {
        writeChatSetting(chatId, 'ttsPreset', String(name || '').trim());
    }
    function resolveChatConfig(chatId, presetOverride) {
        var name = (presetOverride === undefined || presetOverride === null)
            ? getChatPresetName(chatId)
            : String(presetOverride || '').trim();
        if (name) {
            return getPresetConfig(name).then(function (cfg) {
                if (cfg) return cfg;
                return getConfig();
            });
        }
        return getConfig();
    }
    // 清理成「真的能读出来」的台词：去掉翻译、标记、表情和多余符号；
    // 保留逗号、省略号、破折号等自然停顿，不按长度截断。
    function ttsScript(text, type) {
        var raw = String(text == null ? '' : text);
        var s = raw.replace(/\r/g, '');
        s = s.replace(/^\s*\[voice:[^\]]*\]\s*/i, '');
        s = s.replace(/\[(?:reply|image|voice|gift|transfer|call|heart|act|emoji|定位|外卖|头像|亲属卡)[^\]]*\]/gi, ' ');
        // 模型偶尔会写舞台提示/音效标签；TTS 会照读，直接去掉，只保留真正说出口的话。
        s = s.replace(/（[^）]{1,24}）/g, ' ').replace(/【[^】]{1,24}】/g, ' ');
        s = s.replace(/\[[^\]\n]{1,16}\]/g, ' ');
        s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '');
        var lines = s.split('\n').map(function (line) {
            var sep = line.indexOf('||');
            if (sep > -1) line = line.slice(0, sep);
            return line.trim();
        }).filter(Boolean);
        s = lines.join(type === 'fishaudio' ? '，' : ' ');
        s = s.replace(/[*_`#>]/g, '');
        s = s.replace(/\.{3,}/g, '……').replace(/。{2,}/g, '。').replace(/，{2,}/g, '，');
        s = s.replace(/[ \t]{2,}/g, ' ').trim();
        if (!s) s = raw.trim();
        return s;
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
        text = ttsScript(text, type);
        if (!text) throw new Error('这条语音没有可朗读的文字');
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
            // 注意：不要把 model 放进自定义请求头。浏览器会先发 CORS 预检，
            // Fish 对自定义 model 头的放行不稳定，预检失败时表现为 "HTTP 0 / Load failed"。
            var rawFish = cleanUrl(cfg.ttsUrl);
            var fishRoot = rawFish.replace(/\/v1\/tts$/i, '').replace(/\/v1$/i, '').replace(/\/tts$/i, '');
            var fishEndpoint = /\/tts$/i.test(rawFish) ? rawFish : (fishRoot ? (fishRoot + '/v1/tts') : 'https://api.fish.audio/v1/tts');
            var isDirectFish = /^https?:\/\/api\.fish\.audio/i.test(fishEndpoint);
            var fishEndpoints = [];
            var fishProxy = '';
            // 某些网络/代理会直接拦掉 api.fish.audio（CORS 预检都到不了，表现为 HTTP 0）。
            // 直连 Fish 时优先走 Nano 推送 Worker 的 /fish-tts 同源反向代理，失败再直连。
            try {
                fishProxy = String(localStorage.getItem('nano_push_endpoint') || '').trim().replace(/\/+$/, '');
                if (!fishProxy) fishProxy = 'https://nanopush.nano315.online';
                if (fishProxy) fishProxy = fishProxy + '/fish-tts';
            } catch (e) { fishProxy = ''; }
            if (isDirectFish && fishProxy) fishEndpoints.push(fishProxy);
            fishEndpoints.push(fishEndpoint);
            if (!isDirectFish) fishEndpoints.push('https://api.fish.audio/v1/tts');
            if (!isDirectFish && fishProxy) fishEndpoints.push(fishProxy);
            // 去重
            fishEndpoints = fishEndpoints.filter(function (u, i, a) { return u && a.indexOf(u) === i; });
            var fishVoice = String(cfg.ttsVoice || '').trim();
            var fishModel = String(cfg.ttsModel || '').trim();
            var fishBody = {
                text: text,
                format: 'mp3',
                mp3_bitrate: 128,
                // 一次尽量把整段说完，不主动截断；Fish 会自己按句切分。
                chunk_length: 300,
                normalize: true
            };
            if (fishModel) fishBody.model = fishModel;
            // reference_id 只能是音色 ID；不要把模型名（s1 / s2.1-pro）当成音色塞进去，
            // 否则 Fish 会按不存在的参考音色报错或直接返回空音频。
            if (fishVoice) fishBody.reference_id = fishVoice;
            async function fishRequest(endpoint, withModel) {
                var headers = {
                    'Authorization': 'Bearer ' + cfg.ttsKey,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg, application/octet-stream, application/json'
                };
                var body = Object.assign({}, fishBody);
                if (!withModel) delete body.model;
                // 直连 api.fish.audio 时不发自定义 model 头：它会让浏览器预检失败（HTTP 0）。
                // 走 Worker / 自建代理时才带上，保证能选到 s1 / s2.1-pro 等模型。
                if (withModel && fishModel && !/^https?:\/\/api\.fish\.audio/i.test(endpoint)) {
                    headers['model'] = fishModel;
                }
                var resp;
                try {
                    resp = await fetch(endpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(body)
                    });
                } catch (netErr) {
                    var ne = new Error('Fish Audio 连接被拦截（HTTP 0 / Load failed）');
                    ne.status = 0;
                    ne.network = true;
                    throw ne;
                }
                if (!resp.ok) {
                    var fMsg = 'HTTP ' + resp.status;
                    try { var fData = await resp.json(); fMsg = fData.message || (fData.error && fData.error.message) || fMsg; } catch (e) {}
                    var err = new Error('Fish Audio：' + fMsg);
                    err.status = resp.status;
                    throw err;
                }
                return resp;
            }
            var fishResp = null, fishErr = null, fishFatal = false;
            for (var fi = 0; fi < fishEndpoints.length && !fishResp && !fishFatal; fi++) {
                var variants = fishModel ? [true, false] : [false];
                for (var vi = 0; vi < variants.length && !fishResp; vi++) {
                    try {
                        fishResp = await fishRequest(fishEndpoints[fi], variants[vi]);
                    } catch (e) {
                        fishErr = e;
                        var st = e && e.status;
                        // 400/422 可能是模型名不被该账号识别：去掉 model 再试一次。
                        if (variants[vi] && (st === 400 || st === 422)) continue;
                        // 鉴权失败 / 限流：换地址也没用，直接报错。
                        if (st === 401 || st === 403 || st === 429) fishFatal = true;
                        // 其他错误（网络/404/5xx）换下一个地址兜底。
                        break;
                    }
                }
            }
            if (!fishResp) {
                if (fishErr && fishErr.network) {
                    throw new Error('Fish Audio 请求被网络或代理拦截（HTTP 0 / Load failed）。' +
                        '请检查网络代理是否放行 api.fish.audio；也可在推送设置里配置 Worker 地址后重试。');
                }
                throw fishErr || new Error('Fish Audio 请求失败');
            }
            // Fish Audio 在参数/音色错误时有时仍返回 200 + JSON，直接当音频播放会静默失败。
            var fType = String(fishResp.headers.get('content-type') || '').toLowerCase();
            if (fType.indexOf('json') > -1) {
                var fJson = await fishResp.json().catch(function () { return {}; });
                if (fJson && fJson.audio) {
                    var fBytes = hexToBytes(fJson.audio) || null;
                    if (fBytes) return new Blob([fBytes], { type: 'audio/mpeg' });
                }
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

    function playBlob(blob, key) {
        return new Promise(function (resolve, reject) {
            try {
                stop();
                currentClipKey = String(key || '');
                var url = URL.createObjectURL(blob);
                currentUrl = url;
                var audio = new Audio(url);
                currentAudio = audio;
                audio.onended = function () {
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    if (currentUrl === url) currentUrl = '';
                    if (currentAudio === audio) currentAudio = null;
                    if (currentClipKey === String(key || '')) currentClipKey = '';
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
        currentClipKey = '';
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

    // ===== 按角色合成 / 重roll / 下载 =====
    function clipKeyFor(text, opts) {
        opts = opts || {};
        if (opts.key) return String(opts.key);
        var chatId = String(opts.chatId || '');
        var preset = (opts.preset === undefined || opts.preset === null) ? getChatPresetName(chatId) : String(opts.preset || '');
        return chatId + '|' + preset + '|' + String(text || '').slice(0, 120);
    }
    async function ensureVoiceBlob(text, opts) {
        opts = opts || {};
        var t = String(text == null ? '' : text).trim();
        if (!t) throw new Error('这条语音没有可朗读的文字');
        var chatId = String(opts.chatId || '');
        if (!opts.force && !isChatTtsEnabled(chatId)) throw new Error('这个角色的语音朗读已关闭');
        var cfg = opts.config || await resolveChatConfig(chatId, opts.preset);
        if (!isConfigured(cfg)) throw new Error('没有可用的 TTS 配置：请先在 API → TTS 保存预设');
        var key = clipKeyFor(t, opts);
        var hit = voiceCache[key];
        if (!opts.fresh && hit && hit.blob) return { blob: hit.blob, key: key, cfg: cfg };
        var blob = await synth(t, cfg);
        if (!blob || !blob.size) throw new Error('TTS 没有返回音频');
        voiceCache[key] = { blob: blob, text: t, preset: opts.preset || '', at: Date.now() };
        return { blob: blob, key: key, cfg: cfg };
    }
    async function speakForChat(text, opts) {
        opts = opts || {};
        var chatId = String(opts.chatId || '');
        if (!isChatTtsEnabled(chatId)) {
            lastError = '这个角色的语音朗读已关闭';
            return false;
        }
        var t = String(text == null ? '' : text).trim();
        if (!t) return false;
        try {
            var got = await ensureVoiceBlob(t, opts);
            lastError = '';
            return await playBlob(got.blob, got.key);
        } catch (e) {
            lastError = String((e && e.message) || e || 'TTS 合成失败');
            // 没有远端配置时才用浏览器语音兜底；已关闭 TTS 的角色不再偷偷发声。
            var cfg = opts.config || await resolveChatConfig(chatId, opts.preset).catch(function () { return null; });
            if (!isConfigured(cfg) && opts.browserFallback !== false && hasNativeVoice()) {
                try { await speakNative(ttsScript(t, ''), opts); return true; } catch (e2) {}
            }
            throw e;
        }
    }
    async function rerollVoice(text, opts) {
        opts = Object.assign({}, opts || {}, { fresh: true });
        delete voiceCache[clipKeyFor(text, opts)];
        return speakForChat(text, opts);
    }
    async function downloadVoice(text, opts) {
        opts = opts || {};
        var got = await ensureVoiceBlob(text, opts);
        var name = String(opts.filename || '').trim();
        if (!name) {
            var d = new Date();
            function p2(n) { return (n < 10 ? '0' : '') + n; }
            name = 'nano-voice-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' +
                p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '.mp3';
        }
        if (!/\.mp3$/i.test(name)) name += '.mp3';
        var url = URL.createObjectURL(got.blob);
        try {
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.rel = 'noopener';
            a.style.display = 'none';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(function () {
                try { a.remove(); } catch (e) {}
                try { URL.revokeObjectURL(url); } catch (e) {}
            }, 4000);
        } catch (e) {
            try { window.open(url, '_blank'); } catch (e2) {}
        }
        return true;
    }
    async function hasVoiceForChat(chatId, presetOverride) {
        if (!isChatTtsEnabled(chatId)) return false;
        try {
            var cfg = await resolveChatConfig(chatId, presetOverride);
            return isConfigured(cfg);
        } catch (e) { return false; }
    }

    window.NanoTTS = {
        speak: function (text, opts) { return speak(text, opts).catch(function (e) { console.warn('[TTS] 失败:', e && e.message ? e.message : e); return false; }); },
        speakForChat: function (text, opts) { return speakForChat(text, opts); },
        speakForChar: function (text, opts) { return speakForChat(text, opts); },
        rerollVoice: function (text, opts) { return rerollVoice(text, opts); },
        downloadVoice: function (text, opts) { return downloadVoice(text, opts); },
        hasVoiceForChat: function (chatId, preset) { return hasVoiceForChat(chatId, preset); },
        isEnabled: isChatTtsEnabled,
        setEnabled: setChatTtsEnabled,
        getChatPreset: getChatPresetName,
        setChatPreset: setChatPresetName,
        activePreset: getChatPresetName,
        script: ttsScript,
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
