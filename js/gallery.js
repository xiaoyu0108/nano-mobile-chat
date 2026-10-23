(function () {
    'use strict';

    var grid = document.getElementById('grid');
    var empty = document.getElementById('empty');
    var navTitle = document.getElementById('navTitle');
    var lightbox = document.getElementById('lightbox');
    var lbImg = document.getElementById('lbImg');
    var lbMeta = document.getElementById('lbMeta');
    var lbPrev = document.getElementById('lbPrev');
    var lbNext = document.getElementById('lbNext');
    var lbDownload = document.getElementById('lbDownload');
    var lbDelete = document.getElementById('lbDelete');
    var selectbar = document.getElementById('selectbar');
    var selectBtn = document.getElementById('selectBtn');
    var clearBtn = document.getElementById('clearBtn');
    var cleanEmojiBtn = document.getElementById('cleanEmoji');
    var selAll = document.getElementById('selAll');
    var selCount = document.getElementById('selCount');
    var selDelete = document.getElementById('selDelete');
    var selDone = document.getElementById('selDone');
    var dialog = document.getElementById('dialog');
    var dialogTitle = document.getElementById('dialogTitle');
    var dialogText = document.getElementById('dialogText');
    var dialogOk = document.getElementById('dialogOk');
    var dialogCancel = document.getElementById('dialogCancel');

    var items = [];
    var list = [];
    var src = 'all';
    var fromOffline = false;
    var selectionMode = false;
    var selected = {};
    var current = -1;
    var dialogResolve = null;
    var loadSeq = 0;
    var toastEl = document.getElementById('toast');
    var toastTimer = null;
    function toast(msg) {
        if (!toastEl) return;
        toastEl.textContent = String(msg || '');
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
    }
    try { fromOffline = new URLSearchParams(location.search).get('from') === 'offline'; } catch (e) {}
    if (fromOffline) src = '线下';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function selCountText() {
        return Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    }
    function updateSelectUI() {
        var n = selCountText();
        selCount.textContent = n ? ('已选 ' + n + ' 张') : '点图片选择';
        selDelete.disabled = n === 0;
        var allOn = list.length > 0 && list.every(function (x) { return selected[x.url]; });
        selAll.textContent = allOn ? '全不选' : '全选';
        navTitle.textContent = selectionMode ? '选择照片' : '图库';
        selectBtn.textContent = selectionMode ? '取消' : '选择';
        selectBtn.classList.toggle('on', selectionMode);
    }
    function setSelectionMode(on) {
        selectionMode = !!on;
        if (!selectionMode) selected = {};
        document.body.classList.toggle('selection-mode', selectionMode);
        selectbar.hidden = !selectionMode;
        render();
    }
    function render() {
        list = items.filter(function (x) { return src === 'all' || x.source === src; });
        grid.innerHTML = list.map(function (x, i) {
            var who = x.charName || (x.source === '聊天' ? '未知角色' : '');
            var isSel = !!selected[x.url];
            return '<div class="cell' + (isSel ? ' sel' : '') + '" data-i="' + i + '">' +
                '<img loading="lazy" src="' + esc(x.url) + '" alt="">' +
                '<div class="tag">' + (who ? '<b>' + esc(who) + '</b>' : '') + '<span>' + esc(x.source || '') + '</span></div>' +
                '<div class="check">✓</div></div>';
        }).join('');
        empty.classList.toggle('show', !list.length);
        clearBtn.disabled = !items.length;
        updateSelectUI();
        Array.prototype.forEach.call(grid.querySelectorAll('.cell'), function (el) {
            el.addEventListener('click', function () {
                var x = list[Number(el.dataset.i)];
                if (!x) return;
                if (selectionMode) {
                    if (selected[x.url]) delete selected[x.url];
                    else selected[x.url] = true;
                    el.classList.toggle('sel', !!selected[x.url]);
                    updateSelectUI();
                    return;
                }
                openLightbox(Number(el.dataset.i));
            });
        });
    }
    function openLightbox(index) {
        if (index < 0 || index >= list.length) return;
        current = index;
        var x = list[index];
        lbImg.classList.remove('zoom');
        lbImg.src = x.url;
        lbMeta.textContent = [x.source || '', x.charName || '', x.prompt || ''].filter(Boolean).join(' · ') || '图片';
        lbPrev.disabled = index <= 0;
        lbNext.disabled = index >= list.length - 1;
        lightbox.hidden = false;
    }
    function closeLightbox() {
        lightbox.hidden = true;
        lbImg.classList.remove('zoom');
        lbImg.removeAttribute('src');
        current = -1;
    }
    function stepLightbox(delta) {
        var next = current + delta;
        if (next < 0 || next >= list.length) return;
        openLightbox(next);
    }
    function downloadName(x) {
        var ext = /^data:image\/(\w+)/.exec(x.url);
        var e = ext ? (ext[1] === 'jpeg' ? 'jpg' : ext[1]) : 'png';
        return 'nano-gallery-' + Date.now() + '.' + e;
    }
    function downloadCurrent() {
        var x = list[current];
        if (!x) return;
        var name = downloadName(x);
        var url = x.url;
        function saveBlob(blob) {
            var obj = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = obj;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(obj); }, 1500);
        }
        if (/^data:/i.test(url)) {
            try {
                var parts = url.split(',');
                var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/png';
                var bin = atob(parts[1] || '');
                var arr = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                saveBlob(new Blob([arr], { type: mime }));
                return;
            } catch (e) {}
        }
        fetch(url, { mode: 'cors' }).then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.blob();
        }).then(saveBlob).catch(function () {
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.target = '_blank';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }
    function ask(title, text, okText) {
        dialogTitle.textContent = title || '确认';
        dialogText.textContent = text || '';
        dialogOk.textContent = okText || '删除';
        dialog.hidden = false;
        return new Promise(function (resolve) { dialogResolve = resolve; });
    }
    function closeAsk(result) {
        dialog.hidden = true;
        if (dialogResolve) { dialogResolve(result); dialogResolve = null; }
    }
    function removeFromLocal(urls) {
        var set = {};
        (Array.isArray(urls) ? urls : [urls]).forEach(function (u) { set[u] = 1; });
        items = items.filter(function (x) { return !set[x.url]; });
        Object.keys(set).forEach(function (u) { delete selected[u]; });
        render();
    }
    function deleteUrls(urls) {
        if (window.NanoGallery && NanoGallery.remove) NanoGallery.remove(urls);
        removeFromLocal(urls);
        toast('已从图库移除 ' + urls.length + ' 张');
    }
    function deleteCurrent() {
        var x = list[current];
        if (!x) return;
        ask('删除这张照片？', '只会从图库移除，不会删除聊天里的原图。', '删除').then(function (ok) {
            if (!ok) return;
            var wasIndex = current;
            deleteUrls([x.url]);
            if (!list.length) closeLightbox();
            else openLightbox(Math.min(wasIndex, list.length - 1));
        });
    }
    function load() {
        var seq = ++loadSeq;
        var fn = window.NanoGallery ? (window.NanoGallery.allAsync || window.NanoGallery.all) : null;
        if (!fn) { items = []; render(); return; }
        Promise.resolve(fn.call(window.NanoGallery)).then(function (result) {
            if (seq !== loadSeq) return;
            items = Array.isArray(result) ? result : [];
            render();
            try {
                var purged = Number(localStorage.getItem('nano_gallery_purged_count') || 0);
                if (purged > 0) {
                    localStorage.removeItem('nano_gallery_purged_count');
                    setTimeout(function () { toast('已清理 ' + purged + ' 张旧表情包'); }, 260);
                }
            } catch (e) {}
            if (!lightbox.hidden) {
                if (!list.length) closeLightbox();
                else if (current >= list.length) openLightbox(list.length - 1);
                else openLightbox(current);
            }
        }).catch(function () { if (seq !== loadSeq) return; items = []; render(); });
    }

    document.querySelectorAll('.filter').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.src === src);
        btn.addEventListener('click', function () {
            src = btn.dataset.src || 'all';
            document.querySelectorAll('.filter').forEach(function (b) { b.classList.toggle('active', b === btn); });
            render();
        });
    });
    selectBtn.addEventListener('click', function () {
        if (selectionMode) { setSelectionMode(false); return; }
        setSelectionMode(true);
    });
    selDone.addEventListener('click', function () { setSelectionMode(false); });
    selAll.addEventListener('click', function () {
        var allOn = list.length > 0 && list.every(function (x) { return selected[x.url]; });
        if (allOn) list.forEach(function (x) { delete selected[x.url]; });
        else list.forEach(function (x) { selected[x.url] = true; });
        render();
    });
    selDelete.addEventListener('click', function () {
        var urls = list.filter(function (x) { return selected[x.url]; }).map(function (x) { return x.url; });
        if (!urls.length) return;
        ask('删除选中的 ' + urls.length + ' 张照片？', '只会从图库移除，不会删除聊天里的原图。', '删除').then(function (ok) {
            if (!ok) return;
            deleteUrls(urls);
            if (!selectionMode) return;
            setSelectionMode(false);
        });
    });
    clearBtn.addEventListener('click', function () {
        if (!items.length) return;
        ask('清空整个图库？', '将移除图库里的全部 ' + items.length + ' 张照片。聊天、Ins、朋友圈里的原图不受影响。', '全部清空').then(function (ok) {
            if (!ok) return;
            if (window.NanoGallery) {
                var allUrls = items.map(function (x) { return x.url; });
                if (NanoGallery.remove) NanoGallery.remove(allUrls);
                if (NanoGallery.clear) NanoGallery.clear();
            }
            toast('图库已清空');
            items = [];
            selected = {};
            closeLightbox();
            setSelectionMode(false);
            render();
        });
    });
    if (cleanEmojiBtn) cleanEmojiBtn.addEventListener('click', function () {
        ask('清理表情包？', '会自动移除图库里被识别为表情包的图片，正常照片不受影响。', '清理').then(function (ok) {
            if (!ok) return;
            var fn = window.NanoGallery && NanoGallery.removeEmoji;
            if (!fn) { toast('当前版本不支持'); return; }
            Promise.resolve(fn.call(NanoGallery)).then(function (n) {
                toast(n ? ('已清理 ' + n + ' 张表情包') : '没有找到表情包');
                load();
            }).catch(function () { toast('清理失败'); });
        });
    });
    document.getElementById('lbClose').addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
    lbImg.addEventListener('click', function (e) {
        e.stopPropagation();
        lbImg.classList.toggle('zoom');
    });
    var touchX = 0, touchY = 0;
    lightbox.addEventListener('touchstart', function (e) {
        if (!e.touches || !e.touches[0]) return;
        touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
    }, { passive: true });
    lightbox.addEventListener('touchend', function (e) {
        if (!e.changedTouches || !e.changedTouches[0]) return;
        var dx = e.changedTouches[0].clientX - touchX;
        var dy = e.changedTouches[0].clientY - touchY;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) stepLightbox(dx > 0 ? -1 : 1);
    }, { passive: true });
    lbPrev.addEventListener('click', function (e) { e.stopPropagation(); stepLightbox(-1); });
    lbNext.addEventListener('click', function (e) { e.stopPropagation(); stepLightbox(1); });
    lbDownload.addEventListener('click', function (e) { e.stopPropagation(); downloadCurrent(); });
    lbDelete.addEventListener('click', function (e) { e.stopPropagation(); deleteCurrent(); });
    dialogCancel.addEventListener('click', function () { closeAsk(false); });
    dialogOk.addEventListener('click', function () { closeAsk(true); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) closeAsk(false); });
    document.getElementById('refreshBtn').addEventListener('click', load);
    window.addEventListener('nano-gallery-updated', load);
    document.addEventListener('keydown', function (e) {
        if (!lightbox.hidden) {
            if (e.key === 'Escape') closeLightbox();
            else if (e.key === 'ArrowLeft') stepLightbox(-1);
            else if (e.key === 'ArrowRight') stepLightbox(1);
            return;
        }
        if (e.key === 'Escape' && selectionMode) setSelectionMode(false);
    });
    document.getElementById('backBtn').addEventListener('click', function () {
        if (dialogResolve) { closeAsk(false); return; }
        if (!lightbox.hidden) { closeLightbox(); return; }
        if (selectionMode) { setSelectionMode(false); return; }
        if (fromOffline) {
            try { window.parent.postMessage({ type: 'closeOfflineGallery' }, '*'); } catch (e) {}
            return;
        }
        if (window.parent !== window) window.parent.postMessage({ type: 'closeFullscreen' }, '*');
        else try { history.back(); } catch (e) { location.href = 'chat.html'; }
    });
    load();
})();
