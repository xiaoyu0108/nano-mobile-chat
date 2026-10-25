// ============================================================
// video-call.js — 视频通话
// 交互对齐语音通话：计时、缩小成悬浮球、免提(TTS)、录音转文字、输入/回复；
// 新增：本地摄像头（前置镜像）、右上角小窗点击放大/互换、摄像头开关
// （关时显示“我”的头像）、更换通话背景、AI 通过截图“看到”你这边；
// 结束/未接会往聊天里插一张「视频通话」卡片（点卡片可看通话内容）。
// ============================================================
(function () {
    'use strict';

    function q(name) { try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; } }

    var chatId = q('chat') || 'default';
    var contactName = q('name') || 'AI 助手';
    var isIncoming = q('incoming') === '1';

    var $ = function (id) { return document.getElementById(id); };
    var stage = $('vcStage');
    var remoteBox = $('remoteBox');
    var localBox = $('localBox');
    var localVideo = $('localVideo');
    var localOff = $('localOff');
    var localAvatarImg = $('localAvatarImg');
    var localAvatarSvg = $('localAvatarSvg');
    var remoteAvatar = $('remoteAvatar');
    var remoteAvatarSvg = $('remoteAvatarSvg');
    var chatArea = $('chatArea');
    var messageInput = $('messageInput');
    var replyBtn = $('replyBtn');
    var rerollBtn = $('rerollBtn');
    var speakerBtn = $('speakerBtn');
    var recordBtn = $('recordBtn');
    var cameraBtn = $('cameraBtn');
    var flipBtn = $('flipBtn');
    var bgBtn = $('bgBtn');
    var bgPanel = $('bgPanel');
    var bgUpload = $('bgUpload');
    var minimizeBtn = $('minimizeBtn');
    var hangupBtn = $('hangupBtn');
    var callStatus = $('callStatus');
    var contactNameEl = $('contactName');
    var toastEl = $('vcToast');
    var typingEl = $('vcTyping');

    var messages = [];
    var callSessionId = 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var turnSeq = 0;
    var firstSpeaker = (function () {
        try { return localStorage.getItem('nano_call_first_' + chatId) === 'me' ? 'me' : 'char'; } catch (e) { return 'char'; }
    })();
    var isWaiting = false;
    var callSeconds = 0;
    var timer = null;
    var cameraOn = false;
    var facingMode = 'user';
    var speakerOn = (function(){try{return localStorage.getItem('nano_call_tts')!=='0'}catch(e){return true}})();

    var _audioUnlocked = false;
    function unlockAudio() {
        if (_audioUnlocked) return;
        _audioUnlocked = true;
        try {
            if (window.NanoTTS && window.NanoTTS.prime) window.NanoTTS.prime();
        } catch (e) {}
        try {
            var a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
            a.volume = 0;
            var p = a.play();
            if (p && p.catch) p.catch(function () {});
        } catch (e) {}
    }
    try {
        document.addEventListener('touchstart', unlockAudio, { once: true, capture: true });
        document.addEventListener('click', unlockAudio, { once: true, capture: true });
    } catch (e) {}
    var mediaStream = null;
    var charAvatar = '';
    var userAvatar = '';
    var charPersona = '';
    var characterData = null;
    var displayName = contactName;
    var memText = '';
    var wbText = '';
    var ended = false;
    var BG_KEY = 'video_call_bg';

    // ===== 接通提示音（WebAudio 简单回铃）=====
    var ringCtx = null, ringTimer = null;
    function playDefaultRing() {
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!ringCtx) ringCtx = new AC();
            var tone = function (freq, start, dur, vol) {
                var o = ringCtx.createOscillator(), g = ringCtx.createGain();
                o.type = 'sine'; o.frequency.value = freq;
                var t = ringCtx.currentTime + start;
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.05);
                g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
                o.connect(g); g.connect(ringCtx.destination);
                o.start(t); o.stop(t + dur + 0.03);
            };
            // 柔和的两音回铃
            var ring = function () { try { tone(587.33, 0, 0.38, 0.045); tone(783.99, 0.44, 0.5, 0.04); } catch (e) {} };
            ring();
            ringTimer = setInterval(ring, 2200);
        } catch (e) {}
    }
    function startRing() {
        try {
            if (window.NanoCallRingtone && window.NanoCallRingtone.start(playDefaultRing)) return;
        } catch (e) {}
        playDefaultRing();
    }
    function stopRing() {
        try { if (window.NanoCallRingtone) window.NanoCallRingtone.stop(); } catch (e) {}
        try { clearInterval(ringTimer); } catch (e) {}
        ringTimer = null;
        try { if (ringCtx) { ringCtx.close(); ringCtx = null; } } catch (e) { ringCtx = null; }
    }

    function showTyping() { if (typingEl) typingEl.classList.add('active'); }
    function hideTyping() { if (typingEl) typingEl.classList.remove('active'); }

    // 读取「我」的人设头像：MaskAvatarDB / avatars（和面具页一致）
    function readUserAvatar() {
        return new Promise(function (resolve) {
            var maskId = '';
            try {
                var homeKeys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
                for (var i = 0; i < homeKeys.length; i++) {
                    var raw = localStorage.getItem(homeKeys[i]);
                    if (!raw) continue;
                    var d = JSON.parse(raw);
                    if (!d) continue;
                    if (Array.isArray(d.masks)) {
                        var cur = (d.masks || []).find(function (m) { return m && m.id === d.currentMaskId; }) || d.masks[0] || null;
                        if (cur && cur.avatar) { resolve(cur.avatar); return; }
                        if (cur && cur.id) maskId = cur.id;
                        break;
                    }
                    if (d.avatar) { resolve(d.avatar); return; }
                    if (d.id) { maskId = d.id; break; }
                }
            } catch (e) {}
            try {
                var req = indexedDB.open('MaskAvatarDB', 1);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('avatars')) d.createObjectStore('avatars', { keyPath: 'id' }); } catch (err) {} };
                req.onsuccess = function () {
                    try {
                        var r = req.result.transaction('avatars', 'readonly').objectStore('avatars').get(maskId);
                        r.onsuccess = function () { resolve((r.result && r.result.data) || ''); };
                        r.onerror = function () { resolve(''); };
                    } catch (e) { resolve(''); }
                };
                req.onerror = function () { resolve(''); };
            } catch (e) { resolve(''); }
        });
    }

    function toast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
    }

    // ===== 角色 / 用户信息 =====
    function loadInfos() {
        return new Promise(function (resolve) {
            var done = false;
            function finish() { if (!done) { done = true; resolve(); } }
            try {
                var info = JSON.parse(sessionStorage.getItem('inner_setting_info') || 'null') ||
                           JSON.parse(sessionStorage.getItem('last_chat_info') || 'null');
                if (info) {
                    charAvatar = info.chatAvatar || info.avatar || charAvatar;
                    userAvatar = info.userAvatar || userAvatar;
                    if (info.name) displayName = info.name;
                    if (info.chatId || info.id) chatId = info.chatId || info.id;
                }
            } catch (e) {}
            try {
                userAvatar = userAvatar || localStorage.getItem('nano_user_avatar') || '';
                if (!userAvatar) {
                    var ui = JSON.parse(localStorage.getItem('nano_user_info') || 'null');
                    if (ui && (ui.avatar || ui.userAvatar)) userAvatar = ui.avatar || ui.userAvatar;
                }
            } catch (e) {}
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {} };
                req.onsuccess = function () {
                    try {
                        var g = req.result.transaction('characters', 'readonly').objectStore('characters').getAll();
                        g.onsuccess = function () {
                            var list = g.result || [];
                            var c = list.find(function (x) { return x && String(x.id) === String(chatId); }) ||
                                    list.find(function (x) { return x && x.name === contactName; }) || null;
                            if (c) {
                                characterData = c;
                                if (c.avatar && c.avatar.length > 20) charAvatar = c.avatar;
                                if (c.name) displayName = c.name;
                                var parts = [];
                                if (c.gender && c.gender !== '未知') parts.push('性别：' + c.gender);
                                if (c.nationality && c.nationality !== '未知') parts.push('国籍：' + c.nationality);
                                if (c.setting) parts.push(c.setting);
                                charPersona = parts.join('\n');
                            }
                            finish();
                        };
                        g.onerror = finish;
                    } catch (e) { finish(); }
                };
                req.onerror = finish;
            } catch (e) { finish(); }
        });
    }

    function applyAvatars() {
        contactNameEl.textContent = displayName;
        if ($('connName')) $('connName').textContent = displayName;
        // 角色头像作为背景图铺满主画面（不是圆形头像）
        if (charAvatar) {
            remoteAvatar.style.display = 'none';
            remoteAvatarSvg.style.display = 'none';
            var cImg = $('connAvatarImg'), cSvg = $('connAvatarSvg');
            if (cImg) { cImg.src = charAvatar; cImg.style.display = 'block'; }
            if (cSvg) cSvg.style.display = 'none';
            var avOpt = $('bgOptAvatar');
            if (avOpt) avOpt.style.background = '#333 url("' + charAvatar + '") center/cover no-repeat';
        } else {
            remoteAvatarSvg.style.display = '';
        }
        // 摄像头关掉时，小窗显示「我」的头像
        if (userAvatar) {
            localAvatarImg.src = userAvatar; localAvatarImg.style.display = 'block'; localAvatarSvg.style.display = 'none';
        }
    }

    // ===== 背景 =====
    function applyBg(val) {
        try { if (window.NanoCallBg) window.NanoCallBg.stopVideo(); } catch (e) {}
        var remote = $('remoteBox');
        if (!remote) return;
        if (!val || val === 'avatar') {
            // 默认/头像：用角色头像清晰铺满
            remote.style.background = charAvatar
                ? ('#10131a url("' + charAvatar + '") center/cover no-repeat')
                : 'radial-gradient(circle at 50% 35%, #2a2f3a, #10131a 70%)';
        } else if (val.indexOf('data:') === 0 || val.indexOf('http') === 0) {
            remote.style.background = '#10131a url("' + val + '") center/cover no-repeat';
        } else {
            remote.style.background = val;
        }
        remote.style.backgroundSize = 'cover';
        remote.style.backgroundPosition = 'center';
        remote.style.backgroundRepeat = 'no-repeat';
        var key = (!val ? 'avatar' : (val.indexOf('data:') === 0 ? '__upload__' : val));
        var opts = bgPanel ? bgPanel.querySelectorAll('.vc-bg-opt') : [];
        Array.prototype.forEach.call(opts, function (o) {
            o.classList.toggle('active', (o.getAttribute('data-bg') || '') === key);
        });
    }
    // 背景可能是一张动图（GIF），dataURL 很容易超过 localStorage 5MB；
    // 优先放 IndexedDB，失败再退回 localStorage。
    function openBgDB() {
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open('nano_call_bg_db', 1);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('bg')) db.createObjectStore('bg', { keyPath: 'key' });
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function (e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }
    function loadBg() {
        return openBgDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction('bg', 'readonly');
                var req = tx.objectStore('bg').get('background');
                req.onsuccess = function () {
                    var v = (req.result && req.result.value) || '';
                    try { db.close(); } catch (e) {}
                    if (!v) { try { v = localStorage.getItem(BG_KEY) || ''; } catch (e) {} }
                    resolve(v);
                };
                req.onerror = function () { try { db.close(); } catch (e) {} resolve(''); };
            });
        }).catch(function () {
            try { return localStorage.getItem(BG_KEY) || ''; } catch (e) { return ''; }
        }).then(function (v) { applyBg(v); });
    }
    function loadCallBg() {
        var api = window.NanoCallBg;
        if (api && api.load) {
            return api.load(chatId).then(function (item) {
                if (item && item.kind === 'video' && item.blob && api.showVideo(item.blob)) return;
                if (item && item.kind === 'image' && item.value) { applyBg(item.value); return; }
                return loadBg();
            }).catch(function () { return loadBg(); });
        }
        return loadBg();
    }
    function saveBg(v) {
        v = v || '';
        try { localStorage.setItem(BG_KEY, v); } catch (e) {}
        return openBgDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction('bg', 'readwrite');
                tx.objectStore('bg').put({ key: 'background', value: v });
                tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
                tx.onerror = function () { try { db.close(); } catch (e) {} resolve(); };
            });
        }).catch(function () {});
    }

    // ===== 消息 =====
    // 分句：按中英文标点切分，括号内的翻译不拆
    function splitSentences(text) {
        var out = [], cur = '', depth = 0;
        var enders = '。！？!?；;…';
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (ch === '（' || ch === '(') depth++;
            if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
            cur += ch;
            if (depth === 0 && enders.indexOf(ch) !== -1) {
                var t = cur.trim(); if (t) out.push(t); cur = '';
            }
        }
        var rest = cur.trim(); if (rest) out.push(rest);
        return out;
    }
    // 把整段回复拆成多个气泡；外文||中文 → 外文（中文）
    // 清洗模型输出：去掉 Markdown、英文标题、Context 说明和半截翻译。
    function isChineseTranslationText(s) {
        var t = String(s == null ? '' : s).trim();
        if (!/[\u4e00-\u9fff]/.test(t)) return false;
        if (/[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(t)) return false;
        return (t.match(/[\u4e00-\u9fff]/g) || []).length >= 2;
    }

    function lineHasChineseTranslation(line) {
        var s = String(line == null ? '' : line);
        var re = /[（(]([^（）()]*)[）)]/g, m;
        while ((m = re.exec(s))) {
            if (isChineseTranslationText(m[1])) return true;
        }
        return false;
    }

    function stripParentheticals(line) {
        var s = String(line == null ? '' : line);
        var out = s.replace(/[（(][^（）()]*[）)]/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/\s+([，。！？、；：])/g, '$1')
            .trim();
        return out || s.trim();
    }

    function cleanBubbleLine(line) {
        var s = String(line == null ? '' : line).trim();
        if (!s) return '';
        s = s.replace(/```[\s\S]*?```/g, ' ').replace(/[`*_~#]+/g, ' ');
        s = s.replace(/^\s*(?:\d+[.)、]\s*|[-–—•]\s*)/, '').trim();
        s = s.replace(/^(翻译|中文|译文|中文翻译|中文意思)\s*[:：]\s*/, '');
        if (/^(以下是|下面是|翻译如下|译文如下)/.test(s)) return '';
        if (/^(here (are|is)|translation(s)?\s*[:：]|context\s*[:：]|note\s*[:：]|in (japanese|english|korean|chinese)\b|the (japanese|english|korean|chinese) (phrases|translation))/i.test(s)) {
            return '';
        }
        s = s.replace(/[（(]([^（）()]*)[）)]/g, function (m, inner) {
            if (isChineseTranslationText(inner)) return '（' + String(inner).trim() + '）';
            var t = String(inner == null ? '' : inner).trim();
            // 括号里不是合格中文译文，就不要让它冒充翻译（英文说明、日文重复句都删掉）。
            if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(t)) return '';
            var words = t.split(/\s+/).filter(Boolean);
            if (t.length > 18 || words.length >= 3 || /[:：]/.test(t)) return '';
            return m;
        });
        var cleaned = s.replace(/[（(]\s*[）)]/g, '')
            .replace(/\s{2,}/g, ' ')
            .replace(/\s+([，。！？、；：])/g, '$1')
            .trim();
        if (!/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afA-Za-z0-9]/.test(cleaned)) return '';
        return cleaned;
    }

    function cleanModelText(raw) {
        return String(raw == null ? '' : raw)
            .replace(/```[\s\S]*?```/g, ' ')
            .split(/\n+/)
            .map(cleanBubbleLine)
            .filter(Boolean)
            .join('\n');
    }

    function splitBubbles(raw) {
        var out = [];
        String(raw == null ? '' : raw).split(/\n+/).forEach(function (line) {
            line = line.trim();
            if (!line) return;
            if (line.indexOf('||') !== -1) {
                var p = line.split('||');
                var a = (p[0] || '').trim();
                var b = p.slice(1).join('||').trim();
                line = a + (b ? ('（' + b + '）') : '');
            }
            // 含翻译括号的整句不再拆分，保证「外文（中文）」完整
            if (line.indexOf('（') !== -1 || line.indexOf('(') !== -1) {
                out.push(line);
            } else {
                splitSentences(line).forEach(function (s) { if (s) out.push(s); });
            }
        });
        if (!out.length && raw) out = [String(raw).trim()];
        return out;
    }
    // TTS 只读母语：外语（中文翻译）→ 读括号前的部分
    function spokenText(text) {
        var s = String(text == null ? '' : text);
        var original = s;
        // 只去掉含中文的括号翻译；外语原文里的 (really) 这类括号要照读。
        s = s.replace(/[（(]([^）)]*[\u4e00-\u9fff][^）)]*)[）)]/g, ' ');
        // 模型偶尔把“外文 + 中文翻译”直接写在同一行、没有括号：TTS 只保留外语部分。
        // 日文含汉字，不能用这条规则粗暴删中文，交给括号/分句合并处理。
        if (/[A-Za-z\u00C0-\u024F\u0410-\u04FF\uAC00-\uD7AF]/.test(s) && !/[\u3040-\u30ff]/.test(s)) {
            s = s.replace(/[\u4e00-\u9fff][\u4e00-\u9fff\s，。！？、；：…—·"'“”‘’]*$/g, ' ');
        }
        s = s.replace(/\s+/g, ' ').trim();
        return s || original.trim();
    }

    function hasCJK(s) { return /[\u4e00-\u9fff]/.test(String(s || '')); }
    function hasLatin(s) { return /[A-Za-z]/.test(String(s || '')); }
    // 把「what did you do today? 你今天做了些什么呀？」这种无括号写法
    // 统一成「what did you do today？（你今天做了些什么呀？）」，
    // 这样显示和 TTS 都不会把中文翻译当成外语原文读出来。
    function inlineBilingualLine(line) {
        var s = String(line == null ? '' : line).trim();
        if (!s || lineHasChineseTranslation(s)) return s;
        var m = /^([\s\S]*?[A-Za-z\u00C0-\u024F\u0410-\u04FF\uAC00-\uD7AF][\s\S]*?)[\s，,、:：\-–—]*([\u4e00-\u9fff][\u4e00-\u9fff\s，。！？、；：…—·"'“”‘’（）()]*)$/.exec(s);
        if (!m) return s;
        var foreign = String(m[1] || '').trim();
        var chinese = String(m[2] || '').trim();
        if (!foreign || !isChineseTranslationText(chinese)) return s;
        if (/[\u4e00-\u9fff]/.test(foreign)) return s;
        return foreign + '（' + chinese + '）';
    }

    function normalizeBilingualBubbles(list) {
        var out = [];
        (list || []).forEach(function (raw) {
            var line = String(raw || '').trim();
            if (!line) return;
            if (line.indexOf('||') !== -1) {
                var p = line.split('||');
                line = String(p[0] || '').trim() + '（' + String(p.slice(1).join('||') || '').trim() + '）';
            }
            line = inlineBilingualLine(line);
            var prev = out.length ? out[out.length - 1] : '';
            var hasTrans = lineHasChineseTranslation(prev);
            var prevForeign = prev && !hasTrans && (hasLatin(prev) || /[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(prev));
            if (prevForeign && isChineseTranslationText(line)) {
                out[out.length - 1] = prev + '（' + stripParentheticals(line) + '）';
            } else {
                out.push(line);
            }
        });
        return out;
    }

    function appendAudioControls(el, clipId) {
        if (!el || !clipId || el.querySelector('.vc-msg-audio')) return;
        var box = document.createElement('div');
        box.className = 'vc-msg-audio';
        var play = document.createElement('button');
        play.type = 'button';
        play.title = '播放本轮语音';
        play.className = 'call-audio-play';
        play.setAttribute('data-call-audio-clip', clipId);
        play.setAttribute('aria-label', '播放本轮语音');
        play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        play.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            try { if (window.NanoTTS) window.NanoTTS.stop(); } catch (err) {}
            try {
                var p = window.NanoCallAudio ? window.NanoCallAudio.play(clipId) : null;
                if (p && p.then) p.then(function (ok) { if (!ok) toast('这条语音还没有缓存，请重试一次'); });
            } catch (err) { toast('语音播放失败'); }
        });
        var dl = document.createElement('button');
        dl.type = 'button';
        dl.title = '下载本轮 MP3';
        dl.setAttribute('aria-label', '下载本轮 MP3');
        dl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
        dl.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            try {
                if (!window.NanoCallAudio) return;
                window.NanoCallAudio.download(clipId, 'nano-call-' + clipId + '.mp3').then(function (ok) {
                    if (!ok) toast('语音文件还没准备好');
                });
            } catch (err) { toast('语音下载失败'); }
        });
        box.appendChild(play);
        box.appendChild(dl);
        el.classList.add('has-audio');
        el.appendChild(box);
        try { if (window.NanoCallAudio && NanoCallAudio.sync) NanoCallAudio.sync(); } catch (e) {}
    }

    var pendingAutoplayClip = '';
    var autoplayRetryBound = false;
    function armAutoplayRetry(clipId) {
        if (!clipId) return;
        pendingAutoplayClip = clipId;
        if (autoplayRetryBound) return;
        autoplayRetryBound = true;
        var retry = function () {
            try {
                document.removeEventListener('click', retry, true);
                document.removeEventListener('touchstart', retry, true);
            } catch (e) {}
            autoplayRetryBound = false;
            var id = pendingAutoplayClip;
            pendingAutoplayClip = '';
            if (id && speakerOn && window.NanoCallAudio) {
                try { window.NanoCallAudio.play(id); } catch (e) {}
            }
        };
        try {
            document.addEventListener('click', retry, true);
            document.addEventListener('touchstart', retry, true);
        } catch (e) { autoplayRetryBound = false; }
    }

    function addMessage(text, isUser, opts) {
        opts = opts || {};
        var msg = {
            text: text, isUser: !!isUser,
            turnSeq: Number(opts.turnSeq) || 0,
            turnLast: !!opts.turnLast,
            clipId: String(opts.clipId || '')
        };
        messages.push(msg);
        var el = document.createElement('div');
        el.className = 'vc-msg ' + (isUser ? 'user' : 'ai');
        el.textContent = text;
        el._msg = msg;
        chatArea.appendChild(el);
        chatArea.scrollTop = chatArea.scrollHeight;
        return el;
    }

    // 兜底翻译：模型偶尔忘了按“外文（中文）”格式输出，补一次中文译文。
    function needsChineseTranslation(line) {
        var s = String(line || '').trim();
        if (!s) return false;
        if (lineHasChineseTranslation(s)) return false;
        if (/[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(s)) return true;
        var hasCJK = /[\u4e00-\u9fff]/.test(s);
        return !hasCJK && /[A-Za-z]{2,}/.test(s);
    }

    function requestTranslation(bases, strict) {
        return readApiConfig().then(function (rawCfg) {
            var config = normalizeCfg(rawCfg);
            if (!config || !bases.length) return [];
            var base = config.mainUrl.trim();
            if (!base.endsWith('/v1')) base = base.endsWith('/') ? base + 'v1' : base + '/v1';
            var sys = strict
                ? '上一次输出不合格。现在只输出 JSON 字符串数组，每个元素必须是一句简体中文译文，不能包含英文单词、日文假名或任何解释，不要 Markdown。'
                : '你是中文翻译器。输入是 JSON 数组。无论原文是什么语言，都必须翻译成简体中文；只输出同长度的 JSON 字符串数组，每个元素只包含纯中文译文。禁止输出英文、日文、解释、标题、Markdown、JSON 以外的任何文字。示例输入：["こんばんは","元気？"] 示例输出：["晚上好","你还好吗？"]';
            return fetch(base + '/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + config.mainKey.trim(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: config.mainModel,
                    messages: [
                        { role: 'system', content: sys },
                        { role: 'user', content: JSON.stringify(bases) }
                    ],
                    max_tokens: 1200,
                    temperature: 0
                })
            }).then(function (r) { return r.json(); }).then(function (d) {
                var txt = String((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
                txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                var arr = null;
                try { arr = JSON.parse(txt); } catch (e) {}
                if (!Array.isArray(arr)) {
                    var m = txt.match(/\[[\s\S]*\]/);
                    if (m) { try { arr = JSON.parse(m[0]); } catch (e) {} }
                }
                if (!Array.isArray(arr)) {
                    arr = txt.split(/\n+/).map(function (x) { return x.replace(/^[-*\d.\s"']+/, '').replace(/["']+$/, '').trim(); });
                }
                return arr.map(function (x) { return String(x == null ? '' : x).trim(); });
            }).catch(function () { return []; });
        });
    }

    function translateLines(lines) {
        var bases = (lines || []).map(stripParentheticals).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
        if (!bases.length) return Promise.resolve([]);
        return requestTranslation(bases, false).then(function (arr) {
            var ok = Array.isArray(arr) && arr.length >= bases.length && arr.slice(0, bases.length).every(isChineseTranslationText);
            if (ok) return arr;
            return requestTranslation(bases, true);
        });
    }

    function ensureBubbleTranslations(bubbles, els) {
        var need = [];
        (bubbles || []).forEach(function (line, i) {
            if (needsChineseTranslation(line)) need.push(i);
        });
        if (!need.length) return;
        translateLines(need.map(function (i) { return bubbles[i]; })).then(function (trs) {
            if (!Array.isArray(trs) || !trs.length) return;
            need.forEach(function (idx, k) {
                var tr = trs[k];
                if (!isChineseTranslationText(tr)) return;
                var line = bubbles[idx] + '（' + tr + '）';
                bubbles[idx] = line;
                var el = els[idx];
                if (!el || !el.isConnected) return;
                if (el.querySelector('.vc-msg-audio')) {
                    var node = null;
                    for (var n = el.firstChild; n; n = n.nextSibling) {
                        if (n.nodeType === 3) { node = n; break; }
                    }
                    if (node) node.nodeValue = line;
                    else el.insertBefore(document.createTextNode(line), el.firstChild);
                } else {
                    el.textContent = line;
                }
                if (el._msg) el._msg.text = line;
            });
            try { chatArea.scrollTop = chatArea.scrollHeight; } catch (e) {}
        }).catch(function () {});
    }

    // 一轮只调用一次主 API + 一次 TTS：气泡拆开显示，语音整轮合成一次后播放。
    function deliverReplyBubbles(raw, opts) {
        opts = opts || {};
        var bubbles = normalizeBilingualBubbles(splitBubbles(cleanModelText(raw)));
        if (!bubbles.length) return;
        var seq = ++turnSeq;
        var clipId = callSessionId + '_t' + seq;
        var els = [];
        bubbles.forEach(function (line, i) {
            var last = (i === bubbles.length - 1);
            var el = addMessage(line, false, { turnSeq: seq, turnLast: last, clipId: '' });
            els.push(el);
        });
        ensureBubbleTranslations(bubbles, els);
        var spoken = bubbles.map(spokenText).filter(Boolean).join('\n');
        notifyCallReplied(spoken || bubbles.join(' '));
        if (opts.noTts || !speakerOn || !spoken || !window.NanoTTS || !NanoTTS.getVoiceBlob) return;
        try { if (NanoTTS.setEnabled) NanoTTS.setEnabled(chatId, true); } catch (e) {}
        NanoTTS.getVoiceBlob(spoken, { chatId: chatId }).then(function (got) {
            if (!got || !got.blob) {
                try { toast('TTS 没有返回音频，请检查语音配置'); } catch (e) {}
                return;
            }
            var save = (window.NanoCallAudio && NanoCallAudio.saveClip)
                ? NanoCallAudio.saveClip(clipId, got.blob, { callId: callSessionId, turnSeq: seq, isUser: false, text: spoken })
                : Promise.resolve(false);
            return save.then(function (saved) {
                var lastEl = els[els.length - 1];
                if (lastEl && lastEl._msg) lastEl._msg.clipId = clipId;
                appendAudioControls(lastEl, clipId);
                try {
                    var _pl = NanoTTS.playVoiceBlob
                        ? NanoTTS.playVoiceBlob(got.blob, got.key)
                        : NanoTTS.speakForChat(spoken, { chatId: chatId });
                    if (_pl && _pl.catch) {
                        _pl.catch(function () {
                            toast('点一下屏幕以允许播放语音');
                            if (saved) armAutoplayRetry(clipId);
                        });
                    }
                } catch (e) {
                    if (saved) armAutoplayRetry(clipId);
                }
            });
        }).catch(function (e) {
            console.warn('[Call] 整轮 TTS 失败:', e && e.message ? e.message : e);
            try { toast('语音朗读失败：' + ((e && e.message) || '请检查 TTS 配置')); } catch (err) {}
        });
    }

    // 读取私聊设置（与 chat-core 同一套 localStorage 键）
    function callChatSetting(key, defaultVal) {
        try {
            var raw = localStorage.getItem('chat_setting_' + key + '_' + chatId);
            if (raw === null) return defaultVal;
            try { return JSON.parse(raw); } catch (e) { return raw; }
        } catch (e) { return defaultVal; }
    }
    function charLanguageName() {
        if (callChatSetting('forceTranslate', false)) {
            var forced = String(callChatSetting('forceTranslateLang', '') || '').trim();
            if (forced) return forced;
        }
        var given = String((characterData && (characterData.language || characterData.nativeLanguage || characterData.forceLang)) || '').trim();
        if (given && !/中文|汉语|漢語|普通话|國語|chinese|mandarin/i.test(given)) return given;
        var nat = String((characterData && (characterData.nationality || characterData.country || characterData.region)) || '').trim();
        var langMap = {
            '美国': '英文', '英国': '英文', '澳大利亚': '英文', '加拿大': '英文', '新西兰': '英文',
            '印度': '英文', '新加坡': '英文', '法国': '法文', '德国': '德文', '奥地利': '德文',
            '西班牙': '西班牙文', '墨西哥': '西班牙文', '阿根廷': '西班牙文', '巴西': '葡萄牙文',
            '葡萄牙': '葡萄牙文', '意大利': '意大利文', '日本': '日文', '韩国': '韩文',
            '俄罗斯': '俄文', '泰国': '泰文', '越南': '越南文', '荷兰': '荷兰文',
            '瑞典': '瑞典文', '挪威': '挪威文', '丹麦': '丹麦文', '芬兰': '芬兰文',
            '波兰': '波兰文', '土耳其': '土耳其文', '沙特阿拉伯': '阿拉伯文',
            '阿联酋': '阿拉伯文', '埃及': '阿拉伯文'
        };
        for (var k in langMap) { if (nat.indexOf(k) > -1) return langMap[k]; }
        return '英文';
    }

    function buildSystemPrompt() {
        var nat = String((characterData && (characterData.nationality || characterData.country || characterData.region)) || '').trim();
        var nativeLang = String((characterData && (characterData.language || characterData.nativeLanguage)) || '').trim();
        var p = '你是' + (displayName || '对方') + '，一个真实、有血有肉的人。';
        if (nat && nat !== '未知' && nat !== '未设定') p += '\n- 国籍：' + nat;
        if (nativeLang && nativeLang !== '未知' && nativeLang !== '未设定') p += '\n- 母语 / 常用语言：' + nativeLang;
        p += '\n你现在和用户进行的是实时视频通话。\n';
        if (nat && nat !== '未知' && nat !== '未设定') {
            p += '【身份锚点】你就是' + nat + '人。不要忘记、不要否认自己的国籍和成长背景；被问到或聊到相关话题时，按这个身份自然回答。\n';
        }
        try {
            var now = new Date();
            var week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
            p += '当前时间：' + now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + week +
                ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + '。\n';
        } catch (e) {}
        p += '这是视频通话，结合你能看到/听到的内容自然回应；如果看不到画面就正常聊天，不要反复提"你没开摄像头"。\n';
        p += '你是真人，正在用手机和对方视频：任何情况下都不要承认自己是 AI、模型或程序，也不要说自己不能视频；被问到就用人设自然带过。\n';
        p += '【这是实时视频通话，不是文字聊天】你说的每句话都会直接变成声音被对方听到，对方也在用嘴说话。绝对不要说“我只能打字”“我没办法真的发语音消息”“我发一条语音给你”“你想听什么语音”这类话——在这个场景里这些话是错的、很出戏。\n';
        p += '对方有时会用文字输入（系统会把内容念给你听），但你们仍然在通话里；不要因为看到文字就以为自己只能打字聊天。\n';
        p += '说话像真人视频通话一样：允许短句、停顿、换气、语气词（嗯、唔、欸）；用逗号、省略号、破折号表现自然停顿，不要播音腔，也不要写“（深呼吸）”“[风声]”这类会被直接念出来的旁白或音效标签。语气和语速要贴合人设与当下情绪。\n';
        p += '一次说 8~30 秒，但控制在 1~3 句，把话说完；不要自问自答、自言自语，也不要把心里的推理全说出来。\n';
        p += '【必须回应对方】每次回复先听懂对方最后说的话，直接接住那句话的意思和情绪；不要答非所问，不要无视对方刚说的话，也不要把对方已经回答过的问题反复追问。\n';
        p += '【输出格式】只输出角色说的话，一句一行；禁止输出“以下是/Here are/译文如下/翻译：”这类说明，禁止英文解释、翻译标题、Context/Note、Markdown、星号，也禁止在括号里写英文说明。\n';
        p += '【外语输出格式 · 强制】如果你说外语，每一句都必须写成：外文（中文翻译），一句一行；例如 do you love me（你爱我吗？）。翻译不能省略、不能用外语解释代替中文。TTS 只会读括号前的外文。\n';
        if (isForeignCharacter()) {
            var flang = charLanguageName() || '英文';
            var isCanto = /粤语|粵語|cantonese/i.test(flang);
            var transLabel = isCanto ? '普通话' : '简体中文';
            var forcedFT = callChatSetting('forceTranslate', false);
            p += '【外国人 · 强制双语 · 最高优先级】' + (forcedFT ? '本轮已开启强制翻译' : ('你是' + (nat && nat !== '未知' && nat !== '未设定' ? nat + '人' : '外国人'))) + '，本轮请用' + flang + '说话。\n';
            p += '本轮所有台词都必须写成「' + flang + '原文（' + transLabel + '翻译）」，原文和翻译必须在同一行、同一个气泡里；例如：what did you do today？（你今天做了些什么呀？）。\n';
            p += '禁止只输出外语，禁止只输出中文，禁止把' + transLabel + '翻译单独放一行，也不能漏掉括号和翻译。每一句都要成对出现。\n';
            p += '只有当对方明确说“只用中文 / 别再说外语”时，才全用中文；对方说“听不懂 / 在说什么 / 说中文”时，立刻改用中文。\n';
        }
        p += '每条消息单独一行，不同气泡之间用换行分隔；不要把多句话挤进同一段。\n';
        p += '如果你确实要结束这通视频电话（例如要去忙、手机快没电、话题自然结束、想休息了），可以在回复最后单独一行写 [hangup:简短理由]；这个标记不会显示给对方。不要每轮都挂断，只在真的想结束时用。\n';
        p += '不要每轮都重复描述你看到的外貌/穿着/环境细节（例如眼镜、发型、灯光）；只在有变化或确有必要时才提，别反复强调。\n';
        if (charPersona) p += '\n【你的人设】\n' + charPersona + '\n';
        if (wbText) p += '\n【世界书】\n' + wbText + '\n';
        if (memText) p += '\n【长期记忆】\n' + memText + '\n';
        try {
            var rr = String(window.__videoRerollReason || '').trim();
            if (rr) {
                window.__videoRerollReason = '';
                p += (window.NanoReroll && NanoReroll.block) ? NanoReroll.block(rr) : ('\n\n【本次重roll必须修正】' + rr);
            }
        } catch (e) {}
        try {
            if (window.NanoPrompts && NanoPrompts.appendTo) p = NanoPrompts.appendTo(p, 'call');
        } catch (e) {}
        return p;
    }

    function isForeignCharacter() {
        try {
            // 私聊里的「强制翻译」是硬开关：即使国籍没填对，也按外国人处理。
            if (callChatSetting('forceTranslate', false)) return true;
            if (characterData && characterData.forceTranslate) return true;
            var nat = String((characterData && (characterData.nationality || characterData.country || characterData.region)) || '').trim();
            if (nat && nat !== '未知' && nat !== '未设定') {
                return !/(中国|中國|china|chinese|香港|台湾|台灣|澳门|澳門)/i.test(nat);
            }
            var lang = String((characterData && (characterData.language || characterData.nativeLanguage || characterData.forceLang)) || '').trim();
            if (lang && !/中文|汉语|漢語|普通话|國語|chinese|mandarin/i.test(lang)) return true;
            if (characterData && characterData.foreign) return true;
            if (/^[A-Za-z]/.test(String(displayName || ''))) return true;
            return /^[A-Za-z]/.test(String((characterData && characterData.name) || ''));
        } catch (e) { return false; }
    }

    function notifyCallReplied(text) {
        try {
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'callCharReplied',
                    chatId: chatId,
                    callType: 'video',
                    video: true,
                    name: displayName || contactName,
                    avatar: charAvatar || '',
                    text: String(text || '')
                }, '*');
            }
        } catch (e) {}
    }

    // ===== 长期记忆库 / 世界书 =====
    function readMemory() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_vector_memory_db', 5);
                req.onupgradeneeded = function (e) {
                    try {
                        var d = e.target.result, tx = e.target.transaction;
                        if (!d.objectStoreNames.contains('memories')) {
                            var s = d.createObjectStore('memories', { keyPath: 'id' });
                            s.createIndex('chatId', 'chatId', { unique: false });
                        } else {
                            try { var s2 = tx.objectStore('memories'); if (!s2.indexNames.contains('chatId')) s2.createIndex('chatId', 'chatId', { unique: false }); } catch (err) {}
                        }
                        if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath: 'key' });
                        if (!d.objectStoreNames.contains('chat_state')) d.createObjectStore('chat_state', { keyPath: 'chatId' });
                        if (!d.objectStoreNames.contains('chat_messages')) d.createObjectStore('chat_messages', { keyPath: 'chatId' });
                    } catch (err) {}
                };
                req.onsuccess = function () {
                    try {
                        var db = req.result;
                        var r = db.transaction('memories', 'readonly').objectStore('memories').index('chatId').getAll(chatId);
                        r.onsuccess = function () {
                            var out = [];
                            (r.result || []).forEach(function (m) {
                                var t = m.text || m.content || m.summary || '';
                                if (t) out.push(String(t));
                            });
                            resolve(out);
                        };
                        r.onerror = function () { resolve([]); };
                    } catch (e) { resolve([]); }
                };
                req.onerror = function () { resolve([]); };
            } catch (e) { resolve([]); }
        });
    }
    function readWorldbook() {
        try {
            var raw = localStorage.getItem('nano_worldbook_data_v5');
            if (!raw) return '';
            var d = JSON.parse(raw);
            var entries = Array.isArray(d) ? d : (d.entries || d.list || d.data || []);
            if (!Array.isArray(entries)) entries = [];
            var out = [];
            entries.slice(0, 20).forEach(function (e) {
                if (!e) return;
                var kw = e.keywords || e.keys || e.name || e.title || '';
                var ct = e.content || e.text || e.value || e.desc || '';
                if (ct) out.push((kw ? (kw + '：') : '') + ct);
            });
            return out.join('\n').slice(0, 1500);
        } catch (e) { return ''; }
    }
    function loadContext() {
        return readMemory().then(function (list) {
            memText = (list || []).slice(-30).join('\n').slice(0, 2000);
            wbText = readWorldbook();
        });
    }

    // 读取私聊里的最近消息，视频通话开场 / 回复都要带上，不能只看通话里的几句。
    function loadChatInnerMemory() {
        return new Promise(function (resolve) {
            function fromLS() {
                try {
                    const data = JSON.parse(localStorage.getItem('chat_messages_' + chatId) || '[]');
                    resolve(Array.isArray(data) ? data : []);
                } catch (e) { resolve([]); }
            }
            try {
                if (typeof localforage !== 'undefined') {
                    localforage.getItem('chat_messages_' + chatId).then(function (data) {
                        if (Array.isArray(data) && data.length > 0) resolve(data);
                        else fromLS();
                    }).catch(fromLS);
                } else {
                    fromLS();
                }
            } catch (e) { fromLS(); }
        });
    }

    // ===== API（主 API，IndexedDB 优先）=====
    function readApiConfig() {
        return new Promise(function (resolve) {
            function fromLS() { try { var raw = localStorage.getItem('nano_api_config'); resolve(raw ? JSON.parse(raw) : null); } catch (e) { resolve(null); } }
            try {
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('api_data')) d.createObjectStore('api_data', { keyPath: 'key' }); } catch (err) {} };
                req.onsuccess = function () {
                    try {
                        var r = req.result.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                        r.onsuccess = function () { var v = r.result ? r.result.value : null; if (v) resolve(v); else fromLS(); };
                        r.onerror = fromLS;
                    } catch (e) { fromLS(); }
                };
                req.onerror = fromLS;
            } catch (e) { fromLS(); }
        });
    }
    function normalizeCfg(cfg) {
        if (!cfg) return null;
        var url = cfg.mainUrl || (cfg.main && cfg.main.url) || '';
        var key = cfg.mainKey || (cfg.main && cfg.main.key) || '';
        var model = cfg.mainModel || (cfg.main && cfg.main.model) || '';
        if (!url || !key || !model) return null;
        return { mainUrl: url, mainKey: key, mainModel: model };
    }

    function captureFrame() {
        if (!cameraOn || !mediaStream || !localVideo.videoWidth) return '';
        try {
            var c = document.createElement('canvas');
            c.width = 320;
            c.height = Math.round(320 * localVideo.videoHeight / localVideo.videoWidth) || 240;
            c.getContext('2d').drawImage(localVideo, 0, 0, c.width, c.height);
            return c.toDataURL('image/jpeg', 0.6);
        } catch (e) { return ''; }
    }

    function callApi(userText, extraSystem) {
        return readApiConfig().then(function (rawCfg) {
            var config = normalizeCfg(rawCfg);
            if (!config) return '请先在 API 页面配置主 API';
            var baseUrl = config.mainUrl.trim();
            if (!baseUrl.endsWith('/v1')) baseUrl = baseUrl.endsWith('/') ? baseUrl + 'v1' : baseUrl + '/v1';

            return loadChatInnerMemory().then(function (chatMemory) {
                var msgs = [{ role: 'system', content: buildSystemPrompt() + (extraSystem || '') }];

                // 私聊上文：按时间顺序，包含语音转写，别让模型“失忆”。
                (chatMemory || []).slice(-20).forEach(function (m) {
                    if (!m || m.recalled || m.isCard) return;
                    var c = String(m.text || m.transcript || (m.isVoice && m.voiceData && m.voiceData.ttsText) || '').trim();
                    if (!c) return;
                    msgs.push({ role: m.type === 'right' ? 'user' : 'assistant', content: c });
                });

                // 本次视频通话上文：从旧到新，跳过本轮尚未回复的用户占位消息。
                messages.slice(-20).forEach(function (m) {
                    if (!m || m.recalled) return;
                    var c = String(m.text || m.transcript || '').trim();
                    if (!c) return;
                    msgs.push({ role: m.isUser ? 'user' : 'assistant', content: c });
                });

                var frame = captureFrame();
                var lastRole = msgs.length ? msgs[msgs.length - 1].role : '';
                if (frame) {
                    msgs.push({ role: 'user', content: [{ type: 'text', text: userText || '（看看我这边）' }, { type: 'image_url', image_url: { url: frame } }] });
                } else if (userText) {
                    msgs.push({ role: 'user', content: userText });
                } else if (lastRole !== 'user') {
                    msgs.push({ role: 'user', content: '（视频通话中）' });
                }

                return fetch(baseUrl + '/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + config.mainKey.trim(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: config.mainModel, messages: msgs, max_tokens: 1500, temperature: 0.85 })
                }).then(function (r) {
                    if (!r.ok) return r.json().then(function (e) { throw new Error((e.error && e.error.message) || ('HTTP ' + r.status)); }).catch(function () { throw new Error('HTTP ' + r.status); });
                    return r.json();
                }).then(function (data) {
                    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '抱歉，我没收到回复。';
                }).catch(function (err) { return '出错了：' + err.message; });
            });
        });
    }

    // 角色主动挂断：解析回复里的 [hangup:原因] 标记
    function extractHangup(text) {
        var s = String(text == null ? '' : text);
        var re = /[\[【]\s*(?:hangup|挂断)\s*(?:[:：]\s*([^\]】]*?))?\s*[\]】]/i;
        var m = s.match(re);
        if (!m) return { text: s, hangup: false, reason: '' };
        return {
            text: s.replace(re, '').replace(/\n{3,}/g, '\n\n').trim(),
            hangup: true,
            reason: String(m[1] || '').trim()
        };
    }

    function endCallByChar(reason) {
        if (ended) return;
        clearInterval(timer);
        stopRing();
        try {
            if (mediaStream) mediaStream.getTracks().forEach(function (t) { t.stop(); });
            if (window.NanoTTS) window.NanoTTS.stop();
        } catch (e) {}
        // sendCallCard 会置 ended=true，并把挂断理由带到聊天里
        sendCallCard(false, reason);
        toast(reason ? ('对方挂断了：' + reason) : '对方挂断了通话');
        setTimeout(function () {
            if (window.parent !== window) window.parent.postMessage({ type: 'voiceCallEnded' }, '*');
            else history.back();
        }, 1200);
    }

    function updateReplyMode() {
        var has = !!(messageInput.value && messageInput.value.trim());
        replyBtn.classList.toggle('reply-mode', !has);
        replyBtn.title = has ? '发送' : '回复';
    }

    // 有字 = 只发送消息，不自动调 API；空输入点同一个按钮才让 TA 接话。
    function sendUserMessage() {
        if (isWaiting) return;
        var text = messageInput.value.trim();
        if (!text) return;
        addMessage(text, true);
        messageInput.value = '';
        updateReplyMode();
        try { chatArea.scrollTop = chatArea.scrollHeight; } catch (e) {}
    }

    function triggerReply() {
        if (isWaiting) return;
        if (messageInput.value.trim()) { sendUserMessage(); return; }
        isWaiting = true;
        replyBtn.classList.add('loading');
        showTyping();
        callApi('').then(function (rawReply) {
            hideTyping();
            var parsed = extractHangup(rawReply);
            var reply = parsed.text;
            if (window.nanoStripThink) reply = window.nanoStripThink(reply);
            deliverReplyBubbles(reply);
            isWaiting = false;
            replyBtn.classList.remove('loading');
            if (parsed.hangup) {
                setTimeout(function () { endCallByChar(parsed.reason); }, 900);
            }
        });
    }

    function updateStatus() {
        var m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        var s = String(callSeconds % 60).padStart(2, '0');
        callStatus.textContent = m + ':' + s;
    }
    function startTimer() { clearInterval(timer); timer = setInterval(function () { callSeconds++; updateStatus(); }, 1000); }

    // ===== 摄像头 =====
    function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            toast('当前环境不支持摄像头'); cameraOn = false; setCameraUI(false); return;
        }
        navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode }, audio: false })
            .then(function (stream) {
                mediaStream = stream;
                localVideo.srcObject = stream;
                localVideo.style.display = 'block';
                localOff.style.display = 'none';
                cameraOn = true;
                setCameraUI(true);
                // 前置摄像头画面镜像，看着自然；后置不镜像。
                var _mirror = facingMode === 'user';
                stage.classList.toggle('mirror', _mirror);
                try { localVideo.style.transform = _mirror ? 'scaleX(-1)' : ''; } catch (e) {}
            })
            .catch(function () {
                toast('摄像头不可用或无权限');
                cameraOn = false;
                setCameraUI(false);
            });
    }
    function stopCamera() {
        if (mediaStream) { try { mediaStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
        mediaStream = null;
        localVideo.srcObject = null;
        localVideo.style.display = 'none';
        try { localVideo.style.transform = ''; } catch (e) {}
        stage.classList.remove('mirror');
        localOff.style.display = 'flex';
        cameraOn = false;
        setCameraUI(false);
    }
    function setCameraUI(on) {
        if (cameraBtn) cameraBtn.classList.toggle('off', !on);
        if (flipBtn) flipBtn.style.display = on ? '' : 'none';
    }

    function notifyCallState(active) {
        try {
            if (active) localStorage.setItem('nano_call_active_' + chatId, String(Date.now()));
            else localStorage.removeItem('nano_call_active_' + chatId);
        } catch (e) {}
        try {
            if (window.parent !== window) window.parent.postMessage({ type: 'nanoCallState', chatId: chatId, active: !!active }, '*');
        } catch (e) {}
    }

    // ===== 通话卡片 =====
    function sendCallCard(missed, rejectReason) {
        if (ended) return;
        ended = true;
        notifyCallState(false);
        try { if (window.NanoTTS && NanoTTS.stop) NanoTTS.stop(); } catch (e) {}
        try { if (window.NanoCallAudio && NanoCallAudio.stop) NanoCallAudio.stop(); } catch (e) {}
        var out = [];
        for (var i = 0; i < messages.length; i++) {
            var m = messages[i];
            if (m.text && m.text.trim()) {
                out.push({
                    text: m.text,
                    isUser: m.isUser,
                    turnSeq: Number(m.turnSeq) || 0,
                    turnLast: !!m.turnLast,
                    clipId: String(m.clipId || '')
                });
            }
        }
        var callId = callSessionId;
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'NANO_VIDEO_CALL_CARD',
                chatId: chatId,
                callId: callId,
                duration: missed ? 0 : callSeconds,
                missed: missed || false,
                incoming: isIncoming,
                rejectReason: rejectReason || '',
                video: true,
                messages: out
            }, '*');
        }
    }

    // 角色决定接不接视频（调用主 API，约四分之一概率拒接）
    function decideAnswer() {
        return readApiConfig().then(function (rawCfg) {
            var config = normalizeCfg(rawCfg);
            if (!config) return { answer: true };
            var base = config.mainUrl.trim();
            if (!base.endsWith('/v1')) base = base.endsWith('/') ? base + 'v1' : base + '/v1';
            var sys = buildSystemPrompt() +
                '\n\n现在用户正在给你打视频电话。请以你的人设和当前情境判断此刻是否方便接听：如果时间太晚、正在忙、不方便、心情不好等，可以拒接；大约四分之一的情况你会拒接。只输出 JSON：{"answer": true 或 false, "say": "接就结合你们最近的聊天、记忆和当前氛围，写你接通后自然说的第一句话；不要用‘喂，听得到吗’这类模板；拒接就写拒接的一句话理由"}。';
            return fetch(base + '/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + config.mainKey.trim(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: config.mainModel, messages: [{ role: 'system', content: sys }, { role: 'user', content: '（视频通话邀请响了）' }], max_tokens: 120, temperature: 0.8 })
            }).then(function (r) { return r.json(); }).then(function (dd) {
                var t = (dd.choices && dd.choices[0] && dd.choices[0].message && dd.choices[0].message.content) || '';
                var m = t.match(/\{[\s\S]*\}/);
                var obj = null;
                try { obj = m ? JSON.parse(m[0]) : null; } catch (e) {}
                var say = (obj && (obj.say || obj.reason)) || '';
                if (obj && obj.answer === false) return { answer: false, reason: say };
                return { answer: true, say: say };
            }).catch(function () { return { answer: true }; });
        });
    }

    // 由主 API 根据上下文生成视频接通后的第一句，不使用内置模板台词。
    function generateOpeningLine() {
        var extra = '\n\n【本轮场景 · 视频电话刚接通】对方还没有说话，由你先开口。' +
            '请结合你们最近的聊天、长期记忆、当前时间和氛围，自然地直接说第一句；' +
            '不要说“喂，听得到吗”“喂？能听到吗”这类模板开场，也不要问对方能不能听到。' +
            '如果对方在之前的聊天里说过什么，要顺着那件事开口，不要装作没发生过。';
        return callApi('', extra).then(function (raw) {
            var reply = window.nanoStripThink ? window.nanoStripThink(raw) : raw;
            reply = extractHangup(reply).text;
            if (!reply || /^(请先在 API|出错了)/.test(reply)) {
                try { toast('主 API 没有返回开场白，请检查 API 配置'); } catch (e) {}
                return '';
            }
            return reply;
        }).catch(function () {
            try { toast('开场白生成失败，请检查 API'); } catch (e) {}
            return '';
        });
    }

    // ===== 事件 =====
    // 只有小窗（或已放大的本地窗）点击才互换，避免误触主画面
    function onBoxClick(which) {
        var swapped = stage.classList.contains('swapped');
        if (which === 'local') stage.classList.toggle('swapped');
        else if (swapped) stage.classList.toggle('swapped');
    }
    localBox.addEventListener('click', function () { onBoxClick('local'); });
    remoteBox.addEventListener('click', function () { onBoxClick('remote'); });

    cameraBtn.addEventListener('click', function () { if (cameraOn) stopCamera(); else startCamera(); });
    flipBtn.addEventListener('click', function () { facingMode = facingMode === 'user' ? 'environment' : 'user'; stopCamera(); startCamera(); });

    try {
        if (window.NanoTTS && window.NanoTTS.isEnabled && window.NanoTTS.isEnabled(chatId)) speakerOn = true;
            if (speakerOn && window.NanoTTS && window.NanoTTS.setEnabled) window.NanoTTS.setEnabled(chatId, true);
    } catch (e) {}
    speakerBtn.classList.toggle('active', speakerOn);
    speakerBtn.title = speakerOn ? '语音朗读：开' : '语音朗读：关';
    speakerBtn.addEventListener('click', function () {
        try { if (window.NanoTTS && window.NanoTTS.prime) window.NanoTTS.prime(); } catch (e) {}
        speakerOn = !speakerOn;
        try { localStorage.setItem('nano_call_tts', speakerOn ? '1' : '0'); } catch (e) {}
        try { if (window.NanoTTS && window.NanoTTS.setEnabled) window.NanoTTS.setEnabled(chatId, speakerOn); } catch (e) {}
        try {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'ttsEnabledChanged', chatId: chatId, enabled: speakerOn }, '*');
                var cf = window.parent.document.getElementById('chatInnerFrame');
                if (cf && cf.contentWindow) cf.contentWindow.postMessage({ type: 'ttsEnabledChanged', chatId: chatId, enabled: speakerOn }, '*');
            }
        } catch (e) {}
        speakerBtn.classList.toggle('active', speakerOn);
        speakerBtn.title = speakerOn ? '语音朗读：开' : '语音朗读：关';
        if (!speakerOn) {
            try { if (window.NanoTTS) window.NanoTTS.stop(); } catch (e) {}
            try { if (window.NanoCallAudio) window.NanoCallAudio.stop(); } catch (e) {}
            toast('语音朗读已关闭，纯文字');
        } else {
            toast('语音朗读已开启，之后的每轮都会自动读');
            playLatestTurnAudio();
        }
    });

    // 打开喇叭时补播最近一轮缓存语音，不重新调用 TTS / API。
    function playLatestTurnAudio() {
        if (!window.NanoCallAudio || !messages.length) return;
        var lastTurn = 0;
        messages.forEach(function (m) {
            if (m && !m.isUser && Number(m.turnSeq) > lastTurn) lastTurn = Number(m.turnSeq);
        });
        if (!lastTurn) return;
        for (var i = messages.length - 1; i >= 0; i--) {
            var m = messages[i];
            if (m && !m.isUser && Number(m.turnSeq) === lastTurn) {
                if (m.clipId) {
                    try { window.NanoCallAudio.play(m.clipId); } catch (e) {}
                }
                return;
            }
        }
    }

    function applyFirstSpeakerUI() {
        document.querySelectorAll('[data-first-speaker]').forEach(function (btn) {
            btn.classList.toggle('active', String(btn.dataset.firstSpeaker) === firstSpeaker);
        });
    }
    document.querySelectorAll('[data-first-speaker]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            firstSpeaker = String(this.dataset.firstSpeaker) === 'me' ? 'me' : 'char';
            try { localStorage.setItem('nano_call_first_' + chatId, firstSpeaker); } catch (e) {}
            applyFirstSpeakerUI();
            toast(firstSpeaker === 'char' ? '已设置：接通后 TA 先说' : '已设置：接通后你先说');
        });
    });
    applyFirstSpeakerUI();

    bgBtn.addEventListener('click', function (e) { e.stopPropagation(); bgPanel.classList.toggle('active'); });
    if (bgPanel) {
        bgPanel.addEventListener('click', function (e) {
            var opt = e.target.closest('.vc-bg-opt');
            if (opt) {
                var v = opt.getAttribute('data-bg') || '';
                applyBg(v);
                saveBg(v);
                try { if (window.NanoCallBg) window.NanoCallBg.clear(chatId); } catch (err) {}
                bgPanel.classList.remove('active');
            }
        });
    }
    if (bgUpload) bgUpload.addEventListener('change', function () {
        var f = this.files && this.files[0]; if (!f) return;
        bgPanel.classList.remove('active');
        var isVideo = /^video\//i.test(f.type || '') || /\.(mp4|mov|m4v|webm)$/i.test(f.name || '');
        if (isVideo) {
            if (window.NanoCallBg) {
                window.NanoCallBg.setVideo(f, f.name, chatId).then(function () {
                    window.NanoCallBg.showVideo(f);
                    toast('已更换视频背景');
                }).catch(function () { toast('视频背景保存失败'); });
            } else toast('当前环境不支持视频背景');
            this.value = '';
            return;
        }
        var reader = new FileReader();
        reader.onload = function (ev) {
            var v = String(ev.target.result || '');
            applyBg(v);
            saveBg(v);
            try { if (window.NanoCallBg) window.NanoCallBg.setImage(v, chatId); } catch (e) {}
        };
        reader.readAsDataURL(f); this.value = '';
    });

    messageInput.addEventListener('input', updateReplyMode);
    replyBtn.addEventListener('click', function () {
        // 有字 = 只发送；空 = 让 TA 接话（这时才调用 API）
        if (messageInput.value.trim()) sendUserMessage();
        else triggerReply();
    });
    messageInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (messageInput.value.trim()) sendUserMessage();
    });

    rerollBtn.addEventListener('click', async function () {
        if (isWaiting) return;
        if (window.NanoReroll) {
            var reason = await NanoReroll.ask({ title: '重roll 视频通话', subtitle: '上一句哪里不对？留空也可以直接重说' });
            if (reason === null) return;
            window.__videoRerollReason = reason || '';
        }
        // 重roll：删除「本轮」生成的所有气泡（末尾连续的 AI 消息），不动历史消息
        var idx = messages.length - 1;
        while (idx >= 0 && !messages[idx].isUser) idx--;
        messages = messages.slice(0, idx + 1);
        chatArea.innerHTML = '';
        messages.forEach(function (m) {
            var el = document.createElement('div');
            el.className = 'vc-msg ' + (m.isUser ? 'user' : 'ai');
            el.textContent = m.text;
            el._msg = m;
            if (!m.isUser && m.clipId && m.turnLast) appendAudioControls(el, m.clipId);
            chatArea.appendChild(el);
        });
        chatArea.scrollTop = chatArea.scrollHeight;
        triggerReply();
    });

    var recog = null, recording = false;
    function stopRecog() {
        recording = false;
        if (recordBtn) recordBtn.classList.remove('recording');
        try { if (recog) recog.stop(); } catch (e) {}
        recog = null;
    }
    recordBtn.addEventListener('click', function () {
        if (recording) { stopRecog(); return; }
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { toast('当前环境不支持语音识别'); return; }
        try {
            recog = new SR();
            recog.lang = 'zh-CN'; recog.continuous = true; recog.interimResults = true;
            recog.onresult = function (ev) {
                var t = '';
                for (var i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) t += ev.results[i][0].transcript;
                if (!t) return;
                messageInput.value = (messageInput.value || '') + t;
                updateReplyMode();
            };
            recog.onerror = stopRecog;
            recog.onend = stopRecog;
            recog.start();
            recording = true;
            recordBtn.classList.add('recording');
            toast('正在录音，再点一次结束');
        } catch (e) { stopRecog(); toast('录音启动失败'); }
    });

    minimizeBtn.addEventListener('click', function () {
        try { window.parent.postMessage({ type: 'minimizeVoiceCall', seconds: callSeconds }, '*'); } catch (e) {}
    });

    hangupBtn.addEventListener('click', function () {
        clearInterval(timer);
        stopRing();
        sendCallCard();
        try {
            if (mediaStream) mediaStream.getTracks().forEach(function (t) { t.stop(); });
            if (window.NanoTTS) window.NanoTTS.stop();
        } catch (e) {}
        if (window.parent !== window) window.parent.postMessage({ type: 'voiceCallEnded' }, '*');
        else history.back();
    });

    // 右滑返回 = 挂断（复用挂断按钮的收尾逻辑）
    window.__nanoInternalBack = function () {
        try { hangupBtn.click(); return true; } catch (e) { return false; }
    };

    window.addEventListener('message', function (e) {
        var d = e.data;
        if (d && d.type === 'restoreVoiceCall') {
            if (d.seconds !== undefined && d.seconds > 0) { callSeconds = d.seconds; updateStatus(); }
            startTimer();
        }
    });

    window.addEventListener('pagehide', function () { notifyCallState(false); });
    window.addEventListener('beforeunload', function () { notifyCallState(false); });

    // ===== 初始化 =====
    loadInfos().then(function () {
        try {
            if (window.NanoTTS && window.NanoTTS.isEnabled && window.NanoTTS.isEnabled(chatId)) speakerOn = true;
            if (speakerOn && window.NanoTTS && window.NanoTTS.setEnabled) window.NanoTTS.setEnabled(chatId, true);
            speakerBtn.classList.toggle('active', speakerOn);
            speakerBtn.title = speakerOn ? '语音朗读：开' : '语音朗读：关';
        } catch (e) {}
        if (userAvatar) return;
        return readUserAvatar().then(function (u) { if (u) userAvatar = u; });
    }).then(loadContext).then(function () {
        unlockAudio();
        applyAvatars();
        loadCallBg();
        // 默认不开摄像头：本地小窗显示「我」的头像；点了摄像头按钮才出实时画面
        localVideo.style.display = 'none';
        localOff.style.display = 'flex';
        setCameraUI(false);
        updateReplyMode();
        notifyCallState(true);
        // 接通前：居中头像 + 提示音，输入栏与三个按钮先隐藏（和语音通话一致）
        var connectingEl = $('vcConnecting');
        var inputArea = document.querySelector('.vc-input-area');
        var controls = document.querySelector('.hangup-wrapper');
        if (inputArea) inputArea.style.display = 'none';
        // 接通中：底部保留「挂断」按钮（随时可取消），免提/录音接通后再显示
        if (controls) controls.style.display = '';
        var _spkV = $('speakerBtn'); if (_spkV) _spkV.style.display = 'none';
        var _recV = $('recordBtn'); if (_recV) _recV.style.display = 'none';
        if (connectingEl) connectingEl.style.display = 'flex';
        startRing();
        // 接通时长 = 角色「决定接不接」的 API 反应时间（保留最短动画）
        var _answerP = isIncoming ? Promise.resolve({ answer: true, say: '' }) : decideAnswer();
        Promise.all([_answerP, new Promise(function (r) { setTimeout(r, 2600 + Math.random() * 1400); })]).then(function (arr) {
            if (ended) return;
            var d = arr[0];
            if (d && d.answer === false) {
                // 角色拒接
                stopRing();
                if ($('connStatus')) $('connStatus').textContent = '对方未接听...';
                sendCallCard(true, d.reason);
                setTimeout(function () {
                    if (window.parent !== window) window.parent.postMessage({ type: 'voiceCallEnded' }, '*');
                    else history.back();
                }, 2000);
                return;
            }
            // 「谁先说话」：对方先说时，用 API 结合上下文生成第一句；
            // 没有返回内容时再单独请求开场白，不使用内置的「喂，能听到吗」。
            if (firstSpeaker === 'char') {
                var firstSay = d && d.say ? String(d.say).trim() : '';
                if (firstSay) {
                    deliverReplyBubbles(firstSay);
                } else {
                    isWaiting = true;
                    showTyping();
                    generateOpeningLine().then(function (line) {
                        hideTyping();
                        isWaiting = false;
                        if (line) deliverReplyBubbles(line);
                    }).catch(function () {
                        hideTyping();
                        isWaiting = false;
                    });
                }
            }
            stopRing();
            if (connectingEl) connectingEl.style.display = 'none';
            if (inputArea) inputArea.style.display = '';
            if (controls) controls.style.display = '';
            var _spkV2 = $('speakerBtn'); if (_spkV2) _spkV2.style.display = '';
            var _recV2 = $('recordBtn'); if (_recV2) _recV2.style.display = '';
            callStatus.textContent = '00:00';
            startTimer();
        });
    });
})();
