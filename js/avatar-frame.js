/* avatar-frame.js — 头像框：URL 粘贴 + 预设 + 头像大小 / 框大小 / 方圆（线下 / 聊天 / 心声 共用）
   存储：avatar_frame_offline / avatar_frame_chat / avatar_frame_heart（URL 字符串）
        avatar_frame_size_<scope>（框大小%，线下默认 130，其余 140）
        avatar_frame_radius_<scope>（方圆%，默认 50＝圆形）
        avatar_frame_avatarsize_<scope>（头像大小 px，遵循各页代码默认值）
   头像大小默认值取自各页代码：线下 46 / 聊天 38 / 心声 72（--iv-avatar-size）
   预设：avatar_frame_presets = [{name, url}]
   用法：NanoAvatarFrame.openUI('offline'|'chat'|'heart') */
(function () {
    'use strict';
    var KEYS = { offline: 'avatar_frame_offline', chat: 'avatar_frame_chat', heart: 'avatar_frame_heart' };
    var SIZE_KEYS = { offline: 'avatar_frame_size_offline', chat: 'avatar_frame_size_chat', heart: 'avatar_frame_size_heart' };
    var RADIUS_KEYS = { offline: 'avatar_frame_radius_offline', chat: 'avatar_frame_radius_chat', heart: 'avatar_frame_radius_heart' };
    var AVATAR_KEYS = { offline: 'avatar_frame_avatarsize_offline', chat: 'avatar_frame_avatarsize_chat', heart: 'avatar_frame_avatarsize_heart' };
    var PRESET_KEY = 'avatar_frame_presets';

    var SVG_SAVE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>';
    var SVG_TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function get(scope) { try { return localStorage.getItem(KEYS[scope]) || ''; } catch (e) { return ''; } }
    function set(scope, url) { try { if (url) localStorage.setItem(KEYS[scope], url); else localStorage.removeItem(KEYS[scope]); } catch (e) {} }
    function defSize(scope) { return scope === 'offline' ? 130 : 140; }
    function getSize(scope) { var v = 0; try { v = parseInt(localStorage.getItem(SIZE_KEYS[scope]) || '', 10); } catch (e) {} return (isFinite(v) && v > 0) ? v : defSize(scope); }
    function setSize(scope, v) { try { localStorage.setItem(SIZE_KEYS[scope], String(v)); } catch (e) {} }
    function getRadius(scope) { var v = -1; try { v = parseInt(localStorage.getItem(RADIUS_KEYS[scope]) || '', 10); } catch (e) {} return (isFinite(v) && v >= 0 && v <= 50) ? v : 50; }
    function setRadius(scope, v) { try { localStorage.setItem(RADIUS_KEYS[scope], String(v)); } catch (e) {} }
    // 各页代码里的头像默认尺寸（改这里前先看 css/offline.css、css/chat-inner.css、css/heart.css）
    function defAvatar(scope) { return scope === 'offline' ? 46 : (scope === 'chat' ? 38 : 72); }
    function avatarRange(scope) { return scope === 'heart' ? { min: 32, max: 140 } : (scope === 'offline' ? { min: 28, max: 96 } : { min: 24, max: 88 }); }
    function getAvatarSize(scope) { var v = 0; try { v = parseInt(localStorage.getItem(AVATAR_KEYS[scope]) || '', 10); } catch (e) {} return (isFinite(v) && v > 0) ? v : defAvatar(scope); }
    function setAvatarSize(scope, v) { try { localStorage.setItem(AVATAR_KEYS[scope], String(v)); } catch (e) {} }
    function getPresets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]') || []; } catch (e) { return []; } }
    function savePresets(list) { try { localStorage.setItem(PRESET_KEY, JSON.stringify((list || []).slice(-60))); } catch (e) {} }

    function selectors(scope) {
        if (scope === 'offline') return ['.identity-row .avatar'];
        if (scope === 'chat') return ['.message-avatar'];
        if (scope === 'heart') return ['.nano-voice-modal .iv-avatar', '.iv-avatar'];
        return [];
    }

    // 头像框始终以头像为中心自适应：left/top 50% + translate(-50%,-50%)，宽高 = 头像尺寸 * 缩放
    // 方圆/大小都用「无 !important」写入，且本样式插在美化 CSS 之前 → 美化写了就按美化。
    function buildCss(scope, url, sizePct, radiusPct, avatarPx) {
        var sels = selectors(scope);
        if (!sels.length) return '';
        url = String(url || '').trim();
        var r = (isFinite(radiusPct) && radiusPct >= 0) ? radiusPct : getRadius(scope);
        var aPx = (isFinite(avatarPx) && avatarPx > 0) ? avatarPx : getAvatarSize(scope);
        var needFrame = !!url;
        var needRadius = r !== 50;
        var needAvatar = Math.abs(aPx - defAvatar(scope)) >= 0.5;
        if (!needFrame && !needRadius && !needAvatar) return '';   // 默认状态：不注入，完全交给页面/美化
        var base = sels.join(',');
        var imgs = sels.map(function (s) { return s + ' img'; }).join(',');
        var css = '';
        // 「头像」大小：只改头像本身
        if (needAvatar) {
            if (scope === 'heart') css += '.nano-voice-modal{--iv-avatar-size:' + aPx + 'px !important}';
            else css += base + '{width:' + aPx + 'px!important;height:' + aPx + 'px!important}';
        }
        // 「方圆」：只让头像本身变方/变圆（连图片一起），头像框不受影响
        if (needRadius) {
            if (scope === 'heart') css += '.nano-voice-modal{--iv-avatar-radius:' + r + '% !important}';
            css += base + '{border-radius:' + r + '%!important;overflow:hidden}';
        }
        css += base + '{position:relative}';
        // 头像图片始终铺满并继承头像的方圆（否则图片自带的 50% 会盖住方角 / 固定尺寸会让大小调节失效）
        if (needRadius || needAvatar) css += imgs + '{width:100%!important;height:100%!important;border-radius:inherit!important}';
        // 「框大小」：只改头像框（PNG 叠加层）的大小
        if (needFrame) {
            var u = JSON.stringify(url);
            var pct = (isFinite(sizePct) && sizePct > 0) ? sizePct : getSize(scope);
            var scale = (pct / 100).toFixed(3);
            var common = 'content:"";position:absolute;left:50%;top:50%;width:calc(100% * ' + scale + ');height:calc(100% * ' + scale + ');transform:translate(-50%,-50%);pointer-events:none;background-image:url(' + u + ');background-size:contain;background-repeat:no-repeat;background-position:center;';
            css += base + '{overflow:visible!important}';
            css += sels.map(function (s) { return s + '::after'; }).join(',') + '{' + common + '}';
        }
        return css;
    }
    function apply(scope) {
        try {
            var id = 'nano-frame-' + scope;
            var tag = document.getElementById(id);
            var css = buildCss(scope, get(scope), getSize(scope), getRadius(scope), getAvatarSize(scope));
            if (!css) { if (tag) tag.textContent = ''; return; }
            if (!tag) { tag = document.createElement('style'); tag.id = id; document.head.appendChild(tag); }
            tag.textContent = css;
        } catch (e) {}
    }
    function applyAllForPage() {
        var p = '';
        try { p = location.pathname || ''; } catch (e) {}
        if (/offline\.html$/i.test(p)) apply('offline');
        if (/chat_inner\.html$/i.test(p)) { apply('chat'); apply('heart'); }
        if (/groups\.html$/i.test(p)) apply('chat');
    }

    function findAvatarSrc(scope) {
        try {
            var img = null;
            if (scope === 'offline') img = document.querySelector('.identity-row .avatar img') || document.getElementById('composerAvatarImg');
            else if (scope === 'heart') img = document.querySelector('.nano-voice-modal .iv-avatar img') || document.getElementById('ivAvatar');
            else if (scope === 'chat') img = document.querySelector('.message-avatar img');
            if (!img || !img.src) {
                var f = document.getElementById('cssPreviewFrame');
                if (f && f.contentDocument) img = f.contentDocument.querySelector('.identity-row .avatar img') || f.contentDocument.getElementById('composerAvatarImg');
            }
            if (img && img.src) return img.src;
        } catch (e) {}
        return '';
    }

    function toast(msg) {
        try {
            var t = document.getElementById('nafToast');
            if (!t) {
                t = document.createElement('div'); t.id = 'nafToast';
                t.style.cssText = 'position:fixed;left:50%;bottom:52px;transform:translateX(-50%);background:rgba(20,20,20,.9);color:#fff;padding:9px 16px;border-radius:999px;font-size:13px;z-index:2147483001;opacity:0;transition:opacity .2s;pointer-events:none';
                document.body.appendChild(t);
            }
            t.textContent = msg; t.style.opacity = '1';
            clearTimeout(t._tm); t._tm = setTimeout(function () { t.style.opacity = '0'; }, 1600);
        } catch (e) {}
    }

    function ensureStyle() {
        if (document.getElementById('nafStyle')) return;
        var st = document.createElement('style'); st.id = 'nafStyle';
        st.textContent =
            '.naf-preview{position:relative;width:120px;height:120px;margin:6px auto 12px;display:flex;align-items:center;justify-content:center}'
            + '.naf-av{width:72px;height:72px;overflow:hidden;background:#f0f0f3;display:flex;align-items:center;justify-content:center;border:1px solid #e3e3e8}'
            + '.naf-av img{width:100%;height:100%;object-fit:cover;display:block}'
            + '.naf-fb{font-size:26px;color:#8e8e93;font-weight:600}'
            + '.naf-frame{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background-size:contain;background-repeat:no-repeat;background-position:center;pointer-events:none}'
            + '.naf-input{display:flex;gap:8px;align-items:center}'
            + '.naf-icon{width:42px;height:42px;flex:none;border:0;border-radius:10px;background:#ff4d94;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}'
            + '.naf-icon.gray{background:#f2f2f7;color:#5a5a5f}'
            + '.naf-row{display:flex;gap:10px;align-items:center;margin-top:12px}'
            + '.naf-row label{font-size:12.5px;font-weight:600;color:#5a5a5f;flex:none;width:52px}'
            + '.naf-row input[type=range]{flex:1;min-width:0;-webkit-appearance:none;appearance:none;height:26px;background:transparent;cursor:pointer;margin:0}'
            + '.naf-row input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(90deg,#ffd3e4,#ff4d94)}'
            + '.naf-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;background:#fff;border:2px solid #ff4d94;box-shadow:0 2px 7px rgba(255,77,148,.35)}'
            + '.naf-row input[type=range]::-moz-range-track{height:6px;border-radius:999px;background:linear-gradient(90deg,#ffd3e4,#ff4d94)}'
            + '.naf-row input[type=range]::-moz-range-thumb{width:20px;height:20px;border:2px solid #ff4d94;border-radius:50%;background:#fff}'
            + '.naf-row .val{font-size:12px;font-weight:600;color:#ff4d94;width:48px;text-align:right;font-variant-numeric:tabular-nums}'
            + '.naf-sec{font-size:11px;font-weight:700;color:#b9b9bf;letter-spacing:.06em;margin:14px 2px 2px;text-transform:uppercase}';
        document.head.appendChild(st);
    }

    function openUI(scope) {
        var label = { offline: '线下', chat: '聊天', heart: '心声' }[scope] || scope;
        var old = document.getElementById('nafModal'); if (old) old.remove();
        ensureStyle();
        var ov = document.createElement('div');
        ov.id = 'nafModal';
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px';
        function render() {
            var presets = getPresets();
            var avRange = avatarRange(scope);
            var avNow = getAvatarSize(scope);
            ov.innerHTML = '<div style="width:100%;max-width:380px;background:#fff;border-radius:20px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.25);max-height:92vh;overflow:auto">'
                + '<div style="font-size:16px;font-weight:700;margin-bottom:2px">头像框 · ' + label + '</div>'
                + '<div class="naf-preview"><div class="naf-av" id="nafPrevAv"><img id="nafPrevImg" alt=""><span class="naf-fb" id="nafPrevFb">' + esc(label.charAt(0)) + '</span></div><div class="naf-frame" id="nafPrevFrame"></div></div>'
                + '<div class="naf-input"><input id="nafUrl" placeholder="粘贴扣好的透明 PNG 链接" style="flex:1;min-width:0;height:42px;border:1px solid #e6e6ea;border-radius:12px;padding:0 12px;font-size:14px;box-sizing:border-box;background:#fafafb;outline:none" value="' + esc(get(scope)) + '">'
                + '<button class="naf-icon" id="nafSave" title="存为预设">' + SVG_SAVE + '</button></div>'
                + '<div class="naf-row"><select id="nafPreset" style="flex:1;min-width:0;height:40px;border:1px solid #e6e6ea;border-radius:12px;padding:0 8px;font-size:13px;background:#fafafb"><option value="">选择预设…</option>'
                + presets.map(function (p, i) { return '<option value="' + i + '">' + esc(p.name || ('预设' + (i + 1))) + '</option>'; }).join('')
                + '</select><button class="naf-icon gray" id="nafDel" title="删除预设">' + SVG_TRASH + '</button></div>'
                + '<div class="naf-sec">调节</div>'
                + '<div class="naf-row"><label>头像大小</label><input id="nafAvSize" type="range" min="' + avRange.min + '" max="' + avRange.max + '" step="1" value="' + avNow + '"><span class="val" id="nafAvSizeVal">' + avNow + 'px</span></div>'
                + '<div class="naf-row"><label>框大小</label><input id="nafSize" type="range" min="60" max="220" step="5" value="' + getSize(scope) + '"><span class="val" id="nafSizeVal">' + getSize(scope) + '%</span></div>'
                + '<div class="naf-row"><label>头像方圆</label><input id="nafRadius" type="range" min="0" max="50" step="1" value="' + getRadius(scope) + '"><span class="val" id="nafRadiusVal">' + getRadius(scope) + '%</span></div>'
                + '<div style="display:flex;gap:10px;margin-top:16px">'
                + '<button id="nafClear" style="flex:1;height:44px;border:0;border-radius:12px;background:#f2f2f7;font-size:14px;font-weight:600;cursor:pointer">清除</button>'
                + '<button id="nafApply" style="flex:1;height:44px;border:0;border-radius:12px;background:linear-gradient(135deg,#ff6aa8,#ff4d94);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 8px 18px rgba(255,77,148,.28)">应用</button></div>'
                + '<button id="nafClose" style="width:100%;margin-top:8px;height:36px;border:0;background:transparent;color:#8e8e93;font-size:13px;cursor:pointer">关闭</button>'
                + '</div>';
            var src = findAvatarSrc(scope);
            var img = ov.querySelector('#nafPrevImg');
            if (src) { img.src = src; img.style.display = 'block'; ov.querySelector('#nafPrevFb').style.display = 'none'; }
            else { img.style.display = 'none'; }
            function updatePreview() {
                var av = parseInt(ov.querySelector('#nafAvSize').value, 10) || defAvatar(scope);
                var s = parseInt(ov.querySelector('#nafSize').value, 10) || defSize(scope);
                var r = parseInt(ov.querySelector('#nafRadius').value, 10);
                var u = (ov.querySelector('#nafUrl').value || '').trim();
                // 预览头像按「当前头像尺寸 / 代码默认尺寸」等比缩放
                var pvAv = Math.max(20, Math.min(96, Math.round(72 * (av / defAvatar(scope)))));
                var prevAv = ov.querySelector('#nafPrevAv');
                prevAv.style.width = pvAv + 'px';
                prevAv.style.height = pvAv + 'px';
                prevAv.style.borderRadius = r + '%';
                var fr = ov.querySelector('#nafPrevFrame');
                if (u) { var side = Math.round(pvAv * (s / 100)); fr.style.width = side + 'px'; fr.style.height = side + 'px'; fr.style.backgroundImage = 'url(' + JSON.stringify(u) + ')'; }
                else { fr.style.backgroundImage = 'none'; fr.style.width = '0px'; fr.style.height = '0px'; }
            }
            ov.querySelector('#nafAvSize').oninput = function () { ov.querySelector('#nafAvSizeVal').textContent = this.value + 'px'; updatePreview(); };
            ov.querySelector('#nafSize').oninput = function () { ov.querySelector('#nafSizeVal').textContent = this.value + '%'; updatePreview(); };
            ov.querySelector('#nafRadius').oninput = function () { ov.querySelector('#nafRadiusVal').textContent = this.value + '%'; updatePreview(); };
            ov.querySelector('#nafUrl').oninput = updatePreview;
            ov.querySelector('#nafPreset').onchange = function () { var p = getPresets()[parseInt(this.value, 10)]; if (p) { ov.querySelector('#nafUrl').value = p.url || ''; updatePreview(); } };
            ov.querySelector('#nafApply').onclick = function () {
                set(scope, ov.querySelector('#nafUrl').value.trim());
                setSize(scope, parseInt(ov.querySelector('#nafSize').value, 10));
                setRadius(scope, parseInt(ov.querySelector('#nafRadius').value, 10));
                setAvatarSize(scope, parseInt(ov.querySelector('#nafAvSize').value, 10));
                apply(scope);
                try { applyToPreview(); } catch (e) {}
                toast('已应用头像框');
            };
            ov.querySelector('#nafClear').onclick = function () {
                // 只清除头像框（PNG），头像大小 / 方圆保持不变
                ov.querySelector('#nafUrl').value = '';
                set(scope, '');
                apply(scope);
                try { applyToPreview(); } catch (e) {}
                updatePreview();
                toast('已清除头像框');
            };
            ov.querySelector('#nafSave').onclick = function () {
                var url = ov.querySelector('#nafUrl').value.trim();
                if (!url) { toast('先粘贴一个链接'); return; }
                var name = window.prompt('给这个头像框起个名字', '头像框 ' + (getPresets().length + 1));
                if (name == null) return;
                var list = getPresets(); list.push({ name: String(name || '').trim() || ('头像框 ' + (list.length + 1)), url: url }); savePresets(list);
                render(); toast('已保存预设');
            };
            ov.querySelector('#nafDel').onclick = function () {
                var idx = parseInt(ov.querySelector('#nafPreset').value, 10);
                if (isNaN(idx)) { toast('先选一个预设'); return; }
                var list = getPresets(); list.splice(idx, 1); savePresets(list);
                render(); toast('已删除预设');
            };
            ov.querySelector('#nafClose').onclick = function () { ov.remove(); };
            updatePreview();
        }
        render();
        ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
    }

    // 若在设置页打开了线下预览 iframe，把头像框也同步过去
    function applyToPreview() {
        var f = document.getElementById('cssPreviewFrame');
        if (f && f.contentWindow) {
            try { f.contentWindow.postMessage({ type: 'offlinePreviewFrame', css: buildCss('offline', get('offline'), getSize('offline'), getRadius('offline'), getAvatarSize('offline')) }, '*'); } catch (e) {}
        }
    }

    window.NanoAvatarFrame = {
        get: get, set: set, buildCss: buildCss, apply: apply, applyAllForPage: applyAllForPage,
        getPresets: getPresets, getSize: getSize, getRadius: getRadius, getAvatarSize: getAvatarSize, openUI: openUI
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyAllForPage);
    else applyAllForPage();
})();
