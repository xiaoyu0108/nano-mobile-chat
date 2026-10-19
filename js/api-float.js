// ============================================================
// api-float.js — 全局 API 悬浮球
// 功能：拖动 / 点击展开小型面板；切换 API/Image/TTS 分类与预设；
//       拉取网站模型；保存配置（与 API 页面共用 nano_api_db 配置）。
// 挂载：仅在顶层文档挂载；iframe 内自动跳过（由父级悬浮球覆盖）。
// ============================================================
(function () {
    'use strict';
    if (window.__apiFloatLoaded) return;
    window.__apiFloatLoaded = true;

    // 进程内只挂一次；iframe 内不挂（父页面已提供）
    var isTop = (window.top === window.self);
    var LS_KEY = 'nanoApiBall';
    var API_DB = 'nano_api_db';
    var API_STORE = 'api_data';
    var CONFIG_KEY = 'nano_api_config';
    var PRESET_DATA_KEY = 'nano_api_presets_data';
    var PRESET_LIST_KEY = 'nano_api_preset_list';
    var MODEL_LIST_KEY = 'nano_api_model_lists';
    var ASSIGN_KEY = 'nano_api_assign';

    var ASSIGN_FIELDS = {
        api: ['chatSingle', 'chatGroup', 'chatMusic', 'chatDiscover'],
        image: ['imageSingle', 'imageGroup', 'imageMoments'],
        tts: ['ttsReply', 'ttsRead']
    };

    var CATS = {
        api: { label: 'API', prefix: 'main_', listKey: 'main', selectId: 'mainModelSelect', fields: { url: 'mainUrl', key: 'mainKey', model: 'mainModel', preset: 'mainPreset' } },
        image: { label: 'Image', prefix: 'img_', listKey: 'img', selectId: 'imgModelSelect', fields: { url: 'imgUrl', key: 'imgKey', model: 'imgModel', preset: 'imgPreset' } },
        tts: { label: 'TTS', prefix: 'tts_', listKey: 'tts', selectId: 'ttsModelSelect', fields: { url: 'ttsUrl', key: 'ttsKey', model: 'ttsModel', preset: 'ttsPreset' } }
    };

    var DEFAULT_SETTINGS = { enabled: true, size: 52, icon: 'classic', x: null, y: null };

    // ---------- IndexedDB（与 api.js 同库同表） ----------
    function openDB() {
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(API_DB, 2);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(API_STORE)) db.createObjectStore(API_STORE, { keyPath: 'key' });
                    if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function (e) { reject(e.target.error); };
                req.onblocked = function () { reject(new Error('blocked')); };
            } catch (e) { reject(e); }
        });
    }
    function idbGet(key) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var r = db.transaction(API_STORE, 'readonly').objectStore(API_STORE).get(key);
                    r.onsuccess = function () { resolve(r.result ? r.result.value : null); try { db.close(); } catch (e) {} };
                    r.onerror = function () { resolve(null); try { db.close(); } catch (e) {} };
                } catch (e) { resolve(null); try { db.close(); } catch (e2) {} }
            });
        }).catch(function () { return null; });
    }
    function idbSet(key, value) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(API_STORE, 'readwrite');
                    tx.objectStore(API_STORE).put({ key: key, value: value });
                    tx.oncomplete = function () { resolve(); try { db.close(); } catch (e) {} };
                    tx.onerror = function () { resolve(); try { db.close(); } catch (e) {} };
                } catch (e) { resolve(); try { db.close(); } catch (e2) {} }
            });
        }).catch(function () {});
    }

    function cleanUrl(u) { return String(u || '').trim().replace(/\s/g, '').replace(/\/+$/, ''); }
    function cleanKey(k) { return String(k || '').trim(); }
    function baseV1(u) {
        var s = cleanUrl(u);
        if (!s) return s;
        return /\/v1$/i.test(s) ? s : (s.replace(/\/$/, '') + '/v1');
    }

    // ---------- 设置 ----------
    function loadSettings() {
        var s = Object.assign({}, DEFAULT_SETTINGS);
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (raw) Object.assign(s, JSON.parse(raw) || {});
        } catch (e) {}
        return s;
    }
    function persistSettings(patch) {
        var s = Object.assign(loadSettings(), patch || {});
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
        return s;
    }

    if (!isTop) {
        // iframe 内仅提供读取设置的辅助，不渲染
        window.ApiBall = { getSettings: loadSettings, isTopLevel: false };
        return;
    }

    // ---------- 样式 ----------
    var CSS = ''
        + ':root{--ab-size:52px;}'
        + '.ab-ball{position:fixed;z-index:2147483002;width:var(--ab-size);height:var(--ab-size);border-radius:50%;background:#2c2c2e;box-shadow:0 6px 16px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;touch-action:none;cursor:pointer;user-select:none;-webkit-user-select:none;transition:transform .15s;left:0;top:0;overflow:hidden;}'
        + '.ab-ball:active{transform:scale(.94);}'
        + '.ab-ball.ab-hidden{display:none;}'
        + '.ab-ring{width:66%;height:66%;border-radius:50%;background:#8e8e93;box-shadow:inset 0 2px 4px rgba(255,255,255,.25),inset 0 -2px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;}'
        + '.ab-core{width:72%;height:72%;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;font-size:calc(var(--ab-size) * 0.34);line-height:1;overflow:hidden;}'
        + '.ab-photo{display:none;position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;border-radius:50%;}'
        + '.ab-ball.ab-image-mode .ab-ring{display:none;}'
        + '.ab-ball.ab-image-mode .ab-photo{display:block;}'
        + '.ab-panel{position:fixed;z-index:2147483001;width:252px;max-width:calc(100vw - 16px);background:rgba(255,255,255,.98);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border-radius:18px;box-shadow:0 14px 40px rgba(0,0,0,.2);padding:14px;display:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;color:#000;max-height:72vh;overflow:auto;box-sizing:border-box;}'
        + '.ab-panel.ab-open{display:block;}'
        + '.ab-tabs{display:flex;gap:4px;background:rgba(120,120,128,.14);border-radius:11px;padding:4px;margin-bottom:14px;}'
        + '.ab-tab{flex:1;border:none;background:transparent;font-size:12px;padding:8px 0;border-radius:8px;color:#3a3a3c;cursor:pointer;font-family:inherit;}'
        + '.ab-tab.ab-active{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.14);font-weight:600;}'
        + '.ab-select{width:100%;font-size:13px;padding:10px 11px;border-radius:11px;border:0.5px solid rgba(60,60,67,.2);background:#fff;color:#000;margin-bottom:12px;box-sizing:border-box;font-family:inherit;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path d=\'M1 1l4 4 4-4\' fill=\'none\' stroke=\'%238e8e93\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>");background-repeat:no-repeat;background-position:right 11px center;padding-right:28px;}'
        + '.ab-select:disabled{opacity:.5;}'
        + '.ab-model-head{display:flex;align-items:center;justify-content:space-between;margin:0 2px 8px;}'
        + '.ab-model-label{font-size:11px;font-weight:600;color:#8e8e93;letter-spacing:.2px;}'
        + '.ab-pull{width:28px;height:28px;border:none;border-radius:50%;background:rgba(0,122,255,.12);color:#007aff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}'
        + '.ab-pull:active{background:rgba(0,122,255,.22);}'
        + '.ab-pull svg{width:15px;height:15px;display:block;}'
        + '.ab-pull.ab-spin svg{animation:abspin .8s linear infinite;}'
        + '@keyframes abspin{to{transform:rotate(360deg);}}'
        + '.ab-save{width:100%;border:none;border-radius:12px;background:#007aff;color:#fff;font-size:13px;padding:12px 0;font-weight:600;cursor:pointer;font-family:inherit;margin-top:2px;}'
        + '.ab-save:active{opacity:.85;}'
        + '.ab-status{font-size:11px;color:#8e8e93;min-height:15px;margin-top:10px;text-align:center;line-height:1.4;}'
        + '.ab-bt-cats{display:flex;gap:4px;margin-bottom:10px;}'
        + '.ab-bt-cat{flex:1;border:none;background:rgba(120,120,128,.12);border-radius:8px;padding:8px 0;font-size:12px;color:#3a3a3c;cursor:pointer;font-family:inherit;}'
        + '.ab-bt-cat.ab-active{background:#007aff;color:#fff;font-weight:600;}'
        + '.ab-bt-actions{display:flex;gap:6px;margin-bottom:10px;}'
        + '.ab-bt-btn{flex:1;border:none;border-radius:11px;background:rgba(120,120,128,.12);color:#1c1c1e;font-size:12px;padding:10px 0;font-weight:500;cursor:pointer;font-family:inherit;}'
        + '.ab-bt-btn:active{opacity:.8;}'
        + '.ab-bt-tip{font-size:10px;color:#8e8e93;text-align:center;margin-bottom:8px;line-height:1.4;}'
        // ---- 环形菜单（点击悬浮球出现） ----
        + '.ab-ring-menu{position:fixed;inset:0;z-index:2147483003;display:none;pointer-events:none;}'
        + '.ab-ring-menu.ab-open{display:block;}'
        + '.ab-ring-item{position:absolute;pointer-events:auto;border:none;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;box-shadow:0 6px 16px rgba(0,0,0,.24);transition:transform .14s;padding:0;}'
        + '.ab-ring-item:active{transform:scale(.9);}'
        + '.ab-ring-item svg{width:46%;height:46%;display:block;}'
        + '.ab-ring-item.ab-ri-back{background:#007aff;}'
        + '.ab-ring-item.ab-ri-api{background:#34c759;}'
        + '.ab-ring-item.ab-ri-beauty{background:#af52de;}'
        + '.ab-ring-label{position:absolute;top:calc(100% + 3px);left:50%;transform:translateX(-50%);font-size:9px;font-weight:600;color:#1c1c1e;background:rgba(255,255,255,.9);border-radius:6px;padding:1px 5px;white-space:nowrap;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.12);}'
        // 环形连接线 + 面板标题 + 贴边半隐
        + '.ab-ring-line{position:absolute;z-index:-1;background:rgba(120,120,128,.28);pointer-events:none;border-radius:2px;transform-origin:0 50%;}'
        + '.ab-panel-title{font-size:13px;font-weight:700;color:#1c1c1e;margin:0 2px 10px;letter-spacing:-.2px;}'
        + '.ab-close{position:absolute;top:9px;right:9px;width:26px;height:26px;border:none;border-radius:50%;background:rgba(120,120,128,.14);color:#3a3a3c;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;}'
        + '.ab-close:active{background:rgba(120,120,128,.28);}'
        + '.ab-ball.ab-docked{opacity:.5;}'
        + '.ab-ball.ab-docked .ab-core{opacity:.85;}';

    function injectCSS() {
        var st = document.createElement('style');
        st.id = 'apiFloatStyle';
        st.textContent = CSS;
        (document.head || document.documentElement).appendChild(st);
    }

    var settings = loadSettings();
    if (!settings.enabled) {
        window.ApiBall = { getSettings: loadSettings, isTopLevel: true };
        return;
    }

    injectCSS();

    // ---------- DOM ----------
    var ball = document.createElement('div');
    ball.className = 'ab-ball';
    ball.innerHTML = '<img class="ab-photo" alt=""><div class="ab-ring"><div class="ab-core" id="abCore"></div></div>';
    // API 小窗（API / Image / TTS）
    var panel = document.createElement('div');
    panel.className = 'ab-panel ab-panel-api';
    panel.innerHTML = ''
        + '<button class="ab-close" data-ab-close aria-label="关闭">×</button>'
        + '<div class="ab-panel-title">API 切换</div>'
        + '<div class="ab-tabs">'
        + '<button class="ab-tab" data-cat="api">API</button>'
        + '<button class="ab-tab" data-cat="image">Image</button>'
        + '<button class="ab-tab" data-cat="tts">TTS</button>'
        + '</div>'
        + '<div class="ab-api-group">'
        + '<select class="ab-select ab-preset"></select>'
        + '<div class="ab-model-head"><span class="ab-model-label">模型</span>'
        + '<button class="ab-pull" title="拉取模型"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><polyline points="20 4 20 11 13 11"/></svg></button></div>'
        + '<select class="ab-select ab-model"></select>'
        + '<button class="ab-save">保存配置</button>'
        + '</div>'
        + '<div class="ab-status"></div>';

    // 美化小窗（完全独立于 API 小窗）
    var beautyPanel = document.createElement('div');
    beautyPanel.className = 'ab-panel ab-panel-beauty';
    beautyPanel.innerHTML = ''
        + '<button class="ab-close" data-ab-close aria-label="关闭">×</button>'
        + '<div class="ab-panel-title">美化</div>'
        + '<div class="ab-bt-cats">'
        + '<button class="ab-bt-cat ab-active" data-bt="global">全局</button>'
        + '<button class="ab-bt-cat" data-bt="chat">聊天</button>'
        + '<button class="ab-bt-cat" data-bt="font">字体</button>'
        + '</div>'
        + '<div class="ab-bt-main">'
        + '<select class="ab-select ab-bt-preset"></select>'
        + '<div class="ab-bt-actions">'
        + '<button class="ab-bt-btn" data-bt-act="clear">清空</button>'
        + '<button class="ab-bt-btn" data-bt-act="restore">还原初始</button>'
        + '</div>'
        + '<button class="ab-save" data-bt-act="save">应用并保存</button>'
        + '<div class="ab-bt-tip">还原初始会载入内置初始模板</div>'
        + '</div>'
        + '<div class="ab-bt-font-wrap" style="display:none">'
        + '<select class="ab-select ab-bt-font"></select>'
        + '<div class="ab-bt-actions">'
        + '<button class="ab-bt-btn" data-bt-act="font-restore">还原系统字体</button>'
        + '</div>'
        + '<div class="ab-bt-tip">切换字体后所有页面立即生效；还原即回到系统默认</div>'
        + '</div>'
        + '<div class="ab-status"></div>';

    // 环形菜单：点击悬浮球后围绕它展开的三个动作
    var ringMenu = document.createElement('div');
    ringMenu.className = 'ab-ring-menu';
    ringMenu.innerHTML = ''
        + '<button class="ab-ring-item ab-ri-back" data-ring="back" title="返回">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
        + '<span class="ab-ring-label">返回</span></button>'
        + '<button class="ab-ring-item ab-ri-api" data-ring="api" title="API">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
        + '<span class="ab-ring-label">API</span></button>'
        + '<button class="ab-ring-item ab-ri-beauty" data-ring="beauty" title="美化">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>'
        + '<span class="ab-ring-label">美化</span></button>';

    function mount() {
        (document.body || document.documentElement).appendChild(ball);
        (document.body || document.documentElement).appendChild(panel);
        (document.body || document.documentElement).appendChild(beautyPanel);
        (document.body || document.documentElement).appendChild(ringMenu);
        applySettings(settings);
        placeBall(settings.x, settings.y);
        bind();
    }

    var coreEl, photoEl, presetEl, modelEl, statusEl, pullBtn;
    var beautyStatusEl, beautyPresetEl, beautyFontEl;
    function readBeautyCat() {
        try {
            var c = localStorage.getItem('nano_beauty_cat');
            return (c === 'chat' || c === 'font') ? c : 'global';
        } catch (e) { return 'global'; }
    }
    var beautyCat = readBeautyCat();
    var activeCat = 'api';
    var working = { url: '', key: '', model: '', preset: '' };
    var modelCache = [];

    function $(sel, root) { return (root || panel).querySelector(sel); }

    function getBounds() {
        var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
        var el = document.querySelector('.app-container') || document.querySelector('.container');
        var r = el ? el.getBoundingClientRect() : null;
        if (r && r.width > 80 && r.height > 120) {
            // 和可视窗口取交集：页面比屏幕高时，.app-container 的 bottom 会超出视口，
            // 直接用会把小窗放到屏幕外。这里保证边界永远不超出当前可视区域。
            var left = Math.max(0, r.left), top = Math.max(0, r.top);
            var right = Math.min(vw, r.right), bottom = Math.min(vh, r.bottom);
            if (right - left > 80 && bottom - top > 120) {
                return { left: left, top: top, right: right, bottom: bottom };
            }
        }
        return { left: 0, top: 0, right: vw, bottom: vh };
    }

    function applySettings(s) {
        document.documentElement.style.setProperty('--ab-size', (s.size || 52) + 'px');
        ball.classList.toggle('ab-hidden', s.enabled === false);
        ball.classList.toggle('ab-image-mode', !!s.image);
        photoEl = photoEl || ball.querySelector('.ab-photo');
        if (photoEl) {
            if (s.image) photoEl.src = s.image;
            else photoEl.removeAttribute('src');
        }
        coreEl = coreEl || ball.querySelector('.ab-core');
        coreEl.textContent = (!s.image && s.icon && s.icon !== 'classic') ? s.icon : '';
        panel.style.visibility = 'hidden';
        beautyPanel.style.visibility = 'hidden';
        if (!s.docked && (s.x == null || s.y == null)) {
            var b = getBounds();
            s.x = b.right - (s.size || 52) - 14;
            s.y = b.bottom - (s.size || 52) - 120;
            persistSettings({ x: s.x, y: s.y });
        }
        if (s.docked) placeBall(null, s.y, { dock: s.docked });
        else placeBall(s.x, s.y);
        if (panel.classList.contains('ab-open')) placePanel(panel);
        if (beautyPanel.classList.contains('ab-open')) placePanel(beautyPanel);
    }

    function placeBall(x, y, opts) {
        var size = settings.size || 52;
        var b = getBounds();
        var pad = 8;
        if (opts && opts.dock) {
            // 贴边：一半露在屏幕内、一半在屏幕外
            x = opts.dock === 'left' ? (b.left - size * 0.5) : (b.right - size * 0.5);
            y = Math.max(b.top + pad, Math.min(b.bottom - size - pad, (y == null ? settings.y : y)));
            settings.docked = opts.dock;
            ball.classList.add('ab-docked');
        } else {
            x = Math.max(b.left + pad, Math.min(b.right - size - pad, x));
            y = Math.max(b.top + pad, Math.min(b.bottom - size - pad, y));
            settings.docked = null;
            ball.classList.remove('ab-docked');
        }
        ball.style.left = x + 'px';
        ball.style.top = y + 'px';
        settings.x = x; settings.y = y;
    }

    // 小窗跟随悬浮球：放在球旁边（右/左/下/上），优先选不遮挡悬浮球且不出界的位置，
    // 这样球始终露在小窗旁边、可以继续拖动或再点开菜单。
    function placePanel(which) {
        var el = which || panel;
        var size = settings.size || 52;
        var pw = el.offsetWidth || 252, ph = el.offsetHeight || 190;
        var b = getBounds();
        var bx = parseFloat(ball.style.left) || 0;
        var by = parseFloat(ball.style.top) || 0;
        var gap = 10, pad = 8;
        var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
        var inBounds = function (r) {
            return r.l >= b.left + pad && r.t >= b.top + pad && r.l + pw <= b.right - pad && r.t + ph <= b.bottom - pad;
        };
        var noOverlap = function (r) {
            return (r.l >= bx + size + 2 || r.l + pw <= bx - 2 || r.t >= by + size + 2 || r.t + ph <= by - 2);
        };
        var cands = [
            { l: bx + size + gap, t: by + size / 2 - ph / 2 },       // 右
            { l: bx - pw - gap, t: by + size / 2 - ph / 2 },         // 左
            { l: bx + size / 2 - pw / 2, t: by + size + gap },       // 下
            { l: bx + size / 2 - pw / 2, t: by - ph - gap }          // 上
        ];
        var chosen = null;
        for (var i = 0; i < cands.length; i++) {
            if (inBounds(cands[i]) && noOverlap(cands[i])) { chosen = cands[i]; break; }
        }
        if (!chosen) {
            for (var j = 0; j < cands.length; j++) {
                var r2 = {
                    l: clamp(cands[j].l, b.left + pad, b.right - pw - pad),
                    t: clamp(cands[j].t, b.top + pad, b.bottom - ph - pad)
                };
                if (!chosen) chosen = r2;
                if (noOverlap(r2)) { chosen = r2; break; }
            }
        }
        if (!chosen) chosen = { l: b.left + pad, t: b.top + pad };
        el.style.left = chosen.l + 'px';
        el.style.top = chosen.t + 'px';
        el.style.visibility = 'visible';
    }

    // ---------- 交互 ----------
    function bind() {
        coreEl = ball.querySelector('.ab-core');
        presetEl = $('.ab-preset');
        modelEl = $('.ab-model');
        statusEl = $('.ab-status');
        pullBtn = $('.ab-pull');
        beautyStatusEl = beautyPanel.querySelector('.ab-status');
        beautyPresetEl = beautyPanel.querySelector('.ab-bt-preset');
        beautyFontEl = beautyPanel.querySelector('.ab-bt-font');

        panel.querySelectorAll('.ab-tab').forEach(function (b) {
            b.addEventListener('click', function () { setCat(b.dataset.cat); });
        });
        beautyPanel.querySelectorAll('.ab-bt-cat').forEach(function (b) {
            b.addEventListener('click', function () { setBeautyCat(b.dataset.bt); });
        });
        beautyPanel.querySelectorAll('[data-bt-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                var a = b.dataset.btAct;
                if (a === 'clear') doBeautyClear();
                else if (a === 'restore') doBeautyRestore();
                else if (a === 'save') doBeautySave();
                else if (a === 'font-restore') doFontRestore();
            });
        });
        if (beautyPresetEl) beautyPresetEl.addEventListener('change', function () { onBeautyPreset(this.value); });
        if (beautyFontEl) beautyFontEl.addEventListener('change', function () { onFontPreset(this.value); });
        panel.querySelectorAll('.ab-tab').forEach(function (b) {
            b.classList.toggle('ab-active', b.dataset.cat === activeCat);
        });
        presetEl.addEventListener('change', function () { onPresetChange(this.value); });
        modelEl.addEventListener('change', function () { working.model = this.value; syncModelText(); });
        pullBtn.addEventListener('click', doPull);
        $('.ab-save').addEventListener('click', doSave);

        // 拖动 + 点击
        var dragging = false, moved = false, startX = 0, startY = 0, offX = 0, offY = 0;
        ball.addEventListener('pointerdown', function (e) {
            if (e.button != null && e.button !== 0) return;
            dragging = true; moved = false;
            startX = e.clientX; startY = e.clientY;
            offX = e.clientX - (parseFloat(ball.style.left) || 0);
            offY = e.clientY - (parseFloat(ball.style.top) || 0);
            try { ball.setPointerCapture(e.pointerId); } catch (err) {}
        });
        ball.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            if (!moved && (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4)) {
                moved = true;
                if (settings.docked) { settings.docked = null; ball.classList.remove('ab-docked'); }
            }
            if (moved) {
                placeBall(e.clientX - offX, e.clientY - offY);
                // 拖动时环形菜单 / 小窗跟着一起动
                if (ringOpen) placeRing();
                if (panel.classList.contains('ab-open')) placePanel(panel);
                if (beautyPanel.classList.contains('ab-open')) placePanel(beautyPanel);
            }
        });
        ball.addEventListener('pointerup', function (e) {
            if (!dragging) return;
            dragging = false;
            try { ball.releasePointerCapture(e.pointerId); } catch (err) {}
            if (moved) {
                var size = settings.size || 52, b = getBounds();
                var cx = settings.x + size / 2;
                // 拖到左右边缘 → 半隐贴边
                if (cx < b.left + size * 0.75) dockBall('left');
                else if (cx > b.right - size * 0.75) dockBall('right');
                persistSettings({ x: settings.x, y: settings.y, docked: settings.docked || null });
                if (settings.docked) {
                    // 贴边后收起菜单/小窗，点击半个球时再出来
                    closeRing(); closePanel(panel); closePanel(beautyPanel);
                } else {
                    if (ringOpen) placeRing();
                    if (panel.classList.contains('ab-open')) placePanel(panel);
                    if (beautyPanel.classList.contains('ab-open')) placePanel(beautyPanel);
                }
            } else if (settings.docked) {
                // 点贴边的半个球 → 先出来，再展开环形菜单
                undockBall();
                openRing();
            } else {
                toggleRing();
            }
        });
        ball.addEventListener('pointercancel', function () { dragging = false; });

        // 环形菜单按钮
        ringMenu.querySelectorAll('[data-ring]').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                var act = b.dataset.ring;
                if (act === 'back') { closeRing(); doBack(); }
                else if (act === 'api') { openApiPanel(); }
                else if (act === 'beauty') { openBeautyPanel(); }
            });
        });

        // 小窗右上角关闭按钮（即使球被挡住也能关）
        [panel, beautyPanel].forEach(function (p) {
            p.querySelectorAll('[data-ab-close]').forEach(function (b) {
                b.addEventListener('click', function (e) { e.stopPropagation(); closePanel(p); });
            });
        });

        // 点击空白处收起面板 / 环形菜单
        document.addEventListener('pointerdown', function (e) {
            if (ringMenu.contains(e.target) || ball.contains(e.target)) return;
            if (panel.classList.contains('ab-open') && !panel.contains(e.target)) closePanel(panel);
            if (beautyPanel.classList.contains('ab-open') && !beautyPanel.contains(e.target)) closePanel(beautyPanel);
            closeRing();
        }, true);

        window.addEventListener('resize', function () {
            if (settings.docked) placeBall(null, settings.y, { dock: settings.docked });
            else placeBall(settings.x, settings.y);
            if (panel.classList.contains('ab-open')) placePanel(panel);
            if (beautyPanel.classList.contains('ab-open')) placePanel(beautyPanel);
            if (ringOpen) placeRing();
        });

        // 设置同步（同源 storage 事件 + 父级消息）
        window.addEventListener('storage', function (e) {
            if (e.key !== LS_KEY) return;
            settings = loadSettings();
            applySettings(settings);
            if (settings.enabled === false) { closePanel(panel); closePanel(beautyPanel); closeRing(); }
        });
        window.addEventListener('message', function (e) {
            var d = e.data;
            if (d && d.type === 'apiBallSettings') {
                settings = persistSettings(d.settings || {});
                applySettings(settings);
                if (settings.enabled === false) { closePanel(panel); closePanel(beautyPanel); closeRing(); }
            }
        });
    }

    var panelOpen = false;
    function closePanel(el) {
        var which = el || panel;
        which.classList.remove('ab-open');
        if (which === panel) panelOpen = false;
    }
    function openApiPanel() {
        closeRing();
        closePanel(beautyPanel);
        panelOpen = true;
        panel.classList.add('ab-open');
        loadAll().then(function () { placePanel(panel); });
        placePanel(panel);
    }
    function openBeautyPanel() {
        closeRing();
        closePanel(panel);
        beautyPanel.classList.add('ab-open');
        // 记住上次选中的分类与预设，重新打开时回填，避免看起来「切换没保存」
        setBeautyCat(beautyCat);
        placePanel(beautyPanel);
    }

    // ---------- 环形菜单（围绕悬浮球均匀分布三个功能） ----------
    var ringOpen = false;
    function toggleRing() { if (ringOpen) closeRing(); else openRing(); }
    function ringItemSize() {
        var size = settings.size || 52;
        return Math.max(40, Math.round(size * 0.82));
    }
    function ringRadius() {
        var size = settings.size || 52;
        return size + ringItemSize() * 0.62;
    }
    function openRing() {
        closePanel(panel); closePanel(beautyPanel);
        fitBallForRing();
        ringOpen = true;
        ringMenu.classList.add('ab-open');
        placeRing();
    }
    function closeRing() {
        ringOpen = false;
        ringMenu.classList.remove('ab-open');
    }
    // 球太靠边时先把球心收进可视区，保证整个环形菜单都看得到
    function fitBallForRing() {
        var size = settings.size || 52, item = ringItemSize(), R = ringRadius();
        var b = getBounds(), pad = 6;
        var cx = settings.x + size / 2, cy = settings.y + size / 2;
        var maxX = R * Math.cos(30 * Math.PI / 180) + item / 2;
        var minX = b.left + pad + maxX;
        var maxCx = b.right - pad - maxX;
        var minY = b.top + pad + R + item / 2;
        var maxCy = b.bottom - pad - (R * Math.sin(30 * Math.PI / 180) + item / 2);
        if (maxCx < minX) { cx = (b.left + b.right) / 2; } else { cx = Math.max(minX, Math.min(maxCx, cx)); }
        if (maxCy < minY) { cy = (b.top + b.bottom) / 2; } else { cy = Math.max(minY, Math.min(maxCy, cy)); }
        placeBall(cx - size / 2, cy - size / 2);
    }
    function placeRing() {
        var size = settings.size || 52;
        var item = ringItemSize();
        var radius = ringRadius();
        var b = getBounds();
        var pad = 6;
        var cx = (parseFloat(ball.style.left) || 0) + size / 2;
        var cy = (parseFloat(ball.style.top) || 0) + size / 2;
        // 均匀分布：-90°（上）/ 30°（右下）/ 150°（左下），各自相隔 120°
        var defs = [{ a: -90, k: 'back' }, { a: 150, k: 'beauty' }, { a: 30, k: 'api' }];
        defs.forEach(function (d) {
            var btn = ringMenu.querySelector('[data-ring="' + d.k + '"]');
            if (!btn) return;
            btn.style.width = item + 'px';
            btn.style.height = item + 'px';
            var rad = d.a * Math.PI / 180;
            var px = cx + radius * Math.cos(rad) - item / 2;
            var py = cy + radius * Math.sin(rad) - item / 2;
            px = Math.max(b.left + pad, Math.min(b.right - item - pad, px));
            py = Math.max(b.top + pad, Math.min(b.bottom - item - pad, py));
            btn.style.left = px + 'px';
            btn.style.top = py + 'px';
        });
    }
    function dockBall(side) { placeBall(null, settings.y, { dock: side }); }
    function undockBall() {
        var size = settings.size || 52, b = getBounds(), pad = 8;
        var x = (settings.docked === 'left') ? (b.left + pad) : (b.right - size - pad);
        placeBall(x, settings.y);
    }
    // 返回：优先走宿主统一的返回逻辑（关浮层 / 回聊天页），否则点本页返回按钮
    function doBack() {
        // 外壳 index.html 提供了统一返回逻辑
        if (typeof window.__nanoGoBack === 'function') {
            try { if (window.__nanoGoBack()) return; } catch (e) {}
            return; // 已在首页、无可返回：直接不动，避免退出 App
        }
        // 独立打开的页面：点它自己的可见返回按钮
        var b = null, list = document.querySelectorAll('[data-back]');
        for (var i = list.length - 1; i >= 0; i--) {
            var r = list[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { b = list[i]; break; }
        }
        if (b) { try { b.click(); return; } catch (e) {} }
        try {
            if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'swipeBack' }, '*');
            else history.back();
        } catch (e) {}
    }

    // ---------- 数据 ----------
    function loadAll() {
        return idbGet(CONFIG_KEY).then(function (cfg) {
            cfg = cfg || {};
            return idbGet(PRESET_LIST_KEY).then(function (lists) {
                lists = lists || {};
                return applyCat(cfg, lists, activeCat);
            });
        });
    }

    function setCat(cat) {
        activeCat = cat;
        panel.querySelectorAll('.ab-tab').forEach(function (b) {
            b.classList.toggle('ab-active', b.dataset.cat === cat);
        });
        loadAll();
    }

    function applyCat(cfg, lists, cat) {
        var c = CATS[cat];
        // 预设下拉
        var names = (lists[c.listKey] || []).slice();
        presetEl.innerHTML = '<option value="">默认</option>';
        names.forEach(function (n) {
            var o = document.createElement('option'); o.value = n; o.textContent = n; presetEl.appendChild(o);
        });
        var curPreset = cfg[c.fields.preset] || '';
        presetEl.value = names.indexOf(curPreset) !== -1 ? curPreset : '';

        working.url = cfg[c.fields.url] || '';
        working.key = cfg[c.fields.key] || '';
        working.model = cfg[c.fields.model] || '';
        working.preset = presetEl.value;

        return idbGet(MODEL_LIST_KEY).then(function (all) {
            var models = (all && all[c.selectId]) || [];
            modelCache = models.slice();
            renderModels(models, working.model);
            statusEl.textContent = working.url ? (working.url.replace(/^https?:\/\//, '').slice(0, 26)) : '未配置地址';
        });
    }

    function renderModels(models, selected) {
        modelEl.innerHTML = '<option value="">选择模型…</option>';
        models.forEach(function (m) {
            var o = document.createElement('option'); o.value = m.value; o.textContent = m.text; modelEl.appendChild(o);
        });
        if (selected) {
            var exists = models.some(function (m) { return m.value === selected; });
            if (!exists) {
                var o = document.createElement('option'); o.value = selected; o.textContent = selected; modelEl.appendChild(o);
            }
            modelEl.value = selected;
        } else {
            modelEl.value = '';
        }
    }

    function syncModelText() {
        var opt = modelEl.options[modelEl.selectedIndex];
        working.modelText = opt ? opt.text : working.model;
    }

    function onPresetChange(name) {
        var c = CATS[activeCat];
        working.preset = name || '';
        if (!name) { syncConfigToStore(); return; }
        return idbGet(PRESET_DATA_KEY).then(function (all) {
            var data = (all && all[c.prefix + name]) || null;
            if (!data) { statusEl.textContent = '预设数据丢失'; return; }
            working.url = data.url || '';
            working.key = data.key || '';
            working.model = data.modelValue || data.modelText || '';
            renderModels(modelCache, working.model);
            syncModelText();
            return syncConfigToStore().then(function () {
                statusEl.textContent = '已切换：' + name;
                broadcastReload();
            });
        });
    }

    // 把当前 working 写回 nano_api_config（让 API 页面 / TTS 立即使用）
    function syncConfigToStore() {
        var c = CATS[activeCat];
        return idbGet(CONFIG_KEY).then(function (cfg) {
            cfg = cfg || {};
            cfg[c.fields.url] = cleanUrl(working.url);
            cfg[c.fields.key] = working.key;
            cfg[c.fields.model] = working.model;
            cfg[c.fields.preset] = working.preset;
            return idbSet(CONFIG_KEY, cfg);
        }).then(function () {
            // 同步「分配」：让各功能按所选预设读取（无预设时回退到当前配置）
            return idbGet(ASSIGN_KEY).then(function (assign) {
                assign = assign || {};
                (ASSIGN_FIELDS[activeCat] || []).forEach(function (f) {
                    assign[f] = working.preset || '';
                });
                return idbSet(ASSIGN_KEY, assign);
            });
        });
    }

    function doSave() {
        var c = CATS[activeCat];
        syncModelText();
        syncConfigToStore().then(function () {
            if (!working.preset) { flash('已保存配置'); return; }
            // 同时写回预设数据，后续切换即用这套
            return idbGet(PRESET_DATA_KEY).then(function (all) {
                all = all || {};
                var prev = all[c.prefix + working.preset] || {};
                prev.url = cleanUrl(working.url);
                prev.key = working.key;
                prev.modelValue = working.model;
                prev.modelText = working.modelText || working.model;
                all[c.prefix + working.preset] = prev;
                return idbSet(PRESET_DATA_KEY, all).then(function () {
                    flash('已保存：' + working.preset);
                });
            });
        }).then(function () {
            broadcastReload();
        });
    }

    function doPull() {
        var c = CATS[activeCat];
        var url = cleanUrl(working.url);
        var key = cleanKey(working.key);
        if (!url || !key) { flash('请先在 API 页面填写地址和 Key'); return; }
        pullBtn.classList.add('ab-spin');
        statusEl.textContent = '正在拉取…';

        idbGet(CONFIG_KEY).then(function (cfg) {
            cfg = cfg || {};
            var type = activeCat === 'tts' ? (cfg.ttsType || 'openai') : '';
            var groupId = activeCat === 'tts' ? (cfg.ttsGroupId || '') : '';
            var p;
            if (type === 'minimax') {
                p = fetch(baseV1(url) + '/get_voice?GroupId=' + encodeURIComponent(groupId), { headers: { 'Authorization': 'Bearer ' + key } });
            } else if (type === 'fishaudio') {
                var fishRoot = cleanUrl(url).replace(/\/v1$/i, '');
                p = fetch(fishRoot + '/model?page_size=100', { headers: { 'Authorization': 'Bearer ' + key } });
            } else {
                p = fetch(baseV1(url) + '/models', { headers: { 'Authorization': 'Bearer ' + key } });
            }
            return p.then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
            }).then(function (data) {
                var raw;
                if (type === 'minimax') raw = data.voice_list || data.data || [];
                else if (type === 'fishaudio') raw = data.items || data.data || [];
                else raw = data.data || data.models || [];
                var models = (raw || []).map(function (m) {
                    var name = m.voice_id || m._id || m.id || m.name || m;
                    return { value: name, text: m.voice_name || m.title || m.name || name };
                }).filter(function (m) { return m.value; });
                if (!models.length) throw new Error('未找到模型');
                return idbGet(MODEL_LIST_KEY).then(function (all) {
                    all = all || {};
                    all[c.selectId] = models;
                    return idbSet(MODEL_LIST_KEY, all).then(function () {
                        modelCache = models.slice();
                        renderModels(models, working.model || models[0].value);
                        working.model = modelEl.value;
                        flash('拉取成功 · ' + models.length + ' 个');
                    });
                });
            });
        }).catch(function (e) {
            flash('拉取失败：' + (e && e.message ? e.message : e));
        }).finally(function () {
            pullBtn.classList.remove('ab-spin');
        });
    }

    function flash(msg, el) {
        var target = el || statusEl;
        if (!target) return;
        target.textContent = msg;
        clearTimeout(flash._t);
        flash._t = setTimeout(function () {
            if (target.textContent === msg) target.textContent = '';
        }, 2600);
    }

    function broadcastReload() {
        try {
            var frames = document.querySelectorAll('iframe');
            for (var i = 0; i < frames.length; i++) {
                try { frames[i].contentWindow.postMessage({ type: 'nanoApiReload' }, '*'); } catch (e) {}
            }
        } catch (e) {}
    }

    // ============================================================
    // 美化 tab：切换预设 / 清空 / 还原初始 / 应用并保存
    // 与美化页共用 BeautifyAppDB(presets, settings) 与 localStorage 键
    // ============================================================
    var BEAUTY_DB = 'BeautifyAppDB';
    var beautyTemplatesReady = null;

    function openBeautyDB() {
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(BEAUTY_DB, 1);
                req.onupgradeneeded = function (e) {
                    var d = e.target.result;
                    if (!d.objectStoreNames.contains('presets')) d.createObjectStore('presets', { keyPath: 'id', autoIncrement: true });
                    if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function (e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }
    function bdbAllPresets() {
        return openBeautyDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var r = db.transaction('presets', 'readonly').objectStore('presets').getAll();
                    r.onsuccess = function () { resolve(r.result || []); try { db.close(); } catch (e) {} };
                    r.onerror = function () { resolve([]); try { db.close(); } catch (e) {} };
                } catch (e) { resolve([]); try { db.close(); } catch (e2) {} }
            });
        }).catch(function () { return []; });
    }
    function bdbSet(store, obj) {
        return openBeautyDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(store, 'readwrite');
                    tx.objectStore(store).put(obj);
                    tx.oncomplete = function () { resolve(); try { db.close(); } catch (e) {} };
                    tx.onerror = function () { resolve(); try { db.close(); } catch (e) {} };
                } catch (e) { resolve(); try { db.close(); } catch (e2) {} }
            });
        }).catch(function () {});
    }

    function ensureBeautyScripts() {
        if (beautyTemplatesReady) return beautyTemplatesReady;
        beautyTemplatesReady = new Promise(function (resolve) {
            var pending = 0, done = false;
            function finish() { if (!done && pending <= 0) { done = true; resolve(); } }
            function load(src) {
                pending++;
                var s = document.createElement('script');
                s.src = src; s.async = true;
                s.onload = function () { pending--; finish(); };
                s.onerror = function () { pending--; finish(); };
                (document.head || document.documentElement).appendChild(s);
            }
            var _r = window.NANO_ROOT || '';
            if (!window.NANO_GLOBAL_TEMPLATE) load(_r + 'js/nano-global-template.js');
            if (!window.NANO_CHAT_TEMPLATE) load(_r + 'js/nano-chat-template.js?v=20261004p');
            finish();
        });
        return beautyTemplatesReady;
    }
    function initialTemplate(cat) {
        return cat === 'global' ? (window.NANO_GLOBAL_TEMPLATE || '') : (window.NANO_CHAT_TEMPLATE || '');
    }

    function applyBeautify(cat, css) {
        try {
            localStorage.setItem('beautify_' + cat, css);
            localStorage.setItem('beautify_' + cat + '_v2', css);
            localStorage.setItem('beautify_' + cat + '_time', Date.now());
        } catch (e) {}
        try { if (window.__nanoAppearance) window.__nanoAppearance.applyMessage({ type: 'beautify:apply', target: cat, css: css }); } catch (e) {}
        try {
            var frames = document.querySelectorAll('iframe');
            for (var i = 0; i < frames.length; i++) {
                try { frames[i].contentWindow.postMessage({ type: 'beautify:apply', target: cat, css: css }, '*'); } catch (e) {}
            }
        } catch (e) {}
    }

    function loadBeautyPresets() {
        if (!beautyPresetEl) return;
        bdbAllPresets().then(function (items) {
            var list = (items || []).filter(function (x) { return x && x.category === beautyCat; });
            beautyPresetEl.innerHTML = '';
            if (!list.length) {
                var o0 = document.createElement('option');
                o0.value = ''; o0.textContent = '暂无' + (beautyCat === 'global' ? '全局' : '聊天') + '预设';
                beautyPresetEl.appendChild(o0);
                return;
            }
            var ph = document.createElement('option');
            ph.value = ''; ph.textContent = '切换预设…';
            beautyPresetEl.appendChild(ph);
            list.forEach(function (x) {
                var o = document.createElement('option');
                o.value = x.id; o.textContent = x.name || ('预设 ' + x.id);
                beautyPresetEl.appendChild(o);
            });
            // 回填上次选中的预设，避免「切换后返回又变回之前」的错觉
            var saved = '';
            try { saved = localStorage.getItem('nano_beauty_selected_' + beautyCat) || ''; } catch (e) {}
            if (saved && list.some(function (x) { return String(x.id) === String(saved); })) {
                beautyPresetEl.value = saved;
            }
        });
    }

    function setBeautyCat(cat) {
        beautyCat = cat;
        try { localStorage.setItem('nano_beauty_cat', cat); } catch (e) {}
        beautyPanel.querySelectorAll('.ab-bt-cat').forEach(function (b) {
            b.classList.toggle('ab-active', b.dataset.bt === cat);
        });
        var main = beautyPanel.querySelector('.ab-bt-main');
        var fw = beautyPanel.querySelector('.ab-bt-font-wrap');
        var isFont = (cat === 'font');
        if (main) main.style.display = isFont ? 'none' : '';
        if (fw) fw.style.display = isFont ? '' : 'none';
        if (isFont) loadFontPresets(); else loadBeautyPresets();
    }

    function onBeautyPreset(value) {
        var id = Number(value);
        if (!id) return;
        bdbAllPresets().then(function (items) {
            var found = (items || []).find(function (x) { return x.id === id && x.category === beautyCat; });
            if (!found) { flash('预设不存在，请重新选择', beautyStatusEl); return; }
            var css = found.code || '';
            applyBeautify(beautyCat, css);
            // 记住当前分类与选中的预设，重开悬浮球时回填，且保证「切换后一直生效」
            try { localStorage.setItem('nano_beauty_cat', beautyCat); } catch (e) {}
            try { localStorage.setItem('nano_beauty_selected_' + beautyCat, String(id)); } catch (e) {}
            // 同步美化页草稿，避免返回美化 App 时显示旧内容/初始模板
            try { localStorage.setItem('beautify_draft_' + beautyCat, JSON.stringify({ code: css, name: found.name || '', presetId: id })); } catch (e) {}
            bdbSet('settings', { key: 'applied_' + beautyCat, value: css }).then(function () {
                flash('已切换：' + (found.name || ''), beautyStatusEl);
            });
        });
    }

    // ===== 字体 tab：切换字体预设 / 还原系统字体 =====
    function loadFontPresets() {
        if (!beautyFontEl) return;
        bdbAllPresets().then(function (items) {
            var list = (items || []).filter(function (x) { return x && x.category === 'font' && x.font; });
            beautyFontEl.innerHTML = '';
            if (!list.length) {
                var o0 = document.createElement('option');
                o0.value = ''; o0.textContent = '暂无字体预设（去美化页保存）';
                beautyFontEl.appendChild(o0);
                return;
            }
            var ph = document.createElement('option');
            ph.value = ''; ph.textContent = '切换字体…';
            beautyFontEl.appendChild(ph);
            list.forEach(function (x) {
                var o = document.createElement('option');
                o.value = x.id; o.textContent = x.name || ('字体 ' + x.id);
                beautyFontEl.appendChild(o);
            });
        });
    }
    function broadcastFont(cfg) {
        try { if (window.__nanoAppearance) window.__nanoAppearance.applyMessage({ type: 'beautify:font', cfg: cfg }); } catch (e) {}
        var frames = document.querySelectorAll('iframe');
        for (var i = 0; i < frames.length; i++) {
            try { frames[i].contentWindow.postMessage({ type: 'beautify:font', cfg: cfg }, '*'); } catch (e) {}
        }
    }
    function onFontPreset(value) {
        var id = Number(value);
        if (!id) return;
        bdbAllPresets().then(function (items) {
            var found = (items || []).find(function (x) { return x.id === id && x.category === 'font'; });
            if (!found || !found.font) { flash('字体预设不存在', beautyStatusEl); return; }
            var fs = found.font;
            // 必须带上 cssFamily / cssText：Google Fonts / @font-face CSS 预设在美化页里
            // 是「字体族名 + CSS」，只把 source(url) 当字体文件地址传过去会加载失败 → 字体不切换。
            var cfg = {
                family: 'NanoBeautifyFont',
                name: fs.name || found.name || '',
                source: fs.source || '',
                type: fs.type || '',
                size: fs.size || 16,
                format: fs.format || '',
                cssFamily: fs.cssFamily || '',
                cssText: fs.cssText || ''
            };
            var p;
            if (fs.type === 'url' && (fs.source || fs.cssText)) {
                try { localStorage.setItem('beautify_font', JSON.stringify(cfg)); } catch (e) {}
                p = bdbSet('settings', { key: 'appliedFont', value: fs }).then(function () {
                    broadcastFont(cfg);
                });
            } else {
                // 文件字体体积大，走 IndexedDB；先清掉旧的 URL 字体配置，
                // 否则 readFontCfgSync 会一直用旧配置覆盖 IDB 里的文件字体。
                try { localStorage.removeItem('beautify_font'); } catch (e) {}
                p = bdbSet('settings', { key: 'appliedFont', value: fs }).then(function () {
                    var frames = document.querySelectorAll('iframe');
                    for (var i = 0; i < frames.length; i++) {
                        try { frames[i].contentWindow.postMessage({ type: 'beautify:refresh' }, '*'); } catch (e) {}
                    }
                    try { if (window.__nanoAppearance) window.__nanoAppearance.applySaved(); } catch (e) {}
                });
            }
            p.then(function () {
                flash('已切换字体：' + (found.name || ''), beautyStatusEl);
            });
        });
    }
    function doFontRestore() {
        try {
            localStorage.removeItem('beautify_font');
            localStorage.removeItem('beautify_font_pending');
            localStorage.removeItem('nano_beautify_font');
        } catch (e) {}
        bdbSet('settings', { key: 'appliedFont', value: null });
        if (beautyFontEl) beautyFontEl.value = '';
        broadcastFont(null);
        flash('已还原系统字体', beautyStatusEl);
    }

    function doBeautyClear() {
        applyBeautify(beautyCat, '');
        if (beautyCat === 'chat') {
            try {
                localStorage.removeItem('beautify_chat_avatar');
                localStorage.removeItem('beautify_chat_avatar_cfg');
                localStorage.removeItem('nano_avatar_frame');
            } catch (e) {}
            try {
                var frames = document.querySelectorAll('iframe');
                for (var i = 0; i < frames.length; i++) {
                    try { frames[i].contentWindow.postMessage({ type: 'beautify:apply', target: 'chat-avatar', css: '' }, '*'); } catch (e) {}
                }
            } catch (e) {}
        }
        bdbSet('settings', { key: 'applied_' + beautyCat, value: '' }).then(function () {
            flash('已清空' + (beautyCat === 'global' ? '全局' : '聊天') + '美化', beautyStatusEl);
        });
    }

    function doBeautyRestore() {
        ensureBeautyScripts().then(function () {
            var tpl = initialTemplate(beautyCat);
            if (!tpl) { flash('初始模板加载失败', beautyStatusEl); return; }
            applyBeautify(beautyCat, tpl);
            bdbSet('settings', { key: 'applied_' + beautyCat, value: tpl }).then(function () {
                flash('已还原初始', beautyStatusEl);
            });
        });
    }

    function doBeautySave() {
        var id = Number(beautyPresetEl && beautyPresetEl.value) || 0;
        try { localStorage.setItem('nano_beauty_cat', beautyCat); } catch (e) {}
        if (id) { try { localStorage.setItem('nano_beauty_selected_' + beautyCat, String(id)); } catch (e) {} }
        var p;
        if (id) {
            p = bdbAllPresets().then(function (items) {
                var found = (items || []).find(function (x) { return x.id === id && x.category === beautyCat; });
                var css = found ? (found.code || '') : (localStorage.getItem('beautify_' + beautyCat + '_v2') || '');
                applyBeautify(beautyCat, css);
                return bdbSet('settings', { key: 'applied_' + beautyCat, value: css });
            });
        } else {
            var css2 = localStorage.getItem('beautify_' + beautyCat + '_v2') || '';
            applyBeautify(beautyCat, css2);
            p = bdbSet('settings', { key: 'applied_' + beautyCat, value: css2 });
        }
        p.then(function () { flash('已保存', beautyStatusEl); });
    }

    window.ApiBall = {
        isTopLevel: true,
        getSettings: loadSettings,
        apply: function (patch) {
            settings = persistSettings(patch || {});
            applySettings(settings);
            if (settings.enabled === false) { closePanel(panel); closePanel(beautyPanel); closeRing(); }
        },
        open: openApiPanel,
        close: function () { closePanel(panel); closePanel(beautyPanel); },
        openRing: openRing
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
