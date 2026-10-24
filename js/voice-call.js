// ============================================================
// voice-call.js - 语音电话逻辑（完整版）
// ============================================================
(function() {
    'use strict';

    // ===== DOM 引用 =====
    const chatArea = document.getElementById('chatArea');
    const messageInput = document.getElementById('messageInput');
    const replyBtn = document.getElementById('replyBtn');
    const rerollBtn = document.getElementById('rerollBtn');
    const hangupBtn = document.getElementById('hangupBtn');
    const minimizeBtn = document.getElementById('minimizeBtn');
    const bgBtn = document.getElementById('bgBtn');
    const bgPanel = document.getElementById('bgPanel');
    const bgUploadInput = document.getElementById('bgUploadInput');
    const typingIndicator = document.getElementById('typingIndicator');
    const callStatus = document.getElementById('callStatus');
    const contactName = document.getElementById('contactName');
    const msgMenu = document.getElementById('msgMenu');
    const msBar = document.getElementById('msBar');
    const msCount = document.getElementById('msCount');
    const msCancel = document.getElementById('msCancel');
    const msDeleteBtn = document.getElementById('msDelete');
    const incomingActions = document.getElementById('incomingActions');
    const answerBtn = document.getElementById('answerBtn');
    const declineBtn = document.getElementById('declineBtn');
    const hangupWrapper = document.getElementById('hangupWrapper');
    const speakerBtn = document.getElementById('speakerBtn');
    const recordBtn = document.getElementById('recordBtn');
    // 语音朗读：开启时把角色的话接 TTS 读出来；关闭则纯文字。设置会记住。
    let speakerOn = (function(){try{return localStorage.getItem('nano_call_tts')!=='0'}catch(e){return true}})();

    // iOS 需要一次用户手势才允许后续 HTMLAudio 自动播放；先用静音音频解锁。
    let _audioUnlocked = false;
    function unlockAudio() {
        if (_audioUnlocked) return;
        _audioUnlocked = true;
        try {
            // 复用同一个 <audio> 元素做手势解锁，后续 TTS 才能自动接着播。
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

    // ===== 从 URL 获取参数（与 chat_inner 的人设同步） =====
    const urlParams = new URLSearchParams(window.location.search);
    let chatId = urlParams.get('chat');
    let contactNameParam = urlParams.get('name');
    if (!chatId || !contactNameParam) {
        try {
            const info = JSON.parse(sessionStorage.getItem('inner_setting_info') || 'null') ||
                         JSON.parse(sessionStorage.getItem('last_chat_info') || 'null');
            if (info) {
                if (!chatId) chatId = info.chatId || info.id;
                if (!contactNameParam) contactNameParam = info.name || info.chatName;
            }
        } catch (e) {}
    }
    chatId = chatId || 'default';
    contactNameParam = contactNameParam || '对方';
    const lookupName = contactNameParam;
    // 通话喇叭与私聊顶栏喇叭是同一个开关：只要这个角色或全局通话喇叭是开的，就打开 TTS。
    // 注意不能直接用 isEnabled(chatId) 覆盖全局默认值——它的默认是 false，会把通话 TTS 静音。
    try {
        if (window.NanoTTS && window.NanoTTS.isEnabled && window.NanoTTS.isEnabled(chatId)) speakerOn = true;
        if (speakerOn && window.NanoTTS && window.NanoTTS.setEnabled) window.NanoTTS.setEnabled(chatId, true);
    } catch (e) {}

    // ===== 从角色库读取人设 =====
    function getCharacterData() {
        return new Promise(function(resolve) {
            try {
                if (!('indexedDB' in window)) { resolve(null); return; }
                const request = indexedDB.open('nano_characters_db', 1);
                request.onsuccess = function(e) {
                    const db = e.target.result;
                    try {
                        const tx = db.transaction('characters', 'readonly');
                        const getAll = tx.objectStore('characters').getAll();
                        getAll.onsuccess = function() {
                            const chars = getAll.result || [];
                            // 先按聊天 id 精确匹配，避免同名角色串人设（国籍/语言会读错）。
                            let char = chars.find(c => String(c.id) === String(chatId));
                            if (!char) char = chars.find(c => c.name === lookupName);
                            resolve(char || null);
                        };
                        getAll.onerror = function() { resolve(null); };
                    } catch (err) { resolve(null); }
                };
                request.onerror = function() { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    let characterData = null;
    let contactAvatar = urlParams.get('avatar') || '';

    function renderContact() {
        try {
            const remark = localStorage.getItem('chat_setting_remark_' + chatId);
            if (remark) {
                try { contactNameParam = JSON.parse(remark); } catch (e) { }
            }
        } catch (e) {}
        if (characterData && characterData.avatar && characterData.avatar.length > 50) {
            contactAvatar = characterData.avatar;
        }
        // 头像背景选项的缩略图
        var avOpt = document.querySelector('.bg-option-avatar');
        if (avOpt && contactAvatar) avOpt.style.background = '#333 url(' + contactAvatar + ') center/cover';
        contactName.textContent = contactNameParam;
        if (contactAvatar && contactAvatar.trim() !== '') {
            const avatarImg = document.getElementById('contactAvatar');
            const avatarSvg = document.getElementById('avatarSvg');
            if (avatarImg) {
                avatarImg.src = contactAvatar;
                avatarImg.style.display = 'block';
                if (avatarSvg) avatarSvg.style.display = 'none';
            }
        }
    }
    renderContact();
    var characterReady = getCharacterData().then(function(char) {
        characterData = char;
        renderContact();
        // 头像就绪后，若当前是「头像背景」则重新清晰铺满（此回调在同步代码之后执行，安全）
        if (currentBg === 'avatar' || !currentBg) { try { setBg('avatar'); } catch (e) {} }
        return char;
    });

    var memText = '', wbText = '';
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

    // 角色人设 / 世界书 / 记忆没读完就调用 API，会得到「不知道自己是哪国人、没读上文」的回复。
    var contextReady = Promise.resolve();
    function ensureContextReady() {
        return Promise.all([characterReady, contextReady]).catch(function () {});
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
        var nationality = String((characterData && (characterData.nationality || characterData.country || characterData.region)) || '').trim();
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
        for (var k in langMap) { if (nationality.indexOf(k) > -1) return langMap[k]; }
        return '英文';
    }

    function buildSystemPrompt() {
        const charName = characterData ? characterData.name : contactNameParam;
        const nationality = String((characterData && (characterData.nationality || characterData.country || characterData.region)) || '').trim();
        const nativeLang = String((characterData && (characterData.language || characterData.nativeLanguage)) || '').trim();
        const setting = String((characterData && (characterData.setting || characterData.desc || characterData.persona || characterData.backstory)) || '');
        let prompt = '你是' + charName + '，一个真实、有血有肉的人。';
        if (characterData) {
            if (characterData.gender && characterData.gender !== '未知') prompt += '\n- 性别：' + characterData.gender;
            if (nationality && nationality !== '未知' && nationality !== '未设定') prompt += '\n- 国籍：' + nationality;
            if (nativeLang && nativeLang !== '未知' && nativeLang !== '未设定') prompt += '\n- 母语 / 常用语言：' + nativeLang;
            if (setting) prompt += '\n- 设定：\n' + setting;
        }
        if (nationality && nationality !== '未知' && nationality !== '未设定') {
            prompt += '\n\n【身份锚点】你就是' + nationality + '人。不要忘记、不要否认自己的国籍和成长背景；被问到或聊到相关话题时，按这个身份自然回答。';
        }
        try {
            const now = new Date();
            const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
            prompt += '\n当前时间：' + now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + week +
                ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + '。';
        } catch (e) {}
        prompt += '\n\n你正在和用户进行实时语音通话，保持自然、简洁、真实的回复风格，不要使用 emoji。';
        prompt += '\n你是真人，正在用手机和对方通话：任何情况下都不要承认自己是 AI、模型或程序，也不要说自己不能打电话；被问到就用人设自然带过。';
        prompt += '\n【这是实时语音通话，不是文字聊天】你说的每句话都会直接变成声音被对方听到，对方也在用嘴说话。绝对不要说“我只能打字”“我没办法真的发语音消息”“我发一条语音给你”“你想听什么语音”这类话——在这个场景里这些话是错的、很出戏。';
        prompt += '\n对方有时会用文字输入（系统会把内容念给你听），但你们仍然在通话里；不要因为看到文字就以为自己只能打字聊天。';
        prompt += '\n像真人打电话一样说：允许短句、停顿、换气、语气词（嗯、唔、欸）；用逗号、省略号、破折号表现自然停顿，不要播音腔，也不要写“（深呼吸）”“[风声]”这类会被直接念出来的旁白或音效标签。';
        prompt += '\n语气、语速要贴合你的人设和当下情绪；开心轻快、害羞放软、生气短促、困倦含糊。需要环境感时用一句自然的话带过（比如“外面有点吵，我走近一点”），不要每句都加。';
        prompt += '\n一次说 8~30 秒，但控制在 1~3 句，把话说完；不要自问自答、自言自语，也不要把心里的推理全说出来。';
        prompt += '\n【必须回应对方】每次回复先听懂对方最后说的话，直接接住那句话的意思和情绪；不要答非所问，不要无视对方刚说的话，也不要把对方已经回答过的问题反复追问。';
        prompt += '\n【输出格式】只输出角色说的话，一句一行；禁止输出“以下是/Here are/译文如下/翻译：”这类说明，禁止英文解释、翻译标题、Context/Note、Markdown、星号，也禁止在括号里写英文说明。';
        prompt += '\n【外语输出格式 · 强制】如果你说外语，每一句都必须写成：外文（中文翻译），一句一行；例如 do you love me（你爱我吗？）。翻译不能省略、不能用外语解释代替中文。TTS 只会读括号前的外文。';
        if (isForeignCharacter()) {
            var flang = charLanguageName() || '英文';
            var isCanto = /粤语|粵語|cantonese/i.test(flang);
            var transLabel = isCanto ? '普通话' : '简体中文';
            var forcedFT = callChatSetting('forceTranslate', false);
            prompt += '\n【外国人 · 强制双语 · 最高优先级】' + (forcedFT ? '本轮已开启强制翻译' : ('你是' + (nationality && nationality !== '未知' && nationality !== '未设定' ? nationality + '人' : '外国人'))) + '，本轮请用' + flang + '说话。';
            prompt += '\n本轮所有台词都必须写成「' + flang + '原文（' + transLabel + '翻译）」，原文和翻译必须在同一行、同一个气泡里；例如：what did you do today？（你今天做了些什么呀？）。';
            prompt += '\n禁止只输出外语，禁止只输出中文，禁止把' + transLabel + '翻译单独放一行，也不能漏掉括号和翻译。每一句都要成对出现。';
            prompt += '\n只有当对方明确说“只用中文 / 别再说外语”时，才全用中文；对方说“听不懂 / 在说什么 / 说中文”时，立刻改用中文。';
        }
        prompt += '\n每条消息单独一行，不同气泡之间用换行分隔；不要把多句话挤进同一段。';
        prompt += '\n如果你确实要结束这通电话（例如要去忙、手机快没电、话题自然结束、想休息了），可以在回复最后单独一行写 [hangup:简短理由]；这个标记不会显示给对方。不要每轮都挂断，只在真的想结束时用。';
        if (wbText) prompt += '\n【世界书】\n' + wbText;
        if (memText) prompt += '\n【长期记忆】\n' + memText;
        try {
            const rr = String(window.__voiceRerollReason || '').trim();
            if (rr) {
                window.__voiceRerollReason = '';
                prompt += (window.NanoReroll && NanoReroll.block) ? NanoReroll.block(rr) : ('\n\n【本次重roll必须修正】' + rr);
            }
        } catch (e) {}
        try {
            if (window.NanoPrompts && NanoPrompts.appendTo) prompt = NanoPrompts.appendTo(prompt, 'call');
        } catch (e) {}
        return prompt;
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
            if (/^[A-Za-z]/.test(String(contactNameParam || ''))) return true;
            return /^[A-Za-z]/.test(String(characterData && characterData.name || ''));
        } catch (e) { return false; }
    }

    function notifyCallReplied(text) {
        try {
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'callCharReplied',
                    chatId: chatId,
                    callType: 'voice',
                    name: contactNameParam,
                    avatar: (characterData && characterData.avatar) || contactAvatar || '',
                    text: String(text || '')
                }, '*');
            }
        } catch (e) {}
    }

    // ===== 从 localStorage 读取上次计时 =====
    function getStoredSeconds() {
        try {
            const raw = localStorage.getItem('voice_call_seconds_' + chatId);
            if (raw) {
                return parseInt(raw, 10) || 0;
            }
        } catch (e) {}
        return 0;
    }

    function storeSeconds(seconds) {
        try {
            localStorage.setItem('voice_call_seconds_' + chatId, String(seconds));
        } catch (e) {}
    }

    // ===== 状态 =====
    let isWaiting = false;
    let callClosed = false;
    let callSeconds = getStoredSeconds();
    let callTimer = null;
    let messages = [];
    let currentBg = '#f2f2f7';
    let customBg = null;
    let isMinimized = false;
    let isRestoring = false;
    let msgSeq = 0;
    let multiSelectMode = false;
    let selectedIds = [];
    let menuTargetId = null;
    let isIncoming = urlParams.get('incoming') === '1';
    // 同一通电话的稳定 ID：通话记录、语音文件、悬浮球续接都用它，不能等到挂断才生成。
    let callSessionId = 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    let turnSeq = 0;
    let firstSpeaker = (function () {
        try { return localStorage.getItem('nano_call_first_' + chatId) === 'me' ? 'me' : 'char'; } catch (e) { return 'char'; }
    })();

    // ===== 接通状态 =====
    let isConnected = false;          // 是否已接通
    let isConnecting = false;         // 是否正在接通中
    let connectTimer = null;          // 接通等待计时器
    let connectStartTime = null;      // 开始接通的时间

    // ===== IndexedDB 存储 =====
    const DB_NAME = 'voice_call_' + chatId + '_db';
    const STORE_NAME = 'messages';
    const BG_STORE = 'settings';
    const DB_VERSION = 1;

    function openDB() {
        return new Promise(function(resolve, reject) {
            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = function(e) {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    }
                    if (!db.objectStoreNames.contains(BG_STORE)) {
                        db.createObjectStore(BG_STORE, { keyPath: 'key' });
                    }
                };
                req.onsuccess = function(e) { resolve(e.target.result); };
                req.onerror = function(e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }

    function genMsgId() {
        msgSeq++;
        return 'vc_' + Date.now() + '_' + msgSeq;
    }

    function saveMessageObj(obj) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const req = tx.objectStore(STORE_NAME).put(obj);
                req.onsuccess = function() { resolve(req.result); };
                req.onerror = function(e) { reject(e.target.error); };
                tx.oncomplete = function() { db.close(); };
            });
        });
    }

    function deleteMessageById(id) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const req = tx.objectStore(STORE_NAME).delete(id);
                req.onsuccess = function() { resolve(); };
                req.onerror = function(e) { reject(e.target.error); };
                tx.oncomplete = function() { db.close(); };
            });
        });
    }

    function deleteMessagesByIds(ids) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                ids.forEach(function(id) { store.delete(id); });
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function(e) { reject(e); };
            });
        });
    }

    function loadMessages() {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = function() {
                    const msgs = req.result || [];
                    db.close();
                    resolve(msgs);
                };
                req.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    function deleteLastMessage() {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = function() {
                    const msgs = req.result || [];
                    if (msgs.length === 0) { resolve(); return; }
                    const last = msgs[msgs.length - 1];
                    const delReq = store.delete(last.id);
                    delReq.onsuccess = function() { resolve(); };
                    delReq.onerror = function(e) { reject(e.target.error); };
                };
                req.onerror = function(e) { reject(e.target.error); };
                tx.oncomplete = function() { db.close(); };
            });
        });
    }

    function saveBg(bgColor) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(BG_STORE, 'readwrite');
                const store = tx.objectStore(BG_STORE);
                const req = store.put({ key: 'background', value: bgColor });
                req.onsuccess = function() { resolve(); };
                req.onerror = function(e) { reject(e.target.error); };
                tx.oncomplete = function() { db.close(); };
            });
        });
    }

    function loadBg() {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(BG_STORE, 'readonly');
                const store = tx.objectStore(BG_STORE);
                const req = store.get('background');
                req.onsuccess = function() {
                    const result = req.result;
                    db.close();
                    resolve(result ? result.value : null);
                };
                req.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    // ===== 更新计时显示 =====
    function updateCallStatus() {
        const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const s = String(callSeconds % 60).padStart(2, '0');
        callStatus.textContent = m + ':' + s;
        storeSeconds(callSeconds);
    }

    // ===== 通话计时器 =====
    function startTimer() {
        if (callTimer) {
            clearInterval(callTimer);
        }
        callTimer = setInterval(function() {
            callSeconds++;
            updateCallStatus();
        }, 1000);
    }

    // ===== 显示/隐藏输入栏 =====
function showInputArea() {
    const bottomArea = document.querySelector('.bottom-area');
    const rerollBtn = document.getElementById('rerollBtn');
    const messageInput = document.getElementById('messageInput');
    const replyBtn = document.getElementById('replyBtn');
    if (bottomArea) bottomArea.style.display = 'block';
    if (rerollBtn) rerollBtn.style.display = 'flex';
    if (messageInput) messageInput.style.display = 'block';
    if (replyBtn) replyBtn.style.display = 'flex';
    try { updateReplyMode(); } catch (e) {}
}

function hideInputArea() {
    const bottomArea = document.querySelector('.bottom-area');
    const rerollBtn = document.getElementById('rerollBtn');
    const messageInput = document.getElementById('messageInput');
    const replyBtn = document.getElementById('replyBtn');
    if (bottomArea) bottomArea.style.display = 'none';
    if (rerollBtn) rerollBtn.style.display = 'none';
    if (messageInput) messageInput.style.display = 'none';
    if (replyBtn) replyBtn.style.display = 'none';
}

    // ===== 模拟接通（接通等待） =====
    // ===== 接通提示音 =====
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
                g.gain.exponentialRampToValueAtTime(vol || 0.045, t + 0.05);
                g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
                o.connect(g); g.connect(ringCtx.destination);
                o.start(t); o.stop(t + dur + 0.03);
            };
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

    function notifyCallState(active) {
        try {
            if (active) localStorage.setItem('nano_call_active_' + chatId, String(Date.now()));
            else localStorage.removeItem('nano_call_active_' + chatId);
        } catch (e) {}
        try {
            if (window.parent !== window) window.parent.postMessage({ type: 'nanoCallState', chatId: chatId, active: !!active }, '*');
        } catch (e) {}
    }

    function startConnecting() {
        if (isConnected) return;
        unlockAudio();
        isConnecting = true;
        notifyCallState(true);
        connectStartTime = Date.now();
        callStatus.textContent = '接通中...';
        document.body.classList.add('connecting');
        startRing();
        // 接通中：底部保留「挂断」按钮（随时可取消），免提/录音接通后再显示
        if (hangupWrapper) hangupWrapper.style.display = '';
        var _spk0 = document.getElementById('speakerBtn'); if (_spk0) _spk0.style.display = 'none';
        var _rec0 = document.getElementById('recordBtn'); if (_rec0) _rec0.style.display = 'none';
        hangupBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="white"><path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6-.3-.1-.7 0-1 .2l-2.2 2.2c-2.8-1.4-5.1-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.2-1-.4-1.2-.6-2.4-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z"/></svg>';

        // 接通时长 = 角色「决定接不接」的 API 反应时间（保留最短动画）
        if (connectTimer) clearTimeout(connectTimer);
        const minDelay = new Promise(function (r) { setTimeout(r, 2600 + Math.random() * 1400); });
        // 对方主动打来的电话，不应该再让 TA「决定接不接」自己的来电。
        const answerPromise = isIncoming ? Promise.resolve({ answer: true, say: '' }) : decideAnswerRemote();
        Promise.all([answerPromise, minDelay]).then(function (arr) {
            if (!isConnecting) return;
            const d = arr[0];
            if (d && d.answer === false) {
                // 角色拒接（太晚/在忙/不方便等）
                callClosed = true;
                isConnecting = false;
                stopRing();
                document.body.classList.remove('connecting');
                callStatus.textContent = '对方未接听';
                showToast('对方未接听');
                sendVoiceCallCard(true, d.reason);
                setTimeout(function () {
                    if (window.parent !== window) window.parent.postMessage({ type: 'voiceCallEnded' }, '*');
                    else history.back();
                }, 1600);
                return;
            }
            // 「谁先说话」：对方先说时，用 API 根据上下文生成第一句；
            // 只有接口确实没返回内容时才提示，不再使用内置的「喂，听得到吗」。
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
            isConnecting = false;
            isConnected = true;
            stopRing();
            document.body.classList.remove('connecting');
            callStatus.textContent = '00:00';
            if (hangupWrapper) hangupWrapper.style.display = '';
            var _spk1 = document.getElementById('speakerBtn'); if (_spk1) _spk1.style.display = '';
            var _rec1 = document.getElementById('recordBtn'); if (_rec1) _rec1.style.display = '';
            hangupBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="white"><path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6-.3-.1-.7 0-1 .2l-2.2 2.2c-2.8-1.4-5.1-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.2-1-.4-1.2-.6-2.4-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z"/></svg>';
            startTimer();
            showToast('通话已接通');
            showInputArea();
            console.log('[语音电话] 已接通');
        });
    }

    // ===== 角色决定接不接电话（调用主 API，约四分之一概率拒接）=====
    function decideAnswerRemote() {
        return ensureContextReady().then(function () { return readApiConfig(); }).then(function (rawCfg) {
            const config = normalizeCfg(rawCfg);
            if (!config) return { answer: true };
            let base = config.mainUrl.trim();
            if (!base.endsWith('/v1')) base = base.endsWith('/') ? base + 'v1' : base + '/v1';
            const sys = buildSystemPrompt() +
                '\n\n现在用户正在给你打电话。请以你的人设和当前情境判断此刻是否方便接听：如果时间太晚、正在忙、不方便、心情不好等，可以拒接；大约四分之一的情况你会拒接。只输出 JSON：{"answer": true 或 false, "say": "接就结合你们最近的聊天、记忆和当前氛围，写你接通后自然说的第一句话；不要用‘喂，听得到吗’这类模板；拒接就写拒接的一句话理由"}。';
            return fetch(base + '/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + config.mainKey.trim(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: config.mainModel, messages: [{ role: 'system', content: sys }, { role: 'user', content: '（电话响了）' }], max_tokens: 120, temperature: 0.8 })
            }).then(function (r) { return r.json(); }).then(function (dd) {
                const t = (dd.choices && dd.choices[0] && dd.choices[0].message && dd.choices[0].message.content) || '';
                const m = t.match(/\{[\s\S]*\}/);
                let obj = null;
                try { obj = m ? JSON.parse(m[0]) : null; } catch (e) {}
                const say = (obj && (obj.say || obj.reason)) || '';
                if (obj && obj.answer === false) return { answer: false, reason: say };
                return { answer: true, say: say };
            }).catch(function () { return { answer: true }; });
        });
    }

    // 由主 API 根据聊天上下文生成「接通后的第一句」。
    // 接口不可用时不内置假台词，只提示用户检查 API。
    function generateOpeningLine() {
        var extra = '\n\n【本轮场景 · 电话刚接通】对方还没有说话，由你先开口。' +
            '请结合你们最近的聊天、长期记忆、当前时间和氛围，自然地直接说第一句；' +
            '不要说“喂，听得到吗”“喂？能听到吗”这类模板开场，也不要问对方能不能听到。' +
            '如果对方在之前的聊天里说过什么，要顺着那件事开口，不要装作没发生过。';
        return callApi(['（电话刚接通，你先开口）'], [], extra).then(function (raw) {
            var reply = window.nanoStripThink ? window.nanoStripThink(raw) : raw;
            reply = extractHangup(reply).text;
            if (!reply || /^(请先在 API|出错了)/.test(reply)) {
                try { showToast('主 API 没有返回开场白，请检查 API 配置'); } catch (e) {}
                return '';
            }
            return reply;
        }).catch(function () {
            try { showToast('开场白生成失败，请检查 API'); } catch (e) {}
            return '';
        });
    }

    // ===== 屏幕中央小字提示 =====
function showToast(text) {
    // 移除已有 toast
    const oldToast = document.querySelector('.call-toast');
    if (oldToast) oldToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'call-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    
    // 2.5 秒后自动消失
    setTimeout(function() {
        if (toast.parentNode) toast.remove();
    }, 2500);
}

    // ===== 更新分隔线 =====
    function makeDateDividerText(d) {
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        return d.getFullYear() + '年' +
               String(d.getMonth() + 1).padStart(2, '0') + '月' +
               String(d.getDate()).padStart(2, '0') + '日 星期' + weekdays[d.getDay()];
    }

    // ===== 创建消息元素 =====
    function createMessageEl(msg) {
        const el = document.createElement('div');
        el.className = 'message ' + (msg.isUser ? 'msg-user' : 'msg-api');
        el.dataset.id = msg.id;

        const check = document.createElement('div');
        check.className = 'msg-select';
        check.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
        el.appendChild(check);

        const textSpan = document.createElement('span');
        textSpan.className = 'msg-text';
        if (msg.recalled) {
            el.classList.add('recalled');
            textSpan.textContent = msg.isUser ? '你撤回了一条消息' : (contactNameParam + ' 撤回了一条消息');
        } else {
            textSpan.textContent = msg.text;
        }
        el.appendChild(textSpan);

        if (multiSelectMode) el.classList.add('multi-select-on');
        if (selectedIds.indexOf(msg.id) !== -1) {
            el.classList.add('selected');
            if (check) check.classList.add('checked');
        }

        el.addEventListener('dblclick', function(e) {
            if (multiSelectMode) return;
            e.stopPropagation();
            openMsgMenu(e, msg.id);
        });
        el.addEventListener('click', function(e) {
            if (multiSelectMode) {
                e.stopPropagation();
                toggleSelect(msg.id, el);
            }
        });
        if (!msg.isUser && msg.clipId && msg.turnLast) appendAudioControls(el, msg.clipId);
        return el;
    }

    // ===== 分句 / 分气泡（外文（翻译）不拆）=====
    function splitSentences(text) {
        var out = [], cur = '', depth = 0;
        var enders = '。！？!?；;…';
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (ch === '（' || ch === '(') depth++;
            if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
            cur += ch;
            if (depth === 0 && enders.indexOf(ch) !== -1) { var t = cur.trim(); if (t) out.push(t); cur = ''; }
        }
        var rest = cur.trim(); if (rest) out.push(rest);
        return out;
    }
    // 模型偶尔会输出 Markdown、英文标题、Context 说明或半截翻译；
    // 这里先清洗成「一句一行」的纯台词，再由下面的翻译兜底补中文。
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
            // 短括号可能是台词本身（如 (really)）；长英文、带冒号的说明直接删掉。
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
            // 含翻译括号的整句不再拆分
            if (line.indexOf('（') !== -1 || line.indexOf('(') !== -1) {
                out.push(line);
            } else {
                splitSentences(line).forEach(function (s) { if (s) out.push(s); });
            }
        });
        if (!out.length && raw) out = [String(raw).trim()];
        return out;
    }
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

    // 模型偶尔把「外语」和「中文翻译」拆成两行；这里把相邻的「外语 + 纯中文」合并成
    // 一个完整气泡，避免字幕掉格式、TTS 把中文也读出来。
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
        if (!el || !clipId) return;
        if (el.querySelector('.msg-audio')) return;
        var box = document.createElement('div');
        box.className = 'msg-audio';
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
                if (p && p.then) p.then(function (ok) {
                    if (!ok) showToast('这条语音还没有缓存，请重试一次');
                });
            } catch (err) { showToast('语音播放失败'); }
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
                    if (!ok) showToast('语音文件还没准备好');
                });
            } catch (err) { showToast('语音下载失败'); }
        });
        box.appendChild(play);
        box.appendChild(dl);
        el.classList.add('has-audio');
        el.appendChild(box);
        try { if (window.NanoCallAudio && NanoCallAudio.sync) NanoCallAudio.sync(); } catch (e) {}
    }

    // 浏览器可能拦截没有手势的自动播放：先记下这一轮，用户一碰屏幕就补播。
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

    // 兜底翻译：模型偶尔忘了按“外文（中文）”格式输出。这里检测到外语气泡
    // 没有中文翻译时，补一次翻译并直接更新气泡，不重新生成整轮回复。
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
                var span = el.querySelector('.msg-text');
                if (span) span.textContent = line;
                if (el._msg) {
                    el._msg.text = line;
                    try { saveMessageObj(el._msg); } catch (e) {}
                }
            });
            try { chatArea.scrollTop = chatArea.scrollHeight; } catch (e) {}
        }).catch(function () {});
    }

    // 一轮只调用一次主 API + 一次 TTS：气泡先拆开显示，语音整轮合成一次后播放。
    function deliverReplyBubbles(raw, opts) {
        opts = opts || {};
        var bubbles = normalizeBilingualBubbles(splitBubbles(cleanModelText(raw)));
        if (!bubbles.length) return;
        var seq = ++turnSeq;
        var clipId = callSessionId + '_t' + seq;
        var els = [];
        bubbles.forEach(function (line, i) {
            var last = (i === bubbles.length - 1);
            var el = addMessage(line, false, { silent: true, turnSeq: seq, turnLast: last, clipId: '' });
            if (el && el._msg) { el._msg.turnSeq = seq; el._msg.turnLast = last; }
            els.push(el);
        });
        ensureBubbleTranslations(bubbles, els);
        var spoken = bubbles.map(spokenText).filter(Boolean).join('\n');
        notifyCallReplied(spoken || bubbles.join(' '));
        if (opts.noTts || !speakerOn || !spoken || !window.NanoTTS || !NanoTTS.getVoiceBlob) return;
        try { if (NanoTTS.setEnabled) NanoTTS.setEnabled(chatId, true); } catch (e) {}
        NanoTTS.getVoiceBlob(spoken, { chatId: chatId }).then(function (got) {
            if (!got || !got.blob) {
                try { if (typeof showToast === 'function') showToast('TTS 没有返回音频，请检查语音配置'); } catch (e) {}
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
                            showToast('点一下屏幕以允许播放语音');
                            if (saved) armAutoplayRetry(clipId);
                        });
                    }
                } catch (e) {
                    if (saved) armAutoplayRetry(clipId);
                }
            });
        }).catch(function (e) {
            console.warn('[Call] 整轮 TTS 失败:', e && e.message ? e.message : e);
            try { if (typeof showToast === 'function') showToast('语音朗读失败：' + ((e && e.message) || '请检查 TTS 配置')); } catch (err) {}
        });
    }

    // ===== 渲染消息 =====
    function renderMessages(msgList) {
        const children = chatArea.children;
        const toRemove = [];
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child !== typingIndicator) {
                toRemove.push(child);
            }
        }
        toRemove.forEach(function(el) { el.remove(); });

        msgList.sort(function(a, b) { return a.time - b.time; });

        let lastDate = null;
        msgList.forEach(function(msg) {
            const d = new Date(msg.time);
            const dateKey = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
            if (dateKey !== lastDate) {
                const div = document.createElement('div');
                div.className = 'time-divider';
                div.textContent = makeDateDividerText(d);
                chatArea.insertBefore(div, typingIndicator);
                lastDate = dateKey;
            }
            const el = createMessageEl(msg);
            chatArea.insertBefore(el, typingIndicator);
        });
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    // ===== 添加消息 =====
    function addMessage(text, isUser, opts) {
        opts = opts || {};
        const msg = {
            id: genMsgId(), text: text, isUser: isUser, time: Date.now(), recalled: false,
            turnSeq: Number(opts.turnSeq) || 0,
            turnLast: !!opts.turnLast,
            clipId: String(opts.clipId || '')
        };
        messages.push(msg);
        saveMessageObj(msg);

        const now = new Date();
        let hasToday = false;
        const dividers = chatArea.querySelectorAll('.time-divider');
        dividers.forEach(function(d) {
            if (d.textContent.includes(now.getFullYear() + '年')) hasToday = true;
        });

        if (!hasToday) {
            const div = document.createElement('div');
            div.className = 'time-divider';
            div.textContent = makeDateDividerText(now);
            chatArea.insertBefore(div, typingIndicator);
        }

        const el = createMessageEl(msg);
        el._msg = msg;
        chatArea.insertBefore(el, typingIndicator);
        chatArea.scrollTop = chatArea.scrollHeight;
        return el;
    }

    // ===== 消息操作菜单 & 多选 =====
    function openMsgMenu(e, msgId) {
        menuTargetId = msgId;
        msgMenu.classList.add('active');
        // 测量菜单尺寸并限制在屏幕内，避免短消息靠边时菜单被截断
        msgMenu.style.visibility = 'hidden';
        const rect = msgMenu.getBoundingClientRect();
        const menuW = rect.width;
        const menuH = rect.height;
        const margin = 8;
        let left = e.clientX;
        let top = e.clientY;
        if (left + menuW > window.innerWidth - margin) {
            left = window.innerWidth - menuW - margin;
        }
        if (top + menuH > window.innerHeight - margin) {
            top = window.innerHeight - menuH - margin;
        }
        if (left < margin) left = margin;
        if (top < margin) top = margin;
        msgMenu.style.left = left + 'px';
        msgMenu.style.top = top + 'px';
        msgMenu.style.visibility = '';
    }

    function closeMsgMenu() {
        msgMenu.classList.remove('active');
        menuTargetId = null;
    }

    function findMsg(id) {
        return messages.find(function(m) { return m.id === id; });
    }

    function deleteMsgById(id) {
        messages = messages.filter(function(m) { return m.id !== id; });
        deleteMessageById(id);
        renderMessages(messages);
    }

    function recallMsg(id) {
        const idx = messages.findIndex(function(m) { return m.id === id; });
        if (idx === -1) return;
        const msg = messages[idx];
        msg.recalled = true;
        msg.text = '';
        messages[idx] = msg;
        saveMessageObj(msg);
        renderMessages(messages);
    }

    function editMsg(id) {
        const msg = findMsg(id);
        if (!msg || msg.recalled) return;
        const newText = prompt('编辑消息', msg.text);
        if (newText === null) return;
        msg.text = newText;
        saveMessageObj(msg);
        renderMessages(messages);
    }

    function enterMultiSelect(firstId) {
        multiSelectMode = true;
        selectedIds = [];
        if (firstId) selectedIds.push(firstId);
        msBar.classList.add('active');
        closeMsgMenu();
        renderMessages(messages);
        updateMsCount();
    }

    function exitMultiSelect() {
        multiSelectMode = false;
        selectedIds = [];
        msBar.classList.remove('active');
        renderMessages(messages);
    }

    function toggleSelect(id, el) {
        const idx = selectedIds.indexOf(id);
        if (idx === -1) {
            selectedIds.push(id);
            el.classList.add('selected');
            const c = el.querySelector('.msg-select');
            if (c) c.classList.add('checked');
        } else {
            selectedIds.splice(idx, 1);
            el.classList.remove('selected');
            const c = el.querySelector('.msg-select');
            if (c) c.classList.remove('checked');
        }
        updateMsCount();
    }

    function updateMsCount() {
        if (msCount) msCount.textContent = '已选 ' + selectedIds.length + ' 条';
    }

    function batchDeleteSelected() {
        if (selectedIds.length === 0) return;
        messages = messages.filter(function(m) { return selectedIds.indexOf(m.id) === -1; });
        deleteMessagesByIds(selectedIds.slice());
        selectedIds = [];
        renderMessages(messages);
        exitMultiSelect();
    }

    // ===== 打字指示器 =====
    function showTyping() {
        typingIndicator.classList.add('active');
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    function hideTyping() {
        typingIndicator.classList.remove('active');
    }

    // ===== 读取主 API 配置（优先 IndexedDB，和聊天页同一份；再退回 localStorage）=====
    function readApiConfig() {
        return new Promise(function (resolve) {
            function fromLS() {
                try {
                    const raw = localStorage.getItem('nano_api_config');
                    resolve(raw ? JSON.parse(raw) : null);
                } catch (e) { resolve(null); }
            }
            try {
                const req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) {
                    try {
                        const d = e.target.result;
                        if (!d.objectStoreNames.contains('api_data')) d.createObjectStore('api_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function () {
                    try {
                        const db = req.result;
                        const r = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                        r.onsuccess = function () {
                            const v = r.result ? r.result.value : null;
                            if (v) resolve(v); else fromLS();
                        };
                        r.onerror = fromLS;
                    } catch (e) { fromLS(); }
                };
                req.onerror = fromLS;
            } catch (e) { fromLS(); }
        });
    }
    // 兼容两种结构：顶层 mainUrl/mainKey/mainModel，或 main:{url,key,model}
    function normalizeCfg(cfg) {
        if (!cfg) return null;
        const url = cfg.mainUrl || (cfg.main && cfg.main.url) || '';
        const key = cfg.mainKey || (cfg.main && cfg.main.key) || '';
        const model = cfg.mainModel || (cfg.main && cfg.main.model) || '';
        if (!url || !key || !model) return null;
        return { mainUrl: url, mainKey: key, mainModel: model };
    }

    // ===== 获取本轮所有用户消息 =====
    function getUserMessagesForTurn() {
        const userMsgs = [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (!msg.isUser) break;
            userMsgs.unshift(msg.text);
        }
        return userMsgs;
    }

    // ===== 读取聊天详情页记忆 =====
    function loadChatInnerMemory() {
        return new Promise(function(resolve) {
            function fromLS() {
                try {
                    const data = JSON.parse(localStorage.getItem('chat_messages_' + chatId) || '[]');
                    resolve(Array.isArray(data) ? data : []);
                } catch (e) { resolve([]); }
            }
            try {
                if (typeof localforage !== 'undefined') {
                    localforage.getItem('chat_messages_' + chatId).then(function(data) {
                        // localforage 偶尔还没刷盘，回退到同步备份，避免“没读上文”。
                        if (Array.isArray(data) && data.length > 0) resolve(data);
                        else fromLS();
                    }).catch(fromLS);
                } else {
                    fromLS();
                }
            } catch (e) { fromLS(); }
        });
    }

    function callApi(userMessages, history, extraSystem) {
        return ensureContextReady().then(function () { return readApiConfig(); }).then(function(rawCfg) {
        const config = normalizeCfg(rawCfg);
        if (!config) {
            return '请先在 API 页面配置主 API';
        }

        return loadChatInnerMemory().then(function(chatMemory) {
            try {
                let baseUrl = config.mainUrl.trim();
                if (!baseUrl.endsWith('/v1')) {
                    baseUrl = baseUrl.endsWith('/') ? baseUrl + 'v1' : baseUrl + '/v1';
                }
                const key = config.mainKey.trim();
                const model = config.mainModel;

                const historyMessages = [];
                historyMessages.push({ role: 'system', content: buildSystemPrompt() + (extraSystem || '') });

                // 上文：私聊里最近的对话（含语音转写），按时间顺序放进去。
                const memorySlice = (chatMemory || []).slice(-20);
                memorySlice.forEach(function(m) {
                    if (!m || m.recalled || m.isCard) return;
                    const c = String(m.text || m.transcript || (m.isVoice && m.voiceData && m.voiceData.ttsText) || '').trim();
                    if (!c) return;
                    historyMessages.push({
                        role: m.type === 'right' ? 'user' : 'assistant',
                        content: c
                    });
                });

                // 本次通话的上文：只跳过末尾「这一轮还没被回复」的用户消息，
                // 其余按从旧到新的顺序发给模型，不能倒序（倒序会让它接不上刚才的话）。
                const callHistory = Array.isArray(history) ? history : [];
                let endIdx = callHistory.length - 1;
                while (endIdx >= 0 && callHistory[endIdx] && callHistory[endIdx].isUser) endIdx--;
                const startIdx = Math.max(0, endIdx - 19);
                for (let i = startIdx; i <= endIdx; i++) {
                    const msg = callHistory[i];
                    if (!msg || msg.recalled) continue;
                    const c = String(msg.text || msg.transcript || '').trim();
                    if (!c) continue;
                    historyMessages.push({
                        role: msg.isUser ? 'user' : 'assistant',
                        content: c
                    });
                }

                const combinedUserMsg = userMessages.join('\n');
                historyMessages.push({ role: 'user', content: combinedUserMsg });

                return fetch(baseUrl + '/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + key,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: historyMessages,
                        max_tokens: 1500,
                        temperature: 0.85
                    })
                }).then(function(response) {
                    if (!response.ok) {
                        return response.json().then(function(errData) {
                            throw new Error(errData.error?.message || 'HTTP ' + response.status);
                        }).catch(function() {
                            throw new Error('HTTP ' + response.status);
                        });
                    }
                    return response.json();
                }).then(function(data) {
                    return data.choices?.[0]?.message?.content || '抱歉，我没有收到回复。';
                });
            } catch (error) {
                return '出错了：' + error.message;
            }
        });
        });
    }

    // ===== 发送用户消息：只发出去，不自动调 API =====
    // 输入框有字时点按钮 / 回车 = 发送；输入框为空时点同一个按钮 = 让 TA 接话。
    function updateReplyMode() {
        if (!replyBtn) return;
        var has = !!(messageInput.value && messageInput.value.trim());
        replyBtn.classList.toggle('reply-mode', !has);
        replyBtn.title = has ? '发送' : '回复';
        replyBtn.setAttribute('aria-label', has ? '发送' : '回复');
    }
    function sendUserMessage() {
        const text = messageInput.value.trim();
        if (!text || isWaiting) return;
        addMessage(text, true);
        messageInput.value = '';
        updateReplyMode();
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    // 角色主动挂断：解析回复里的 [hangup:原因] 标记。
    // 标记只用于控制通话，不会出现在聊天气泡里。
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
        if (callClosed) return;
        callClosed = true;
        stopRing();
        if (callTimer) { clearInterval(callTimer); callTimer = null; }
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        isConnecting = false;
        isConnected = false;
        sendVoiceCallCard(false, reason);
        try { localStorage.removeItem('voice_call_seconds_' + chatId); } catch (e) {}
        showToast(reason ? ('对方挂断了：' + reason) : '对方挂断了通话');
        setTimeout(function() {
            if (window.parent !== window) window.parent.postMessage({ type: 'voiceCallEnded' }, '*');
            else history.back();
        }, 1200);
    }

    // ===== 点击回复按钮 - 调用 API =====
    function triggerReply() {
        if (isWaiting || callClosed) return;

        const userMsgs = getUserMessagesForTurn();

        isWaiting = true;
        replyBtn.classList.add('loading');
        showTyping();

        callApi(userMsgs, messages).then(function(rawReply) {
            hideTyping();
            var parsed = extractHangup(rawReply);
            var reply = parsed.text;
            // 分句拆成多条独立气泡（先清掉可能漏出的思维链标记）
            if (window.nanoStripThink) reply = window.nanoStripThink(reply);
            deliverReplyBubbles(reply);
            isWaiting = false;
            replyBtn.classList.remove('loading');
            // 角色说完最后一句后主动挂断
            if (parsed.hangup) {
                setTimeout(function() { endCallByChar(parsed.reason); }, 900);
            }
        }).catch(function(err) {
            hideTyping();
            addMessage('出错了：' + err.message, false);
            isWaiting = false;
            replyBtn.classList.remove('loading');
        });
    }

    // ===== 重roll =====
    async function handleReroll() {
        if (isWaiting) return;
        if (window.NanoReroll) {
            const reason = await NanoReroll.ask({ title: '重roll 通话', subtitle: '上一句哪里不对？留空也可以直接重说' });
            if (reason === null) return;
            window.__voiceRerollReason = reason || '';
        }
        // 重roll：删除本轮生成的所有 AI 气泡（末尾连续的非用户消息），不动历史消息
        let idx = messages.length - 1;
        while (idx >= 0 && !messages[idx].isUser) idx--;
        const toRemove = messages.slice(idx + 1);
        if (!toRemove.length) { triggerReply(); return; }
        toRemove.forEach(function(m) { if (m && m.id) { try { deleteMessageById(m.id); } catch (e) {} } });
        messages = messages.slice(0, idx + 1);
        renderMessages(messages);
        triggerReply();
    }

    // ===== 背景切换 =====
    function setDarkBg(isDark) { try { document.body.classList.toggle('dark-bg', !!isDark); } catch (e) {} }

    function setBg(color) {
        try { if (window.NanoCallBg) window.NanoCallBg.stopVideo(); } catch (e) {}
        currentBg = color;
        customBg = null;
        if (color === 'avatar') setDarkBg(true);
        else if (color === '#ffffff') setDarkBg(false);
        else if (color === '#000000') setDarkBg(true);
        else {
            try {
                var m = /^#?([0-9a-f]{6})$/i.exec(String(color));
                if (m) {
                    var n = parseInt(m[1], 16);
                    var lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
                    setDarkBg(lum < 0.6);
                }
            } catch (e) {}
        }
        if (color === 'avatar' && contactAvatar) {
            // 头像背景：清晰铺满
            document.body.style.backgroundImage = 'url(' + contactAvatar + ')';
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundRepeat = 'no-repeat';
            document.body.style.backgroundColor = 'transparent';
        } else if (color === 'avatar') {
            document.body.style.background = '#2a2f3a';
            document.body.style.backgroundImage = 'none';
        } else {
            document.body.style.background = color;
            document.body.style.backgroundImage = 'none';
        }
        saveBg(color);

        document.querySelectorAll('.bg-option').forEach(function(el) {
            if (el.tagName !== 'LABEL') {
                el.classList.toggle('active', el.dataset.bg === color);
            }
        });
    }

    function setCustomBg(imageData) {
        try { if (window.NanoCallBg) window.NanoCallBg.stopVideo(); } catch (e) {}
        customBg = imageData;
        setDarkBg(true);
        document.body.style.backgroundImage = 'url(' + imageData + ')';
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundRepeat = 'no-repeat';
        document.body.style.backgroundColor = 'transparent';
        saveBg(imageData);

        document.querySelectorAll('.bg-option').forEach(function(el) {
            if (el.tagName !== 'LABEL') {
                el.classList.remove('active');
            }
        });
    }

    // ===== 同步计时 =====
    function syncTimeFromParent(seconds) {
        if (seconds !== undefined && seconds > 0) {
            callSeconds = seconds;
            updateCallStatus();
        }
    }

    // ===== 发送语音通话卡片 =====
    function sendVoiceCallCard(missed, rejectReason) {
        notifyCallState(false);
        try { if (window.NanoTTS && NanoTTS.stop) NanoTTS.stop(); } catch (e) {}
        try { if (window.NanoCallAudio && NanoCallAudio.stop) NanoCallAudio.stop(); } catch (e) {}
        var messagesForCard = [];
        for (var i = 0; i < messages.length; i++) {
            var m = messages[i];
            // 跳过系统消息（如"📞 通话已接通"）
            if (!m.recalled && m.text && m.text.trim() && !m.text.includes('📞 通话已接通')) {
                messagesForCard.push({
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
                type: 'NANO_VOICE_CALL_CARD',
                chatId: chatId,
                callId: callId,
                duration: missed ? 0 : callSeconds,
                missed: missed || false,
                incoming: isIncoming,
                rejectReason: rejectReason || '',
                messages: messagesForCard
            }, '*');
            console.log('[语音电话] 已发送通话卡片，类型:', missed ? '未接通' : '已接通', '来电:', isIncoming, '消息数:', messagesForCard.length);
        }
    }

    // ===== 来电界面 =====
    function startIncomingUI() {
        notifyCallState(true);
        if (incomingActions) incomingActions.classList.add('active');
        if (hangupWrapper) hangupWrapper.style.display = 'none';
    }

    function stopIncomingUI() {
        if (incomingActions) incomingActions.classList.remove('active');
        if (hangupWrapper) hangupWrapper.style.display = '';
    }

    // ===== 初始化 =====
    function applyLoadedBg(bg) {
        if (bg) {
            if (bg.startsWith('data:image') || bg.startsWith('http')) {
                customBg = bg;
                document.body.style.backgroundImage = 'url(' + bg + ')';
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center';
                document.body.style.backgroundRepeat = 'no-repeat';
                document.body.style.backgroundColor = 'transparent';
                document.querySelectorAll('.bg-option').forEach(function(el) {
                    if (el.tagName !== 'LABEL') el.classList.remove('active');
                });
            } else {
                setBg(bg);
            }
        } else {
            // 默认：头像背景
            setBg('avatar');
        }
    }
    function loadCallBg() {
        var api = window.NanoCallBg;
        if (api && api.load) {
            return api.load(chatId).then(function(item) {
                if (item && item.kind === 'video' && item.blob && api.showVideo(item.blob)) return;
                if (item && item.kind === 'image' && item.value) { setCustomBg(item.value); return; }
                return loadBg().then(applyLoadedBg);
            }).catch(function() { return loadBg().then(applyLoadedBg); });
        }
        return loadBg().then(applyLoadedBg);
    }
    function init() {
    contextReady = loadContext();
    updateCallStatus();

    loadCallBg();

    // ===== 每次新建通话，不加载旧消息 =====
    messages = [];
    renderMessages([]);
    // ===== 初始隐藏输入栏 =====
    hideInputArea();
    if (isIncoming) {
        // AI 主动来电：显示接听/挂断界面，等待用户应答
        callStatus.textContent = '等待你接通...';
        startIncomingUI();
    } else {
        startConnecting();
    }
}
init();

    // ===== 事件绑定 =====
    messageInput.addEventListener('input', updateReplyMode);
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            // 有字只发送；空输入回车不触发回复，回复请点按钮
            if (messageInput.value.trim()) sendUserMessage();
        }
    });

    replyBtn.addEventListener('click', function() {
        // 有字 = 只发送这条消息；空 = 让 TA 接话（这时才调用 API）
        if (messageInput.value.trim()) sendUserMessage();
        else triggerReply();
    });
    updateReplyMode();
    rerollBtn.addEventListener('click', handleReroll);

    // ===== 挂断按钮 =====
    hangupBtn.addEventListener('click', function() {
        if (callClosed) return;
        callClosed = true;
        // 停止计时器
        stopRing();
        clearInterval(callTimer);
        callTimer = null;

        // 清除接通等待定时器
        if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
        }

        var missed = !isConnected && isConnecting;

        // ===== 发送语音通话卡片 =====
        sendVoiceCallCard(missed);

        // 清除存储的计时
        try {
            localStorage.removeItem('voice_call_seconds_' + chatId);
        } catch (e) {}

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'voiceCallEnded' }, '*');
        } else {
            history.back();
        }
    });

    // 右滑返回 = 挂断（走和挂断按钮完全一致的收尾逻辑）
    window.__nanoInternalBack = function () {
        try { hangupBtn.click(); return true; } catch (e) { return false; }
    };

    // ===== 喇叭按钮：开启 = 角色说话有声音（TTS）；关闭 = 纯文字 =====
    if (speakerBtn) {
        speakerBtn.classList.toggle('active', speakerOn);
        speakerBtn.title = speakerOn ? '语音朗读：开' : '语音朗读：关';
        speakerBtn.addEventListener('click', function() {
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
            if (speakerOn) {
                showToast('语音朗读已开启，之后的每轮都会自动读');
                playLatestTurnAudio();
            } else {
                try { if (window.NanoTTS) window.NanoTTS.stop(); } catch (e) {}
                try { if (window.NanoCallAudio) window.NanoCallAudio.stop(); } catch (e) {}
                showToast('语音朗读已关闭，纯文字');
            }
        });
    }

    // 打开喇叭时，把最近一轮已经缓存的语音补播一次（不重新调用 TTS）。
    function playLatestTurnAudio() {
        if (!window.NanoCallAudio || !messages.length) return;
        var lastTurn = 0;
        messages.forEach(function (m) {
            if (m && !m.isUser && Number(m.turnSeq) > lastTurn) lastTurn = Number(m.turnSeq);
        });
        if (!lastTurn) return;
        for (var i = messages.length - 1; i >= 0; i--) {
            var m = messages[i];
            if (m && !m.isUser && Number(m.turnSeq) === lastTurn && (m.clipId || m.turnLast)) {
                if (m.clipId) {
                    try { window.NanoCallAudio.play(m.clipId); } catch (e) {}
                }
                return;
            }
        }
    }

    // ===== 录音按钮：语音转文字写入输入框 =====
    let recog = null;
    let recording = false;
    function stopRecog() {
        recording = false;
        if (recordBtn) recordBtn.classList.remove('recording');
        try { if (recog) recog.stop(); } catch (e) {}
        recog = null;
    }
    if (recordBtn) {
        recordBtn.addEventListener('click', function() {
            if (recording) { stopRecog(); return; }
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) { showToast('当前环境不支持语音识别'); return; }
            try {
                recog = new SR();
                recog.lang = 'zh-CN';
                recog.continuous = true;
                recog.interimResults = true;
                recog.onresult = function(ev) {
                    let finalText = '';
                    for (let i = ev.resultIndex; i < ev.results.length; i++) {
                        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
                    }
                    if (!finalText) return;
                    const cur = messageInput.value;
                    messageInput.value = cur ? (cur + finalText) : finalText;
                };
                recog.onerror = function() { stopRecog(); };
                recog.onend = function() { stopRecog(); };
                recog.start();
                recording = true;
                recordBtn.classList.add('recording');
                showToast('正在录音，再点一次结束');
            } catch (e) {
                stopRecog();
                showToast('录音启动失败');
            }
        });
    }

    // ===== 来电接听 / 拒接 =====
    if (answerBtn) {
        answerBtn.addEventListener('click', function() {
            if (isConnecting || isConnected) return;
            stopIncomingUI();
            startConnecting();
        });
    }
    if (declineBtn) {
        declineBtn.addEventListener('click', function() {
            if (isConnecting || isConnected) return;
            // 拒接 -> 记为未接，发送通话卡片并结束
            sendVoiceCallCard(true);
            try { localStorage.removeItem('voice_call_seconds_' + chatId); } catch (e) {}
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'voiceCallEnded' }, '*');
            } else {
                history.back();
            }
        });
    }

    // ===== 缩小按钮 =====
    minimizeBtn.addEventListener('click', function() {
        isMinimized = true;
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'minimizeVoiceCall',
                seconds: callSeconds
            }, '*');
        }
    });

    // ===== 背景面板 =====
    bgBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        bgPanel.classList.toggle('active');
        this.classList.toggle('active');
    });

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
            showToast(firstSpeaker === 'char' ? '已设置：接通后 TA 先说' : '已设置：接通后你先说');
        });
    });
    applyFirstSpeakerUI();

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.bg-panel') && !e.target.closest('.btn-bg') && !e.target.closest('.btn-settings')) {
            bgPanel.classList.remove('active');
            bgBtn.classList.remove('active');
        }
        if (!e.target.closest('.msg-menu')) {
            closeMsgMenu();
        }
    });

    // ===== 消息菜单 & 多选 =====
    document.querySelectorAll('.msg-menu-item').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const action = this.dataset.action;
            const msg = findMsg(menuTargetId);
            closeMsgMenu();
            if (!msg) return;
            if (action === 'delete') {
                deleteMsgById(msg.id);
            } else if (action === 'recall') {
                recallMsg(msg.id);
            } else if (action === 'edit') {
                editMsg(msg.id);
            } else if (action === 'multiselect') {
                enterMultiSelect(msg.id);
            }
        });
    });

    if (msCancel) {
        msCancel.addEventListener('click', function() {
            exitMultiSelect();
        });
    }
    if (msDeleteBtn) {
        msDeleteBtn.addEventListener('click', function() {
            batchDeleteSelected();
        });
    }

    document.querySelectorAll('.bg-option:not(.bg-upload)').forEach(function(el) {
        el.addEventListener('click', function() {
            setBg(this.dataset.bg);
            bgPanel.classList.remove('active');
            bgBtn.classList.remove('active');
        });
    });

    bgUploadInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            setCustomBg(evt.target.result);
            bgPanel.classList.remove('active');
            bgBtn.classList.remove('active');
        };
        reader.readAsDataURL(file);
        this.value = '';
    });

    // ===== 监听父页面消息 =====
    window.addEventListener('message', function(event) {
        const data = event.data;
        if (!data) return;

        if (data.type === 'restoreVoiceCall') {
            isMinimized = false;
            isRestoring = true;
            if (data.seconds !== undefined && data.seconds > 0) {
                callSeconds = data.seconds;
                updateCallStatus();
            }
            isRestoring = false;
        }
    });

    // ===== 页面可见性变化 =====
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            updateCallStatus();
        }
    });

    // ===== 暴露 API =====
    window.addEventListener('pagehide', function () { notifyCallState(false); });
    window.addEventListener('beforeunload', function () { notifyCallState(false); });

    window.__voiceCall = {
        addMessage: addMessage,
        sendUserMessage: sendUserMessage,
        triggerReply: triggerReply,
        handleReroll: handleReroll,
        setBg: setBg,
        setCustomBg: setCustomBg,
        get messages() { return messages; },
        getCallSeconds: function() { return callSeconds; },
        syncTime: syncTimeFromParent,
        isConnected: function() { return isConnected; },
        isConnecting: function() { return isConnecting; }
    };

    console.log('[语音电话] 已加载，消息数:', messages.length, '计时:', callSeconds);
})();