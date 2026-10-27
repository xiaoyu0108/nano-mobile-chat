/* =========================================================
   云端备份（GitHub Gist / 自建 Cloudflare Worker + KV）
   - 依赖 backup.js 暴露的 collectAllData / importFromJson / 进度弹层
   - 令牌只保存在本机 localStorage，上传备份前会剔除令牌本身
   ========================================================= */
(function () {
    'use strict';

    var GH_KEY = 'nano_cloud_github';
    var CF_KEY = 'nano_cloud_cloudflare';
    var GH_API = 'https://api.github.com';
    var GH_FILE = 'nano-backup.json';
    var GH_TAG = 'Nano 云端备份';
    // Gist 超过 10MB 的文件无法通过 raw_url 直接下载（官方要求 clone），
    // 所以分片必须小于 10MB：这里用 8MB。应用层不再限制总大小；
    // 实际上限由 GitHub Gist（最多 300 个文件）和手机内存决定。
    var CHUNK_BYTES = 8 * 1024 * 1024;
    var PART_PREFIX = 'nano-backup-part-';
    function partName(i) {
        return PART_PREFIX + String(i + 1).padStart(3, '0') + '.txt';
    }

    function $(id) { return document.getElementById(id); }

    function readCfg(key) {
        try {
            var raw = localStorage.getItem(key);
            var v = raw ? JSON.parse(raw) : null;
            return v && typeof v === 'object' ? v : null;
        } catch (e) { return null; }
    }
    function writeCfg(key, v) {
        try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
    }
    function dropCfg(key) {
        try { localStorage.removeItem(key); } catch (e) {}
    }

    var toastEl = null;
    var toastTimer = null;
    function toast(msg, ms) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'cloud-toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = String(msg || '');
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2400);
    }

    function fmtSize(n) {
        n = Number(n) || 0;
        if (!n) return '大小未知';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(2) + ' MB';
    }
    function fmtTime(v) {
        try {
            var d = v instanceof Date ? v : new Date(v);
            if (isNaN(d.getTime())) return '';
            var p = function (x) { return String(x).padStart(2, '0'); };
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        } catch (e) { return ''; }
    }
    function stamp() {
        var d = new Date();
        var p = function (x) { return String(x).padStart(2, '0'); };
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    function normalizeUrl(v) {
        v = String(v || '').trim().replace(/\/+$/, '');
        if (!v) return '';
        if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
        return v;
    }

    function friendlyError(e, fallback) {
        var msg = String((e && e.message) || e || '');
        if (!msg) return fallback || '未知错误';
        if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return '网络连接失败，请检查网络或地址';
        return msg;
    }

    // ================= 压缩 =================
    async function gzipBytes(bytes) {
        if (typeof CompressionStream !== 'undefined') {
            try {
                var cs = new CompressionStream('gzip');
                var stream = new Blob([bytes]).stream().pipeThrough(cs);
                var ab = await new Response(stream).arrayBuffer();
                return { bytes: new Uint8Array(ab), gzip: true };
            } catch (e) {}
        }
        if (window.pako && typeof window.pako.gzip === 'function') {
            try { return { bytes: window.pako.gzip(bytes), gzip: true }; } catch (e) {}
        }
        return { bytes: bytes, gzip: false };
    }

    async function gunzipBytes(bytes) {
        if (!(bytes && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
        if (typeof DecompressionStream !== 'undefined') {
            try {
                var ds = new DecompressionStream('gzip');
                var stream = new Blob([bytes]).stream().pipeThrough(ds);
                var ab = await new Response(stream).arrayBuffer();
                return new Uint8Array(ab);
            } catch (e) {}
        }
        if (window.pako && typeof window.pako.ungzip === 'function') {
            try { return window.pako.ungzip(bytes); } catch (e) {}
        }
        throw new Error('当前浏览器无法解压这份备份，请升级系统后重试');
    }

    // ================= 打包 / 还原 =================
    function stripCloudSecrets(data) {
        [GH_KEY, CF_KEY].forEach(function (k) {
            try { if (data.localStorage) delete data.localStorage[k]; } catch (e) {}
            try { if (data.sessionStorage) delete data.sessionStorage[k]; } catch (e) {}
        });
        return data;
    }

    async function packBackup() {
        if (typeof collectAllData !== 'function') throw new Error('备份模块未加载，请刷新页面');
        setProgress(4, '读取数据库…');
        var data = await collectAllData({ binary: true });
        stripCloudSecrets(data);
        setProgress(38, '序列化数据…');
        var json = JSON.stringify(data);
        var raw = new TextEncoder().encode(json);
        setProgress(48, '压缩数据…');
        var gz = await gzipBytes(raw);
        return { jsonBytes: raw.length, bytes: gz.bytes, gzip: gz.gzip };
    }

    function keepLocalCloudCfg() {
        var out = {};
        [GH_KEY, CF_KEY].forEach(function (k) {
            try { out[k] = localStorage.getItem(k); } catch (e) { out[k] = null; }
        });
        return out;
    }
    function restoreLocalCloudCfg(saved) {
        Object.keys(saved || {}).forEach(function (k) {
            try {
                if (saved[k] == null) return;
                localStorage.setItem(k, saved[k]);
            } catch (e) {}
        });
    }

    async function restoreBackupData(data) {
        if (!data || (!data.indexedDB && !data.localStorage && !data.sessionStorage)) {
            throw new Error('备份内容无效');
        }
        var saved = keepLocalCloudCfg();
        showProgress('正在恢复云端备份');
        try {
            await importFromJson(data, function (text, pct) { setProgress(pct, text); });
            setProgress(100, '完成');
            setTimeout(function () {
                try { alert('恢复完成，页面将重新加载'); } catch (e) {}
                location.reload();
            }, 350);
        } finally {
            // importFromJson 会 clear() localStorage，失败时也要把云端令牌放回去
            restoreLocalCloudCfg(saved);
            setTimeout(hideProgress, 1000);
        }
    }

    // ================= GitHub =================
    var gh = {
        cfg: readCfg(GH_KEY),
        busy: false,
        items: []
    };

    function ghToken() { return gh.cfg && gh.cfg.token ? gh.cfg.token : ''; }

    async function ghRequest(path, opts, token) {
        token = token || ghToken();
        if (!token) throw new Error('请先填写 GitHub 令牌');
        var controller = null;
        var timer = null;
        var o = Object.assign({}, opts || {});
        try {
            if (typeof AbortController !== 'undefined') {
                controller = new AbortController();
                o.signal = controller.signal;
                timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, 90000);
            }
            o.headers = Object.assign({
                'Accept': 'application/vnd.github+json',
                'Authorization': 'Bearer ' + token,
                'X-GitHub-Api-Version': '2022-11-28'
            }, (opts && opts.headers) || {});
            o.cache = 'no-store';
            var res = await fetch(GH_API + path, o);
            var text = await res.text();
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
            if (!res.ok) {
                var msg = (data && (data.message || data.error)) || text || ('HTTP ' + res.status);
                if (res.status === 401) msg = '令牌无效或已过期';
                if (res.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub 请求太频繁，请稍后再试';
                if (res.status === 404) msg = '没找到对应的备份（可能已被删除）';
                throw new Error(msg);
            }
            return data;
        } catch (e) {
            if (e && e.name === 'AbortError') throw new Error('连接 GitHub 超时，请检查网络');
            throw e;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function updateGhUI() {
        var connected = !!ghToken();
        var badge = $('ghBadge');
        var status = $('ghStatus');
        if (badge) {
            badge.textContent = gh.busy ? '处理中…' : (connected ? '已连接' : '未配置');
            badge.classList.toggle('ok', connected && !gh.busy);
            badge.classList.toggle('busy', gh.busy);
        }
        if (status) {
            status.textContent = connected
                ? ('@' + (gh.cfg.login || '已保存') + ' · 备份保存为私有 Gist')
                : '未连接 · 备份会存成私有 Gist';
        }
        ['ghSave', 'ghDisconnect'].forEach(function (id) {
            var b = $(id); if (b) b.disabled = gh.busy;
        });
        ['ghUpload', 'ghRefresh'].forEach(function (id) {
            var b = $(id); if (b) b.disabled = gh.busy || !connected;
        });
    }

    function setGhBusy(on) {
        gh.busy = !!on;
        updateGhUI();
    }

    function clearNode(el) {
        while (el && el.firstChild) el.removeChild(el.firstChild);
    }

    function makeItem(title, meta, onRestore, onDelete, deletingText) {
        var row = document.createElement('div');
        row.className = 'cloud-item';
        var main = document.createElement('div');
        main.className = 'cloud-item-main';
        var t = document.createElement('div');
        t.className = 'cloud-item-title';
        t.textContent = title;
        var m = document.createElement('div');
        m.className = 'cloud-item-meta';
        m.textContent = meta;
        main.appendChild(t);
        main.appendChild(m);
        var acts = document.createElement('div');
        acts.className = 'cloud-item-actions';
        var rb = document.createElement('button');
        rb.type = 'button';
        rb.className = 'mini-btn';
        rb.textContent = '恢复';
        rb.addEventListener('click', onRestore);
        var db = document.createElement('button');
        db.type = 'button';
        db.className = 'mini-btn del';
        db.textContent = deletingText || '删除';
        db.addEventListener('click', onDelete);
        acts.appendChild(rb);
        acts.appendChild(db);
        row.appendChild(main);
        row.appendChild(acts);
        return row;
    }

    function renderGhList() {
        var box = $('ghList');
        if (!box) return;
        clearNode(box);
        if (!ghToken()) {
            var e0 = document.createElement('div');
            e0.className = 'cloud-empty';
            e0.textContent = '连接后显示你的备份';
            box.appendChild(e0);
            return;
        }
        if (!gh.items.length) {
            var e1 = document.createElement('div');
            e1.className = 'cloud-empty';
            e1.textContent = '还没有云端备份，点「上传备份」创建第一个';
            box.appendChild(e1);
            return;
        }
        gh.items.forEach(function (it) {
            var meta = fmtTime(it.updatedAt) + ' · ' + fmtSize(it.size);
            var row = makeItem(it.desc || 'Nano 云端备份', meta, function () {
                ghRestore(it);
            }, function () {
                ghDelete(it);
            });
            box.appendChild(row);
        });
    }

    async function ghLoadList(quiet) {
        if (!ghToken()) return;
        if (!quiet) toast('正在读取 GitHub 备份…');
        var gists = await ghRequest('/gists?per_page=100');
        var items = [];
        (Array.isArray(gists) ? gists : []).forEach(function (g) {
            if (!g || typeof g.description !== 'string') return;
            if (g.description.indexOf(GH_TAG) !== 0) return;
            var file = null;
            try {
                file = g.files && (g.files[GH_FILE] || g.files[Object.keys(g.files)[0]]);
            } catch (e) {}
            var total = (file && file.size) || 0;
            // 分片备份：清单本身很小，真实大小要把所有 part 加起来。
            try {
                Object.keys(g.files || {}).forEach(function (name) {
                    if (name.indexOf(PART_PREFIX) === 0) total += ((g.files[name] && g.files[name].size) || 0);
                });
            } catch (e) {}
            items.push({
                id: g.id,
                desc: g.description,
                updatedAt: g.updated_at || g.created_at,
                size: total
            });
        });
        items.sort(function (a, b) {
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
        gh.items = items;
        renderGhList();
    }

    async function ghConnect() {
        var token = ($('ghToken') && $('ghToken').value || '').trim();
        if (!token) { toast('请先粘贴 GitHub 令牌'); return; }
        setGhBusy(true);
        try {
            var user = await ghRequest('/user', {}, token);
            gh.cfg = { token: token, login: (user && user.login) || '' };
            writeCfg(GH_KEY, gh.cfg);
            if ($('ghToken')) $('ghToken').value = token;
            updateGhUI();
            toast('已连接 @' + (gh.cfg.login || 'GitHub'));
            try {
                await ghLoadList(true);
                if (!gh.items.length) toast('连接成功，点「上传备份」创建第一个备份');
            } catch (listErr) {
                toast('已连接，但读取备份列表失败：' + friendlyError(listErr), 4000);
            }
        } catch (e) {
            if ($('ghStatus')) $('ghStatus').textContent = '连接失败：' + friendlyError(e);
            toast('连接失败：' + friendlyError(e), 3600);
        } finally {
            setGhBusy(false);
        }
    }

    async function ghUpload(opts) {
        opts = opts || {};
        var isAuto = !!opts.auto;
        if (!ghToken()) { if (!isAuto) toast('请先连接 GitHub'); return false; }
        if (!isAuto && !confirm('将把本机全部数据压缩后上传到你的 GitHub（私有 Gist）。\n备份包含聊天记录和图片，继续？')) return false;
        setGhBusy(true);
        if (!isAuto) showProgress('正在上传到 GitHub');
        try {
            var pack = await packBackup();
            setProgress(58, '生成备份文件…');
            var b64 = await binaryToBase64(pack.bytes);
            var payload = JSON.stringify({
                format: 'nano-cloud-backup',
                version: 1,
                encoding: pack.gzip ? 'gzip+base64' : 'base64',
                createdAt: new Date().toISOString(),
                origin: location.origin,
                jsonBytes: pack.jsonBytes,
                data: b64
            });
            var chunks = [];
            for (var off = 0; off < payload.length; off += CHUNK_BYTES) {
                chunks.push(payload.slice(off, off + CHUNK_BYTES));
            }
            if (!chunks.length) chunks.push('');
            // GitHub 单个 Gist 最多返回 300 个文件；这是平台限制，不是应用限制。
            if (chunks.length > 290) {
                throw new Error('备份需要 ' + chunks.length + ' 个分片，超过 GitHub Gist 的 300 文件上限。请改用本地导出，或先清理部分聊天/图片数据。');
            }
            var manifest = {
                format: 'nano-cloud-backup-manifest',
                version: 2,
                complete: false,
                createdAt: new Date().toISOString(),
                origin: location.origin,
                jsonBytes: pack.jsonBytes,
                size: payload.length,
                parts: chunks.map(function (_, i) { return partName(i); })
            };
            setProgress(66, '创建备份（' + chunks.length + ' 个分片，共 ' + fmtSize(payload.length) + '）…');
            var created = null;
            try {
                created = await ghRequest('/gists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        description: GH_TAG + (isAuto ? ' · 自动' : '') + ' · ' + fmtTime(new Date()),
                        public: false,
                        files: (function () {
                            var f = {};
                            f[GH_FILE] = { content: JSON.stringify(manifest) };
                            return f;
                        })()
                    })
                });
                if (!created || !created.id) throw new Error('GitHub 没有返回 Gist ID');
                // 逐个 PATCH 分片：单个请求不会过大，失败时删除半成品 Gist。
                for (var i = 0; i < chunks.length; i++) {
                    var f = {};
                    f[partName(i)] = { content: chunks[i] };
                    await ghRequest('/gists/' + encodeURIComponent(created.id), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ files: f })
                    });
                    setProgress(66 + Math.round(30 * (i + 1) / chunks.length), '上传分片 ' + (i + 1) + '/' + chunks.length + '…');
                }
                // 所有分片成功后再把清单标记为完成；中途退出/失败时恢复端会明确提示备份不完整。
                manifest.complete = true;
                var doneFile = {};
                doneFile[GH_FILE] = { content: JSON.stringify(manifest) };
                await ghRequest('/gists/' + encodeURIComponent(created.id), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files: doneFile })
                });
            } catch (upErr) {
                if (created && created.id) {
                    try { await ghRequest('/gists/' + encodeURIComponent(created.id), { method: 'DELETE' }); } catch (e) {}
                }
                throw upErr;
            }
            setProgress(100, '上传完成');
            if (!isAuto) toast('已上传到 GitHub 私有 Gist（' + chunks.length + ' 个分片）');
            try {
                await ghLoadList(true);
                // 自动备份每次新建 Gist，再按设置的份数删除最旧的（0 = 不限制）。
                if (isAuto) await ghPruneAuto(auto.cfg.keep);
            } catch (listErr) {
                if (!isAuto) toast('上传成功，但刷新列表失败：' + friendlyError(listErr), 4000);
            }
            return true;
        } catch (e) {
            if (!isAuto) toast('上传失败：' + friendlyError(e), 4000);
            return false;
        } finally {
            setGhBusy(false);
            if (!isAuto) setTimeout(hideProgress, 800);
        }
    }

    async function ghPruneAuto(keep) {
        keep = Number(keep);
        if (!keep) return;   // 0 = 不限制，保留全部自动备份
        var autos = (gh.items || []).filter(function (x) {
            return x && /自动/.test(String(x.desc || ''));
        });
        autos.sort(function (a, b) {
            return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
        });
        for (var i = Math.max(0, keep); i < autos.length; i++) {
            try {
                await ghRequest('/gists/' + encodeURIComponent(autos[i].id), { method: 'DELETE' });
            } catch (e) {}
        }
    }

    async function fetchTextUrl(url) {
        // raw_url 本身带签名，直接取即可；不带 Authorization 可以少一次跨域预检。
        var res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('下载备份失败（HTTP ' + res.status + '）');
        return res.text();
    }
    async function readGistFile(file) {
        if (!file) return '';
        var text = typeof file.content === 'string' ? file.content : '';
        // GitHub 对大于 1MB 的文件只返回 truncated 标记，需要走 raw_url。
        if ((file.truncated || !text) && file.raw_url) text = await fetchTextUrl(file.raw_url);
        return text || '';
    }

    async function ghRestore(it) {
        if (!confirm('即将恢复「' + (it.desc || '云端备份') + '」。\n当前本机全部数据会被覆盖，且不可撤销。继续？')) return;
        setGhBusy(true);
        showProgress('正在下载 GitHub 备份');
        try {
            setProgress(12, '读取 Gist…');
            var g = await ghRequest('/gists/' + encodeURIComponent(it.id));
            var file = null;
            try { file = g.files && (g.files[GH_FILE] || g.files[Object.keys(g.files)[0]]); } catch (e) {}
            if (!file) throw new Error('这条 Gist 里没有备份文件');
            setProgress(24, '读取备份清单…');
            var content = await readGistFile(file);
            if (!content) throw new Error('备份内容为空');
            var wrap = JSON.parse(content);
            if (wrap && wrap.format === 'nano-cloud-backup-manifest') {
                if (wrap.complete === false) throw new Error('这条备份没有上传完成（缺少分片），请删除后重新备份');
                var names = Array.isArray(wrap.parts) ? wrap.parts : [];
                if (!names.length) throw new Error('备份清单里没有分片');
                var pieces = [];
                for (var pi = 0; pi < names.length; pi++) {
                    var pf = g.files && g.files[names[pi]];
                    if (!pf) throw new Error('缺少备份分片：' + names[pi]);
                    pieces.push(await readGistFile(pf));
                    setProgress(24 + Math.round(22 * (pi + 1) / names.length), '下载分片 ' + (pi + 1) + '/' + names.length + '…');
                }
                content = pieces.join('');
                if (!content) throw new Error('备份分片内容为空');
                wrap = JSON.parse(content);
            }
            setProgress(46, '解压备份…');
            var data = wrap;
            if (wrap && wrap.format === 'nano-cloud-backup') {
                var bytes = new Uint8Array(base64ToArrayBuffer(wrap.data || ''));
                if (wrap.encoding && wrap.encoding.indexOf('gzip') !== -1) bytes = await gunzipBytes(bytes);
                data = JSON.parse(new TextDecoder().decode(bytes));
            }
            await restoreBackupData(data);
        } catch (e) {
            toast('恢复失败：' + friendlyError(e), 4200);
            hideProgress();
        } finally {
            setGhBusy(false);
        }
    }

    async function ghDelete(it) {
        if (!confirm('删除云端备份「' + (it.desc || '') + '」？\n只删除 GitHub 上的这一条，本机数据不受影响。')) return;
        setGhBusy(true);
        try {
            await ghRequest('/gists/' + encodeURIComponent(it.id), { method: 'DELETE' });
            toast('已删除');
            try { await ghLoadList(true); } catch (listErr) { toast('已删除，但刷新列表失败：' + friendlyError(listErr), 4000); }
        } catch (e) {
            toast('删除失败：' + friendlyError(e), 3600);
        } finally {
            setGhBusy(false);
        }
    }

    function ghDisconnect() {
        if (!confirm('断开 GitHub 后，本机不再保存令牌（云端已有备份不会被删除）。继续？')) return;
        gh.cfg = null;
        gh.items = [];
        dropCfg(GH_KEY);
        if ($('ghToken')) $('ghToken').value = '';
        updateGhUI();
        renderGhList();
        toast('已断开 GitHub');
    }

    // ================= Cloudflare Worker =================
    var cf = {
        cfg: readCfg(CF_KEY),
        busy: false,
        items: []
    };

    function cfBase() {
        return cf.cfg && cf.cfg.url ? normalizeUrl(cf.cfg.url) : '';
    }
    function cfToken() {
        return cf.cfg && cf.cfg.token ? String(cf.cfg.token) : '';
    }

    async function cfJson(path, opts) {
        var base = cfBase();
        var token = cfToken();
        if (!base) throw new Error('请先填写 Worker 地址');
        if (!token) throw new Error('请先填写访问密码');
        var o = Object.assign({}, opts || {});
        o.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, (opts && opts.headers) || {});
        o.cache = 'no-store';
        var res = await fetch(base + path, o);
        var text = await res.text();
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok || (data && data.ok === false)) {
            var msg = (data && data.error) || text || ('HTTP ' + res.status);
            if (res.status === 401) msg = '密码错误';
            throw new Error(msg);
        }
        return data || {};
    }

    function updateCfUI() {
        var connected = !!(cfBase() && cfToken());
        var badge = $('cfBadge');
        var status = $('cfStatus');
        if (badge) {
            badge.textContent = cf.busy ? '处理中…' : (connected ? '已连接' : '未配置');
            badge.classList.toggle('ok', connected && !cf.busy);
            badge.classList.toggle('busy', cf.busy);
        }
        if (status) {
            status.textContent = connected
                ? (cfBase().replace(/^https?:\/\//, '') + ' · ' + (cf.cfg && cf.cfg.store === 'r2' ? 'R2（无 24MB 限制）' : (cf.cfg && cf.cfg.store === 'kv' ? 'KV（单个 24MB 上限）' : '数据在你的 Cloudflare 账号')))
                : '未连接 · 推荐绑定 R2，不再受 24MB 限制';
        }
        ['cfSave', 'cfDisconnect'].forEach(function (id) {
            var b = $(id); if (b) b.disabled = cf.busy;
        });
        ['cfUpload', 'cfRefresh'].forEach(function (id) {
            var b = $(id); if (b) b.disabled = cf.busy || !connected;
        });
    }

    function setCfBusy(on) {
        cf.busy = !!on;
        updateCfUI();
    }

    function renderCfList() {
        var box = $('cfList');
        if (!box) return;
        clearNode(box);
        var connected = !!(cfBase() && cfToken());
        if (!connected) {
            var e0 = document.createElement('div');
            e0.className = 'cloud-empty';
            e0.textContent = '连接后显示你的备份';
            box.appendChild(e0);
            return;
        }
        if (!cf.items.length) {
            var e1 = document.createElement('div');
            e1.className = 'cloud-empty';
            e1.textContent = '还没有云端备份，点「上传备份」创建第一个';
            box.appendChild(e1);
            return;
        }
        cf.items.forEach(function (it) {
            var when = it.uploadedAt || it.createdAt || '';
            var meta = (when ? fmtTime(when) : fmtTimeFromKey(it.name)) + ' · ' + fmtSize(it.size);
            var row = makeItem('Nano 云端备份', meta, function () {
                cfRestore(it);
            }, function () {
                cfDelete(it);
            });
            box.appendChild(row);
        });
    }

    function fmtTimeFromKey(name) {
        var m = String(name || '').match(/nano-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
        if (!m) return '';
        return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5];
    }

    async function cfLoadList(quiet) {
        if (!(cfBase() && cfToken())) return;
        if (!quiet) toast('正在读取 Cloudflare 备份…');
            var data = await cfJson('/list?prefix=nano-backup-');
            if (data.store) { cf.cfg.store = data.store; writeCfg(CF_KEY, cf.cfg); }
        var items = (Array.isArray(data.keys) ? data.keys : []).map(function (k) {
            var meta = k.metadata || {};
            return {
                name: k.name,
                size: meta.size || 0,
                uploadedAt: meta.uploadedAt || '',
                createdAt: meta.createdAt || ''
            };
        });
        items.sort(function (a, b) {
            return String(b.uploadedAt || b.createdAt || b.name).localeCompare(String(a.uploadedAt || a.createdAt || a.name));
        });
        cf.items = items;
        renderCfList();
    }

    async function cfConnect() {
        var url = normalizeUrl($('cfUrl') && $('cfUrl').value);
        var token = ($('cfToken') && $('cfToken').value || '').trim();
        if (!url) { toast('请先填写 Worker 地址'); return; }
        if (!token) { toast('请先填写访问密码'); return; }
        setCfBusy(true);
        try {
            var res = await fetch(url + '/list?prefix=nano-backup-', {
                headers: { 'Authorization': 'Bearer ' + token },
                cache: 'no-store'
            });
            var text = await res.text();
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
            if (!res.ok || !data || data.ok === false) {
                var msg = (data && data.error) || text || ('HTTP ' + res.status);
                if (res.status === 401) msg = '密码错误';
                throw new Error(msg);
            }
            cf.cfg = { url: url, token: token, store: data.store || '' };
            writeCfg(CF_KEY, cf.cfg);
            if ($('cfUrl')) $('cfUrl').value = url;
            updateCfUI();
            cf.items = (Array.isArray(data.keys) ? data.keys : []).map(function (k) {
                var meta = k.metadata || {};
                return { name: k.name, size: meta.size || 0, uploadedAt: meta.uploadedAt || '', createdAt: meta.createdAt || '' };
            }).sort(function (a, b) {
                return String(b.uploadedAt || b.createdAt || b.name).localeCompare(String(a.uploadedAt || a.createdAt || a.name));
            });
            renderCfList();
            toast('Cloudflare 连接成功');
        } catch (e) {
            if ($('cfStatus')) $('cfStatus').textContent = '连接失败：' + friendlyError(e);
            toast('连接失败：' + friendlyError(e), 4000);
        } finally {
            setCfBusy(false);
        }
    }

    async function cfUpload(opts) {
        opts = opts || {};
        var isAuto = !!opts.auto;
        if (!(cfBase() && cfToken())) { if (!isAuto) toast('请先连接 Cloudflare'); return false; }
        if (!isAuto && !confirm('将把本机全部数据压缩后上传到你自己的 Cloudflare Worker。\n备份包含聊天记录和图片，继续？')) return false;
        setCfBusy(true);
        if (!isAuto) showProgress('正在上传到 Cloudflare');
        try {
            var pack = await packBackup();
            // R2 不限制 24MB；如果 Worker 仍绑的是 KV，后端会返回明确错误。
            var key = isAuto ? 'nano-backup-auto.bak' : ('nano-backup-' + stamp() + '.bak');
            var meta = encodeURIComponent(JSON.stringify({
                createdAt: new Date().toISOString(),
                origin: location.origin,
                jsonBytes: pack.jsonBytes,
                gzip: pack.gzip ? 1 : 0
            }));
            setProgress(65, '上传 ' + fmtSize(pack.bytes.length) + '…');
            var data = await cfJson('/put?key=' + encodeURIComponent(key) + '&meta=' + meta, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: pack.bytes
            });
            if (!data || data.ok === false) throw new Error((data && data.error) || '上传失败');
            setProgress(100, '上传完成');
            if (!isAuto) toast('已上传到 Cloudflare ' + (data.store === 'r2' ? 'R2' : 'KV'));
            try { await cfLoadList(true); } catch (listErr) { if (!isAuto) toast('上传成功，但刷新列表失败：' + friendlyError(listErr), 4000); }
            return true;
        } catch (e) {
            if (!isAuto) toast('上传失败：' + friendlyError(e), 4200);
            return false;
        } finally {
            setCfBusy(false);
            if (!isAuto) setTimeout(hideProgress, 800);
        }
    }

    async function cfRestore(it) {
        var label = fmtTimeFromKey(it.name) || it.name;
        if (!confirm('即将恢复 ' + label + ' 的云端备份。\n当前本机全部数据会被覆盖，且不可撤销。继续？')) return;
        setCfBusy(true);
        showProgress('正在下载 Cloudflare 备份');
        try {
            var base = cfBase();
            var res = await fetch(base + '/get?key=' + encodeURIComponent(it.name), {
                headers: { 'Authorization': 'Bearer ' + cfToken() },
                cache: 'no-store'
            });
            if (!res.ok) {
                var text = await res.text();
                var d = null;
                try { d = JSON.parse(text); } catch (e) {}
                throw new Error((d && d.error) || ('HTTP ' + res.status));
            }
            setProgress(28, '下载备份内容…');
            var buf = new Uint8Array(await res.arrayBuffer());
            setProgress(46, '解压备份…');
            var bytes = await gunzipBytes(buf);
            setProgress(52, '解析备份…');
            var data = JSON.parse(new TextDecoder().decode(bytes));
            await restoreBackupData(data);
        } catch (e) {
            toast('恢复失败：' + friendlyError(e), 4200);
            hideProgress();
        } finally {
            setCfBusy(false);
        }
    }

    async function cfDelete(it) {
        if (!confirm('删除 Cloudflare 上的这条备份？\n只删除云端这一条，本机数据不受影响。')) return;
        setCfBusy(true);
        try {
            await cfJson('/del?key=' + encodeURIComponent(it.name), { method: 'DELETE' });
            toast('已删除');
            try { await cfLoadList(true); } catch (listErr) { toast('已删除，但刷新列表失败：' + friendlyError(listErr), 4000); }
        } catch (e) {
            toast('删除失败：' + friendlyError(e), 3600);
        } finally {
            setCfBusy(false);
        }
    }

    function cfDisconnect() {
        if (!confirm('断开 Cloudflare 后，本机不再保存地址和密码（云端已有备份不会被删除）。继续？')) return;
        cf.cfg = null;
        cf.items = [];
        dropCfg(CF_KEY);
        if ($('cfUrl')) $('cfUrl').value = '';
        if ($('cfToken')) $('cfToken').value = '';
        updateCfUI();
        renderCfList();
        toast('已断开 Cloudflare');
    }

    // ================= 教程代码 =================
    var workerCode = '';
    async function loadWorkerCode() {
        var box = $('cfCodeBox');
        try {
            var res = await fetch('../backup-worker/index.js?v=20261026d', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            workerCode = await res.text();
            if (box) box.textContent = workerCode;
        } catch (e) {
            if (box) box.textContent = '读取失败。请打开仓库的 backup-worker/index.js 复制代码，或检查网络。';
        }
    }

    function fallbackCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
        } catch (e) { return false; }
    }

    function bindToggle(btn) {
        var id = btn.getAttribute('data-toggle');
        if (!id) return;
        btn.addEventListener('click', function () {
            var input = $(id);
            if (!input) return;
            var show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.textContent = show ? '隐藏' : '显示';
        });
    }

    // ================= 自动备份 =================
    var AUTO_KEY = 'nano_auto_backup';
    var isAutoFrame = /(?:^|[?&])auto=1(?:&|$)/.test(location.search || '');
    function normalizeAutoCfg(c) {
        c = c || {};
        var hhmm = (function (v) {
            var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
            if (!m) return '04:00';
            var h = Number(m[1]), mi = Number(m[2]);
            if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return '04:00';
            return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
        })(c.time);
        return {
            enabled: c.enabled === true,
            target: c.target === 'gh' ? 'gh' : 'cf',
            mode: c.mode === 'daily' ? 'daily' : 'interval',
            time: hhmm,
            minutes: [30, 180, 480, 720, 1440].indexOf(Number(c.minutes)) >= 0 ? Number(c.minutes) : 480,
            keep: [0, 3, 5, 10].indexOf(Number(c.keep)) >= 0 ? Number(c.keep) : 3,
            lastAt: Number(c.lastAt) || 0,
            lastStatus: String(c.lastStatus || ''),
            nextTryAt: Number(c.nextTryAt) || 0
        };
    }
    var auto = {
        cfg: normalizeAutoCfg(readCfg(AUTO_KEY)),
        timer: null,
        running: false
    };

    function autoSave(patch) {
        if (patch && typeof patch === 'object') Object.assign(auto.cfg, patch);
        auto.cfg = normalizeAutoCfg(auto.cfg);
        writeCfg(AUTO_KEY, auto.cfg);
        updateAutoUI();
        if (window.parent && window.parent !== window) {
            try { window.parent.postMessage({ type: 'nanoAutoBackupChanged' }, '*'); } catch (e) {}
        }
    }

    function updateAutoUI() {
        var en = $('autoEnabled'), target = $('autoTarget'), mode = $('autoMode'),
            interval = $('autoInterval'), time = $('autoTime'), keep = $('autoKeep'),
            intervalField = $('autoIntervalField'), timeField = $('autoTimeField'), status = $('autoStatus');
        if (en) en.checked = !!auto.cfg.enabled;
        if (target) target.value = auto.cfg.target;
        if (mode) mode.value = auto.cfg.mode;
        if (interval) interval.value = String(auto.cfg.minutes);
        if (time) time.value = auto.cfg.time;
        if (keep) keep.value = String(auto.cfg.keep);
        if (intervalField) intervalField.style.display = auto.cfg.mode === 'daily' ? 'none' : '';
        if (timeField) timeField.style.display = auto.cfg.mode === 'daily' ? '' : 'none';
        if (status) {
            var when = auto.cfg.lastAt ? new Date(auto.cfg.lastAt).toLocaleString() : '还没备份过';
            var plan = auto.cfg.mode === 'daily'
                ? ('每天 ' + auto.cfg.time + '（本机时间）')
                : ('每 ' + (auto.cfg.minutes >= 60 ? (auto.cfg.minutes / 60) + ' 小时' : auto.cfg.minutes + ' 分钟'));
            status.textContent = (auto.cfg.enabled ? '已开启 · ' + plan : '未开启') + ' · 上次：' + when +
                (auto.cfg.lastStatus ? ' · ' + auto.cfg.lastStatus : '') +
                (auto.cfg.enabled && auto.running ? ' · 正在备份…' : '');
        }
    }

    // 每天固定时间的「今天目标时刻」（本机时区）
    function dailyTargetMs(nowMs) {
        var now = new Date(nowMs || Date.now());
        var m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(auto.cfg.time || '04:00'));
        var hh = m ? Number(m[1]) : 4;
        var mm = m ? Number(m[2]) : 0;
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0).getTime();
    }

    function autoDue() {
        if (!auto.cfg.enabled) return false;
        var now = Date.now();
        if (auto.cfg.nextTryAt && now < auto.cfg.nextTryAt) return false;
        if (auto.cfg.mode === 'daily') {
            var target = dailyTargetMs(now);
            // 还没到今天定的时间；或者今天这个点之后已经备份过
            if (now < target) return false;
            return (auto.cfg.lastAt || 0) < target;
        }
        return now - (auto.cfg.lastAt || 0) >= auto.cfg.minutes * 60000;
    }

    async function runAutoBackup() {
        if (auto.running || auto.busy) return;
        if (!auto.cfg.enabled || !autoDue()) return;
        if (gh.busy || cf.busy) return;
        var target = auto.cfg.target;
        if (target === 'gh' && !ghToken()) {
            auto.cfg.lastStatus = '未连接 GitHub';
            auto.cfg.nextTryAt = Date.now() + 3600 * 1000;
            autoSave();
            return;
        }
        if (target === 'cf' && !(cfBase() && cfToken())) {
            auto.cfg.lastStatus = '未连接 Cloudflare';
            auto.cfg.nextTryAt = Date.now() + 3600 * 1000;
            autoSave();
            return;
        }
        auto.running = true;
        auto.cfg.lastStatus = '正在上传…';
        updateAutoUI();
        var ok = false;
        try {
            ok = target === 'gh' ? await ghUpload({ auto: true }) : await cfUpload({ auto: true });
        } catch (e) {
            ok = false;
        }
        auto.running = false;
        if (ok) {
            auto.cfg.lastAt = Date.now();
            auto.cfg.lastStatus = '成功';
            auto.cfg.nextTryAt = 0;
        } else {
            auto.cfg.lastStatus = '失败，10 分钟后重试';
            auto.cfg.nextTryAt = Date.now() + 10 * 60 * 1000;
        }
        autoSave();
    }

    function startAutoScheduler() {
        updateAutoUI();
        if (auto.timer) return;
        auto.timer = setInterval(function () {
            if (autoDue()) runAutoBackup();
        }, 60 * 1000);
        setTimeout(function () { if (autoDue()) runAutoBackup(); }, 12000);
    }

    // ================= 初始化 =================
    function init() {
        if (isAutoFrame) {
            // 由首页隐藏 iframe 加载：只跑定时器，不渲染备份页。
            try { document.documentElement.style.display = 'none'; } catch (e) {}
            startAutoScheduler();
            window.addEventListener('storage', function (e) {
                if (e && e.key === AUTO_KEY) {
                    auto.cfg = normalizeAutoCfg(readCfg(AUTO_KEY) || {});
                }
            });
            return;
        }
        if (gh.cfg) {
            gh.cfg.token = String(gh.cfg.token || '');
            if ($('ghToken')) $('ghToken').value = gh.cfg.token;
        }
        if (cf.cfg) {
            cf.cfg.url = String(cf.cfg.url || '');
            cf.cfg.token = String(cf.cfg.token || '');
            if ($('cfUrl')) $('cfUrl').value = cf.cfg.url;
            if ($('cfToken')) $('cfToken').value = cf.cfg.token;
        }
        updateGhUI();
        updateCfUI();
        renderGhList();
        renderCfList();

        document.querySelectorAll('[data-toggle]').forEach(bindToggle);

        var back = $('cloudBack');
        if (back) back.addEventListener('click', function () { location.href = 'backup.html'; });

        var ghSave = $('ghSave'); if (ghSave) ghSave.addEventListener('click', ghConnect);
        var ghUploadBtn = $('ghUpload'); if (ghUploadBtn) ghUploadBtn.addEventListener('click', ghUpload);
        var ghRefresh = $('ghRefresh'); if (ghRefresh) ghRefresh.addEventListener('click', function () {
            if (!ghToken()) return;
            setGhBusy(true);
            ghLoadList(false).catch(function (e) { toast('读取失败：' + friendlyError(e), 3600); })
                .then(function () { setGhBusy(false); });
        });
        var ghDisc = $('ghDisconnect'); if (ghDisc) ghDisc.addEventListener('click', ghDisconnect);

        var cfSave = $('cfSave'); if (cfSave) cfSave.addEventListener('click', cfConnect);
        var cfUploadBtn = $('cfUpload'); if (cfUploadBtn) cfUploadBtn.addEventListener('click', cfUpload);
        var cfRefresh = $('cfRefresh'); if (cfRefresh) cfRefresh.addEventListener('click', function () {
            if (!(cfBase() && cfToken())) return;
            setCfBusy(true);
            cfLoadList(false).catch(function (e) { toast('读取失败：' + friendlyError(e), 3600); })
                .then(function () { setCfBusy(false); });
        });
        var cfDisc = $('cfDisconnect'); if (cfDisc) cfDisc.addEventListener('click', cfDisconnect);

        var autoSaveBtn = $('autoSave');
        if (autoSaveBtn) autoSaveBtn.addEventListener('click', function () {
            var en = $('autoEnabled'), target = $('autoTarget'), mode = $('autoMode'),
                interval = $('autoInterval'), time = $('autoTime'), keep = $('autoKeep');
            var keepVal = keep ? Number(keep.value) : 3;
            var timeVal = time ? String(time.value || '') : '';
            autoSave({
                enabled: !!(en && en.checked),
                target: target && target.value === 'gh' ? 'gh' : 'cf',
                mode: mode && mode.value === 'daily' ? 'daily' : 'interval',
                time: /^([01]?\d|2[0-3]):[0-5]\d$/.test(timeVal) ? timeVal : '04:00',
                minutes: Number(interval && interval.value) || 480,
                keep: [0, 3, 5, 10].indexOf(keepVal) >= 0 ? keepVal : 3,
                nextTryAt: 0
            });
            if (auto.cfg.enabled) {
                startAutoScheduler();
                if (auto.cfg.mode === 'daily') {
                    toast('已开启自动备份：每天 ' + auto.cfg.time + '（本机时间）备份一次');
                } else {
                    toast('已开启自动备份：App 打开时每 ' + (auto.cfg.minutes >= 60 ? (auto.cfg.minutes / 60) + ' 小时' : auto.cfg.minutes + ' 分钟') + '备份一次');
                }
            } else {
                toast('已关闭自动备份');
            }
        });
        var autoModeSel = $('autoMode');
        if (autoModeSel) autoModeSel.addEventListener('change', function () {
            var daily = autoModeSel.value === 'daily';
            var inf = $('autoIntervalField'), tf = $('autoTimeField');
            if (inf) inf.style.display = daily ? 'none' : '';
            if (tf) tf.style.display = daily ? '' : 'none';
        });
        updateAutoUI();
        // 多个标签页/隐藏 iframe 共用 lastAt：任一页备份成功后，其它页下一分钟就会跳过。
        window.addEventListener('storage', function (e) {
            if (!e || e.key !== AUTO_KEY) return;
            try {
                auto.cfg = normalizeAutoCfg(readCfg(AUTO_KEY) || {});
                updateAutoUI();
            } catch (err) {}
        });
        // 在 App 里由首页的隐藏 iframe 负责定时；直接打开备份页时才在这里跑，避免两个定时器重复上传。
        if (window.parent === window) startAutoScheduler();

        var copyBtn = $('cfCopyCode');
        if (copyBtn) copyBtn.addEventListener('click', function () {
            if (!workerCode) { toast('代码还没加载好，请稍后再试'); return; }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(workerCode)
                    .then(function () { toast('代码已复制'); })
                    .catch(function () {
                        toast(fallbackCopy(workerCode) ? '代码已复制' : '复制失败，请长按代码手动复制');
                    });
            } else {
                toast(fallbackCopy(workerCode) ? '代码已复制' : '复制失败，请长按代码手动复制');
            }
        });

        loadWorkerCode();

        // 已配置过：后台静默刷新列表，不打扰用户
        if (ghToken()) {
            ghLoadList(true).catch(function () {});
        }
        if (cfBase() && cfToken()) {
            cfLoadList(true).catch(function () {});
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
