/* =========================================================
   角色关系（每个 char 独立设置）
   - 存储：nano_char_rel_<charId>
   - 只能选择当前 user 绑定的角色
   - 不做 API 调用；生成/记录都在 char-chats.html 与外壳模块
   ========================================================= */
(function () {
    'use strict';

    var CFG_PREFIX = 'nano_char_rel_';
    var OLD_CFG_KEY = 'nano_char_sharing';
    var $ = function (id) { return document.getElementById(id); };

    var chatId = '';
    var chars = [];
    var bound = [];
    var cfg = null;
    var toastTimer = null;

    function toast(msg, ms) {
        var el = $('relToast');
        if (!el) return;
        el.textContent = String(msg || '');
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2200);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function parseJson(raw, fallback) {
        try { var v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; }
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
    async function getBoundChars() {
        var all = await idbChars();
        var mask = homeMask();
        var mid = String(mask.id || '');
        // 和聊天列表保持一致：优先取 bindUser === 当前 user 的全部角色（含 NPC / 小号）
        var out = mid ? all.filter(function (c) {
            return c && String(c.bindUser) === mid && !c.nanoAssistant;
        }) : [];
        if (!out.length) {
            var binds = Array.isArray(mask.bindChars) ? mask.bindChars.map(String) : [];
            if (binds.length) {
                out = all.filter(function (c) {
                    if (!c || c.nanoAssistant) return false;
                    return binds.indexOf(String(c.id)) > -1 || binds.indexOf(String(c.name)) > -1;
                });
            }
        }
        if (!out.length) {
            var contacts = parseJson(localStorage.getItem('nano_contacts_data'), []);
            if (Array.isArray(contacts)) {
                out = contacts.filter(function (c) {
                    return c && String(c.bindUser) === mid && !c.nanoAssistant;
                });
            }
        }
        return { all: all, bound: out, mask: mask };
    }

    function maskId() {
        try { return String(homeMask().id || 'default'); } catch (e) { return 'default'; }
    }
    function cfgKey(id) { return CFG_PREFIX + maskId() + '_' + id; }
    function legacyCfgKey(id) { return CFG_PREFIX + id; }
    function readCfg(id) {
        var v = parseJson(localStorage.getItem(cfgKey(id)), null);
        // 旧 key 没有 user/mask 前缀：读到后复制到当前 user 的新 key。
        if (!v || typeof v !== 'object') {
            v = parseJson(localStorage.getItem(legacyCfgKey(id)), null);
            if (v && typeof v === 'object') {
                try { localStorage.setItem(cfgKey(id), JSON.stringify(v)); } catch (e) {}
            }
        }
        if (!v || typeof v !== 'object') {
            v = { privateEnabled: false, shareEnabled: false, rounds: 3, relationIds: [], labels: {}, autoDays: 3, lastAutoAt: 0, lastManualAt: 0 };
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
    function saveCfg() {
        if (!chatId || !cfg) return;
        try { localStorage.setItem(cfgKey(chatId), JSON.stringify(cfg)); } catch (e) {}
    }

    function currentChar() {
        return bound.find(function (c) { return String(c.id) === String(chatId); }) ||
            chars.find(function (c) { return String(c.id) === String(chatId); }) || null;
    }
    function charName(id) {
        var c = bound.find(function (x) { return String(x.id) === String(id); }) ||
            chars.find(function (x) { return String(x.id) === String(id); });
        return (c && c.name) || ('角色' + String(id).slice(-4));
    }
    function charAvatar(id) {
        var c = bound.find(function (x) { return String(x.id) === String(id); }) ||
            chars.find(function (x) { return String(x.id) === String(id); });
        return (c && c.avatar) || '';
    }

    function renderHero() {
        var c = currentChar();
        var av = $('relHeroAvatar');
        var title = $('relHeroTitle');
        if (av) {
            if (c && c.avatar) av.innerHTML = '<img src="' + esc(c.avatar) + '" alt="">';
            else av.textContent = String((c && c.name) || '?').slice(0, 1);
        }
        if (title) title.textContent = c ? ((c.name || '角色') + ' 的角色关系') : '角色关系';
        var pick = $('relPickWrap');
        if (pick) pick.style.display = (!chatId || !c) ? 'block' : 'none';
        var sel = $('charPick');
        if (sel && pick && pick.style.display !== 'none') {
            sel.innerHTML = bound.map(function (x) {
                return '<option value="' + esc(x.id) + '">' + esc(x.name || '未命名') + '</option>';
            }).join('') || '<option value="">当前 user 还没有绑定角色</option>';
            sel.value = chatId || (bound[0] && bound[0].id) || '';
        }
    }

    function updateAutoNote() {
        var note = $('autoNote');
        if (!note) return;
        if (!cfg.privateEnabled) {
            note.textContent = '悄悄话未开启。开启后约 3 天自动刷新一次（只在你打开 App 时检查，一次只生成一段，避免浪费 API）。开启后勾选对方即可，对方会自动同步。';
            return;
        }
        var last = Math.max(cfg.lastAutoAt || 0, cfg.lastManualAt || 0);
        if (!cfg.relationIds.length) {
            note.textContent = '悄悄话已开启。下一步勾选对方即可，对方会自动同步；约 3 天自动检查一次。';
        } else if (!last) {
            note.textContent = '悄悄话已开启，已和 ' + cfg.relationIds.length + ' 个角色建立关系（对方已自动同步）。约 3 天自动检查一次。';
        } else {
            var next = last + 3 * 24 * 3600 * 1000;
            note.textContent = '悄悄话已开启。上次刷新：' + new Date(last).toLocaleString('zh-CN') +
                '；下次大约：' + new Date(next).toLocaleString('zh-CN') + '。';
        }
    }

    function renderChars() {
        var box = $('shareList');
        if (!box) return;
        var q = String(($('shareSearch') || {}).value || '').trim().toLowerCase();
        var list = bound.filter(function (c) {
            if (!c || String(c.id) === String(chatId)) return false;
            if (q && String(c.name || '').toLowerCase().indexOf(q) < 0) return false;
            return true;
        });
        if (!list.length) {
            box.innerHTML = '<div class="rel-empty">' + (bound.length <= 1 ? '当前 user 还没有绑定其它角色' : '没有匹配的角色') + '</div>';
            return;
        }
        box.innerHTML = list.map(function (c) {
            var on = cfg.relationIds.indexOf(String(c.id)) > -1;
            var sub = String(c.setting || '').replace(/\s+/g, ' ').slice(0, 70) || '未填写人设';
            var av = c.avatar ? '<img src="' + esc(c.avatar) + '" alt="">' : esc(String(c.name || '?').slice(0, 1));
            var relLabels = ['朋友', '好朋友', '同事', '同学', '家人', '恋人', '前任', '宿敌'];
            var rawLabel = (cfg.labels && cfg.labels[String(c.id)]) || '朋友';
            var isCustom = relLabels.indexOf(rawLabel) < 0;
            var curLabel = isCustom ? '__custom__' : rawLabel;
            var labelSel = on ? ('<select class="rel-label-select" data-label-id="' + esc(c.id) + '">' +
                relLabels.map(function (x) { return '<option value="' + x + '"' + (x === curLabel ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
                '<option value="__custom__"' + (isCustom ? ' selected' : '') + '>其他（自定义）</option>' +
                '</select>') : '';
            var customInput = on ? ('<input class="rel-label-custom" data-label-id="' + esc(c.id) + '" value="' + esc(isCustom ? rawLabel : '') + '" placeholder="自定义关系"' + (isCustom ? '' : ' style="display:none"') + '>') : '';
            return '<div class="rel-char-row' + (on ? ' on' : '') + '" data-id="' + esc(c.id) + '" role="checkbox" aria-checked="' + on + '">' +
                '<div class="rel-avatar">' + av + '</div>' +
                '<div class="rel-char-main"><div class="rel-char-name">' + esc(c.name || '未命名') + '</div>' +
                '<div class="rel-char-sub">' + esc(sub) + '</div></div>' +
                labelSel + customInput +
                '<div class="rel-check">✓</div></div>';
        }).join('');
        box.querySelectorAll('.rel-char-row').forEach(function (row) {
            row.addEventListener('click', function () {
                var id = row.getAttribute('data-id');
                var idx = cfg.relationIds.indexOf(String(id));
                if (idx > -1) cfg.relationIds.splice(idx, 1);
                else {
                    cfg.relationIds.push(String(id));
                    if (!cfg.labels) cfg.labels = {};
                    cfg.labels[String(id)] = cfg.labels[String(id)] || '朋友';
                    syncRelationTo(String(id));
                }
                saveCfg();
                renderChars();
            });
        });
        box.querySelectorAll('.rel-label-select').forEach(function (sel) {
            sel.addEventListener('click', function (e) { e.stopPropagation(); });
            sel.addEventListener('change', function (e) {
                e.stopPropagation();
                var id = sel.getAttribute('data-label-id');
                var row = sel.closest('.rel-char-row');
                var inp = row && row.querySelector('.rel-label-custom');
                if (sel.value === '__custom__') {
                    if (inp) { inp.style.display = ''; inp.focus(); }
                    return;
                }
                if (inp) inp.style.display = 'none';
                if (!cfg.labels) cfg.labels = {};
                cfg.labels[String(id)] = sel.value;
                saveCfg();
                syncRelationTo(String(id));
                toast('关系已设为：' + sel.value);
            });
        });
        box.querySelectorAll('.rel-label-custom').forEach(function (inp) {
            inp.addEventListener('click', function (e) { e.stopPropagation(); });
            var applyCustom = function () {
                var id = inp.getAttribute('data-label-id');
                var val = String(inp.value || '').trim().slice(0, 12) || '朋友';
                inp.value = val;
                if (!cfg.labels) cfg.labels = {};
                cfg.labels[String(id)] = val;
                saveCfg();
                syncRelationTo(String(id));
                toast('关系已设为：' + val);
            };
            inp.addEventListener('change', function (e) { e.stopPropagation(); applyCustom(); });
            inp.addEventListener('blur', applyCustom);
        });
    }

    function renderAll() {
        if ($('privateEnabled')) $('privateEnabled').checked = !!cfg.privateEnabled;
        if ($('shareEnabled')) $('shareEnabled').checked = !!cfg.shareEnabled;
        if ($('shareRounds')) $('shareRounds').value = String(cfg.rounds || 3);
        renderHero();
        renderChars();
        updateAutoNote();
    }

    // 单边开启：A 开启悄悄话并勾选 B 后，自动把 B 也同步开启，并把 A 加进 B 的关系
    function syncRelationTo(otherId) {
        if (!chatId || !cfg || !cfg.privateEnabled) return;
        if (cfg.relationIds.indexOf(String(otherId)) < 0) return;
        try {
            var other = readCfg(otherId);
            other.privateEnabled = true;
            if (other.relationIds.indexOf(String(chatId)) < 0) other.relationIds.push(String(chatId));
            if (!other.labels) other.labels = {};
            if (cfg.labels && cfg.labels[String(otherId)]) other.labels[String(chatId)] = cfg.labels[String(otherId)];
            localStorage.setItem(cfgKey(otherId), JSON.stringify(other));
        } catch (e) {}
    }

    function loadChar(id) {
        chatId = String(id || '');
        cfg = readCfg(chatId);
        // 清掉已经不在绑定列表里的关系
        var valid = {};
        bound.forEach(function (c) { valid[String(c.id)] = 1; });
        cfg.relationIds = cfg.relationIds.filter(function (x) { return valid[String(x)] && String(x) !== String(chatId); });
        saveCfg();
        // 已开启时，把关系同步给另一方，做到单边开启即可聊天
        if (cfg.privateEnabled) cfg.relationIds.forEach(syncRelationTo);
        renderAll();
    }

    function bind() {
        var back = $('navBack');
        if (back) back.addEventListener('click', function () {
            if (window.parent !== window) {
                try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); return; } catch (e) {}
            }
            history.back();
        });
        var en = $('privateEnabled');
        if (en) en.addEventListener('change', function () {
            cfg.privateEnabled = !!en.checked;
            saveCfg();
            if (cfg.privateEnabled) cfg.relationIds.forEach(syncRelationTo);
            updateAutoNote();
            toast(cfg.privateEnabled ? '已开启悄悄话，已选角色会自动同步' : '已关闭悄悄话（对方已开启的设置不会被强制关闭）');
        });
        var sh = $('shareEnabled');
        if (sh) sh.addEventListener('change', function () {
            cfg.shareEnabled = !!sh.checked;
            saveCfg();
            toast(cfg.shareEnabled ? '已开启近况共享' : '已关闭近况共享');
        });
        var rd = $('shareRounds');
        if (rd) rd.addEventListener('change', function () {
            cfg.rounds = Math.max(1, Math.min(10, parseInt(rd.value, 10) || 3));
            saveCfg();
            toast('共享轮数：' + cfg.rounds);
        });
        var search = $('shareSearch');
        if (search) search.addEventListener('input', renderChars);
        var pick = $('charPick');
        if (pick) pick.addEventListener('change', function () { if (pick.value) loadChar(pick.value); });
        var records = $('openRecords');
        if (records) records.addEventListener('click', function () {
            if (window.parent !== window) {
                try {
                    window.parent.postMessage({ type: 'openFullscreen', url: 'char-chats.html', title: '悄悄话', source: 'chat_inner' }, '*');
                    return;
                } catch (e) {}
            }
            location.href = 'char-chats.html';
        });
    }

    async function init() {
        var q = new URLSearchParams(location.search);
        chatId = String(q.get('chat') || '');
        bind();
        var data = await getBoundChars();
        chars = data.all;
        bound = data.bound;
        if (!chatId && bound.length) chatId = String(bound[0].id);
        if (!bound.length) {
            var box = $('shareList');
            if (box) box.innerHTML = '<div class="rel-empty">当前 user 还没有绑定角色。请先在主页绑定角色，再来设置。</div>';
            var hero = $('relHeroTitle');
            if (hero) hero.textContent = '还没有绑定角色';
            return;
        }
        loadChar(chatId);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
