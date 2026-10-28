/* =========================================================
   角色悄悄话（char ↔ char）
   - 每个 char 独立配置：nano_char_rel_<charId>
   - 自动约 3 天刷新一次（只在 App 打开时检查，一次只生成一段，控制 API 用量）
   - 1 次 API ≈ 2 轮对话；2 次 API ≈ 3~4 轮对话
   - 生成完成后弹出悄悄话记录，并写入双方记忆
   - 由 index.html 加载；记录页/关系设置页通过 postMessage 调用
   ========================================================= */
(function () {
    'use strict';

    var CFG_PREFIX = 'nano_char_rel_';
    var OLD_CFG_KEY = 'nano_char_sharing';
    var RECORDS_KEY = 'nano_char_secret_chats';
    var LOCK_KEY = 'nano_secret_chat_lock';
    var AUTO_GAP = 3 * 24 * 3600 * 1000;
    var MODULE_BUILD = '20261025b';

    function $(id) { return document.getElementById(id); }
    function parseJson(raw, fallback) {
        try { var v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; }
    }
    function sameName(a, b) {
        var clean = function (s) { return String(s == null ? '' : s).replace(/[\s~～!！?？.。·,，、]/g, '').toLowerCase(); };
        return clean(a) === clean(b);
    }
    function idbChars() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var g = e.target.result.transaction('characters', 'readonly').objectStore('characters').getAll();
                        g.onsuccess = function () { resolve(g.result || []); };
                        g.onerror = function () { resolve([]); };
                    } catch (err) { resolve([]); }
                };
                req.onerror = function () { resolve([]); };
            } catch (e) { resolve([]); }
        });
    }
    function homeMask() {
        // 外壳/聊天页把当前 user 存在 nano_mask_data；nano_home_data 只是旧键名
        var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
        for (var i = 0; i < keys.length; i++) {
            var h = parseJson(localStorage.getItem(keys[i]), null);
            if (h && Array.isArray(h.masks) && h.masks.length) {
                var id = h.currentMaskId;
                if (id) {
                    var m = h.masks.find(function (x) { return x && String(x.id) === String(id); });
                    if (m) return m;
                }
                return h.masks[0];
            }
        }
        return { id: 'm_default', name: '我', bindChars: [] };
    }
    function currentMaskId() { return String((homeMask() || {}).id || 'm_default'); }

    async function getBoundChars() {
        var chars = await idbChars();
        var mask = homeMask();
        var mid = String(mask.id || '');
        // 和聊天列表保持一致：优先取 bindUser === 当前 user 的全部角色（含 NPC / 小号）
        var out = mid ? chars.filter(function (c) {
            return c && String(c.bindUser) === mid && !c.nanoAssistant;
        }) : [];
        // 兼容旧数据：mask.bindChars 里可能是 id，也可能是名字
        if (!out.length) {
            var binds = Array.isArray(mask.bindChars) ? mask.bindChars.map(String) : [];
            if (binds.length) {
                out = chars.filter(function (c) {
                    if (!c || c.nanoAssistant) return false;
                    return binds.indexOf(String(c.id)) > -1 || binds.indexOf(String(c.name)) > -1;
                });
            }
        }
        // 角色库读不到时，回退到通讯录
        if (!out.length) {
            var contacts = parseJson(localStorage.getItem('nano_contacts_data'), []);
            if (Array.isArray(contacts)) {
                out = contacts.filter(function (c) {
                    return c && String(c.bindUser) === mid && !c.nanoAssistant;
                });
            }
        }
        return out;
    }

    function cfgKey(id) { return CFG_PREFIX + currentMaskId() + '_' + id; }
    function legacyCfgKey(id) { return CFG_PREFIX + id; }
    function getConfig(id) {
        var v = parseJson(localStorage.getItem(cfgKey(id)), null);
        if (!v || typeof v !== 'object') {
            v = parseJson(localStorage.getItem(legacyCfgKey(id)), null);
            if (v && typeof v === 'object') {
                try { localStorage.setItem(cfgKey(id), JSON.stringify(v)); } catch (e) {}
            }
        }
        if (!v || typeof v !== 'object') {
            v = {
                privateEnabled: false,
                shareEnabled: false,
                rounds: 3,
                relationIds: [],
                labels: {},
                autoDays: 3,
                lastAutoAt: 0,
                lastManualAt: 0
            };
            // 兼容上一版全局共享设置
            var old = parseJson(localStorage.getItem(OLD_CFG_KEY), null);
            if (old && old.enabled && Array.isArray(old.ids) && old.ids.map(String).indexOf(String(id)) > -1) {
                v.shareEnabled = true;
                v.rounds = Math.max(1, Math.min(10, parseInt(old.rounds, 10) || 3));
                v.relationIds = old.ids.map(String).filter(function (x) { return x !== String(id); });
            }
        }
        return {
            privateEnabled: !!v.privateEnabled,
            shareEnabled: !!v.shareEnabled,
            rounds: Math.max(1, Math.min(10, parseInt(v.rounds, 10) || 3)),
            relationIds: (Array.isArray(v.relationIds) ? v.relationIds : []).map(String).filter(Boolean),
            labels: (v.labels && typeof v.labels === 'object') ? v.labels : {},
            autoDays: Math.max(1, Math.min(30, parseFloat(v.autoDays) || 3)),
            lastAutoAt: Number(v.lastAutoAt) || 0,
            lastManualAt: Number(v.lastManualAt) || 0
        };
    }
    function saveConfig(id, cfg) {
        try { localStorage.setItem(cfgKey(id), JSON.stringify(cfg)); } catch (e) {}
    }

    function loadRecords() {
        var arr = parseJson(localStorage.getItem(RECORDS_KEY), []);
        // 悄悄话只记录角色 × 角色；旧的「用户 × 角色」1:1 记录（source: chat）不再混进来。
        if (!Array.isArray(arr)) return [];
        var clean = arr.filter(function (r) {
            return r && r.source !== 'chat' && r.a && r.b && Array.isArray(r.lines) && r.lines.length;
        });
        if (clean.length !== arr.length) { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(clean)); } catch (e) {} }
        return clean;
    }
    // 记录只保留展示需要的字段。头像经常是 dataURL，存进 localStorage 很容易把
    // 5MB 配额撑满，导致 setItem 静默失败：生成成功、弹窗能看到，但列表里没有卡片。
    function slimRecord(r) {
        if (!r || !r.a || !r.b) return r;
        var lines = (Array.isArray(r.lines) ? r.lines : []).slice(-20).map(function (l) {
            return {
                who: l && l.who === 'b' ? 'b' : 'a',
                name: String((l && l.name) || '').slice(0, 40),
                text: String((l && l.text) || '').slice(0, 600),
                translation: String((l && l.translation) || '').slice(0, 600)
            };
        });
        return Object.assign({}, r, {
            a: { id: r.a.id, name: r.a.name || '' },
            b: { id: r.b.id, name: r.b.name || '' },
            lines: lines
        });
    }
    function saveRecords(list) {
        // IndexedDB 存全部悄悄话卡片；localStorage 只保留最近 40 条作为同步缓存。
        var all = (list || []).map(slimRecord);
        var arr = all.slice(-40);
        if (window.NanoWhisperStore) {
            try { NanoWhisperStore.putAll(all); } catch (e) {}
        }
        try {
            localStorage.setItem(RECORDS_KEY, JSON.stringify(arr));
            return true;
        } catch (e) {
            // 配额仍然不够时保留最近 15 条再试一次；完整数据仍在 IndexedDB。
            try {
                localStorage.setItem(RECORDS_KEY, JSON.stringify(arr.slice(-15)));
                return true;
            } catch (e2) {
                console.warn('[NanoSecretChat] 保存记录失败，localStorage 可能已满（IndexedDB 仍有完整记录）', e2);
                return false;
            }
        }
    }

    function recentLines(id, rounds) {
        try {
            var arr = parseJson(localStorage.getItem('chat_messages_' + id), []);
            if (!Array.isArray(arr)) return '';
            var mask = homeMask();
            var uname = (mask && mask.name) || '用户';
            var ch = null;
            // 名称由调用方补，这里先放占位
            return arr.filter(function (m) {
                return m && !m.recalled && !m.isCard && !m.isImage && !m.isVoice &&
                    (m.type === 'left' || m.type === 'right') && String(m.text || '').trim();
            }).slice(-(Math.max(1, rounds) * 2 + 2)).map(function (m) {
                return (m.type === 'right' ? uname : '对方') + '：' + String(m.text || '').replace(/\s+/g, ' ').slice(0, 260);
            }).join('\n');
        } catch (e) { return ''; }
    }

    // ===== 世界书 / 长期记忆（私聊也给角色读，避免 OOC）=====
    var __wbFilesCache = null;
    function readWorldbookLocal() {
        var keys = ['nano_worldbook_data_v5', 'nano_worldbook_data', 'peach_worldbook_data'];
        for (var i = 0; i < keys.length; i++) {
            var d = parseJson(localStorage.getItem(keys[i]), null);
            if (d && Array.isArray(d.files)) return d.files;
        }
        return null;
    }
    function loadWorldbookFiles() {
        if (__wbFilesCache) return Promise.resolve(__wbFilesCache);
        var local = readWorldbookLocal();
        if (local) { __wbFilesCache = local; return Promise.resolve(local); }
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_worldbook_db', 1);
                req.onupgradeneeded = function (e) {
                    try { var db = e.target.result; if (!db.objectStoreNames.contains('worldbook_data')) db.createObjectStore('worldbook_data', { keyPath: 'key' }); } catch (err) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var g = e.target.result.transaction('worldbook_data', 'readonly').objectStore('worldbook_data').get('data');
                        g.onsuccess = function () {
                            var d = g.result ? g.result.value : null;
                            __wbFilesCache = (d && Array.isArray(d.files)) ? d.files : [];
                            try { if (d) localStorage.setItem('nano_worldbook_data_v5', JSON.stringify(d)); } catch (err) {}
                            resolve(__wbFilesCache);
                        };
                        g.onerror = function () { resolve([]); };
                    } catch (err) { resolve([]); }
                };
                req.onerror = function () { resolve([]); };
            } catch (e) { resolve([]); }
        });
    }
    function getWorldbookTextFor(ch, recentText, filesIn) {
        if (!ch) return '';
        var files = Array.isArray(filesIn) ? filesIn : (__wbFilesCache || readWorldbookLocal());
        if (!files) return '';
        var idCands = [String(ch.id), String(ch.name)].filter(Boolean);
        var bindIds = [];
        (Array.isArray(ch.worldbookBindings) ? ch.worldbookBindings : []).forEach(function (b) {
            if (b && b.id != null) bindIds.push(String(b.id));
            else if (b) bindIds.push(String(b));
        });
        var lower = String(recentText || '').toLowerCase();
        var chunks = [];
        var total = 0;
        files.forEach(function (w) {
            if (!w) return;
            var entries = Array.isArray(w.entries) ? w.entries : [];
            if (!entries.length && w.content && String(w.content).trim()) {
                entries = [{ title: w.name || '', content: w.content, permanent: true }];
            }
            if (!entries.length) return;
            var scope = w.scope || 'global';
            var bound = Array.isArray(w.boundCharacters) ? w.boundCharacters.map(String) : [];
            var hit = bindIds.indexOf(String(w.id)) > -1 || bound.some(function (b) { return idCands.indexOf(String(b)) > -1; });
            if (scope === 'local' && !hit) return;
            if (scope === 'online' && bound.length && !hit) return;
            entries.forEach(function (en) {
                if (!en || en.enabled === false || !String(en.content || '').trim()) return;
                // 私聊不依赖关键词命中：把绑定/全局世界书条目都读进来（有上限），避免角色漏设定
                var text = (en.title ? '【' + en.title + '】\n' : '') + String(en.content || '').trim();
                if (total + text.length > 3200) return;
                total += text.length;
                chunks.push(text);
            });
        });
        if (!chunks.length) return '';
        return chunks.join('\n\n').slice(0, 3200);
    }

    function getMemoryTextFor(charId) {
        return openMemoryDb().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var g = db.transaction('config', 'readonly').objectStore('config').get('memlist_' + charId);
                    g.onsuccess = function () {
                        var arr = (g.result && Array.isArray(g.result.value)) ? g.result.value : [];
                        var out = arr.slice(-14).map(function (e) {
                            return '- ' + (e && e.content ? String(e.content).replace(/\s+/g, ' ').slice(0, 260) : '');
                        }).filter(function (s) { return s.length > 2; }).join('\n');
                        resolve(out.slice(0, 2200));
                    };
                    g.onerror = function () { resolve(''); };
                } catch (e) { resolve(''); }
            });
        }).catch(function () { return ''; });
    }
    function readApiCfg() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var g = e.target.result.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                        g.onsuccess = function () {
                            resolve(g.result ? g.result.value : parseJson(localStorage.getItem('nano_api_config'), null));
                        };
                        g.onerror = function () { resolve(parseJson(localStorage.getItem('nano_api_config'), null)); };
                    } catch (err) { resolve(parseJson(localStorage.getItem('nano_api_config'), null)); }
                };
                req.onerror = function () { resolve(parseJson(localStorage.getItem('nano_api_config'), null)); };
            } catch (e) { resolve(parseJson(localStorage.getItem('nano_api_config'), null)); }
        });
    }

    function parseApiText(text) {
        var d = parseJson(text, null);
        if (!d) throw new Error('API 返回的不是 JSON');
        var choice = d.choices && d.choices[0];
        var msg = (choice && choice.message) || {};
        var c = msg.content;
        if (!c && choice) c = choice.text;
        // 部分推理模型只给 reasoning_content；正文为空时用它兜底，避免「生成成功但没内容」。
        if (!c) c = msg.reasoning_content;
        if (!c) throw new Error((d.error && (d.error.message || d.error)) || 'API 没有返回内容');
        return String(c).trim();
    }

    function callApi(messages, maxTokens) {
        return readApiCfg().then(function (cfg) {
            if (!cfg || !cfg.mainUrl || !cfg.mainKey) throw new Error('没有找到主 API 配置，请先到「设置 → API」填写');
            var base = String(cfg.mainUrl).trim().replace(/\/+$/, '');
            if (!/\/v1$/i.test(base)) base += '/v1';
            var url = base + '/chat/completions';
            var body = JSON.stringify({
                model: cfg.mainModel || '',
                messages: messages,
                stream: false,
                temperature: 0.95,
                max_tokens: maxTokens || 900
            });
            var controller = null;
            var timer = null;
            var opts = {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + String(cfg.mainKey).trim(), 'Content-Type': 'application/json' },
                body: body
            };
            if (typeof AbortController !== 'undefined') {
                controller = new AbortController();
                opts.signal = controller.signal;
                timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, 90000);
            }
            return fetch(url, opts).then(function (res) {
                return res.text().then(function (text) {
                    if (!res.ok) throw new Error('HTTP ' + res.status + '：' + String(text).slice(0, 160));
                    return parseApiText(text);
                });
            }).catch(function (e) {
                if (e && e.name === 'AbortError') throw new Error('API 超时');
                throw e;
            }).finally(function () { if (timer) clearTimeout(timer); });
        });
    }

    function parseDialogue(text, a, b) {
        var out = [];
        var last = null;
        var clean = function (s) { return String(s || '').replace(/^["“「]+|["”」]+$/g, '').trim(); };
        String(text || '').replace(/\r/g, '').split(/\n+/).forEach(function (line) {
            line = String(line || '').trim();
            if (!line) return;
            // 单独一行「译：...」/「中文：...」时，挂到上一句
            var tm = line.match(/^(?:译|翻译|中文|中文翻译)\s*[：:]\s*([\s\S]+)$/i);
            if (tm && last) { last.translation = clean(tm[1]).slice(0, 800); return; }
            var m = line.match(/^\s*(?:【)?([^：:\n]{1,24})(?:】)?\s*[：:]\s*([\s\S]+)$/);
            if (!m) return;
            var name = m[1].trim();
            var who = sameName(name, a.name) ? 'a' : (sameName(name, b.name) ? 'b' : null);
            if (!who) return;
            var body = m[2].trim();
            var translation = '';
            // 句末括号：名字：原文（中文：翻译）
            var pm = body.match(/[（(]\s*中文\s*[：:]\s*([\s\S]*?)\s*[）)]\s*$/);
            if (pm) {
                translation = pm[1].trim();
                body = body.slice(0, pm.index).trim();
            }
            // 或：名字：原文 || 中文：翻译
            if (!translation) {
                var bars = body.split(/\s*(?:\|\||｜｜)\s*/);
                if (bars.length >= 2 && /^(?:中文|翻译|译)\s*[：:]/i.test(bars[1])) {
                    translation = bars[1].replace(/^(?:中文|翻译|译)\s*[：:]\s*/i, '').trim();
                    body = bars[0].trim();
                }
            }
            body = clean(body);
            if (!body) return;
            var item = {
                who: who,
                name: who === 'a' ? (a.name || 'A') : (b.name || 'B'),
                text: body.slice(0, 800),
                translation: clean(translation).slice(0, 800)
            };
            out.push(item);
            last = item;
        });
        return out;
    }

    function relationLabel(a, b) {
        try {
            var ac = getConfig(a.id), bc = getConfig(b.id);
            var lb = String((ac.labels || {})[String(b.id)] || (bc.labels || {})[String(a.id)] || '');
            if (lb) return lb;
            var related = (ac.relationIds || []).map(String).indexOf(String(b.id)) > -1 ||
                (bc.relationIds || []).map(String).indexOf(String(a.id)) > -1;
            return related ? '朋友' : '';
        } catch (e) { return ''; }
    }
    function buildFirstPrompt(a, b, mask, aRecent, bRecent, prevChat, extra) {
        extra = extra || {};
        var rel = relationLabel(a, b);
        return '你是「' + (a.name || 'A') + '」，一个活生生的人类，不是 AI。\n'
            + '你正在和「' + (b.name || 'B') + '」说悄悄话，用户「' + (mask.name || '用户') + '」不在场。\n\n'
            + (rel ? '【你们的关系】' + rel + '。对话的称呼、亲疏、边界和试探方式要符合这个关系，不要突然变成陌生人或过度亲密。\n\n' : '')
            + '【你的人设】\n' + String(a.setting || '（未填写）').slice(0, 2200) + '\n\n'
            + '【' + (b.name || 'B') + ' 的人设】\n' + String(b.setting || '（未填写）').slice(0, 1800) + '\n\n'
            + '【用户】' + (mask.name || '用户') + '；' + String(mask.setting || '').slice(0, 800) + '\n\n'
            + (extra.wbA ? '【' + (a.name || 'A') + ' 的世界书 · 必须遵守】\n' + extra.wbA + '\n\n' : '')
            + (extra.wbB ? '【' + (b.name || 'B') + ' 的世界书 · 必须遵守】\n' + extra.wbB + '\n\n' : '')
            + (extra.memA ? '【' + (a.name || 'A') + ' 的长期记忆】\n' + extra.memA + '\n\n' : '')
            + (extra.memB ? '【' + (b.name || 'B') + ' 的长期记忆】\n' + extra.memB + '\n\n' : '')
            + (bRecent ? '【用户和' + (b.name || 'B') + '最近的聊天】\n' + bRecent.replace(/对方：/g, (b.name || 'B') + '：') + '\n\n' : '')
            + (aRecent ? '【用户和你最近的聊天】\n' + aRecent.replace(/对方：/g, (a.name || 'A') + '：') + '\n\n' : '')
            + (prevChat ? '【你们上次私下聊到】\n' + prevChat + '\n（这次可以接着上次的情绪/话题，但不要原样重复。）\n\n' : '')
            + '现在你们两人私下聊起来。可以谈用户、试探对方、吃醋、交换信息、撒谎或挑拨。\n'
            + '请写出一段自然、有实质内容的对话，正好 2 轮。每一轮 2~4 个气泡（同一角色可以连续发多条），每个气泡 1~2 句，要具体、有情绪和细节，不要只回一句短话。\n'
            + '每行一个气泡，严格用「' + (a.name || 'A') + '：内容」或「' + (b.name || 'B') + '：内容」的格式；不要旁白、不要动作描写、不要解释、不要省略号。\n'
            + '严格遵循双方人设、世界书和长期记忆，不要 OOC，不要编造与设定冲突的内容。\n'
            + '【语言与翻译】按角色自然的语言说话。只要某句不是简体中文，必须在该句末尾用「（中文：简体中文翻译）」附上翻译；中文句子不用加。名字前缀保持原文，不要翻译。';
    }
    function buildContinuePrompt(a, b, transcript, extra) {
        extra = extra || {};
        var rel = relationLabel(a, b);
        return '继续下面这段「' + (a.name || 'A') + '」和「' + (b.name || 'B') + '」说悄悄话。\n\n'
            + (rel ? '【你们的关系】' + rel + '。继续保持这个关系的称呼、亲疏和边界。\n\n' : '')
            + (extra.wbA ? '【' + (a.name || 'A') + ' 的世界书 · 仍须遵守】\n' + extra.wbA.slice(0, 1600) + '\n\n' : '')
            + (extra.wbB ? '【' + (b.name || 'B') + ' 的世界书 · 仍须遵守】\n' + extra.wbB.slice(0, 1600) + '\n\n' : '')
            + (extra.memA ? '【' + (a.name || 'A') + ' 的长期记忆】\n' + extra.memA.slice(0, 900) + '\n\n' : '')
            + (extra.memB ? '【' + (b.name || 'B') + ' 的长期记忆】\n' + extra.memB.slice(0, 900) + '\n\n' : '')
            + transcript + '\n\n'
            + '再写 1~2 轮，保持人设、情绪和刚才的话题，不要重复已经说过的话。每一轮 2~4 个气泡，每个气泡 1~2 句，内容具体，不要只回一句短话。\n'
            + '每行一个气泡，严格用「' + (a.name || 'A') + '：内容」或「' + (b.name || 'B') + '：内容」的格式；不要旁白、不要动作描写、不要解释。\n'
            + '【语言与翻译】继续按角色自然的语言；非简体中文的句子必须在句末用「（中文：简体中文翻译）」附上翻译。';
    }

    function openMemoryDb() {
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open('nano_vector_memory_db', 5);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function (e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }
    function appendMemory(charId, content) {
        return openMemoryDb().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction('config', 'readwrite');
                    var store = tx.objectStore('config');
                    var key = 'memlist_' + charId;
                    var g = store.get(key);
                    g.onsuccess = function () {
                        var arr = (g.result && Array.isArray(g.result.value)) ? g.result.value : [];
                        var ts = Date.now();
                        arr.push({
                            id: 'sc' + ts + '-' + Math.random().toString(36).slice(2, 6),
                            ts: ts,
                            date: new Date(ts).toISOString(),
                            time: new Date(ts).toLocaleString('zh-CN'),
                            type: '私下对话',
                            importance: 4,
                            chatId: charId,
                            content: String(content || '').slice(0, 1400),
                            embedding: null,
                            hasVector: false
                        });
                        store.put({ key: key, value: arr });
                    };
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { resolve(false); };
                } catch (e) { resolve(false); }
            });
        }).catch(function () { return false; });
    }

    function acquireLock() {
        try {
            var now = Date.now();
            var lock = parseJson(localStorage.getItem(LOCK_KEY), null);
            if (lock && Number(lock.until) > now) return false;
            localStorage.setItem(LOCK_KEY, JSON.stringify({ at: now, until: now + 3 * 60 * 1000 }));
            return true;
        } catch (e) { return false; }
    }
    function releaseLock() { try { localStorage.removeItem(LOCK_KEY); } catch (e) {} }

    function broadcast(msg) {
        try {
            document.querySelectorAll('iframe').forEach(function (f) {
                try { if (f.contentWindow) f.contentWindow.postMessage(msg, '*'); } catch (e) {}
            });
        } catch (e) {}
    }
    function notifyMemory(chatId) {
        document.querySelectorAll('iframe[id^=chatInnerFrame]').forEach(function (f) {
            try { if (f.contentWindow) f.contentWindow.postMessage({ type: 'NANO_MEMORY_UPDATED', chatId: chatId }, '*'); } catch (e) {}
        });
    }

    async function translateRecord(recordId) {
        var list = loadRecords();
        var rec = list.find(function (r) { return String(r.id) === String(recordId); });
        if (!rec) throw new Error('找不到这条记录');
        var todo = rec.lines.filter(function (l) { return !l.translation; });
        if (!todo.length) return rec;
        var src = todo.map(function (l, i) { return (i + 1) + '. ' + (l.name || '') + '：' + (l.text || ''); }).join('\n');
        var out = await callApi([
            { role: 'system', content: '把下面这段角色私下对话逐行翻译成简体中文。保持每行的说话者与顺序，只输出译文，每行对应一句；不要加序号、不要解释、不要旁白。' },
            { role: 'user', content: src }
        ], 1200);
        var trs = String(out || '').replace(/\r/g, '').split(/\n+/).map(function (s) {
            return String(s || '').replace(/^\s*(?:\d+[.、)]\s*)?/, '').replace(/^[^：:]{1,24}[：:]\s*/, '').trim();
        }).filter(Boolean);
        var k = 0;
        rec.lines.forEach(function (l) {
            if (l.translation) return;
            if (k < trs.length) { l.translation = trs[k].slice(0, 800); k++; }
        });
        rec.translatedAt = Date.now();
        saveRecords(list);
        broadcast({ type: 'nanoSecretChatUpdated', record: rec });
        return rec;
    }
    async function generate(aId, bId, opts) {
        opts = opts || {};
        var chars = await getBoundChars();
        var a = chars.find(function (c) { return String(c.id) === String(aId); });
        var b = chars.find(function (c) { return String(c.id) === String(bId); });
        // 单边开启：记录页手动选择时，允许从角色库直接补查（仍校验属于当前 user）
        if ((!a || !b) && opts.allowUnbound) {
            var all = await idbChars();
            var mid = String(opts.maskId || currentMaskId());
            function pick(id) {
                var c = all.find(function (x) { return x && String(x.id) === String(id); });
                if (!c) return null;
                if (c.bindUser && String(c.bindUser) !== mid) return null;
                return c;
            }
            if (!a) a = pick(aId);
            if (!b) b = pick(bId);
        }
        if (!a || !b) throw new Error('找不到这两个角色，或角色不属于当前 user');
        if (String(a.id) === String(b.id)) throw new Error('请选择两个不同的角色');
        var ca = getConfig(a.id), cb = getConfig(b.id);
        var aReady = ca.privateEnabled && ca.relationIds.indexOf(String(b.id)) > -1;
        var bReady = cb.privateEnabled && cb.relationIds.indexOf(String(a.id)) > -1;
        if (!aReady && !bReady) throw new Error('请先在任意一方的「角色关系」里开启悄悄话并勾选对方');
        var calls = Number(opts.calls) === 2 ? 2 : 1;
        if (!acquireLock()) throw new Error('正在生成另一段悄悄话，请稍后再试');
        try {
            var mask = homeMask();
            var aRecent = recentLines(a.id, 3);
            var bRecent = recentLines(b.id, 3);
            var prevChat = '';
            try {
                var lastPair = loadRecords().filter(function (r) {
                    if (r.source === 'chat') return false;   // 1:1 聊天不是 char↔char 的前情
                    if (r.maskId && String(r.maskId) !== String(opts.maskId || currentMaskId())) return false;
                    const x = String(r.a.id), y = String(r.b.id), p = String(a.id), q = String(b.id);
                    return (x === p && y === q) || (x === q && y === p);
                }).slice(-1)[0];
                if (lastPair) {
                    prevChat = lastPair.lines.slice(-6).map(function (l) {
                        return (l.name || '') + '：' + String(l.text || '').slice(0, 200);
                    }).join('\n');
                }
            } catch (e) {}
            var wbFiles = await loadWorldbookFiles();
            var wbA = getWorldbookTextFor(a, [aRecent, bRecent, prevChat].join('\n'), wbFiles);
            var wbB = getWorldbookTextFor(b, [aRecent, bRecent, prevChat].join('\n'), wbFiles);
            var extraCtx = {
                wbA: wbA,
                wbB: wbB,
                memA: await getMemoryTextFor(a.id),
                memB: await getMemoryTextFor(b.id)
            };
            var out1 = await callApi([
                { role: 'system', content: buildFirstPrompt(a, b, mask, aRecent, bRecent, prevChat, extraCtx) },
                { role: 'user', content: '（现在开始。只输出带「名字：」前缀的对话行）' }
            ], 2600);
            var lines = parseDialogue(out1, a, b);
            if (!lines.length) throw new Error('模型没有按对话格式返回，请重试');
            if (calls === 2) {
                var transcript = lines.map(function (l) { return l.name + '：' + l.text; }).join('\n');
                var out2 = await callApi([
                    { role: 'system', content: buildContinuePrompt(a, b, transcript, extraCtx) },
                    { role: 'user', content: '（继续，只输出带「名字：」前缀的对话行）' }
                ], 2000);
                var more = parseDialogue(out2, a, b);
                if (more.length) lines = lines.concat(more);
            }
            lines = lines.slice(0, 20);
            var rec = {
                id: 'sc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                at: Date.now(),
                maskId: String(opts.maskId || currentMaskId()),
                source: opts.source || 'manual',
                calls: calls,
                a: { id: a.id, name: a.name || 'A', avatar: a.avatar || '' },
                b: { id: b.id, name: b.name || 'B', avatar: b.avatar || '' },
                lines: lines
            };
            var all = loadRecords();
            all.push(rec);
            var saved = saveRecords(all);

            var transcriptAll = lines.map(function (l) { return l.name + '：' + l.text; }).join(' / ');
            await appendMemory(a.id, '你和' + (b.name || 'B') + '私下聊过：' + transcriptAll);
            await appendMemory(b.id, '你和' + (a.name || 'A') + '私下聊过：' + transcriptAll);
            notifyMemory(a.id); notifyMemory(b.id);

            var now = Date.now();
            ca.privateEnabled = true;
            if (ca.relationIds.indexOf(String(b.id)) < 0) ca.relationIds.push(String(b.id));
            cb.privateEnabled = true;
            if (cb.relationIds.indexOf(String(a.id)) < 0) cb.relationIds.push(String(a.id));
            ca.lastAutoAt = now; ca.lastManualAt = now; saveConfig(a.id, ca);
            cb.lastAutoAt = now; cb.lastManualAt = now; saveConfig(b.id, cb);
            try {
                var pairKey = 'nano_secret_pair_last_' + [String(a.id), String(b.id)].sort().join('_');
                localStorage.setItem(pairKey, String(now));
            } catch (e) {}

            broadcast({ type: 'nanoSecretChatUpdated', record: rec, saved: saved });
            if (opts.show !== false) showViewer(rec);
            return rec;
        } finally {
            releaseLock();
        }
    }

    // ===== 自动检查（约 3 天，一次只生成一段）=====
    var autoRunning = false;
    async function autoTick() {
        if (autoRunning) return;
        autoRunning = true;
        try {
            var chars = await getBoundChars();
            if (!chars.length) return;
            // 单边开启时，关系里的另一方可能没被 getBoundChars 收进来（旧数据/通讯录），补查一次
            var missing = {};
            chars.forEach(function (a) {
                (getConfig(a.id).relationIds || []).forEach(function (id) {
                    if (!chars.some(function (x) { return String(x.id) === String(id); })) missing[String(id)] = 1;
                });
            });
            if (Object.keys(missing).length) {
                var allChars = await idbChars();
                var mid = currentMaskId();
                allChars.forEach(function (c) {
                    if (!c || !missing[String(c.id)]) return;
                    if (c.bindUser && String(c.bindUser) !== mid) return;
                    if (!chars.some(function (x) { return String(x.id) === String(c.id); })) chars.push(c);
                });
            }
            var now = Date.now();
            var pairs = [];
            var seen = {};
            // 单边开启：只要 A 开启并勾选了 B，就进入候选；B 会在生成成功后自动同步开启
            chars.forEach(function (a) {
                var ca = getConfig(a.id);
                if (!ca.privateEnabled) return;
                (ca.relationIds || []).forEach(function (bid) {
                    if (String(bid) === String(a.id)) return;
                    var b = chars.find(function (x) { return String(x.id) === String(bid); });
                    if (!b) return;
                    var pairKey = 'nano_secret_pair_last_' + [String(a.id), String(b.id)].sort().join('_');
                    if (seen[pairKey]) return;
                    seen[pairKey] = 1;
                    var cb = getConfig(b.id);
                    var last = Math.max(ca.lastAutoAt || 0, cb.lastAutoAt || 0, Number(localStorage.getItem(pairKey)) || 0);
                    if (now - last < AUTO_GAP) return;
                    pairs.push({ a: a, b: b, last: last });
                });
            });
            if (!pairs.length) return;
            pairs.sort(function (x, y) { return x.last - y.last; });
            await generate(pairs[0].a.id, pairs[0].b.id, { calls: 1, source: 'auto', show: true, force: true });
        } catch (e) {
            // 自动生成失败不打扰用户，等下一次检查
        } finally {
            autoRunning = false;
        }
    }

    // ===== 查看器（App 外壳弹窗）=====
    function showViewer(rec) {
        if (!rec || !rec.lines || !rec.lines.length) return;
        var old = $('nanoSecretChatViewer');
        if (old) { try { old.remove(); } catch (e) {} }
        var ov = document.createElement('div');
        ov.id = 'nanoSecretChatViewer';
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px;';
        var card = document.createElement('div');
        card.style.cssText = 'width:100%;max-width:460px;max-height:80vh;background:#fff;border-radius:18px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.28);';
        var head = document.createElement('div');
        head.style.cssText = 'padding:16px 18px 10px;font-size:16px;font-weight:700;color:#1c1c1e;border-bottom:1px solid #ececf0;';
        head.textContent = (rec.a.name || 'A') + ' × ' + (rec.b.name || 'B') + ' 的悄悄话';
        var sub = document.createElement('div');
        sub.style.cssText = 'padding:8px 18px 0;font-size:11.5px;color:#8e8e93;';
        sub.textContent = new Date(rec.at || Date.now()).toLocaleString('zh-CN') + ' · 已写入双方记忆';
        var body = document.createElement('div');
        body.style.cssText = 'flex:1;overflow:auto;padding:14px 16px;background:#f7f7f9;-webkit-overflow-scrolling:touch;';
        rec.lines.forEach(function (l) {
            var b = document.createElement('div');
            var isA = l.who === 'a';
            b.style.cssText = 'max-width:86%;margin-bottom:10px;padding:10px 13px;border-radius:15px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;' +
                (isA ? 'margin-right:auto;background:#fff;color:#1c1c1e;border-bottom-left-radius:5px;' : 'margin-left:auto;background:#1c1c1e;color:#fff;border-bottom-right-radius:5px;');
            var nm = document.createElement('div');
            nm.style.cssText = 'font-size:10.5px;font-weight:700;opacity:.6;margin-bottom:3px;';
            nm.textContent = l.name || '';
            b.appendChild(nm);
            b.appendChild(document.createTextNode(l.text || ''));
            if (l.translation) {
                var tr = document.createElement('div');
                tr.style.cssText = 'margin-top:6px;padding-top:5px;border-top:1px solid rgba(127,127,127,.18);font-size:11.5px;line-height:1.5;opacity:.72;';
                tr.textContent = '中文：' + l.translation;
                b.appendChild(tr);
            }
            body.appendChild(b);
        });
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = '知道了';
        close.style.cssText = 'height:48px;border:none;border-top:1px solid #ececf0;background:#fff;color:#1c1c1e;font-size:14px;font-weight:600;cursor:pointer;';
        close.onclick = function () { try { ov.remove(); } catch (e) {} };
        card.appendChild(head);
        card.appendChild(sub);
        card.appendChild(body);
        card.appendChild(close);
        ov.appendChild(card);
        document.body.appendChild(ov);
    }

    function routeCard(chatId, card) {
        if (!card) return;
        try {
            var frames = document.querySelectorAll('iframe[id^=chatInnerFrame]');
            for (var i = 0; i < frames.length; i++) {
                var f = frames[i];
                if (String(f.getAttribute('data-chat-id') || '') === String(chatId) && f.contentWindow) {
                    f.contentWindow.postMessage({ type: 'NANO_CHAR_SECRET_CARD', chatId: String(chatId), card: card }, '*');
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function onMessage(e) {
        var d = e && e.data;
        if (!d || !d.type) return;
        if (d.type === 'nanoSecretGenerate') {
            generate(d.aId, d.bId, {
                calls: d.calls,
                source: 'manual',
                show: true,
                maskId: d.maskId,
                allowUnbound: !!d.allowUnbound
            })
                .catch(function (err) {
                    try {
                        if (e.source) e.source.postMessage({ type: 'nanoSecretError', requestId: d.requestId || '', message: String((err && err.message) || err) }, '*');
                    } catch (x) {}
                });
            return;
        }
        if (d.type === 'nanoSecretTranslate') {
            translateRecord(d.recordId).catch(function (err) {
                try { if (e.source) e.source.postMessage({ type: 'nanoSecretError', message: String((err && err.message) || err) }, '*'); } catch (x) {}
            });
            return;
        }
        if (d.type === 'nanoSecretRouteCard') {
            routeCard(d.chatId, d.card);
            return;
        }
        if (d.type === 'nanoSecretAutoCheck') {
            autoTick();
        }
    }

    function boot() {
        window.addEventListener('message', onMessage);
        setTimeout(autoTick, 20000 + Math.random() * 30000);
        setInterval(autoTick, 30 * 60 * 1000);
        try { console.log('[NanoSecretChat] ready', MODULE_BUILD); } catch (e) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    window.NanoSecretChat = {
        getBoundChars: getBoundChars,
        getConfig: getConfig,
        saveConfig: saveConfig,
        loadRecords: loadRecords,
        generate: generate,
        translateRecord: translateRecord,
        autoTick: autoTick,
        showViewer: showViewer,
        routeCard: routeCard
    };
})();
