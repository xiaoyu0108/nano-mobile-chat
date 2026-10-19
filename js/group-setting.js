/* ============================================================
   group-setting.js - 群设置逻辑
   ============================================================ */
(function(){
    'use strict';

    function getQueryParam(n){ return new URLSearchParams(location.search).get(n); }
    var chatId = getQueryParam('group') || getQueryParam('chat') || 'group_default';
    var GROUP_KEY = 'group_data_' + chatId;
    var MSG_KEY = 'group_msgs_' + chatId;
    var SETTINGS_KEY = 'group_settings_' + chatId;
    var BG_KEY = 'group_bg_' + chatId;
    var GROUPS_KEY = 'nano_groups_data';

    var LEVEL_COLORS = {
        1: '#a0a4b8', 2: '#7fb1e5', 3: '#5f9bea', 4: '#7a6fd9', 5: '#b66fd9', 6: '#e55fa0', 7: '#fa5151'
    };
    function levelColor(lv){ return LEVEL_COLORS[lv] || LEVEL_COLORS[1]; }

    var defaultGroup = {
        name: '',
        notice: '',
        avatar: '',
        ownerId: 'me',
        members: []
    };
    var defaultSettings = { timeAware: true, allowImage: false, myTitle: '群主', myLevel: 1, myNick: '你', myMsgCount: 0 };

    var MEMBER_BG = ['#2c5fb1','#b1552c','#2c7a3e','#6d2cb1','#d96f3a','#0a84ff','#ff375f','#30d158'];
    function memberBg(i){ return MEMBER_BG[i % MEMBER_BG.length]; }

    function loadRegistryGroup(){
        try {
            var raw = localStorage.getItem(GROUPS_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            var arr = data && data.groups;
            if (!Array.isArray(arr)) return null;
            for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].id === chatId) return arr[i]; }
        } catch(e){}
        return null;
    }
    function buildFromRegistry(rg){
        var names = rg.memberNames || [];
        var ids = rg.members || [];
        return {
            name: rg.name || '',
            notice: '',
            avatar: rg.avatar || '',
            ownerId: 'me',
            members: names.map(function(nm, i){
                var id = ids[i] || ('m' + i);
                nm = nm || id;
                return { id:id, name:nm, nick:nm, initial:nm.charAt(0), bg:memberBg(i), role:'成员', title:'', level:1, msgCount:0 };
            })
        };
    }

    function loadGroup(){
        try { var raw = localStorage.getItem(GROUP_KEY); if (raw){ var g=JSON.parse(raw); if(g&&g.members) return g; } } catch(e){}
        var rg = loadRegistryGroup();
        if (rg) return buildFromRegistry(rg);
        return JSON.parse(JSON.stringify(defaultGroup));
    }
    function syncToRegistry(){
        try {
            var raw = localStorage.getItem(GROUPS_KEY);
            if (!raw) return;
            var data = JSON.parse(raw);
            if (!data || !Array.isArray(data.groups)) return;
            for (var i = 0; i < data.groups.length; i++) {
                if (data.groups[i] && data.groups[i].id === chatId) {
                    data.groups[i].name = group.name || '';
                    data.groups[i].avatar = group.avatar || '';
                    data.groups[i].members = group.members.map(function(m){ return m.id; });
                    data.groups[i].memberNames = group.members.map(function(m){ return m.name; });
                    break;
                }
            }
            localStorage.setItem(GROUPS_KEY, JSON.stringify(data));
        } catch(e){}
    }
    function saveGroup(g){ try { localStorage.setItem(GROUP_KEY, JSON.stringify(g)); } catch(e){} }
    function loadSettings(){
        try { var raw = localStorage.getItem(SETTINGS_KEY); if (raw){ var s=JSON.parse(raw); if(s) return Object.assign({}, defaultSettings, s); } } catch(e){}
        return Object.assign({}, defaultSettings);
    }
    function saveSettings(s){ try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch(e){} }
    // 把群设置里的变动写入待处理队列，回到群聊页时以“系统提示条”展示并让 AI 知晓
    function pushPendingChange(text){
        try {
            var key = 'group_pending_changes_' + chatId;
            var arr = [];
            try { arr = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch(e){ arr = []; }
            arr.push(text);
            localStorage.setItem(key, JSON.stringify(arr));
        } catch(e){}
    }
    function loadMsgs(){
        try { var raw = localStorage.getItem(MSG_KEY); return raw ? JSON.parse(raw) : []; } catch(e){ return []; }
    }

    var group = loadGroup();
    var settings = loadSettings();
    var messages = loadMsgs();

    var currentUser = { id:'me', name:'你', nick:'你', initial:'你', avatar:'', bg:'#34c759' };

    // ===== 从 IndexedDB 读取角色 / 人设头像，保证群成员与 mask/character 一致 =====
    function getCharactersFromDB(){
        return new Promise(function(resolve){
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function(e){
                    try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath:'id' }); } catch(err){}
                };
                req.onsuccess = function(e){
                    try {
                        var db = e.target.result;
                        var g = db.transaction('characters', 'readonly').objectStore('characters').getAll();
                        g.onsuccess = function(){ resolve(g.result || []); };
                        g.onerror = function(){ resolve([]); };
                    } catch(err){ resolve([]); }
                };
                req.onerror = function(){ resolve([]); };
            } catch(e){ resolve([]); }
        });
    }
    function getMaskAvatarFromDB(id){
        return new Promise(function(resolve){
            try {
                var req = indexedDB.open('MaskAvatarDB', 1);
                req.onupgradeneeded = function(e){
                    try { var d = e.target.result; if (!d.objectStoreNames.contains('avatars')) d.createObjectStore('avatars', { keyPath:'id' }); } catch(err){}
                };
                req.onsuccess = function(e){
                    try {
                        var db = e.target.result;
                        var r = db.transaction('avatars', 'readonly').objectStore('avatars').get(id);
                        r.onsuccess = function(){ resolve(r.result ? r.result.data : ''); };
                        r.onerror = function(){ resolve(''); };
                    } catch(err){ resolve(''); }
                };
                req.onerror = function(){ resolve(''); };
            } catch(e){ resolve(''); }
        });
    }
    function getCurrentMask(){
        try {
            var raw = localStorage.getItem('nano_mask_data');
            if (!raw) return null;
            var d = JSON.parse(raw);
            var masks = d.masks || [];
            if (d.currentMaskId) {
                for (var i = 0; i < masks.length; i++) { if (masks[i].id === d.currentMaskId) return masks[i]; }
            }
            return masks[0] || null;
        } catch(e){ return null; }
    }
    function resolveIdentities(){
        return Promise.all([getCharactersFromDB(), Promise.resolve(getCurrentMask())]).then(function(res){
            var chars = res[0] || [];
            var mask = res[1];
            var map = {};
            chars.forEach(function(c){ map[c.id] = c; if (c.name) map[c.name] = c; });
            group.members.forEach(function(m){
                var c = map[m.id] || map[m.name];
                if (!c) return;
                if (c.avatar) m.avatar = c.avatar;
                if (c.name) {
                    var oldName = m.name;
                    m.name = c.name;
                    if (!m.nick || m.nick === oldName) m.nick = c.name;
                }
                m.initial = (m.nick || m.name || '?').charAt(0);
            });
            if (mask) {
                currentUser.name = mask.name || currentUser.name;
                currentUser.nick = mask.name || currentUser.nick;
                currentUser.initial = currentUser.name.charAt(0);
                if (mask.avatar && mask.avatar.trim() !== '') {
                    currentUser.avatar = mask.avatar;
                    return;
                }
                return getMaskAvatarFromDB(mask.id).then(function(a){ if (a) currentUser.avatar = a; });
            }
        }).then(function(){
            saveGroup(group);
        });
    }

    var $ = function(id){ return document.getElementById(id); };

    // ========== 渲染 ==========
    function renderAll(){
        var gp = $('gpAvatar');
        if (group.avatar) gp.innerHTML = '<img src="' + group.avatar + '">';
        else gp.textContent = '群';
        $('gpName').textContent = group.name || '群聊';
        $('gpMeta').textContent = (group.members.length + 1) + ' 人';
        $('editNamePreview').textContent = group.name || '未设置';
        $('editNoticePreview').textContent = group.notice ? (group.notice.length > 12 ? group.notice.slice(0,12) + '…' : group.notice) : '未设置';
        $('editAvatarPreview').textContent = group.avatar ? '已设置' : '未设置';
        $('memberCount').textContent = group.members.length + 1;
        $('bgStatus').textContent = localStorage.getItem(BG_KEY) ? '已设置' : '默认';
        $('timeSwitch').checked = !!settings.timeAware;
        $('imageSwitch').checked = !!settings.allowImage;

        renderMemberList();
    }

    function renderMemberList(){
        var el = $('memberList');
        el.innerHTML = '';

        // 我自己
        var isOwner = !(group.ownerId && group.ownerId !== 'me');
        var selfTitle = isOwner ? (settings.myTitle || '群主') : (settings.myTitle || '成员');
        var selfLevel = settings.myLevel || 1;
        var selfAvatar = currentUser.avatar ? '<img src="' + currentUser.avatar + '">' : (currentUser.initial || '你');
        var selfRow = document.createElement('div');
        selfRow.className = 'member-row';
        selfRow.innerHTML =
            '<div class="m-avatar" style="background:#34c759;">' + selfAvatar + '</div>' +
            '<div class="m-info">' +
                '<div class="m-name">' +
                    '<span class="m-nick">' + (currentUser.nick || '你') + '</span>' +
                    '<span class="m-title" style="background:' + levelColor(selfLevel) + ';">' + selfTitle + '</span>' +
                '</div>' +
                '<div class="m-role">' + (isOwner ? '群主' : '成员') + '</div>' +
            '</div>' +
            '<div class="m-actions">' +
                '<button class="m-icon-btn title-btn" data-me="1"><i class="fas fa-pen"></i></button>' +
            '</div>';
        el.appendChild(selfRow);

        group.members.forEach(function(m, i){
            var lv = m.level || 1;
            var row = document.createElement('div');
            row.className = 'member-row';
            var titleHtml = m.title ? '<span class="m-title" style="background:' + levelColor(lv) + ';">' + m.title + '</span>' : '';
            var avatarHtml = m.avatar ? '<img src="' + m.avatar + '">' : (m.initial || m.name.charAt(0));
            row.innerHTML =
                '<div class="m-avatar" style="background:' + m.bg + ';">' + avatarHtml + '</div>' +
                '<div class="m-info">' +
                    '<div class="m-name">' +
                        '<span class="m-nick">' + (m.nick || m.name) + '</span>' +
                        titleHtml +
                    '</div>' +
                    '<div class="m-role">' + (m.role || '成员') + '</div>' +
                '</div>' +
                '<div class="m-actions">' +
                    '<button class="m-icon-btn title-btn" data-idx="' + i + '"><i class="fas fa-pen"></i></button>' +
                    '<button class="m-icon-btn kick-btn" data-idx="' + i + '"><i class="fas fa-user-minus"></i></button>' +
                '</div>';
            el.appendChild(row);
        });

        el.querySelectorAll('.m-icon-btn').forEach(function(btn){
            btn.addEventListener('click', function(e){
                e.stopPropagation();
                if (btn.classList.contains('title-btn')) {
                    if (btn.dataset.me) openTitleModal(-2, currentUser.nick || '你', settings.myTitle || '群主');
                    else {
                        var i = parseInt(btn.dataset.idx);
                        openTitleModal(i, group.members[i].nick || group.members[i].name, group.members[i].title || '');
                    }
                } else if (btn.classList.contains('kick-btn')) {
                    var i = parseInt(btn.dataset.idx);
                    var m = group.members[i];
                    if (confirm('确定将「' + (m.nick || m.name) + '」移出群聊？')) {
                        group.members.splice(i, 1);
                        saveGroup(group);
                        syncToRegistry();
                        renderAll();
                    }
                }
            });
        });
    }

    // ========== 顶栏（返回目标为 groups） ==========
    $('navBack').addEventListener('click', function(){
        if (window.parent !== window) window.parent.postMessage({ type:'closeFullscreen' }, '*');
        else history.back();
    });
    $('navSave').addEventListener('click', function(){
        saveGroup(group);
        saveSettings(settings);
        syncToRegistry();
        showAlert('提示', '已保存');
    });

    // ========== 编辑弹窗 ==========
    var editCallback = null;
    function openEditModal(title, sub, val, cb){
        $('editTitle').textContent = title;
        $('editSub').textContent = sub;
        $('editInput').value = val || '';
        editCallback = cb;
        $('editModal').classList.add('active');
        setTimeout(function(){ $('editInput').focus(); }, 100);
    }
    $('editCancel').addEventListener('click', function(){ $('editModal').classList.remove('active'); editCallback = null; });
    $('editConfirm').addEventListener('click', function(){
        var val = $('editInput').value.trim();
        if (editCallback) editCallback(val);
        $('editModal').classList.remove('active');
        editCallback = null;
    });

    $('editNameItem').addEventListener('click', function(){
        openEditModal('群名称', '输入新的群名称', group.name, function(val){
            if (val) { var oldName = group.name; group.name = val; saveGroup(group); syncToRegistry(); pushPendingChange('用户把群名从「' + (oldName || '群聊') + '」改成了「' + val + '」'); renderAll(); }
        });
    });
    $('editNoticeItem').addEventListener('click', function(){
        openEditModal('群公告', '输入新的群公告', group.notice, function(val){
            group.notice = val; saveGroup(group); renderAll();
        });
    });

    // ========== 群头像 ==========
    var avatarTemp = null;
    $('editAvatarItem').addEventListener('click', function(){
        avatarTemp = group.avatar || null;
        renderAvatarPreview();
        $('avatarModal').classList.add('active');
    });
    $('gpAvatar').addEventListener('click', function(){
        avatarTemp = group.avatar || null;
        renderAvatarPreview();
        $('avatarModal').classList.add('active');
    });
    function renderAvatarPreview(){
        var el = $('avatarPreview');
        if (avatarTemp) el.innerHTML = '<img src="' + avatarTemp + '">';
        else el.textContent = '群';
    }
    $('avatarFileInput').addEventListener('change', function(){
        var f = this.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function(ev){ avatarTemp = ev.target.result; renderAvatarPreview(); };
        r.readAsDataURL(f);
    });
    $('avatarResetBtn').addEventListener('click', function(){ avatarTemp = null; renderAvatarPreview(); });
    $('avatarCancel').addEventListener('click', function(){ $('avatarModal').classList.remove('active'); });
    $('avatarConfirm').addEventListener('click', function(){
        group.avatar = avatarTemp || '';
        saveGroup(group);
        syncToRegistry();
        pushPendingChange('用户更换了群头像');
        renderAll();
        $('avatarModal').classList.remove('active');
    });

    // ========== 聊天背景 ==========
    var bgTemp = localStorage.getItem(BG_KEY) || null;
    $('bgItem').addEventListener('click', function(){
        bgTemp = localStorage.getItem(BG_KEY) || null;
        renderBgPreview();
        $('bgModal').classList.add('active');
    });
    function renderBgPreview(){
        var el = $('bgPreview');
        if (bgTemp) {
            el.style.backgroundImage = 'url(' + bgTemp + ')';
            el.textContent = '';
        } else {
            el.style.backgroundImage = 'none';
            el.textContent = '默认背景';
        }
    }
    $('bgFileInput').addEventListener('change', function(){
        var f = this.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function(ev){ bgTemp = ev.target.result; renderBgPreview(); };
        r.readAsDataURL(f);
    });
    $('bgResetBtn').addEventListener('click', function(){ bgTemp = null; renderBgPreview(); });
    $('bgCancel').addEventListener('click', function(){ $('bgModal').classList.remove('active'); });
    $('bgConfirm').addEventListener('click', function(){
        if (bgTemp) localStorage.setItem(BG_KEY, bgTemp);
        else localStorage.removeItem(BG_KEY);
        renderAll();
        $('bgModal').classList.remove('active');
    });

    // ========== 开关 ==========
    $('timeSwitch').addEventListener('change', function(){
        settings.timeAware = this.checked;
        saveSettings(settings);
    });
    $('imageSwitch').addEventListener('change', function(){
        settings.allowImage = this.checked;
        saveSettings(settings);
    });

    // ========== 邀请成员 ==========
    var inviteSelected = new Set();
    var invitePool = [];
    $('addMemberBtn').addEventListener('click', function(){
        inviteSelected.clear();
        var el = $('inviteList');
        el.innerHTML = '<div class="invite-empty">加载中…</div>';
        getCharactersFromDB().then(function(allChars){
            var inIds = {};
            group.members.forEach(function(m){ inIds[m.id] = true; });
            invitePool = (allChars || []).filter(function(c){ return c && c.id && !inIds[c.id]; }).map(function(c, i){
                return { id:c.id, name:c.name || c.id, avatar:c.avatar || '', initial:(c.name || c.id).charAt(0), bg:memberBg(i) };
            });
            el.innerHTML = '';
            if (invitePool.length === 0) {
                el.innerHTML = '<div class="invite-empty">没有更多可邀请的角色</div>';
            } else {
                invitePool.forEach(function(c){
                    var row = document.createElement('div');
                    row.className = 'invite-item';
                    var avHtml = c.avatar ? '<img src="' + c.avatar + '">' : (c.initial || c.name.charAt(0));
                    row.innerHTML =
                        '<div class="iv-avatar" style="background:' + c.bg + ';">' + avHtml + '</div>' +
                        '<div class="iv-name">' + c.name + '</div>' +
                        '<div class="iv-check"></div>';
                    row.addEventListener('click', function(){
                        if (inviteSelected.has(c.id)) { inviteSelected.delete(c.id); row.classList.remove('on'); }
                        else { inviteSelected.add(c.id); row.classList.add('on'); }
                    });
                    el.appendChild(row);
                });
            }
        });
        $('inviteModal').classList.add('active');
    });
    $('inviteCancel').addEventListener('click', function(){ $('inviteModal').classList.remove('active'); });
    $('inviteConfirm').addEventListener('click', function(){
        if (inviteSelected.size === 0) { $('inviteModal').classList.remove('active'); return; }
        var sent = 0;
        var pending = {};
        try {
            (window.GroupInvites ? window.GroupInvites.list() : []).forEach(function(x){
                if (x && x.status === 'pending' && x.direction === 'user' && x.groupId === chatId) pending[x.toCharId] = true;
            });
        } catch(e){}
        invitePool.forEach(function(c){
            if (inviteSelected.has(c.id) && window.GroupInvites && !pending[c.id]) {
                window.GroupInvites.add({
                    groupId: chatId, groupName: group.name || '群聊',
                    fromName: '你', toCharId: c.id, toName: c.name,
                    direction: 'user', status: 'pending'
                });
                sent++;
            }
        });
        $('inviteModal').classList.remove('active');
        if (sent) {
            showAlert('邀请已发送', '请到被邀请角色的私聊里点击回复，TA 同意后才会加入本群');
        } else {
            showAlert('提示', '这些角色已经在等待回应了，请到他们的私聊里点回复');
        }
    });

    // ========== 生成群成员（调用一次主 API，基于成员人设+世界书） ==========
    function getMainApiConfig(){
        return new Promise(function(resolve){
            var done = function(cfg){ resolve(cfg || null); };
            try {
                if ('indexedDB' in window) {
                    var req = indexedDB.open('nano_api_db', 2);
                    req.onupgradeneeded = function(e){
                        try { var db = e.target.result;
                            if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath:'key' });
                            if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath:'key' });
                        } catch(e2){}
                    };
                    req.onsuccess = function(e){
                        try {
                            var db = e.target.result;
                            var g = db.transaction('api_data','readonly').objectStore('api_data').get('nano_api_config');
                            g.onsuccess = function(){
                                var v = g.result ? g.result.value : null;
                                if (v) { done(v); return; }
                                try { var raw = localStorage.getItem('nano_api_config'); done(raw ? JSON.parse(raw) : null); } catch(e3){ done(null); }
                            };
                            g.onerror = function(){ try { var raw = localStorage.getItem('nano_api_config'); done(raw ? JSON.parse(raw) : null); } catch(e3){ done(null); } };
                        } catch(e2){ done(null); }
                    };
                    req.onerror = function(){ try { var raw = localStorage.getItem('nano_api_config'); done(raw ? JSON.parse(raw) : null); } catch(e3){ done(null); } };
                    return;
                }
            } catch(e){}
            try { var raw2 = localStorage.getItem('nano_api_config'); done(raw2 ? JSON.parse(raw2) : null); } catch(e){ done(null); }
        });
    }
    function resolveApiHost(rawUrl){
        try {
            var s = String(rawUrl || '').trim();
            if (!s) return s;
            var u = new URL(s);
            var host = u.hostname;
            var cur = window.location.hostname;
            var isLan = cur && (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(cur) || /^10\./.test(cur) || /^192\.168\./.test(cur) || /^172\.(1[6-9]|2\d|3[01])\./.test(cur) || /\.local$/.test(cur));
            // 仅当页面也在本地/局域网时才把 localhost 换成当前主机，公网域名下保留原地址
            if ((host === 'localhost' || host === '127.0.0.1' || host === '[::1]') && isLan) {
                u.hostname = cur;
            }
            return u.toString();
        } catch(e){ return rawUrl; }
    }
    function toV1Url(u){ u = resolveApiHost(u); u = String(u || '').trim().replace(/\/+$/, ''); if (!/\/v1$/i.test(u)) u += '/v1'; return u; }
    function collectWorldbookText(memberIds){
        var out = [];
        try {
            var raw = localStorage.getItem('nano_worldbook_data_v5');
            if (raw) {
                var d = JSON.parse(raw); var files = (d && d.files) || [];
                files.forEach(function(f){
                    if (!f) return;
                    var scope = f.scope || 'global';
                    if (scope === 'local') {
                        var bound = f.boundCharacters || [];
                        if (!bound.some(function(b){ return memberIds.indexOf(b) > -1; })) return;
                    }
                    var txt = '';
                    if (Array.isArray(f.entries)) txt = f.entries.map(function(en){ return en && en.content ? String(en.content) : ''; }).filter(Boolean).join('\n');
                    else if (typeof f.content === 'string') txt = f.content;
                    if (txt.trim()) out.push('【' + (f.name || '世界书') + '】\n' + txt.trim().slice(0, 1200));
                });
            }
        } catch(e){}
        return out.slice(0, 3).join('\n\n');
    }
    var genMemberBtn = $('genMemberBtn');
    if (genMemberBtn) {
        genMemberBtn.addEventListener('click', function(){
            var btn = this;
            if (btn.dataset.busy === '1') return;
            if (!group || !Array.isArray(group.members)) { showAlert('提示', '群数据还没加载好，请稍后重试'); return; }
            getCharactersFromDB().then(function(chars){
                var map = {};
                (chars || []).forEach(function(c){ map[c.id] = c; if (c.name) map[c.name] = c; });
                var ids = group.members.map(function(m){ return m.id; });
                var lines = group.members.map(function(m){
                    var c = map[m.id] || map[m.name] || null;
                    var nm = m.nick || m.name || '成员';
                    return '◇ ' + nm + (m.title ? ('（' + m.title + '）') : '') + '\n' + ((c && c.setting) || m.setting || '（暂无详细设定）');
                }).join('\n');
                var wb = collectWorldbookText(ids);
                var gname = group.name || '群聊';
                getMainApiConfig().then(function(cfg){
                    if (!cfg || !cfg.mainUrl || !cfg.mainKey || !cfg.mainModel) {
                        showAlert('配置错误', '请先在「API」页面配置主 API（地址 / Key / 模型）');
                        return;
                    }
                    btn.dataset.busy = '1';
                    var old = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>生成中…</span>';
                    var sys = '你在为群聊「' + gname + '」设计可能出现在群里的新成员（NPC）。\n' +
                        '要求：\n1. 名字正常、像真人名，符合这些角色的国籍与世界观，不要乱码或怪名。\n' +
                        '2. 人设要具体：身份、性格、说话习惯、与群内角色及用户的关系，30~80字。\n' +
                        '3. 与已有成员有区分度，不要同一种性格。\n' +
                        '4. 每个人一行，格式严格为：名字|人设。只输出这些行，不要编号解释。';
                    var usr = '【群成员及人设】\n' + lines + (wb ? ('\n\n【世界书参考】\n' + wb) : '') + '\n\n请生成 3~5 个可能出现的群成员。';
                    fetch(toV1Url(cfg.mainUrl) + '/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + String(cfg.mainKey).trim(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: cfg.mainModel, messages: [{ role:'system', content:sys }, { role:'user', content:usr }], max_tokens: 900, temperature: 0.9 })
                    }).then(function(r){
                        if (r.ok) return r.json();
                        return r.text().then(function(t){ throw new Error('HTTP ' + r.status + '：' + String(t || '').slice(0, 200)); });
                    }).then(function(d){
                        var content = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
                        if (!content) { showAlert('提示', '生成失败，请检查 API 配置'); return; }
                        var added = 0;
                        String(content).split(/\n+/).forEach(function(line, i){
                            line = line.replace(/^[\s\-\*\d.、）)]+/, '').replace(/\*\*/g, '').trim();
                            if (!line) return;
                            var mm = line.match(/^([^：:|｜=\(\（]{1,20})\s*(?:[：:|｜=]|\s[-—–]{1,2}\s)\s*([\s\S]+)$/);
                            if (!mm) {
                                var mm2 = line.match(/^(.{1,20}?)[（(]\s*([\s\S]{6,}?)[)）]\s*$/);
                                if (mm2) mm = mm2;
                            }
                            if (!mm) return;
                            var nm = String(mm[1]).replace(/[（(].*$/, '').trim(), st = mm[2].trim();
                            if (!nm || !st) return;
                            if (!/^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·.\- ]{0,11}$/.test(nm)) return;
                            if (group.members.some(function(x){ return (x.nick || x.name) === nm; })) return;
                            group.members.push({ id:'npc_' + Date.now() + '_' + i, name:nm, nick:nm, initial:nm.charAt(0), avatar:'', bg:memberBg(group.members.length), role:'成员', title:'', level:1, msgCount:0, isNpc:true, setting:st });
                            // 群 NPC 主动加我：写进 Meet 好友申请（绑定当前人设，不串 user）
                            try {
                                var _own = ''; try { var _mdd = JSON.parse(localStorage.getItem('nano_mask_data') || 'null'); if (_mdd && _mdd.currentMaskId != null) _own = String(_mdd.currentMaskId); } catch (e0) {}
                                var _all = []; try { _all = JSON.parse(localStorage.getItem('nano_friend_requests') || '[]') || []; } catch (e0) {}
                                if (!_all.some(function (x) { return x && x.status === 'pending' && x.source === 'groupnpc' && x.name === nm; })) {
                                    _all.push({ id: 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6), owner: _own, name: nm, avatar: '', source: 'groupnpc', app: 'group', setting: st, requestNote: '在群聊里加你', ts: Date.now(), status: 'pending' });
                                    try { localStorage.setItem('nano_friend_requests', JSON.stringify(_all.slice(-400))); } catch (e0) {}
                                }
                            } catch (e0) {}
                            added++;
                        });
                        saveGroup(group); syncToRegistry(); renderAll();
                        if (added) showAlert('已生成 ' + added + ' 个群成员', '点击成员头像可查看人设并加为好友');
                        else showAlert('提示', '本次未解析到有效成员');
                    }).catch(function(err){
                        showAlert('生成失败', String((err && err.message) || err));
                    }).then(function(){
                        btn.dataset.busy = '0';
                        btn.innerHTML = old;
                    });
                });
            });
        });
    }

    // ========== 头衔 ==========
    var titleTargetIdx = -1;
    function openTitleModal(idx, name, current){
        titleTargetIdx = idx;
        $('titleSubName').textContent = name;
        $('titleInput').value = current || '';
        $('titleModal').classList.add('active');
        setTimeout(function(){ $('titleInput').focus(); }, 100);
    }
    $('titleCancel').addEventListener('click', function(){ $('titleModal').classList.remove('active'); });
    $('titleConfirm').addEventListener('click', function(){
        var val = $('titleInput').value.trim();
        if (titleTargetIdx === -2) {
            settings.myTitle = val;
            saveSettings(settings);
        } else if (titleTargetIdx >= 0 && group.members[titleTargetIdx]) {
            group.members[titleTargetIdx].title = val;
            saveGroup(group);
        }
        renderAll();
        $('titleModal').classList.remove('active');
    });

    // ========== 查找聊天记录 ==========
    $('searchItem').addEventListener('click', function(){
        $('searchOverlay').classList.add('active');
        setTimeout(function(){ $('searchInput').focus(); }, 100);
        renderSearchResults('');
    });
    $('searchClose').addEventListener('click', function(){ $('searchOverlay').classList.remove('active'); });
    $('searchOverlay').addEventListener('click', function(e){ if (e.target === this) this.classList.remove('active'); });
    $('searchInput').addEventListener('input', function(){
        renderSearchResults(this.value.trim().toLowerCase());
    });
    function renderSearchResults(q){
        var el = $('searchResults');
        el.innerHTML = '';
        if (!q) {
            el.innerHTML = '<div class="search-empty">输入关键词以搜索</div>';
            return;
        }
        var found = 0;
        messages.forEach(function(m){
            var t = m.text || '';
            if (t.toLowerCase().indexOf(q) > -1) {
                found++;
                var item = document.createElement('div');
                item.className = 'search-result-item';
                var who = m.type === 'right' ? (settings.myNick || '你') : (getMemberName(m.senderId));
                item.innerHTML = '<div class="sr-name">' + who + ' · ' + (m.time || '') + '</div><div class="sr-text">' + t + '</div>';
                item.addEventListener('click', function(){
                    $('searchOverlay').classList.remove('active');
                    // 跳回本群的群聊页并定位到该消息（不要跳到私人聊天）
                    var url = 'groups.html?group=' + encodeURIComponent(chatId) + '&jump=' + encodeURIComponent(m.id);
                    if (window.parent !== window) {
                        window.parent.postMessage({ type:'openFullscreen', url: url, title: '群聊' }, '*');
                    } else {
                        location.href = url;
                    }
                });
                el.appendChild(item);
            }
        });
        if (!found) el.innerHTML = '<div class="search-empty">没有找到相关记录</div>';
    }
    function getMemberName(id){
        if (!id) return '未知';
        if (id === 'me') return settings.myNick || '你';
        var m = group.members.find(function(x){ return x.id === id; });
        return m ? (m.nick || m.name) : '未知';
    }

    // ========== 清空聊天记录 ==========
    // 清空群聊记录时，连同本群产生的记忆一起清掉
    function clearGroupMemories(gid){
        try {
            if (!('indexedDB' in window)) return;
            var ids = group.members.map(function(m){ return m.id; });
            ids.push(gid);
            var req = indexedDB.open('nano_vector_memory_db', 5);
            req.onupgradeneeded = function(e){ try { var d = e.target.result; if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath:'key' }); } catch(err){} };
            req.onsuccess = function(e){
                var db = e.target.result;
                ids.forEach(function(cid){
                    try {
                        var tx = db.transaction('config','readwrite');
                        var store = tx.objectStore('config');
                        var g = store.get('memlist_' + cid);
                        g.onsuccess = function(){
                            try {
                                var list = (g.result && Array.isArray(g.result.value)) ? g.result.value : [];
                                var filtered = list.filter(function(it){ return !(it && it.groupId === gid); });
                                store.put({ key:'memlist_' + cid, value: filtered });
                            } catch(err){}
                        };
                    } catch(err){}
                });
            };
        } catch(e){}
    }

    $('clearItem').addEventListener('click', function(){ $('clearModal').classList.add('active'); });
    $('clearCancel').addEventListener('click', function(){ $('clearModal').classList.remove('active'); });
    $('clearConfirm').addEventListener('click', function(){
        localStorage.removeItem(MSG_KEY);
        clearGroupMemories(chatId);
        $('clearModal').classList.remove('active');
        showAlert('提示', '聊天记录与相关记忆已清空');
        if (window.parent !== window) {
            window.parent.postMessage({ type:'messagesCleared', chatId: chatId }, '*');
        }
    });

    // ========== 转让群主 ==========
    var transferTargetIdx = -1;
    $('transferItem').addEventListener('click', function(){
        transferTargetIdx = -1;
        var el = $('transferList');
        el.innerHTML = '';
        if (group.members.length === 0) {
            el.innerHTML = '<div class="transfer-empty">暂无可转让的群成员</div>';
        } else {
            group.members.forEach(function(m, i){
                var row = document.createElement('div');
                row.className = 'transfer-item';
                row.dataset.idx = i;
                var tvAvatar = m.avatar ? '<img src="' + m.avatar + '">' : (m.initial || m.name.charAt(0));
                row.innerHTML =
                    '<div class="tv-avatar" style="background:' + m.bg + ';">' + tvAvatar + '</div>' +
                    '<div class="tv-name">' + (m.nick || m.name) + '</div>' +
                    '<div class="tv-radio"></div>';
                row.addEventListener('click', function(){
                    el.querySelectorAll('.transfer-item').forEach(function(x){ x.classList.remove('on'); });
                    row.classList.add('on');
                    transferTargetIdx = i;
                    $('transferConfirm').disabled = false;
                });
                el.appendChild(row);
            });
        }
        $('transferConfirm').disabled = true;
        $('transferModal').classList.add('active');
    });

    $('transferCancel').addEventListener('click', function(){
        $('transferModal').classList.remove('active');
    });

    $('transferConfirm').addEventListener('click', function(){
        if (transferTargetIdx < 0 || !group.members[transferTargetIdx]) return;
        var newOwner = group.members[transferTargetIdx];
        var newOwnerName = newOwner.nick || newOwner.name;

        // 只转移群主身份：成员不进不出，用户也不会变成第二个成员
        group.ownerId = newOwner.id;
        group.members.forEach(function(m){
            m.role = (m.id === newOwner.id) ? '群主' : '成员';
        });
        // 用户不再是群主，头衔改为成员
        settings.myTitle = '成员';

        saveGroup(group);
        saveSettings(settings);
        syncToRegistry();
        pushPendingChange('用户把群主转让给了「' + newOwnerName + '」');

        $('transferModal').classList.remove('active');
        showAlert('提示', '已转让群主给「' + newOwnerName + '」');
        renderAll();

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'groupOwnerChanged', chatId: chatId }, '*');
        }
    });

    // ========== 退出群聊 ==========
    $('quitItem').addEventListener('click', function(){ $('quitModal').classList.add('active'); });
    $('quitCancel').addEventListener('click', function(){ $('quitModal').classList.remove('active'); });
    $('quitConfirm').addEventListener('click', function(){
        $('quitModal').classList.remove('active');
        group.userLeft = true;
        saveGroup(group);
        pushPendingChange('用户退出了群聊，之后只能围观大家聊天');
        showAlert('提示', '已退出群聊');
        setTimeout(function(){
            if (window.parent !== window) window.parent.postMessage({ type:'closeFullscreen' }, '*');
            else history.back();
        }, 1200);
    });

    // ========== 解散群聊 ==========
    $('dissolveItem').addEventListener('click', function(){ $('dissolveModal').classList.add('active'); });
    $('dissolveCancel').addEventListener('click', function(){ $('dissolveModal').classList.remove('active'); });
    $('dissolveConfirm').addEventListener('click', function(){
        clearGroupMemories(chatId);
        localStorage.removeItem(GROUP_KEY);
        localStorage.removeItem(MSG_KEY);
        localStorage.removeItem(SETTINGS_KEY);
        localStorage.removeItem(BG_KEY);
        localStorage.removeItem('group_pending_changes_' + chatId);
        // 从群列表移除，chat 页面的群卡片随之消失
        try {
            var raw = localStorage.getItem(GROUPS_KEY);
            if (raw) {
                var d = JSON.parse(raw);
                if (d && Array.isArray(d.groups)) {
                    d.groups = d.groups.filter(function(g){ return g && g.id !== chatId; });
                    localStorage.setItem(GROUPS_KEY, JSON.stringify(d));
                }
            }
        } catch(e){}
        $('dissolveModal').classList.remove('active');
        showAlert('提示', '群聊已解散');
        setTimeout(function(){
            if (window.parent !== window) window.parent.postMessage({ type:'groupDissolved', chatId: chatId }, '*');
            else history.back();
        }, 900);
    });

    // ========== 提示 ==========
    function showAlert(title, msg){
        $('alertTitle').textContent = title;
        $('alertMessage').textContent = msg;
        $('iosAlert').classList.add('active');
    }
    $('alertButton').addEventListener('click', function(){ $('iosAlert').classList.remove('active'); });

    // ========== 初始化 ==========
    renderAll();
    resolveIdentities().then(function(){ renderAll(); });
})();