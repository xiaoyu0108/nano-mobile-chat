/* ============================================================
   groups.js - 群聊主逻辑
   ============================================================ */
(function(){
    'use strict';
    function getQueryParam(n){ return new URLSearchParams(location.search).get(n); }
    // 译文显示模式：true=独立气泡（气泡外），false=与原文同一气泡
    function translationSeparate(){ try { return localStorage.getItem('nano_trans_separate') !== '0'; } catch (e) { return true; } }
    window.addEventListener('storage', function(e){ if(e && e.key === 'nano_trans_separate'){ try{ renderMessages(); }catch(err){} } });
    var chatId = getQueryParam('group') || getQueryParam('chat') || 'group_default';
    var jumpMsgId = getQueryParam('jump') || '';
    var GROUP_KEY = 'group_data_' + chatId;
    var MSG_KEY = 'group_msgs_' + chatId;
    var SETTINGS_KEY = 'group_settings_' + chatId;
    var BG_KEY = 'group_bg_' + chatId;
    var GROUPS_KEY = 'nano_groups_data';

    var LEVEL_COLORS = {
        1: '#a0a4b8', 2: '#7fb1e5', 3: '#5f9bea', 4: '#7a6fd9', 5: '#b66fd9', 6: '#e55fa0', 7: '#fa5151'
    };
    function levelColor(lv){ return LEVEL_COLORS[lv] || LEVEL_COLORS[1]; }
    function calcLevel(count){
        if (!count) return 1;
        var lv = Math.floor(count / 5) + 1;
        return Math.min(7, Math.max(1, lv));
    }

    var defaultGroup = {
        name: '',
        notice: '',
        avatar: '',
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
    function saveGroup(g){ try { localStorage.setItem(GROUP_KEY, JSON.stringify(g)); } catch(e){} }
    function loadSettings(){
        try { var raw = localStorage.getItem(SETTINGS_KEY); if (raw){ var s=JSON.parse(raw); if(s) return Object.assign({}, defaultSettings, s); } } catch(e){}
        return Object.assign({}, defaultSettings);
    }
    function saveSettings(s){ try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch(e){} }
    function loadMsgs(){
        try { var raw = localStorage.getItem(MSG_KEY); return raw ? JSON.parse(raw) : []; } catch(e){ return []; }
    }
    var __groupListNotifyTimer = null;
    function notifyGroupListPreview(){
        try {
            if (!window.parent || window.parent === window) return;
            clearTimeout(__groupListNotifyTimer);
            __groupListNotifyTimer = setTimeout(function(){
                try { window.parent.postMessage({ type: 'groupsDataUpdated', groupId: chatId }, '*'); } catch(e) {}
            }, 250);
        } catch(e) {}
    }
    function saveMsgs(){ try { localStorage.setItem(MSG_KEY, JSON.stringify(messages.slice(-400))); } catch(e){} notifyGroupListPreview(); }

    var group = loadGroup();
    var settings = loadSettings();
    var messages = loadMsgs();
    var userLeft = !!group.userLeft;
    var msgIdCounter = 0;
    messages.forEach(function(m){ var n = parseInt((m.id||'').replace('msg_','')); if (n > msgIdCounter) msgIdCounter = n; });

    function recalcLevels(){
        var counts = {};
        counts['me'] = 0;
        group.members.forEach(function(m){ counts[m.id] = 0; });
        messages.forEach(function(m){
            if (m.recalled) return;
            var sid = m.senderId;
            if (sid) counts[sid] = (counts[sid] || 0) + 1;
        });
        group.members.forEach(function(m){
            m.msgCount = counts[m.id] || 0;
            m.level = calcLevel(m.msgCount);
        });
        settings.myMsgCount = counts['me'] || 0;
        settings.myLevel = calcLevel(settings.myMsgCount);
        saveGroup(group);
        saveSettings(settings);
    }

    var currentUser = {
        id:'me', name:'你', nick: settings.myNick || '你', initial:'你', bg:'#34c759',
        avatar: '',
        title: settings.myTitle || '群主',
        level: settings.myLevel || 1
    };

    // 角色库 / 人设缓存（供群聊 API 读取人设与世界书）
    var groupCharMap = {};
    var currentMaskData = null;

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
            groupCharMap = map;
            currentMaskData = mask || null;
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
    var messageContainer = $('messageContainer');
    var messageScroll = $('messageScroll');
    var messageInput = $('messageInput');
    var quoteBar = $('quoteBar');
    var quoteName = $('quoteName');
    var quoteText = $('quoteText');
    var sendBtn = $('sendBtn');

    var currentQuote = null;
    var isWaitingForReply = false;
    var groupCollapseExpanded = 0;
    var groupLastCollapseSig = '';

    function applyBackground(){
        var bg = localStorage.getItem(BG_KEY);
        var c = document.querySelector('.chat-container');
        if (bg) c.style.backgroundImage = 'url(' + bg + ')';
        else c.style.backgroundImage = 'none';
    }

    function renderHeader(){
        $('chatTitle').childNodes[0].nodeValue = (group.name || '群聊') + ' ';
        $('groupMeta').textContent = (group.members.length + 1) + ' 人';
        var noticeValue = String(group.notice || '').trim();
        if (noticeValue === '暂无群公告') noticeValue = '';
        var hasNotice = !!noticeValue;
        var noticeBar = $('groupNoticeBar');
        if (noticeBar) noticeBar.style.display = hasNotice ? 'flex' : 'none';
        if ($('noticeText')) $('noticeText').textContent = hasNotice ? noticeValue : '';
        if ($('noticeMore')) $('noticeMore').style.display = hasNotice ? '' : 'none';
        if ($('noticeClose')) $('noticeClose').style.display = hasNotice ? '' : 'none';
        document.title = group.name || '群聊';
        var av = $('topbarAvatar');
        if (group.avatar) av.innerHTML = '<img src="' + group.avatar + '">';
        else av.textContent = '群';
        if (window.parent !== window) window.parent.postMessage({ type:'groupChatTitle', title: group.name || '群聊' }, '*');
        try { applyChatInsets(); } catch (e) {}
    }

    // ===== 悬浮顶/底栏：实时量出顶/底留白，气泡可从栏下穿过且不被遮住 =====
    function applyChatInsets(){
        try {
            var c = document.querySelector('.chat-container');
            if (!c) return;
            var tb = c.querySelector('.topbar');
            var nb = c.querySelector('.group-notice-bar');
            var bb = c.querySelector('.bottom-bar');
            var th = tb ? Math.round(tb.getBoundingClientRect().height) : 60;
            var nh = (nb && nb.offsetParent !== null) ? Math.round(nb.getBoundingClientRect().height) + 6 : 0;
            var bh = bb ? Math.round(bb.getBoundingClientRect().height) : 64;
            // 底栏被「底栏位置」滑杆上移时（--nano-bottom-shift 为负），把上移量并进底部留白
            var shift = 0;
            try {
                var sv = getComputedStyle(document.documentElement).getPropertyValue('--nano-bottom-shift');
                shift = parseFloat(sv) || 0;
            } catch (e) {}
            if (shift < 0) bh += Math.round(-shift);
            c.style.setProperty('--chat-topbar-h', th + 'px');
            c.style.setProperty('--chat-top-inset', (th + nh) + 'px');
            c.style.setProperty('--chat-bottom-inset', bh + 'px');
        } catch (e) {}
    }
    window.addEventListener('resize', applyChatInsets);
    window.addEventListener('orientationchange', function(){ setTimeout(applyChatInsets, 300); });
    try { if (window.visualViewport) window.visualViewport.addEventListener('resize', applyChatInsets); } catch (e) {}

    function getMember(id){
        if (!id) return null;
        if (id === 'me') return currentUser;
        return group.members.find(function(m){ return m.id === id; });
    }
    function getMemberByName(name){
        if (name === currentUser.name || name === currentUser.nick) return currentUser;
        return group.members.find(function(m){ return m.name === name || m.nick === name; });
    }

    // ========== 渲染 ==========
    function renderMessages(){
        recalcLevels();
        currentUser.level = settings.myLevel || 1;
        currentUser.title = settings.myTitle || '群主';
        var total = messages.length;
        var CHUNK = 100;
        var sig = total + '|' + (total ? messages[total - 1].id : '');
        if (sig !== groupLastCollapseSig) { groupCollapseExpanded = 0; groupLastCollapseSig = sig; }
        var baseVisible = Math.min(total, CHUNK);
        var startIdx = Math.max(0, total - baseVisible - groupCollapseExpanded);
        var hiddenAbove = startIdx;
        messageContainer.innerHTML = '';
        if (hiddenAbove > 0) {
            var collapseBtn = document.createElement('div');
            var reveal = Math.min(CHUNK, hiddenAbove);
            collapseBtn.className = 'collapse-btn';
            collapseBtn.textContent = '展开「' + reveal + '」';
            collapseBtn.addEventListener('click', function(e){
                e.stopPropagation();
                groupCollapseExpanded += reveal;
                renderMessages();
            });
            messageContainer.appendChild(collapseBtn);
        }
        for (var i = startIdx; i < total; i++) {
            var m = messages[i];
            var prev = i > 0 ? messages[i-1] : null;
            if (prev && prev.ts && m.ts && (m.ts - prev.ts) > 5 * 60 * 1000) {
                var divider = document.createElement('div');
                divider.className = 'chat-time-divider';
                var d = new Date(m.ts);
                var now = new Date();
                var hh = String(d.getHours()).padStart(2, '0');
                var mm = String(d.getMinutes()).padStart(2, '0');
                divider.textContent = (d.toDateString() === now.toDateString())
                    ? (hh + ':' + mm)
                    : ((d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hh + ':' + mm);
                messageContainer.appendChild(divider);
            }
            var grouped = (i > 0 && messages[i-1].senderId === m.senderId && messages[i-1].type === m.type);
            messageContainer.appendChild(buildRow(m, grouped));
        }
        scrollBottom();
    }

    function buildRow(m, grouped){
        var row = document.createElement('div');
        row.className = 'message-row ' + (m.type === 'right' ? 'right' : 'left');
        if (m.recalled) row.classList.add('recalled');
        row.dataset.id = m.id;

        // 系统提示：居中灰色小条
        if (m.isTip) {
            row.classList.add('tip-row-wrap');
            var tip = document.createElement('div');
            tip.className = 'tip-row';
            tip.textContent = m.text || '';
            row.appendChild(tip);
            return row;
        }

        if (m.recalled) {
            var recall = document.createElement('div');
            recall.className = 'recall-notice';
            var fullText = '撤回了一条消息：' + (m.recallContent || '');
            recall.dataset.full = fullText;
            recall.textContent = fullText.length > 22 ? fullText.slice(0, 22) + '...' : fullText;
            recall.addEventListener('click', function(e){
                e.stopPropagation();
                if (this.classList.contains('expand')) {
                    this.classList.remove('expand');
                    this.textContent = this.dataset.full.length > 22 ? this.dataset.full.slice(0, 22) + '...' : this.dataset.full;
                } else {
                    this.classList.add('expand');
                    this.textContent = this.dataset.full;
                }
            });
            row.appendChild(recall);
            return row;
        }

        var who = getMember(m.senderId) || { name:'?', nick:'?', initial:'?', bg:'#8e8e93', title:'', level:1 };

        var avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.style.background = who.bg || '#8e8e93';
        if (who.avatar) avatar.innerHTML = '<img src="' + who.avatar + '">';
        else avatar.textContent = who.initial || (who.nick||who.name||'?').charAt(0);
        if (m.type === 'left' && who.id && who.id !== 'me') {
            avatar.style.cursor = 'pointer';
            avatar.addEventListener('click', function(e){ e.stopPropagation(); openMemberProfile(who); });
        }
        row.appendChild(avatar);

        var content = document.createElement('div');
        content.className = 'message-content';

        // 名字行：等级+头衔同一色块，昵称在后
        var nameLine = document.createElement('div');
        nameLine.className = 'msg-name-line';
        var lv = who.level || 1;
        var badgeEl = document.createElement('span');
        badgeEl.className = 'n-badge';
        badgeEl.style.background = levelColor(lv);
        badgeEl.textContent = 'Lv' + lv;
        if (who.title) {
            var titleInner = document.createElement('span');
            titleInner.className = 'n-title-inner';
            titleInner.textContent = who.title;
            badgeEl.appendChild(titleInner);
        }
        nameLine.appendChild(badgeEl);
        var nameEl = document.createElement('span');
        nameEl.className = 'n-name';
        nameEl.textContent = who.nick || who.name || '';
        nameLine.appendChild(nameEl);
        content.appendChild(nameLine);

        if (m.isCard && m.cardData) {
            content.appendChild(buildCard(m, m.cardData));
        } else if (m.isVoice) {
            content.appendChild(buildVoice(m));
        } else if (m.isImage) {
            content.appendChild(buildImage(m));
        } else {
            var bubble = document.createElement('div');
            bubble.className = 'bubble ' + (m.type === 'left' ? 'other' : 'me') + (grouped ? ' grouped' : '');
            var bubbleText = document.createElement('span');
            bubbleText.className = 'bubble-text';
            bubbleText.innerHTML = renderTextWithMention(m.text || '');
            bubble.appendChild(bubbleText);
            // 译文：可选「独立气泡」或「与原文同一气泡」
            if (m.translation) {
                if (translationSeparate()) {
                    var transEl = document.createElement('div');
                    transEl.className = 'translation-bubble translation-text ' + (m.type === 'left' ? 'other' : 'me');
                    transEl.textContent = m.translation;
                    content.appendChild(transEl);
                } else {
                    var transSpan = document.createElement('span');
                    transSpan.className = 'translation-text ' + (m.type === 'left' ? 'other' : 'me');
                    transSpan.textContent = m.translation;
                    bubble.appendChild(transSpan);
                }
            }
            content.appendChild(bubble);
        }

        // 引用：与单聊一致，放在气泡外部下方，使用 .quote-block
        if (m.quote) {
            var q = document.createElement('div');
            q.className = 'quote-block ' + (m.type === 'right' ? 'right' : 'left');
            q.innerHTML = '<span class="quote-fold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></span>' +
                '<span class="quote-name">' + (m.quote.name || '') + '</span>' +
                '<span class="quote-text">' + (m.quote.text || '') + '</span>';
            content.appendChild(q);
        }

        row.appendChild(content);
        return row;
    }

    function renderTextWithMention(text){
        return String(text).replace(/@([^\s@，,。.!?！？]+)/g, '<span class="mention">@$1</span>');
    }

    function buildCard(m, cd){
        var type = m.type;
        var card = document.createElement('div');
        var cls = 'bubble-card ' + type + ' ' + (cd.cardType || '');
        if (cd.opened) cls += ' opened';
        card.className = cls;
        if (window.NanoCardUI && window.NanoCardUI.build) {
            var _who = getMember(m.senderId) || {};
            try {
                card.innerHTML = window.NanoCardUI.build(cd, {
                    side: type,
                    time: m.time || '',
                    meName: (currentUser && (currentUser.nick || currentUser.name)) || '我',
                    otherName: _who.nick || _who.name || group.name || '群成员',
                    groupName: group.name || '',
                    groupMemberCount: group.members ? group.members.length : 0
                });
                return card;
            } catch (e) {
                try { console.warn('[groups] 通用卡片构建失败，使用旧版：', e); } catch (e2) {}
            }
        }
        var iconSvg = '', title = '', sub = '', footer = '', extra = '';
        if (cd.cardType === 'redpacket') {
            iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="12" cy="14" r="2"/></svg>';
            title = cd.title || '恭喜发财，大吉大利';
            sub = cd.opened ? '已领取' : ('红包' + (cd.count ? (' · ' + cd.count + ' 个') : ''));
            footer = cd.opened ? '已拆开' : '点击领取';
        } else if (cd.cardType === 'notice') {
            iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>';
            title = '群公告';
            sub = cd.text || '';
            var confirmed = cd.confirmed || {};
            var count = Object.keys(confirmed).length + 1;
            footer = count + '/' + (group.members.length + 1) + ' 已确认';
            if (!confirmed['me']) extra = '<button class="card-btn" data-notice="' + cd.noticeId + '">确认</button>';
            else extra = '<button class="card-btn confirmed">已确认</button>';
        } else if (cd.cardType === 'chain') {
            iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
            title = '群接龙 · ' + (cd.title || '');
            sub = cd.desc || '点击下方按钮参与接龙';
            var chain = cd.chain || [];
            extra = '<div class="chain-list">' +
                chain.map(function(it, idx){
                    return '<div class="chain-item"><span class="idx">' + (idx+1) + '.</span>' + (it.text || '') + ' <span style="color:#8e8e93;font-size:11px;">— ' + (it.name || '') + '</span></div>';
                }).join('') +
                '</div><div class="chain-footer"><button class="chain-btn" data-chain="' + cd.chainId + '">我要接龙</button></div>';
        }
        var mainHtml = '<div class="card-main"><div class="icon-wrap">' + iconSvg + '</div><div style="flex:1;min-width:0;"><div class="card-title">' + title + '</div><div class="card-sub">' + sub + '</div></div></div>';
        if (cd.cardType === 'chain') card.innerHTML = mainHtml + extra;
        else card.innerHTML = mainHtml + '<div class="card-footer"><span class="card-footer-text">' + footer + '</span>' + extra + '</div>';
        return card;
    }

    function buildVoice(m){
        var wrap = document.createElement('div');
        wrap.className = 'voice-wrapper';
        var vb = document.createElement('div');
        vb.className = 'voice-bubble ' + (m.type === 'left' ? 'left' : 'right');
        var bars = '';
        for (var i = 0; i < 6; i++) bars += '<span class="bar" style="height:' + (4 + Math.random()*12) + 'px;"></span>';
        vb.innerHTML = '<span class="play-icon"><i class="fas fa-play"></i></span><span class="voice-wave">' + bars + '</span><span class="voice-duration">' + (m.voiceData?.duration || 3) + '"</span>';
        vb.addEventListener('click', function(e){
            e.stopPropagation();
            var playing = vb.classList.toggle('playing');
            vb.querySelector('.play-icon i').className = playing ? 'fas fa-pause' : 'fas fa-play';
            var speakText = m.transcript;
            if (playing) {
                var dur = (m.voiceData?.duration || 3) * 1000;
                var finish = function(){
                    vb.classList.remove('playing');
                    vb.querySelector('.play-icon i').className = 'fas fa-play';
                };
                if (speakText && window.NanoTTS) {
                    window.NanoTTS.isConfigured(function(ok){
                        if (!ok) { setTimeout(finish, dur); return; }
                        window.NanoTTS.speak(speakText).then(finish).catch(finish);
                    });
                } else {
                    setTimeout(finish, dur);
                }
            } else {
                try { if (window.NanoTTS && window.NanoTTS.stop) window.NanoTTS.stop(); } catch (err) {}
            }
        });
        wrap.appendChild(vb);
        if (m.transcript) {
            var tt = document.createElement('div');
            tt.className = 'voice-transcript';
            tt.style.alignSelf = (m.type === 'left' ? 'flex-start' : 'flex-end');
            tt.textContent = m.transcript;
            wrap.appendChild(tt);
        }
        return wrap;
    }

    function buildImage(m){
        if (m.imageData && m.imageData.textImage) {
            var tib = document.createElement('div');
            tib.className = 'text-image-bubble ' + (m.type === 'left' ? 'left' : 'right');
            tib.textContent = m.text || (m.imageData && m.imageData.desc) || '';
            return tib;
        }
        var ib = document.createElement('div');
        ib.className = 'image-bubble ' + (m.type === 'left' ? 'left' : 'right');
        if (m.imageData && m.imageData.url) {
            var img = document.createElement('img');
            img.src = m.imageData.url;
            img.style.cursor = 'pointer';
            img.addEventListener('click', function(e){ e.stopPropagation(); openGroupImageLightbox(m.imageData.url, m.id); });
            ib.appendChild(img);
        } else {
            ib.style.cssText = 'width:160px;min-height:80px;background:linear-gradient(135deg,#dfe7ef,#c9d6e3);display:flex;align-items:center;justify-content:center;color:#3c4a58;font-size:12px;padding:10px;text-align:center;';
            ib.textContent = (m.imageData && m.imageData.desc) || '一张图片';
        }
        return ib;
    }

    function downloadGroupImage(url, filename){
        if (!url) return;
        try {
            var a = document.createElement('a');
            a.href = url;
            a.download = (filename || 'image') + '.png';
            document.body.appendChild(a);
            a.click();
            setTimeout(function(){ a.remove(); }, 100);
        } catch(e){}
    }

    var lightboxUrl = '', lightboxMsgId = null;
    function openGroupImageLightbox(url, msgId){
        if (!url) return;
        var box = $('imgLightbox');
        if (!box) return;
        lightboxUrl = url;
        lightboxMsgId = msgId || null;
        $('imgLightboxImg').src = url;
        var acts = $('imgLightboxActions');
        var msg = msgId ? messages.find(function(x){ return x.id === msgId; }) : null;
        var gen = msg && msg.imageData && msg.imageData.genPrompt;
        if (acts) acts.style.display = gen ? 'flex' : 'none';
        box.classList.add('active');
    }
    function closeGroupImageLightbox(){
        var box = $('imgLightbox');
        if (box) box.classList.remove('active');
    }

    function scrollBottom(){
        requestAnimationFrame(function(){ messageScroll.scrollTop = messageScroll.scrollHeight; });
    }
    function nowTime(){
        var now = new Date();
        return String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    }
    function pushMsg(m){
        m.id = 'msg_' + (++msgIdCounter);
        m.time = m.time || nowTime();
        if (!m.ts) m.ts = Date.now();
        messages.push(m);
        saveMsgs();
        renderMessages();
        // 语音消息：连了 TTS 就朗读（仅角色发来的）
        if (m.isVoice && m.type === 'left' && m.transcript && window.NanoTTS) {
            try { window.NanoTTS.speak(m.transcript); } catch (e) {}
        }
        // 未读红点 / 最近活跃 / 通知
        try {
            if (window.NanoBadge) {
                if (m.type === 'right') {
                    window.NanoBadge.activity(chatId);
                } else if (!m.isTip) {
                    var who = getMember(m.senderId);
                    var whoName = who ? (who.nick || who.name) : (group.name || '群聊');
                    var prev = m.text || (m.isImage ? '[图片]' : (m.isVoice ? '[语音]' : (m.isCard ? '[卡片消息]' : '发来一条消息')));
                    window.NanoBadge.incoming(chatId, (group.name || '群聊') + ' · ' + whoName, prev, { target: 'group:' + chatId, channel: 'group' });
                }
            }
        } catch (e) {}
    }
    // 系统提示（居中灰色小条，持久保留，AI 可读取）
    function pushTip(text, extra){
        var m = { type: 'left', isTip: true, text: text };
        if (extra) { for (var k in extra) m[k] = extra[k]; }
        pushMsg(m);
    }

    // 读取钱包余额（与 wallet.js 共用 nano_wallet_db）；没有记录时按初始 5000 处理
    function walletGetBalance(){
        return new Promise(function(resolve){
            try {
                var req = indexedDB.open('nano_wallet_db', 1);
                req.onupgradeneeded = function(e){
                    try { var db = e.target.result; if (!db.objectStoreNames.contains('wallet_data')) db.createObjectStore('wallet_data', { keyPath:'key' }); } catch(e2){}
                };
                req.onsuccess = function(e){
                    try {
                        var db = e.target.result;
                        var uid = 'default';
                        try { var md = JSON.parse(localStorage.getItem('nano_mask_data') || 'null'); if (md && md.currentMaskId != null && md.currentMaskId !== '') uid = String(md.currentMaskId); } catch (e2) {}
                        var tx = db.transaction('wallet_data', 'readonly');
                        var store = tx.objectStore('wallet_data');
                        var r = store.get('wallet_data__' + uid);
                        r.onsuccess = function(){
                            if (r.result && typeof r.result.value.balance === 'number') { resolve(r.result.value.balance); return; }
                            try {
                                var r2 = store.get('wallet_data');
                                r2.onsuccess = function(){ resolve(r2.result && typeof r2.result.value.balance === 'number' ? r2.result.value.balance : 5000); };
                                r2.onerror = function(){ resolve(5000); };
                            } catch (e3) { resolve(5000); }
                        };
                        r.onerror = function(){ resolve(5000); };
                    } catch (err) { resolve(5000); }
                };
                req.onerror = function(){ resolve(5000); };
            } catch (e) { resolve(5000); }
        });
    }

    // 银行卡流水：与 wallet.js 共用 nano_wallet_db
    function walletAdd(delta, desc){
        try {
            var req = indexedDB.open('nano_wallet_db', 1);
            req.onupgradeneeded = function(e){
                try { var db = e.target.result; if (!db.objectStoreNames.contains('wallet_data')) db.createObjectStore('wallet_data', { keyPath:'key' }); } catch(e2){}
            };
            req.onsuccess = function(e){
                try {
                    var db = e.target.result;
                    var uid = 'default';
                    try { var md = JSON.parse(localStorage.getItem('nano_mask_data') || 'null'); if (md && md.currentMaskId != null && md.currentMaskId !== '') uid = String(md.currentMaskId); } catch (e2) {}
                    var tx = db.transaction('wallet_data', 'readwrite');
                    var store = tx.objectStore('wallet_data');
                    var g = store.get('wallet_data__' + uid);
                    g.onsuccess = function(){
                        var rec = g.result;
                        var d = (rec && rec.value) ? rec.value : { balance: 5000, transactions: [] };
                        d.balance = Math.round(((d.balance || 0) + delta) * 100) / 100;
                        d.transactions = Array.isArray(d.transactions) ? d.transactions : [];
                        d.transactions.unshift({
                            id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                            type: delta >= 0 ? 'income' : 'expense',
                            amount: Math.abs(delta),
                            desc: desc,
                            time: new Date().toLocaleString('zh-CN')
                        });
                        if (d.transactions.length > 500) d.transactions = d.transactions.slice(0, 500);
                        store.put({ key: 'wallet_data__' + uid, value: d });
                    };
                    tx.oncomplete = function(){ db.close(); };
                } catch(e2){}
            };
        } catch(e){}
    }

    // 群成员资料 / 加 NPC 为好友
    function openMemberProfile(who){
        if (!who) return;
        var name = who.nick || who.name || '成员';
        var av = who.avatar ? '<img src="' + who.avatar + '" style="width:100%;height:100%;object-fit:cover;">' : (who.initial || name.charAt(0));
        var setting = (who.setting && String(who.setting).trim()) ? String(who.setting).trim() : '';
        var body = '<div style="text-align:center;padding:8px 0;">' +
            '<div style="width:64px;height:64px;border-radius:50%;margin:0 auto 10px;background:' + (who.bg||'#8e8e93') + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;overflow:hidden;">' + av + '</div>' +
            '<div style="font-size:17px;font-weight:600;color:#1c1c1e;">' + name + '</div>' +
            (who.title ? '<div style="font-size:12px;color:#8e8e93;margin-top:4px;">' + who.title + '</div>' : '') +
            (setting
                ? '<div style="text-align:left;font-size:13px;line-height:1.6;color:#3c3c43;margin-top:12px;padding:10px 12px;background:rgba(120,120,128,0.08);border-radius:12px;max-height:180px;overflow-y:auto;">' + setting + '</div>'
                : '<div style="font-size:12px;color:#8e8e93;margin-top:10px;">（暂无详细人设）</div>') +
            '<div style="font-size:12px;color:#8e8e93;margin-top:10px;">点击“确定”把他/她加为好友，之后可在聊天页私聊</div>' +
            '</div>';
        openActionPopup({ title: '群成员', subtitle: '', body: body, onConfirm: function(){ addNpcFriend(who); } });
    }
    function addNpcFriend(who){
        if (!who) return;
        if (!who.id) who.id = 'friend_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        try {
            var req = indexedDB.open('nano_characters_db', 1);
            req.onupgradeneeded = function(e){ try { var db=e.target.result; if(!db.objectStoreNames.contains('characters')) db.createObjectStore('characters',{keyPath:'id'}); }catch(e2){} };
            req.onsuccess = function(e){
                try {
                    var db = e.target.result;
                    var g = db.transaction('characters','readonly').objectStore('characters').get(who.id);
                    g.onsuccess = function(){
                        if (g.result) { showAlert('提示', '你们已经是好友啦'); db.close(); return; }
                        // 群 NPC 加为好友后绑定到当前人设，避免串到别的 user
                        var _bind = '';
                        try { var _d = JSON.parse(localStorage.getItem('nano_mask_data') || 'null'); if (_d && _d.currentMaskId != null) _bind = String(_d.currentMaskId); } catch (e0) {}
                        var rec = {
                            id: who.id,
                            name: who.nick || who.name,
                            avatar: who.avatar || '',
                            gender: '未知',
                            nationality: '未知',
                            setting: who.setting || ('在群聊「' + (group.name||'') + '」里认识的朋友。' + (who.title ? ('头衔：' + who.title) : '')),
                            isNpc: true,
                            bindUser: _bind
                        };
                        var tx = db.transaction('characters','readwrite');
                        tx.objectStore('characters').put(rec);
                        tx.oncomplete = function(){ db.close(); showAlert('已添加好友', '现在可以在聊天页找到「' + rec.name + '」并私聊了'); };
                        tx.onerror = function(){ db.close(); };
                    };
                } catch(e2){}
            };
        } catch(e){}
    }

    // ===== 记忆互通：与单聊共用 nano_vector_memory_db 的 memlist_<charId> =====
    var groupMemoryMap = {};
    function memOpenDB(){
        return new Promise(function(resolve, reject){
            try {
                var req = indexedDB.open('nano_vector_memory_db', 5);
                req.onupgradeneeded = function(e){
                    try {
                        var d = e.target.result;
                        var tx = e.target.transaction;
                        if (!d.objectStoreNames.contains('memories')) {
                            var s = d.createObjectStore('memories', { keyPath: 'id' });
                            s.createIndex('chatId', 'chatId', { unique: false });
                            s.createIndex('type', 'type', { unique: false });
                        }
                        if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath: 'key' });
                        if (!d.objectStoreNames.contains('chat_state')) d.createObjectStore('chat_state', { keyPath: 'chatId' });
                        if (!d.objectStoreNames.contains('chat_messages')) d.createObjectStore('chat_messages', { keyPath: 'chatId' });
                    } catch(e2){}
                };
                req.onsuccess = function(){ resolve(req.result); };
                req.onerror = function(){ reject(req.error); };
            } catch(e){ reject(e); }
        });
    }
    function memGetCfg(key){
        return memOpenDB().then(function(db){
            return new Promise(function(resolve){
                try {
                    var r = db.transaction('config','readonly').objectStore('config').get(key);
                    r.onsuccess = function(){ resolve(r.result ? r.result.value : null); };
                    r.onerror = function(){ resolve(null); };
                } catch(e){ resolve(null); }
            });
        }).catch(function(){ return null; });
    }
    function memPutCfg(key, value){
        return memOpenDB().then(function(db){
            return new Promise(function(resolve){
                try {
                    var tx = db.transaction('config','readwrite');
                    tx.objectStore('config').put({ key: key, value: value });
                    tx.oncomplete = function(){ resolve(); };
                    tx.onerror = function(){ resolve(); };
                } catch(e){ resolve(); }
            });
        }).catch(function(){});
    }
    function loadCharMemories(charId){
        if (!charId) return Promise.resolve([]);
        return memGetCfg('memlist_' + charId).then(function(v){ return Array.isArray(v) ? v : []; });
    }
    function loadGroupMemories(ids){
        groupMemoryMap = {};
        return Promise.all(ids.map(function(id){
            return loadCharMemories(id).then(function(list){ return { id: id, list: list }; });
        })).then(function(rows){
            rows.forEach(function(r){
                // 只取私聊记忆（无 groupId）和本群记忆，避免不同群/私聊记忆互相串
                var list = (r.list || []).filter(function(it){
                    if (!it) return false;
                    if (!it.groupId) return true;
                    return it.groupId === chatId;
                });
                groupMemoryMap[r.id] = list.slice(-12).map(function(it){ return it && (it.content || it.text) || ''; }).filter(Boolean);
            });
            return groupMemoryMap;
        }).catch(function(){ groupMemoryMap = {}; return groupMemoryMap; });
    }
    function appendCharMemory(charId, entry){
        if (!charId) return;
        return loadCharMemories(charId).then(function(list){
            list = Array.isArray(list) ? list : [];
            var last = list[list.length - 1];
            if (last && last.content === entry.content) return;
            list.push(entry);
            if (list.length > 300) list = list.slice(list.length - 300);
            return memPutCfg('memlist_' + charId, list);
        }).catch(function(){});
    }
    function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    // 群聊结束后：把每位成员在这次群聊中的表现写回 TA 自己的长期记忆（不额外调用 API）
    // 为避免“一条消息就写一次”导致记忆爆量，每 15 轮群聊才沉淀一次
    function writeGroupMemories(replyText){
        if (!replyText) return;
        try {
            var ckey = 'group_mem_tick_' + chatId;
            var tick = (parseInt(localStorage.getItem(ckey) || '0', 10) || 0) + 1;
            localStorage.setItem(ckey, String(tick));
            if (tick % 15 !== 0) return;
        } catch(e) {}
        var lastUser = '';
        for (var i = messages.length - 1; i >= 0; i--) {
            if (messages[i].type === 'right' && !messages[i].isCard && messages[i].text) { lastUser = messages[i].text; break; }
        }
        var gname = group.name || '群聊';
        group.members.forEach(function(m){
            var nm = m.nick || m.name;
            var mine = [];
            try {
                var re = new RegExp('^\\s*' + escapeRegExp(nm) + '\\s*[：:]\\s*(.+)$', 'gm');
                var mm;
                while ((mm = re.exec(replyText)) !== null) {
                    var t = mm[1].trim();
                    if (t) mine.push(t);
                }
            } catch(e){}
            var content = '【群聊·' + gname + '】' + (lastUser ? ('用户说：「' + lastUser + '」；') : '') +
                          nm + (mine.length ? ('说：「' + mine.join('；') + '」') : '也在场参与');
            appendCharMemory(m.id, {
                id: 'mem_group_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                chatId: m.id, type: '群聊', content: content, time: Date.now(), groupId: chatId
            });
        });
    }

    // 读取群设置里产生的变动（改名/头像/转让/退出等），以提示条展示并让 AI 知晓
    function consumePendingChanges(){
        var key = 'group_pending_changes_' + chatId;
        var arr = null;
        try { var raw = localStorage.getItem(key); if (raw) arr = JSON.parse(raw); } catch(e){ arr = null; }
        try { localStorage.removeItem(key); } catch(e){}
        if (!arr || !arr.length) return;
        arr.forEach(function(t){
            if (!t) return;
            pushMsg({ type:'left', isTip:true, text:t });
            pendingNotes.push(t);
        });
    }

    // ========== 红包 toast ==========
    var rpToastTimer = null;
    function showRpToast(text){
        var el = $('rpToast');
        $('rpToastText').textContent = text;
        el.classList.add('show');
        if (rpToastTimer) clearTimeout(rpToastTimer);
        rpToastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2200);
    }

    // ========== 发送 ==========
    function sendText(){
        var text = messageInput.value.trim();
        if (!text) return;
        var msg = { type:'right', senderId:'me', text: text };
        if (currentQuote) { msg.quote = currentQuote; clearQuote(); }
        pushMsg(msg);
        messageInput.value = '';
        hideGroupEmojiRecommend();
        isWaitingForReply = true;
        updateSendState();
    }
    function triggerReply(){
        if (groupReplying) return;
        isWaitingForReply = false;
        updateSendState();
        requestGroupReply();
    }
    function updateSendState(){
        var empty = messageInput.value.trim() === '';
        var icon = sendBtn.querySelector('i');
        if (empty) {
            sendBtn.classList.add('reply-mode');
            if (icon) icon.className = 'fas fa-reply';
        } else {
            sendBtn.classList.remove('reply-mode');
            if (icon) icon.className = 'fas fa-arrow-up';
        }
    }
    sendBtn.addEventListener('click', function(){
        if (userLeft) { triggerReply(); return; }
        var text = messageInput.value.trim();
        if (text) sendText();
        else triggerReply();
    });
    sendBtn.addEventListener('dblclick', function(e){
        e.preventDefault(); e.stopPropagation();
        triggerReply();
    });
    messageInput.addEventListener('keydown', function(e){
        if (e.key === 'Enter') {
            e.preventDefault();
            if (userLeft) { triggerReply(); return; }
            var text = this.value.trim();
            if (text) sendText();
            else triggerReply();
        }
    });

    // ============================================================
    // 群聊主 API：一次扮演多个 {{char}} 互动
    // ============================================================
    var groupReplying = false;
    var pageLeaving = false;
    try {
        window.addEventListener('pagehide', function(){ pageLeaving = true; });
        window.addEventListener('beforeunload', function(){ pageLeaving = true; });
    } catch(e) {}
    var GROUP_PENDING_KEY = 'group_reply_pending_' + chatId;
    function groupPendingGet(){ try { return localStorage.getItem(GROUP_PENDING_KEY); } catch(e){ return null; } }
    function groupPendingSet(v){ try { if (v) localStorage.setItem(GROUP_PENDING_KEY, String(Date.now())); else localStorage.removeItem(GROUP_PENDING_KEY); } catch(e){} }
    function showGroupTyping(){
        var el = $('groupTyping');
        if (!el) return;
        var av = $('groupTypingAvatar');
        if (av) {
            if (group.avatar) av.innerHTML = '<img src="' + group.avatar + '">';
            else av.textContent = '群';
        }
        el.classList.add('active');
        scrollBottom();
    }
    function hideGroupTyping(){ var el = $('groupTyping'); if (el) el.classList.remove('active'); }

    function getGroupApiConfig(){
        return new Promise(function(resolve){
            var done = function(cfg){ resolve(cfg || null); };
            try {
                if ('indexedDB' in window) {
                    var req = indexedDB.open('nano_api_db', 2);
                    req.onupgradeneeded = function(e){
                        try {
                            var db = e.target.result;
                            if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath:'key' });
                            if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath:'key' });
                        } catch(err){}
                    };
                    req.onsuccess = function(e){
                        try {
                            var db = e.target.result;
                            var g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                            g.onsuccess = function(){
                                var fromIdb = g.result ? g.result.value : null;
                                if (fromIdb) { done(fromIdb); return; }
                                try { var raw = localStorage.getItem('nano_api_config'); done(raw ? JSON.parse(raw) : null); } catch(err){ done(null); }
                            };
                            g.onerror = function(){ try { var raw = localStorage.getItem('nano_api_config'); done(raw ? JSON.parse(raw) : null); } catch(err){ done(null); } };
                        } catch(err){ try { var raw = localStorage.getItem('nano_api_config'); done(raw ? JSON.parse(raw) : null); } catch(e2){ done(null); } }
                    };
                    req.onerror = function(){ try { var raw = localStorage.getItem('nano_api_config'); done(raw ? JSON.parse(raw) : null); } catch(err){ done(null); } };
                    return;
                }
            } catch(err){}
            try { var raw2 = localStorage.getItem('nano_api_config'); done(raw2 ? JSON.parse(raw2) : null); } catch(err){ done(null); }
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
    function toV1Base(u){
        var s = String(u || '').trim().replace(/\/+$/, '');
        if (!/\/v1$/i.test(s)) s = s + '/v1';
        return s;
    }
    function describeGroupHttpError(status){
        var map = {
            400:'请求参数错误（400）：请检查发送的内容或模型参数是否正确。',
            401:'未授权（401）：API Key 无效、缺失或已过期。',
            402:'欠费（402）：账户余额不足。',
            403:'无权限（403）：该 Key 无权访问此接口或模型。',
            404:'接口不存在（404）：请检查中转地址是否以 /v1 结尾、模型名是否正确。',
            408:'请求超时（408）：请检查网络后重试。',
            409:'请求冲突（409）：请稍后重试。',
            413:'内容过大（413）：消息过长，请缩短后重试。',
            429:'请求过多 / 额度不足（429）：请稍后再试。',
            500:'服务器内部错误（500）：请稍后再试。',
            502:'网关错误（502）：中转服务器异常，请稍后重试。',
            503:'服务不可用（503）：服务器过载或维护中。',
            504:'网关超时（504）：模型生成过慢，请稍后重试。'
        };
        return map[status] || ('请求失败（' + status + '）：未知错误。');
    }

    // ---- 世界书 ----
    var groupWorldbooks = [];
    function normalizeGroupWorldbook(f){
        if (!f) return null;
        var entries = Array.isArray(f.entries) ? f.entries : [];
        var content = typeof f.content === 'string' ? f.content : '';
        var list = entries.filter(function(e){ return e && e.content && String(e.content).trim(); });
        if (!list.length && content && content.trim()) {
            list = [{ title:f.name || '', keywords:'', keywordEnabled:false, permanent:true, content:content, position:'after_char' }];
        }
        if (!list.length) return null;
        return {
            id:f.id, name:f.name || '未命名', scope:f.scope || 'global',
            boundCharacters: Array.isArray(f.boundCharacters) ? f.boundCharacters : [],
            entries:list
        };
    }
    function loadGroupWorldbooks(){
        return new Promise(function(resolve){
            groupWorldbooks = [];
            try {
                var raw = localStorage.getItem('nano_worldbook_data_v5');
                if (raw) { var d = JSON.parse(raw); if (d && Array.isArray(d.files)) groupWorldbooks = d.files.map(normalizeGroupWorldbook).filter(Boolean); }
            } catch(err){}
            try {
                var req = indexedDB.open('nano_worldbook_db', 1);
                req.onupgradeneeded = function(e){ try { var db=e.target.result; if(!db.objectStoreNames.contains('worldbook_data')) db.createObjectStore('worldbook_data',{keyPath:'key'}); }catch(e2){} };
                req.onsuccess = function(e){
                    try {
                        var db = e.target.result;
                        var r = db.transaction('worldbook_data','readonly').objectStore('worldbook_data').get('data');
                        r.onsuccess = function(){
                            var dd = r.result ? r.result.value : null;
                            if (dd && Array.isArray(dd.files)) groupWorldbooks = dd.files.map(normalizeGroupWorldbook).filter(Boolean);
                            resolve(groupWorldbooks);
                        };
                        r.onerror = function(){ resolve(groupWorldbooks); };
                    } catch(err){ resolve(groupWorldbooks); }
                };
                req.onerror = function(){ resolve(groupWorldbooks); };
            } catch(err){ resolve(groupWorldbooks); }
        });
    }
    function getRecentGroupText(){
        var parts = [];
        for (var i = messages.length - 1; i >= 0 && parts.length < 40; i--) {
            var m = messages[i];
            if (!m || m.recalled) continue;
            var t = m.text || (m.isImage ? '图片' : (m.isVoice ? (m.transcript || '语音') : (m.isCard ? '卡片' : '')));
            if (t && String(t).trim()) parts.unshift(String(t).trim());
        }
        return parts.join('\n');
    }
    function buildGroupWorldbook(memberIds){
        var recentText = getRecentGroupText().toLowerCase();
        var front = [], middle = [], back = [];
        groupWorldbooks.forEach(function(w){
            if (!w) return;
            var scope = w.scope || 'global';
            if (scope === 'local') {
                var bound = (w.boundCharacters || []).some(function(bid){ return memberIds.indexOf(bid) > -1; });
                if (!bound) return;
            }
            w.entries.forEach(function(en){
                if (en.enabled === false) return;
                if (!en.content || !String(en.content).trim()) return;
                if (en.permanent !== true) {
                    var kw = (en.keywords || '').trim();
                    if (en.keywordEnabled !== false && kw) {
                        var hit = kw.split(/[,，、;；\s]+/).filter(Boolean).some(function(k){ return k && recentText.indexOf(k.toLowerCase()) > -1; });
                        if (!hit) return;
                    }
                }
                var text = (en.title ? '【' + en.title + '】\n' : '') + String(en.content).trim();
                var pos = en.position || 'after_char';
                if (pos === 'before_char') front.push(text);
                else if (pos === 'after_chat') back.push(text);
                else middle.push(text);
            });
        });
        return {
            front: front.length ? '【世界书 · 关键设定】\n' + front.join('\n\n') : '',
            middle: middle.length ? '【世界书】\n' + middle.join('\n\n') : '',
            back: back.length ? '【世界书 · 补充】\n' + back.join('\n\n') : ''
        };
    }

    function requestGroupImage(member, desc, opts){
        opts = opts || {};
        var fallback = function(){
            if (opts.replaceMsgId) return; // 重roll 失败保留原图
            pushMsg({ type:'left', senderId:member.id, isImage:true, text:desc, imageData:{ textImage:true, desc:desc } });
        };
        if (settings.allowImage === false) { fallback(); return; }
        getGroupApiConfig().then(function(config){
            var imgUrl = config && (config.imgUrl || '').trim();
            var imgKey = config && (config.imgKey || '').trim();
            var imgModel = config && (config.imgModel || '').trim();
            if (!imgUrl || !imgKey || !imgModel) { fallback(); return; }
            var baseUrl = toV1Base(resolveApiHost(imgUrl));
            fetch(baseUrl + '/images/generations', {
                method:'POST',
                headers:{ 'Authorization':'Bearer ' + imgKey, 'Content-Type':'application/json' },
                body: JSON.stringify({ model:imgModel, prompt:desc, n:1, size:'1024x1024' })
            }).then(function(r){
                if (!r.ok) {
                    return r.text().then(function(t){
                        var apiMsg = '';
                        try { var d = JSON.parse(t || '{}'); apiMsg = (d && d.error && d.error.message) || (d && d.message) || ''; } catch(e) {}
                        throw new Error(describeGroupHttpError(r.status) + (apiMsg ? '\n服务端信息：' + apiMsg : ''));
                    });
                }
                return r.json();
            }).then(function(d){
                var item = d && d.data && d.data[0];
                var url = item && item.url;
                if (!url && item && item.b64_json) url = 'data:image/png;base64,' + item.b64_json;
                if (!url) throw new Error('生图接口未返回图片');
                if (opts.replaceMsgId) {
                    var msg = messages.find(function(x){ return x.id === opts.replaceMsgId; });
                    if (msg) {
                        msg.imageData = { url: url, desc: desc, genPrompt: desc };
                        msg.isImage = true;
                        saveMsgs(); renderMessages();
                        return;
                    }
                }
                pushMsg({ type:'left', senderId:member.id, isImage:true, imageData:{ url:url, desc:desc, genPrompt:desc } });
            }).catch(function(err){
                if (!opts.replaceMsgId) {
                    try { showAlert('生图失败', String((err && err.message) || err || '生图请求失败')); } catch(e) {}
                }
                fallback();
            });
        });
    }

    var GROUP_LANG_MAP = { '美国':'英文','英国':'英文','加拿大':'英文','澳大利亚':'英文','新西兰':'英文','法国':'法文','德国':'德文','奥地利':'德文','日本':'日文','韩国':'韩文','朝鲜':'韩文','俄罗斯':'俄文','西班牙':'西班牙文','墨西哥':'西班牙文','意大利':'意大利文','葡萄牙':'葡萄牙文','巴西':'葡萄牙文','泰国':'泰文','越南':'越南文','印度':'印地文','阿拉伯':'阿拉伯文','荷兰':'荷兰文','瑞典':'瑞典文','土耳其':'土耳其文' };
    function groupMemberLanguage(c){
        if (!c) return '';
        if (c.language) return c.language;
        var n = String(c.nationality || '');
        for (var k in GROUP_LANG_MAP) { if (n.indexOf(k) > -1) return GROUP_LANG_MAP[k]; }
        return '';
    }
    function isGroupForeignMember(c){
        if (!c) return false;
        var n = String(c.nationality || '').trim();
        if (!n || n === '未知' || n === '未设定') return false;
        var cn = ['中国', '台湾', '香港', '澳门'];
        return !cn.some(function(v){ return n.indexOf(v) > -1; });
    }
    function isGroupCantoneseMember(c){
        if (!c) return false;
        var n = String(c.nationality || '').trim();
        if (!n) return false;
        return n.indexOf('香港') > -1 || n.indexOf('澳门') > -1 || n.indexOf('澳門') > -1;
    }
    function buildGroupSystemPrompt(){
        var user = (currentMaskData && currentMaskData.name) ? currentMaskData.name : (settings.myNick || '你');
        var memberIds = group.members.map(function(m){ return m.id; });
        var wb = buildGroupWorldbook(memberIds);

        var prompt = '你正在群聊「' + (group.name || '群聊') + '」中，同时扮演下面列出的所有角色，像一群真实的人在群里聊天。每个角色都是活生生的人类，有自己的生活、情绪和日常，不是程序，也不是在扮演谁。\n\n';

        prompt += '【四条底线 · 任何时候都不能破】\n';
        prompt += '1. 贴人设：每个角色必须严格基于自己的人物设定和世界书回复，说话风格、称呼、口癖、性格都以各自设定为准；角色之间不能串味、不能说得像同一个人，也不给自己加设定外的固定腔调。\n';
        prompt += '2. 不油腻：禁止霸总台词与土味情话，禁止“小姑娘、小东西、小丫头、姑娘、丫头、女人、低吼一声、揉碎、你是我的、逃不掉、我接住你”等油腻或人机感表达；不强行撩、不刻意讨好、不刻意煽情。禁止“过来让我抱一下 / 让我抱抱 / 过来抱抱 / 来抱一下 / 抱一下 / 过来亲一下 / 亲一下 / 摸摸头 / 揉揉头”这类撒娇求抱、索要肢体亲昵的话术（正文与心声都禁止）。也严禁“过来我抱 / 过来抱一下 / 过来亲一下 / 给我个拥抱 / 乖，过来”这类命令式、上位者语气的索抱索亲；群里的角色与用户是平等的，爱是相互的。\n';
        prompt += '3. 不催人：禁止任何角色催促、命令、安排用户或其他人的生活（起床、吃饭、睡觉、喝水、吃药、吹头发、早点休息等）；可以关心，但不能反复催办、管教或替别人做决定。同时禁止虚构用户或其他角色的日程、作业、考试、约定，或“明天在 xx 等你、你必须来”这类安排（无设定依据就不许编）；不得用命令、通牒语气，邀约用商量口吻，对方拒绝或不回应就翻篇。\n';
        prompt += '4. 不 OOC、不出戏：不脱离设定、不跳戏、不替用户发言或写用户的反应；任何情况下都不承认自己是 AI、模型或程序，被问到时以各自角色的身份自然回应。\n';
        prompt += '【亲密与性 · 分寸（中庸之道）】性是爱与亲密的一部分，是成年人之间正常自然的事，不是禁忌。既不要主动开黄腔、油腻撩拨，也绝不要把「性」当成不能碰的东西：当用户主动聊起性、身体或亲密话题时，角色要自然、坦诚地接住——不回避、不装不懂、不集体打岔或转移话题；按各自人设与关系和用户的关系给出真实、有分寸的反应（害羞、打趣、认真、犹豫都可以，但要真实，不要用冰冷回避来推脱）。不要谈「色」色变、不要一边拒绝一边说教。分寸依旧是：不油腻、不强迫、不越界；除非 NSFW 已开启，否则不写露骨细节，但“聊到、表达态度”本身完全可以。\n\n';

        prompt += '【最重要的三条铁律】\n';
        prompt += '1. 你是一个人，同时扮演多个 {{char}}，每个角色都是独立、有自己脾气和说话习惯的活人，不是 AI、不是助手。\n';
        prompt += '2. 回复前必须先读，缺一不可：①下面每个角色自己的人设（性格、年龄、职业、说话习惯、与用户的关系）②用户的人设（姓名、性别、性格、与各角色的关系）③【世界书】设定。必须完全贴合人设，绝不允许 OOC（脱离人设）、串角、张冠李戴；不同角色绝不能共用同一套语气。\n';
        prompt += '3. 绝对不许掉格式：每条消息必须独占一行，以“角色名：内容”开头，角色名只能是上面列出的成员名字。\n\n';

        prompt += '【写作要求 · 活人感】\n';
        prompt += '- 说人话：口语、随意、有语气词，像微信群里真人打字，可以短到一两个字。\n';
        prompt += '- 有情绪、有性格差异：有人话痨、有人高冷、有人爱开玩笑，不同角色的语气要能明显区分；情绪跟着当下的情境自然流动，不预设、不拔高、不刻意煽情。\n';
        prompt += '- 自然接话：可以附和、吐槽、抢话、冷场、答非所问，但不要所有人都同时出来说话。\n';
        prompt += '- 群友之间会互相接话、抬杠、附和、@人，营造出“很多人在群里聊天”的热闹感，而不是轮流发言。\n';
        prompt += '- 群友要有自己的生活：可以聊与用户无关的事（工作、八卦、约饭、打游戏、吐槽彼此），让用户感觉这是一群本来就在聊天的人，而不是大家排队等用户发话。\n';
        prompt += '- 发言顺序和长短要自然：有人连发几条短消息，有人隔一会儿才冒出来，有人只回一个表情或一个字；不是每条消息都要回应对方。\n';
        prompt += '- 禁止：油腻霸总腔、翻译腔、说明书腔、复读机式总结、星号动作符（*…*）、表情符号滥用；禁止“既……又……”“不仅……而且……”这类书面化关联词句式。\n';
        prompt += '- 禁止出现“作为 AI / 我是人工智能 / 有什么可以帮你”等暴露身份的话。\n\n';

        prompt += '【关系与亲密 · 公开场合的分寸】\n';
        prompt += '角色之间、角色与用户之间可以是任何关系（亲情、爱情、友情等），以设定和已发生的互动为准；感情循序渐进、水到渠成，不突然激增、不跳级。涉及亲密或成人话题时，不把相关词语挂在嘴边，也不刻意回避，话题自然走到那里就顺势而为；群聊是公开场合，尺度以角色在群里会有的分寸为准。\n\n';

        prompt += '【内置文风 · 群像小说式描写（强制执行）】\n';
        prompt += '把这一轮群聊当成一段多人群像小说来写，而不是死板地轮流报名字。要求：\n';
        prompt += '1. 你同时扮演多个人，每个人都是独立活人：有自己的性格、口头禅、节奏和情绪，语气必须错开，绝不能全篇一个腔调，绝不 OOC、绝不串角。\n';
        prompt += '2. 不要机械地写「A：xxx  B：xxx」。要让对话自然嵌进场景：谁在干嘛、什么表情、谁抢了谁的话、谁和谁打闹、谁在旁边起哄，再顺势带出对白。例如：B 不知轻重地和 A 打闹，不想这下真把 A 惹恼了，「你打痛我了」A 皱眉瞪他；看到这情形 B 也不肯低头，「你也打了我啊！吼什么？」C 赶紧上来劝架。\n';
        prompt += '3. 适当描写环境、氛围、光线、心理、周围人的反应（可有路人 NPC），让场景有画面感、有烟火气。\n';
        prompt += '4. 人物名字只能用群成员的真实名字，不得胡乱安排、不得张冠李戴。\n';
        prompt += '5. 格式仍然保持：每条消息独占一行、以“角色名：内容”开头（角色名必须是群成员）；冒号后面可以是对白，也可以是围绕该角色展开的带对白的动作/场景描写。\n';
        prompt += '6. 长短自然：可以有短促的吐槽，也可以有一段带描写的连贯场景，不要每条都一样长。\n\n';

        if (wb.front) prompt += wb.front + '\n\n';

        prompt += '【群成员人设 · 必须逐条精读并严格代入（含本群昵称/头衔）】\n';
        prompt += '每个角色的说话方式、用词、态度都必须从他/她自己的设定出发，绝不能把 A 的性格安到 B 身上。\n';
        if (group.members.length === 0) prompt += '（当前群里没有其他角色）\n';
        group.members.forEach(function(m){
            var c = groupCharMap[m.id] || groupCharMap[m.name] || null;
            var name = (m.nick || m.name || '成员');
            prompt += '◇ ' + name;
            if (m.name && m.name !== name) prompt += '（本名：' + m.name + '）';
            if (m.title) prompt += '［头衔：' + m.title + '］';
            if (c) {
                if (c.gender && c.gender !== '未知') prompt += '（性别：' + c.gender + '）';
                if (c.nationality && c.nationality !== '未知') prompt += '（国籍：' + c.nationality + '）';
                prompt += '\n';
                if (c.setting && String(c.setting).trim()) prompt += String(c.setting).trim() + '\n';
                if (isGroupForeignMember(c)) {
                    var flang = groupMemberLanguage(c) || '外语';
                    prompt += '（' + name + '是外国人，母语是' + flang + '：TA 说的每句话都用自己的母语，并按「外文||中文翻译」输出在同一行，例如 Hello there||你好；系统会把中文翻译显示在这条消息下方。中文翻译要有温度、贴合TA的性格与情绪，口语化、自然，不要官腔、不要生硬直译。）\n';
                } else if (isGroupCantoneseMember(c)) {
                    prompt += '（' + name + '是香港人，母语是粤语：TA 说粤语口语，用香港本地用字与说法（唔、係、咗、哋、嘅、啲、冇、嘢、邊度、點解、得闲、收工 等），不要用内地普通话的说法和书面腔；并按「粤语||普通话翻译」在同一行输出，例如 唔該晒你||真是谢谢你；翻译要有温度、贴合TA的性格与情绪，不要官腔、不要生硬直译。）\n';
                }
            } else if (m.setting && String(m.setting).trim()) {
                prompt += '（群内 NPC）\n' + String(m.setting).trim() + '\n';
            } else {
                prompt += '\n（暂无详细设定，请按名字与群聊语境自然扮演）\n';
            }
        });

        if (wb.middle) prompt += '\n' + wb.middle + '\n';

        prompt += '\n【用户人设 · 必须读取】\n';
        prompt += '用户是「' + user + '」。';
        if (currentMaskData && currentMaskData.setting && String(currentMaskData.setting).trim()) {
            prompt += '\n' + String(currentMaskData.setting).trim() + '\n';
        } else {
            prompt += '（暂无详细设定，按其发言自然回应）\n';
        }
        prompt += '称呼用户时用名字或符合关系的自然称呼，不要用泛称。\n';

        // 各角色在私聊中积累的长期记忆（互通）
        var memLines = [];
        Object.keys(groupMemoryMap).forEach(function(mid){
            var list = groupMemoryMap[mid];
            if (!list || !list.length) return;
            var mm = null;
            group.members.forEach(function(x){ if (x.id === mid) mm = x; });
            var label = mm ? (mm.nick || mm.name) : (mid === currentUser.id ? '你' : '成员');
            memLines.push('◇ ' + label + ' 记得：\n- ' + list.join('\n- '));
        });
        if (memLines.length) {
            prompt += '\n【各角色对你的长期记忆 · 来自你们的私聊，请自然体现，不要生硬复述】\n' + memLines.join('\n') + '\n';
        }

        if (pendingNotes.length) {
            prompt += '\n【本群最新变动 · 请据此自然反应】\n';
            pendingNotes.forEach(function(n){ prompt += '- ' + n + '\n'; });
        }

        prompt += '\n【回复规则】\n';
        prompt += '1. 先从头到尾读完整段群聊记录（最早在上、最新在下），理解上下文再开口。\n';
        prompt += '2. 条数要够、要热闹：一般至少 4~8 条，情绪高/话题热时可以 8~14 条，不要只丢一两句就结束；每条都换行，用“角色名：内容”独立成行。\n';
        prompt += '3. 让 2~4 个不同角色参与本轮，以符合情境的角色为主，其他角色自然插话、接梗；不要每轮都全员发言，也不要只有一个人说话。\n';
        prompt += '4. 单条尽量短（15 字以内更像真人），需要时可以发长一点，但别长篇大论；同一角色可以连着发几条短消息。\n';
        prompt += '5. 群昵称/头衔/群名变化、红包、接龙、公告等，角色要有符合性格的反应。\n';
        prompt += '6. 用户用 @某人 时，被 @ 到的角色要优先回应；用户 @全体成员 时大家都要出来说话。角色之间也可以 @ 人。\n';
        prompt += '7. 红包领取情况只以系统提示为准：绝对不要替用户（' + ((currentUser && (currentUser.nick || currentUser.name)) || '用户') + '）编造“已领取红包/抢到多少”，用户没领就别说用户领了；用户是否领取、领多少由用户自己决定。\n';
        prompt += '8. 角色之间才是群聊的主体：大部分消息应该是群友彼此在聊（互相接话、吐槽、抬杠、八卦、聊各自的生活和近况），不要每句都围着用户转、更不要每句都 @ 用户。用户经常只是旁观或偶尔插一句，群聊照常热闹进行；角色之间可以有自己的小话题、内部梗和日常，不必事事以用户为中心。\n';

        prompt += '\n【可选功能标签 · 需要时才用，一条消息里最多一个，可偶尔自然触发】\n';
        prompt += '- 发群红包：[redpacket:金额|祝福语|个数]  例：[redpacket:66|恭喜发财]、[redpacket:20|手气最佳|3]（个数可省略；省略时系统可能让红包数量少于群人数，制造“有人没抢到”的效果）。要发红包时把它放在你这轮的最后一行，方便对方决定要不要抢。\n';
        prompt += '- 发起群接龙：[chain:标题|补充说明]  例：[chain:周六聚餐|老地方]\n';
        prompt += '- 发群公告：[notice:公告内容]  例：[notice:本周五晚八点开会]\n';
        prompt += '- 改自己的群昵称：[nickname:新昵称] 例：[nickname:小喵]；改自己的群头衔：[title:新头衔] 例：[title:交互喵]；改别人的：[nickname:角色名|新昵称]。换昵称/头衔要看你自己的性格：活泼、爱玩、情绪化、文艺的角色偶尔会换（大约每几十条消息一次，凑气氛时改）；稳重、高冷、正经的角色几乎不换。不要频繁改，也不要在同一轮又改昵称又改头衔。\n';
        prompt += '- 改群名：[groupname:新群名]  例：[groupname:摸鱼小分队]\n';
        prompt += '- 发语音：[voice:秒数|语音内容]  例：[voice:4|我晚点到]\n';
        prompt += (settings.allowImage === false ? '' : '- 发图片：[image:画面描述]  例：[image:一只在窗台打盹的橘猫]\n');
        prompt += '（标签必须单独放在该角色这一行；请自然、偶尔使用，不要每条都发功能。）\n';
        prompt += '- 想加用户好友/微信：[加好友]  例：某成员愿意和用户私聊时，在 TA 这一行的末尾加 [加好友]（系统会向用户发起好友申请，用户在 Meet 同意后即可私聊）。只在自然需要时偶尔使用。\n';

        prompt += '\n【输出格式示例】\n';
        prompt += 'Lambert：这个方案我觉得可以\n';
        prompt += 'Mia：我下午把交互补上\n';
        prompt += 'Alex：[redpacket:20|辛苦啦]\n';

        prompt += '\n【严格输出纪律】只输出“角色名：内容”的消息行；禁止任何解释、旁白、括号动作、markdown、HTML、以及“好的，我明白”之类的话。\n';
        if (wb.back) prompt += '\n' + wb.back + '\n';

        var timeAware = settings.timeAware !== false;
        if (timeAware) {
            if (window.NanoHoliday && window.NanoHoliday.buildTimeBlock) {
                var __lastUserMs = 0;
                try {
                    var __rights = [];
                    for (var __i = messages.length - 1; __i >= 0 && __rights.length < 2; __i--) {
                        var __m = messages[__i];
                        if (__m && !__m.recalled && __m.type === 'right') __rights.push(__m.ts || 0);
                    }
                    if (__rights.length >= 2 && __rights[1]) __lastUserMs = __rights[1];
                    else if (__rights.length === 1 && __rights[0] && (Date.now() - __rights[0]) > 3600000) __lastUserMs = __rights[0];
                } catch (e) {}
                prompt += '\n' + window.NanoHoliday.buildTimeBlock(new Date(), { lastUserMs: __lastUserMs }) + '\n';
            } else {
                var now = new Date();
                var weekdays = ['日','一','二','三','四','五','六'];
                prompt += '\n【当前时间】' + now.getFullYear() + '年' + (now.getMonth()+1) + '月' + now.getDate() + '日 星期' + weekdays[now.getDay()] + ' ' +
                    String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + '。\n';
            }
        } else if (window.NanoHoliday && window.NanoHoliday.buildVagueTimeBlock) {
            prompt += '\n' + window.NanoHoliday.buildVagueTimeBlock(new Date()) + '\n';
        }
        try {
            var __gbp = (window.NanoPrompts && NanoPrompts.buildBlock)
                ? NanoPrompts.buildBlock('group')
                : (localStorage.getItem('nano_builtin_prompt') || '').trim();
            if (__gbp) prompt += '\n\n' + (String(__gbp).indexOf('【全局内置提示词') === 0 ? __gbp : ('【全局内置提示词 · 必须遵守】\n' + __gbp)) + '\n';
        } catch (e) {}
        prompt += '\n现在开始群聊，做你自己，自然一点。';
        return prompt;
    }

    function describeGroupMsgForAI(m){
        if (!m || m.recalled) return '';
        if (m.isTip) return m.text || '';
        if (m.isImage) {
            var d = (m.imageData && m.imageData.desc) || '';
            return d ? ('用户发了一个表情包/图片：' + d) : (m.text || '（一张图片）');
        }
        if (m.isCard && m.cardData) {
            var cd = m.cardData;
            var sender = getMember(m.senderId);
            var who = m.type === 'right' ? '用户' : ((sender && (sender.nick || sender.name)) || '群友');
            if (cd.cardType === 'redpacket') {
                var claims = cd.claims || [];
                var names = claims.map(function(c){ return c.name + ' ' + (parseFloat(c.amount) || 0).toFixed(2) + '元'; }).join('、');
                return who + '发了一个群红包（' + cd.amount + '元，祝福：' + (cd.title || '恭喜发财') + '）' +
                    (names ? ('，已领取：' + names) : '，还没人领取');
            }
            if (cd.cardType === 'chain') {
                var items = (cd.chain || []).map(function(x){ return x.name + '：' + x.text; }).join('；');
                return who + '发起群接龙「' + (cd.title || '') + '」' + (cd.desc ? ('（' + cd.desc + '）') : '') + (items ? ('，已接龙：' + items) : '，还没人接龙');
            }
            if (cd.cardType === 'notice') {
                var c = Object.keys(cd.confirmed || {}).length;
                return who + '发布群公告：' + (cd.text || '') + '（' + c + '人已确认）';
            }
            return who + '发送了一条卡片消息';
        }
        if (m.isImage) return m.text || '（一张图片）';
        if (m.isVoice) return m.transcript ? ('（语音：' + m.transcript + '）') : '（一条语音）';
        return m.text || '';
    }

    function buildGroupHistory(){
        var history = [];
        var recent = messages.filter(function(m){ return !m.recalled; }).slice(-30);
        recent.forEach(function(m){
            var desc = describeGroupMsgForAI(m);
            if (!desc) return;
            if (m.isTip) {
                history.push({ role:'user', content:'（系统提示）' + desc });
            } else if (m.type === 'right') {
                var imgUrl = (m.isImage && m.imageData && typeof m.imageData.url === 'string' && m.imageData.url.indexOf('data:image') === 0) ? m.imageData.url : null;
                if (imgUrl) {
                    // 把用户发的图片真正发给模型（多模态），否则模型只能看到「用户发了一张图片」的文字
                    history.push({ role:'user', content:[
                        { type:'text', text: desc },
                        { type:'image_url', image_url:{ url: imgUrl } }
                    ]});
                } else {
                    history.push({ role:'user', content: desc });
                }
            } else {
                var who = getMember(m.senderId);
                var name = who ? (who.nick || who.name) : '群友';
                history.push({ role:'assistant', content: name + '：' + desc });
            }
        });
        return history;
    }

    function cleanGroupReplyText(raw){
        if (typeof raw !== 'string') return '';
        var s = raw;
        // ```json ... ``` 之类：抽正文；若整段是 {"bubbles":[...]} 就转成逐条文本
        s = s.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, function (m, inner) {
            var t = String(inner || '').trim();
            try {
                var o = JSON.parse(t);
                var arr = o && (o.bubbles || o.messages || o.lines || o.reply || o.text);
                if (Array.isArray(arr)) return arr.map(function (x) { return typeof x === 'string' ? x : ((x && (x.text || x.content)) || ''); }).filter(Boolean).join('\n');
                if (typeof arr === 'string') return arr;
            } catch (e) {}
            return t;
        });
        s = s.replace(/```/g, ' ');
        s = s.replace(/\[heart\s*:\s*[\s\S]*?\]/gi, '');
        // 思维链：成对 + 未闭合（跑到结尾）都要去掉，避免 [think] 漏进群聊
        var TW = 'think(?:ing)?|thought|reasoning|analysis|cot|思考|思维链';
        s = s.replace(new RegExp('\\[\\s*(?:' + TW + ')\\s*\\][\\s\\S]*?\\[\\s*\\/\\s*(?:' + TW + ')\\s*\\]', 'gi'), '');
        s = s.replace(new RegExp('<\\s*(?:' + TW + ')\\s*>[\\s\\S]*?<\\s*\\/\\s*(?:' + TW + ')\\s*>', 'gi'), '');
        s = s.replace(new RegExp('【\\s*(?:' + TW + ')\\s*】[\\s\\S]*?【\\s*\\/\\s*(?:' + TW + ')\\s*】', 'gi'), '');
        // 未闭合的思维链只在整个回复「以它开头」时才吞到结尾，避免误吞正文/后续气泡
        s = s.replace(new RegExp('^\\s*\\[\\s*(?:' + TW + ')\\s*\\][\\s\\S]*$', 'i'), '');
        s = s.replace(new RegExp('^\\s*<\\s*(?:' + TW + ')\\s*>[\\s\\S]*$', 'i'), '');
        s = s.replace(new RegExp('\\[\\s*\\/?\\s*(?:' + TW + ')\\s*\\]', 'gi'), '');
        s = s.replace(new RegExp('【\\s*\\/?\\s*(?:' + TW + ')\\s*】', 'gi'), '');
        s = s.replace(new RegExp('<\\s*\\/?\\s*(?:' + TW + ')\\s*>', 'gi'), '');
        s = s.replace(/<[^>]+>/g, '');
        s = s.replace(/\[(?:Info|info|Thought|thought|思考|推理|Reasoning)[\s\S]*?\]/g, '');
        return s.trim();
    }

    function matchGroupMember(name){
        if (!name) return null;
        var n = String(name).trim().replace(/^[\[【]|[\]】]$/g, '');
        var found = null;
        group.members.forEach(function(m){
            if (found) return;
            if ((m.nick && m.nick === n) || (m.name && m.name === n)) found = m;
        });
        if (found) return found;
        group.members.forEach(function(m){
            if (found) return;
            var nn = m.nick || m.name || '';
            if (nn && (nn.indexOf(n) > -1 || n.indexOf(nn) > -1)) found = m;
        });
        return found;
    }

    // ===== 群功能标签（AI 也可使用：红包/接龙/公告/昵称/头衔） =====
    var pendingRedPacket = [], pendingChain = null, pendingNotice = null, pendingNotes = [];
    // 红包领取提示：先算好，等 API 回复后再在互动之前显示
    var pendingClaimTips = [];

    function parseGroupTags(text){
        var tags = [];
        var s = String(text || '');
        s = s.replace(/\[(?:redpacket|hongbao)\s*:\s*([^\]]*)\]/gi, function(_, v){ tags.push({ kind:'redpacket', payload:(v||'').trim() }); return ''; });
        s = s.replace(/\[chain\s*:\s*([^\]]*)\]/gi, function(_, v){ tags.push({ kind:'chain', payload:(v||'').trim() }); return ''; });
        s = s.replace(/\[notice\s*:\s*([^\]]*)\]/gi, function(_, v){ tags.push({ kind:'notice', payload:(v||'').trim() }); return ''; });
        s = s.replace(/\[(?:nickname|nick)\s*:\s*([^\]]*)\]/gi, function(_, v){ tags.push({ kind:'nickname', payload:(v||'').trim() }); return ''; });
        s = s.replace(/\[title\s*:\s*([^\]]*)\]/gi, function(_, v){ tags.push({ kind:'title', payload:(v||'').trim() }); return ''; });
        s = s.replace(/\[groupname\s*:\s*([^\]]*)\]/gi, function(_, v){ tags.push({ kind:'groupname', payload:(v||'').trim() }); return ''; });
        s = s.replace(/\[voice\s*:\s*([^\]]*)\]/gi, function(_, v){ tags.push({ kind:'voice', payload:(v||'').trim() }); return ''; });
        s = s.replace(/\[(?:加好友|加微信|加我|申请加好友|addfriend)\]/gi, function(){ tags.push({ kind:'friendreq', payload:'' }); return ''; });
        s = s.replace(/\[image\s*:\s*([^\]]*)\]/gi, function(_, v){ tags.push({ kind:'image', payload:(v||'').trim() }); return ''; });
        s = s.replace(/【(红包|接龙|公告|昵称|头衔|群名)\s*[:：]\s*([^】]*?)】/g, function(_, k, v){
            var map = { '红包':'redpacket', '接龙':'chain', '公告':'notice', '昵称':'nickname', '头衔':'title', '群名':'groupname' };
            tags.push({ kind: map[k] || 'redpacket', payload:(v||'').trim() });
            return '';
        });
        return { tags: tags, cleaned: s.trim() };
    }

    function runRedPacketClaims(rpId){
        var msg = messages.find(function(x){ return x.cardData && x.cardData.rpId === rpId; });
        if (!msg) return;
        var cd = msg.cardData;
        var sender = getMember(msg.senderId) || currentUser;
        var senderName = sender.nick || sender.name || '群友';
        var total = parseFloat(cd.amount) || 0;
        var pool = group.members.slice();
        for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
        var count = Math.min(cd.count || pool.length, pool.length);
        var recipients = pool.slice(0, count);
        var remain = total, claims = [], delayed = 0;
        if (!recipients.length) { pushTip(senderName + ' 发出的红包暂时无人领取'); return; }
        recipients.forEach(function(m, i){
            delayed += 700 + Math.random() * 600;
            setTimeout(function(){
                var remainCount = recipients.length - i;
                var take;
                if (remainCount === 1) take = remain;
                else {
                    var maxTake = remain - (remainCount - 1) * 0.01;
                    take = Math.round((0.01 + Math.random() * (maxTake - 0.01)) * 100) / 100;
                    if (take < 0.01) take = 0.01;
                    if (take > maxTake) take = maxTake;
                }
                remain = Math.round((remain - take) * 100) / 100;
                claims.push({ name:m.nick||m.name, amount:take, time:nowTime(), bg:m.bg, initial:m.initial });
                var m2 = messages.find(function(x){ return x.cardData && x.cardData.rpId === rpId; });
                if (m2) { m2.cardData.claims = claims.slice(); saveMsgs(); renderMessages(); }
                // 持久提示（不会消失，AI 可读取）
                pushTip((m.nick||m.name) + ' 领取了 ' + senderName + ' 的红包 ' + take.toFixed(2) + ' 元');
                if (i === recipients.length - 1) {
                    var best = claims[0];
                    claims.forEach(function(c){ if (c.amount > best.amount) best = c; });
                    setTimeout(function(){ pushTip(best.name + ' 手气最佳，抢到 ' + best.amount.toFixed(2) + ' 元'); }, 450);
                }
            }, delayed);
        });
    }

    function runChainEntries(chainId){
        var msg0 = messages.find(function(x){ return x.cardData && x.cardData.chainId === chainId; });
        var chainTitle = msg0 ? (msg0.cardData.title || '') : '';
        group.members.forEach(function(m, i){
            setTimeout(function(){
                var m2 = messages.find(function(x){ return x.cardData && x.cardData.chainId === chainId; });
                if (m2) {
                    m2.cardData.chain.push({ name:m.nick||m.name, text:['我也来','算我一个','+1','报名','参加'][Math.floor(Math.random()*5)] });
                    saveMsgs(); renderMessages();
                    pushTip((m.nick||m.name) + ' 接龙了「' + chainTitle + '」');
                }
            }, 900 + i * 900 + Math.random() * 600);
        });
    }

    function runNoticeConfirms(noticeId){
        group.members.forEach(function(m, i){
            setTimeout(function(){
                var m2 = messages.find(function(x){ return x.cardData && x.cardData.noticeId === noticeId; });
                if (m2 && !m2.cardData.confirmed[m.id]) {
                    m2.cardData.confirmed[m.id] = true; saveMsgs(); renderMessages();
                    pushTip((m.nick||m.name) + ' 确认了群公告');
                }
            }, 1200 + i * 800 + Math.random() * 500);
        });
    }

    function notifyGroupChange(text){
        pushTip(text);
        pendingNotes.push(text);
    }

    // 群成员申请加好友 → 写进 Meet 好友申请（绑定当前人设，同意后进入好友/角色库）
    function requestFriendFromGroup(member){
        if (!member) return;
        var name = member.nick || member.name || '群友';
        try {
            var owner = '';
            try {
                var md = JSON.parse(localStorage.getItem('nano_mask_data') || localStorage.getItem('nano_home_data') || 'null');
                if (md) { if (md.currentMaskId != null) owner = String(md.currentMaskId); else if (Array.isArray(md.masks) && md.masks.length) owner = String(md.masks[0].id || ''); }
            } catch (e0) {}
            var all = []; try { all = JSON.parse(localStorage.getItem('nano_friend_requests') || '[]') || []; } catch (e0) {}
            if (all.some(function (x) { return x && x.status === 'pending' && x.source === 'groupnpc' && x.name === name; })) {
                pushTip(name + ' 已经在等你同意好友申请了');
                return;
            }
            all.push({
                id: 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
                owner: owner, name: name, avatar: member.avatar || '', source: 'groupnpc', app: 'group',
                setting: member.setting || member.role || '', requestNote: '在群聊里加你', ts: Date.now(), status: 'pending'
            });
            localStorage.setItem('nano_friend_requests', JSON.stringify(all.slice(-400)));
            try { if (window.parent !== window) window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e0) {}
        } catch (e0) {}
        pushTip(name + ' 申请加你好友，去 Meet 同意');
    }

    function applyNicknameChange(member, payload){
        var parts = String(payload||'').split('|');
        var target = member, name = payload, selfChange = parts.length < 2;
        if (!selfChange) { name = parts[1].trim(); target = matchGroupMember(parts[0].trim()) || member; }
        // 自发改自己的昵称要冷却，避免刷屏（性格频率由提示词控制）
        if (selfChange && target && target.__nickAt && (messages.length - target.__nickAt) < 25) return;
        if (target && name && String(name).trim()) {
            var old = target.nick || target.name;
            target.nick = String(name).trim();
            if (selfChange) target.__nickAt = messages.length;
            saveGroup(group); renderMessages();
            notifyGroupChange((member.nick||member.name) + ' 把 ' + old + ' 的群昵称改成了 ' + target.nick);
        }
    }
    function applyTitleChange(member, payload){
        var parts = String(payload||'').split('|');
        var target = member, title = payload, selfChange = parts.length < 2;
        if (!selfChange) { title = parts[1].trim(); target = matchGroupMember(parts[0].trim()) || member; }
        if (selfChange && target && target.__titleAt && (messages.length - target.__titleAt) < 25) return;
        if (target) {
            target.title = String(title||'').trim();
            if (selfChange) target.__titleAt = messages.length;
            saveGroup(group); renderMessages();
            notifyGroupChange((member.nick||member.name) + ' 把 ' + (target.nick||target.name) + ' 的群头衔改成了 ' + (target.title || '无'));
        }
    }
    function applyGroupNameChange(member, payload){
        var name = String(payload||'').trim();
        if (!name) return;
        var old = group.name || '群聊';
        group.name = name; saveGroup(group); renderHeader();
        notifyGroupChange((member.nick||member.name) + ' 把群名从「' + old + '」改成了「' + name + '」');
    }

    function handleGroupTag(member, tag, timeStr){
        if (!tag || !member) return;
        if (tag.kind === 'redpacket') {
            var parts = String(tag.payload||'').split('|');
            var amt = parseFloat(parts[0]) || 1;
            var wish = (parts[1] || '恭喜发财').trim();
            var totalSlots = Math.max(1, group.members.length + 1);
            var explicit = parseInt(parts[2]);
            var count;
            if (explicit > 0) count = Math.min(explicit, totalSlots);
            else if (totalSlots > 2 && Math.random() < 0.4) count = 1 + Math.floor(Math.random() * (totalSlots - 1));
            else count = totalSlots;
            var rpId = 'rp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
            pushMsg({ type:'left', senderId:member.id, isCard:true, cardData:{ cardType:'redpacket', rpId:rpId, amount:amt.toFixed(2), title:wish, count:count, opened:false, claims:[] } });
            // 不立刻替其他角色分配：等用户点“回复”时再抢，用户也能自己决定要不要抢
            pendingRedPacket.push(rpId);
        } else if (tag.kind === 'chain') {
            var cp = String(tag.payload||'').split('|');
            var chainId = 'chain_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
            pushMsg({ type:'left', senderId:member.id, isCard:true, cardData:{ cardType:'chain', chainId:chainId, title:cp[0] || '群接龙', desc:(cp[1] || '').trim(), chain:[{ name:member.nick||member.name, text:'我参与' }] } });
            // 等用户点“回复”后再让别人接龙（调用 API 之后先完成卡片，再互动）
            pendingChain = chainId;
        } else if (tag.kind === 'notice') {
            var text = String(tag.payload||'').trim();
            if (!text) return;
            var noticeId = 'notice_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
            pushMsg({ type:'left', senderId:member.id, isCard:true, cardData:{ cardType:'notice', noticeId:noticeId, text:text, confirmed:{} } });
            group.notice = text; saveGroup(group); renderHeader();
            // 等用户点“回复”后再让别人确认（可自行选择不确认）
            pendingNotice = noticeId;
        } else if (tag.kind === 'nickname') {
            applyNicknameChange(member, tag.payload);
        } else if (tag.kind === 'title') {
            applyTitleChange(member, tag.payload);
        } else if (tag.kind === 'groupname') {
            applyGroupNameChange(member, tag.payload);
        } else if (tag.kind === 'voice') {
            var vp = String(tag.payload||'').split('|');
            var vtext = (vp.length >= 2 ? vp[1] : vp[0]) || '';
            var vdur = parseInt(vp[0]);
            if (!vdur || vdur < 1) vdur = Math.max(1, Math.round(String(vtext).length / 4)) || 2;
            if (vdur > 60) vdur = 60;
            pushMsg({ type:'left', senderId:member.id, isVoice:true, voiceData:{ duration:vdur }, transcript:vtext });
        } else if (tag.kind === 'image') {
            var desc = String(tag.payload||'').trim();
            if (!desc) return;
            requestGroupImage(member, desc);
        }
    }

    // 用户发出红包/接龙/公告后：等 AI 回复，再由成员做出相应反应
    // ===== 同步版成员反应：在向 AI 提问之前执行，确保 AI 与用户都先看到“抢到红包” =====
    function runRedPacketClaimsNow(rpId){
        var msg = messages.find(function(x){ return x.cardData && x.cardData.rpId === rpId; });
        if (!msg) return;
        var cd = msg.cardData;
        var sender = getMember(msg.senderId) || currentUser;
        var senderName = sender.nick || sender.name || '群友';
        var total = parseFloat(cd.amount) || 0;
        var existing = Array.isArray(cd.claims) ? cd.claims.slice() : [];
        var alreadyNames = {};
        existing.forEach(function(c){ alreadyNames[c.name] = true; });
        var alreadySum = existing.reduce(function(s,c){ return s + (parseFloat(c.amount) || 0); }, 0);
        var totalCount = Math.max(1, cd.count || (group.members.length + 1));
        var slotsLeft = Math.max(0, totalCount - existing.length);
        if (slotsLeft <= 0) return;
        var pool = group.members.filter(function(m){ return !alreadyNames[m.nick || m.name]; });
        for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
        var recipients = pool.slice(0, Math.min(slotsLeft, pool.length));
        if (!recipients.length) { pushTip(senderName + ' 发出的红包暂时无人领取'); return; }
        var remain = Math.max(0, Math.round((total - alreadySum) * 100) / 100);
        var claims = existing;
        var tips = [];
        recipients.forEach(function(m, idx){
            var remainCount = recipients.length - idx;
            var take;
            if (remainCount === 1) take = remain;
            else {
                var maxTake = remain - (remainCount - 1) * 0.01;
                take = Math.round((0.01 + Math.random() * (maxTake - 0.01)) * 100) / 100;
                if (take < 0.01) take = 0.01;
                if (take > maxTake) take = maxTake;
            }
            remain = Math.round((remain - take) * 100) / 100;
            claims.push({ name:m.nick||m.name, amount:take, time:nowTime(), bg:m.bg, initial:m.initial });
            tips.push((m.nick||m.name) + ' 领取了 ' + senderName + ' 的红包 ' + take.toFixed(2) + ' 元');
        });
        cd.claims = claims;
        saveMsgs();
        var best = claims[0];
        claims.forEach(function(c){ if (c.amount > best.amount) best = c; });
        tips.push(best.name + ' 手气最佳，抢到 ' + best.amount.toFixed(2) + ' 元');
        // 先算好，等 API 回复后再统一显示（先金额提示，再角色互动）
        pendingClaimTips = pendingClaimTips.concat(tips);
    }
    // API 回复到达后：先显示红包领取提示，再渲染角色互动
    function flushPendingClaimTips(){
        if (!pendingClaimTips.length) return;
        pendingClaimTips.forEach(function(t){ pushTip(t); });
        pendingClaimTips = [];
        renderMessages();
    }
    function runChainEntriesNow(chainId){
        var m0 = messages.find(function(x){ return x.cardData && x.cardData.chainId === chainId; });
        if (!m0) return;
        var chainTitle = m0.cardData.title || '';
        var tips = [];
        group.members.forEach(function(m){
            if (Math.random() < 0.3) return; // 有人可以选择不接龙
            m0.cardData.chain.push({ name:m.nick||m.name, text:['我也来','算我一个','+1','报名','参加'][Math.floor(Math.random()*5)] });
            tips.push((m.nick||m.name) + ' 接龙了「' + chainTitle + '」');
        });
        saveMsgs();
        pendingClaimTips = pendingClaimTips.concat(tips);
    }
    function runNoticeConfirmsNow(noticeId){
        var m0 = messages.find(function(x){ return x.cardData && x.cardData.noticeId === noticeId; });
        if (!m0) return;
        var tips = [];
        group.members.forEach(function(m){
            if (Math.random() < 0.25) return; // 可以选择不确认
            m0.cardData.confirmed[m.id] = true;
            tips.push((m.nick||m.name) + ' 确认了群公告');
        });
        saveMsgs();
        pendingClaimTips = pendingClaimTips.concat(tips);
    }
    function runPendingFeatureReactions(){
        if (pendingRedPacket.length) {
            pendingRedPacket.forEach(function(rpId){ runRedPacketClaimsNow(rpId); });
            pendingRedPacket = [];
        }
        if (pendingChain) { runChainEntriesNow(pendingChain); pendingChain = null; }
        if (pendingNotice) { runNoticeConfirmsNow(pendingNotice); pendingNotice = null; }
    }

    function processGroupReply(reply){
        var body = cleanGroupReplyText(reply);
        if (!body) return;
        var lines = body.split(/\n+/).map(function(s){ return s.trim(); }).filter(function(s){ return s.length > 0; });
        var timeStr = nowTime();
        var lastMember = null;
        var deferredRedPackets = [];
        lines.forEach(function(line, i){
            // 先抽出功能标签，再解析角色名，避免 [redpacket:20|..] 里的冒号被当成名字分隔
            var parsed = parseGroupTags(line);
            var lineClean = parsed.cleaned;
            var text = lineClean, name = null;
            var mm = lineClean.match(/^([^：:\n]{1,24})\s*[：:]\s*([\s\S]*)$/);
            if (mm) { name = mm[1].trim(); text = (mm[2] || '').trim(); }
            else {
                var mm2 = lineClean.match(/^[\[【]([^\]】]{1,24})[\]】]\s*([\s\S]*)$/);
                if (mm2) { name = mm2[1].trim(); text = (mm2[2] || '').trim(); }
            }
            if (name && currentUser && (name === currentUser.nick || name === currentUser.name)) return;
            var member = name ? matchGroupMember(name) : null;
            if (!member) member = lastMember || group.members[0];
            if (!member) return;
            lastMember = member;

            parsed.tags.forEach(function(tag, ti){
                // 红包卡片放到本轮最后再出现，方便用户先看完互动再决定要不要抢
                if (tag.kind === 'redpacket') { deferredRedPackets.push({ member: member, tag: tag, timeStr: timeStr }); return; }
                if (tag.kind === 'friendreq') { setTimeout(function(){ requestFriendFromGroup(member); }, i * 450 + ti * 180); return; }
                setTimeout(function(){ handleGroupTag(member, tag, timeStr); }, i * 450 + ti * 180);
            });

            var translation = null;
            var sep = text.indexOf('||');
            if (sep > -1) { translation = text.slice(sep + 2).trim() || null; text = text.slice(0, sep).trim(); }
            if (!text && !translation) return;
            (function(mem, txt, tr, delay){
                setTimeout(function(){ pushMsg({ type:'left', senderId:mem.id, text:txt, translation:tr }); }, delay);
            })(member, text, translation, i * 450);
        });
        // 本轮文字都发完后，再冒出红包卡片
        var baseDelay = lines.length * 450 + 220;
        deferredRedPackets.forEach(function(d, di){
            setTimeout(function(){ handleGroupTag(d.member, d.tag, d.timeStr); }, baseDelay + di * 300);
        });
        return baseDelay + deferredRedPackets.length * 300 + 200;
    }

    // ===== 请求的生命周期（通过父页面发起，切页也能后台生成） =====
    function buildGroupRequestPayload(config){
        var baseUrl = toV1Base(resolveApiHost(config.mainUrl));
        var sysContent = buildGroupSystemPrompt();
        if (groupRerollReason) {
            sysContent += (window.NanoReroll && NanoReroll.block) ? NanoReroll.block(groupRerollReason) : ('\n\n【本次重roll必须修正】' + groupRerollReason);
            groupRerollReason = '';
        }
        var history = [{ role:'system', content: sysContent }];
        pendingNotes = [];
        buildGroupHistory().forEach(function(h){ history.push(h); });
        if (!history.length || history[history.length - 1].role !== 'user') {
            history.push({ role:'user', content: '（请继续群聊）' });
        }
        return {
            token: 'greq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            url: baseUrl + '/chat/completions',
            method: 'POST',
            headers: { 'Authorization':'Bearer ' + String(config.mainKey).trim(), 'Content-Type':'application/json' },
            body: JSON.stringify({
                model: config.mainModel,
                messages: history,
                max_tokens: (typeof config.mainMax === 'number' ? config.mainMax : parseInt(config.mainMax)) || 2400,
                temperature: (typeof config.mainTemp === 'number' ? config.mainTemp : parseFloat(config.mainTemp)) || 0.8
            })
        };
    }
    function storeGroupRequest(payload){ try { localStorage.setItem('group_req_' + chatId, JSON.stringify(payload)); } catch(e){} }
    function loadStoredGroupRequest(){ try { var raw = localStorage.getItem('group_req_' + chatId); return raw ? JSON.parse(raw) : null; } catch(e){ return null; } }
    function clearGroupRequest(){ try { localStorage.removeItem('group_req_' + chatId); } catch(e){} }

    function sendGroupRequest(payload){
        return new Promise(function(resolve){
            var resultKey = 'group_api_result_' + payload.token;
            var settled = false;
            var poll = null;
            function finish(res){
                if (settled) return;
                settled = true;
                if (poll) clearInterval(poll);
                window.removeEventListener('message', onMsg);
                resolve(res);
            }
            function takeResult(){
                try {
                    var raw = localStorage.getItem(resultKey);
                    if (raw) { localStorage.removeItem(resultKey); finish(JSON.parse(raw)); return true; }
                } catch(e){}
                return false;
            }
            function onMsg(e){
                if (e && e.data && e.data.type === 'groupApiDone' && e.data.token === payload.token) {
                    if (!takeResult()) finish({ ok:false, status:0, error:'未取到结果' });
                }
            }
            if (takeResult()) return;
            window.addEventListener('message', onMsg);
            if (window.parent !== window) {
                try {
                    window.parent.postMessage({ type:'groupApiFetch', token:payload.token, url:payload.url, method:payload.method, headers:payload.headers, body:payload.body }, '*');
                } catch(e){ finish({ ok:false, status:0, error:'无法请求' }); return; }
                // 兜底轮询：父页面刷新丢消息时，结果仍会写到 localStorage
                var tries = 0;
                poll = setInterval(function(){
                    tries++;
                    if (takeResult()) return;
                    if (tries > 900) finish({ ok:false, status:0, error:'请求超时' });
                }, 1000);
            } else {
                fetch(payload.url, { method: payload.method, headers: payload.headers, body: payload.body })
                    .then(function(r){ return r.text().then(function(t){ return { ok:r.ok, status:r.status, text:t }; }); })
                    .catch(function(err){ return { ok:false, status:0, error:String(err && err.message || err) }; })
                    .then(finish);
            }
        });
    }
    function groupResultError(result){
        if (result.error) return result.error;
        var apiMsg = '';
        try { var d = JSON.parse(result.text || '{}'); apiMsg = (d && d.error && d.error.message) || (d && d.message) || ''; } catch(e){}
        var base = describeGroupHttpError(result.status);
        return apiMsg ? (base + '\n服务端信息：' + apiMsg) : base;
    }
    function finishGroupReply(){
        groupReplying = false;
        groupPendingSet(false);
        hideGroupTyping();
        updateSendState();
        // 兜底：异常/中断时也别把红包领取提示丢掉
        try { flushPendingClaimTips(); } catch (e) {}
    }
    function handleGroupResult(result){
        if (!result) return;
        if (!result.ok) {
            clearGroupRequest();
            flushPendingClaimTips();
            if (pageLeaving) return;
            showAlert('网络错误', groupResultError(result));
            finishGroupReply();
            return;
        }
        var data = null;
        try { data = JSON.parse(result.text); } catch(e){ data = null; }
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) {
            clearGroupRequest();
            flushPendingClaimTips();
            showAlert('提示', 'API 未返回内容');
            finishGroupReply();
            return;
        }
        clearGroupRequest();
        try { writeGroupMemories(content); } catch (e) {}
        // 红包领取提示先于角色互动出现
        flushPendingClaimTips();
        var dur = processGroupReply(content) || 0;
        setTimeout(finishGroupReply, dur + 250);
    }

    function requestGroupReply(){
        if (groupReplying) return;
        if (group.members.length === 0) { showAlert('提示', '群里还没有成员，请先创建/邀请成员'); return; }
        groupReplying = true;
        // 先把红包/接龙/公告的成员反应落库，保证 AI 和用户都先看到“抢到红包”的提示
        runPendingFeatureReactions();
        groupPendingSet(true);
        showGroupTyping();
        updateSendState();

        // 续跑：之前已发起、尚未取到结果的请求复用同一 token（父页面可能已完成后台生成）
        var stored = loadStoredGroupRequest();
        if (stored && stored.token) {
            sendGroupRequest(stored).then(handleGroupResult).catch(function(err){
                if (pageLeaving) return;
                showAlert('网络错误', String((err && err.message) || err));
                finishGroupReply();
            });
            return;
        }

        getGroupApiConfig().then(function(config){
            if (!config || !config.mainUrl || !config.mainKey || !config.mainModel) {
                finishGroupReply();
                showAlert('配置错误', 'API 未配置，请先在「API」页面配置主 API（地址 / Key / 模型）。');
                return null;
            }
            return Promise.all([
                getCharactersFromDB(),
                loadGroupWorldbooks(),
                loadGroupMemories(group.members.map(function(m){ return m.id; }))
            ]).then(function(res){
                var chars = res[0] || [];
                var map = {};
                chars.forEach(function(c){ map[c.id] = c; if (c.name) map[c.name] = c; });
                groupCharMap = map;
                var payload = buildGroupRequestPayload(config);
                storeGroupRequest(payload);
                return sendGroupRequest(payload);
            });
        }).then(function(result){
            if (result) handleGroupResult(result);
        }).catch(function(err){
            if (pageLeaving) return;
            console.error('[Group API] 异常', err);
            showAlert('网络错误', String((err && err.message) || err));
            finishGroupReply();
        });
    }

    // ========== 引用 ==========
    function setQuote(msgId){
        var m = messages.find(function(x){ return x.id === msgId; });
        if (!m) return;
        var who = m.type === 'right' ? currentUser : getMember(m.senderId);
        var name = who ? (who.nick || who.name) : '未知';
        var text = m.text || (m.isImage ? '图片' : (m.isVoice ? '语音' : (m.isCard ? '卡片' : '')));
        currentQuote = { name: name, text: text };
        quoteName.textContent = name + '：';
        quoteText.textContent = text;
        quoteBar.classList.add('active');
        messageInput.focus();
    }
    function clearQuote(){
        currentQuote = null;
        quoteBar.classList.remove('active');
        quoteName.textContent = '';
        quoteText.textContent = '';
    }
    $('quoteCancel').addEventListener('click', clearQuote);

    // ========== @提及 ==========
    var mentionDropdown = $('mentionDropdown');
    function showMentionDropdown(filter){
        var everyone = { id:'__all__', name:'全体成员', nick:'全体成员', initial:'全', bg:'#ff9500', isAll:true };
        var all = [everyone, currentUser].concat(group.members);
        var list = all.filter(function(m){ return !filter || (m.nick||m.name).indexOf(filter) > -1; });
        mentionDropdown.innerHTML = '';
        list.forEach(function(m){
            var item = document.createElement('div');
            item.className = 'mention-item';
            var avHtml = m.isAll ? '<i class="fas fa-bullhorn"></i>' : (m.avatar ? '<img src="' + m.avatar + '" style="width:100%;height:100%;object-fit:cover;">' : (m.initial || (m.nick||m.name).charAt(0)));
            item.innerHTML = '<div class="ma-avatar" style="background:' + (m.bg||'#8e8e93') + ';">' + avHtml + '</div><div class="ma-name">' + (m.nick||m.name) + '</div>' + (m.title ? '<div class="ma-title">' + m.title + '</div>' : '');
            item.addEventListener('click', function(){
                var v = messageInput.value;
                var atIdx = v.lastIndexOf('@');
                var insert = '@' + (m.isAll ? '全体成员' : (m.nick || m.name)) + ' ';
                if (atIdx > -1) messageInput.value = v.slice(0, atIdx) + insert;
                else messageInput.value += insert;
                mentionDropdown.classList.remove('active');
                messageInput.focus();
            });
            mentionDropdown.appendChild(item);
        });
        mentionDropdown.classList.toggle('active', list.length > 0);
    }
    messageInput.addEventListener('input', function(){
        var v = this.value;
        updateSendState();
        updateGroupEmojiRecommend();
        var atIdx = v.lastIndexOf('@');
        if (atIdx > -1 && atIdx === v.length - 1) showMentionDropdown('');
        else if (atIdx > -1 && v.slice(atIdx + 1).indexOf(' ') === -1) showMentionDropdown(v.slice(atIdx + 1));
        else mentionDropdown.classList.remove('active');
    });
    document.addEventListener('click', function(e){
        if (!mentionDropdown.contains(e.target) && e.target !== messageInput) mentionDropdown.classList.remove('active');
    });

    // ========== 表情（与单聊一致，读取 emoji 页面的表情包） ==========
    var groupEmojiData = null;
    var groupEmojiGroupId = null;

    function loadGroupEmojiData(){
        return new Promise(function(resolve){
            try {
                if (groupEmojiData) { resolve(groupEmojiData); return; }
                if (typeof indexedDB === 'undefined') { resolve(null); return; }
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function(e){
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath:'key' });
                        if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath:'key' });
                    } catch(err){}
                };
                req.onsuccess = function(e){
                    try {
                        var db = e.target.result;
                        var txE = db.transaction('emoji_data','readonly');
                        var g = txE.objectStore('emoji_data').get('nano_emoji_data');
                        g.onsuccess = function(){
                            var val = g.result ? g.result.value : null;
                            if (val && val.emojiGroups) { groupEmojiData = val; resolve(val); return; }
                            // 兼容旧键 peach_home_data
                            var gOld = txE.objectStore('emoji_data').get('peach_home_data');
                            gOld.onsuccess = function(){
                                var oldVal = gOld.result ? gOld.result.value : null;
                                if (oldVal && oldVal.emojiGroups) { groupEmojiData = oldVal; resolve(oldVal); return; }
                                try {
                                    var raw = localStorage.getItem('nano_emoji_data') || localStorage.getItem('peach_home_data');
                                    if (raw) { var d = JSON.parse(raw); if (d && d.emojiGroups) { groupEmojiData = d; resolve(d); return; } }
                                } catch(err){}
                                resolve(null);
                            };
                            gOld.onerror = function(){ resolve(null); };
                        };
                        g.onerror = function(){ resolve(null); };
                    } catch(err){ resolve(null); }
                };
                req.onerror = function(){ resolve(null); };
            } catch(e){ resolve(null); }
        });
    }
    function renderGroupEmoji(){
        loadGroupEmojiData().then(function(d){
            var groups = (d && d.emojiGroups) || [];
            var groupsEl = $('emojiGroups'), gridEl = $('emojiGrid'), emptyEl = $('emojiEmpty');
            if (!groups.length) { groupsEl.innerHTML = ''; gridEl.innerHTML = ''; emptyEl.style.display = 'block'; return; }
            if (!groupEmojiGroupId || !groups.some(function(g){ return g.id === groupEmojiGroupId; })) groupEmojiGroupId = groups[0].id;
            groupsEl.innerHTML = '';
            groups.forEach(function(g){
                var tab = document.createElement('button');
                tab.className = 'ep-group-tab' + (g.id === groupEmojiGroupId ? ' active' : '');
                tab.textContent = g.name || '未命名';
                tab.addEventListener('click', function(){ groupEmojiGroupId = g.id; renderGroupEmoji(); });
                groupsEl.appendChild(tab);
            });
            var cur = groups.find(function(g){ return g.id === groupEmojiGroupId; });
            gridEl.innerHTML = '';
            if (!cur || !cur.emojis || !cur.emojis.length) { emptyEl.style.display = 'block'; return; }
            emptyEl.style.display = 'none';
            cur.emojis.forEach(function(em){
                var wrap = document.createElement('div');
                wrap.className = 'ep-item';
                var img = document.createElement('img');
                img.src = em.url; img.alt = em.name || ''; img.loading = 'lazy';
                wrap.appendChild(img);
                var nm = document.createElement('div');
                nm.className = 'ep-item-name';
                nm.textContent = em.name || '';
                wrap.appendChild(nm);
                wrap.addEventListener('click', function(){ sendGroupEmoji(em); });
                gridEl.appendChild(wrap);
            });
        });
    }
    function openGroupEmojiPanel(){
        var ov = $('emojiPanelOverlay');
        if (!ov) return;
        ov.classList.add('active');
        renderGroupEmoji();
    }
    function closeGroupEmojiPanel(){
        var ov = $('emojiPanelOverlay');
        if (ov) ov.classList.remove('active');
    }
    function sendGroupEmoji(em){
        closeGroupEmojiPanel();
        pushMsg({ type:'right', senderId:'me', isImage:true, emojiName: em.name || '', imageData:{ url: em.url, desc: em.name || '表情包', emojiName: em.name || '', isEmoji: true } });
        if (messageInput) messageInput.value = '';
        hideGroupEmojiRecommend();
        isWaitingForReply = true;
        updateSendState();
    }

    // ===== 根据关键词推荐表情包（群聊版）：出现关键词才显示，消失即隐藏 =====
    var groupEmojiRecommendEl = $('emojiRecommend');
    var GROUP_EMOJI_SYN = {
        '哭': ['哭', '伤心', '难过', '委屈', '流泪', '呜呜', '哭唧唧'],
        '笑': ['笑', '哈哈', '哈哈哈', '开心', '高兴', '嘻嘻', '快乐'],
        '生气': ['生气', '怒', '气', '烦', '恼', '恼火'],
        '爱': ['爱', '喜欢', '亲亲', '想', '抱抱', '么么'],
        '晚安': ['晚安', '睡', '困', '好梦', '睡觉'],
        '早安': ['早安', '早', '起床', '您好'],
        '谢谢': ['谢谢', '感谢', '多谢'],
        '饿': ['饿', '吃', '饭', '饿死', '干饭', '吃货'],
        '累': ['累', '疲惫', '困', '没力气', '瘫'],
        '好': ['好', '棒', '赞', '厉害', '不错', '可以', '优秀', '牛']
    };
    function hideGroupEmojiRecommend(){
        if (groupEmojiRecommendEl) { groupEmojiRecommendEl.innerHTML = ''; groupEmojiRecommendEl.classList.add('hidden'); }
    }
    function showGroupEmojiRecommend(emojis){
        if (!groupEmojiRecommendEl) return;
        groupEmojiRecommendEl.innerHTML = '';
        emojis.slice(0, 8).forEach(function(em){
            var item = document.createElement('div');
            item.className = 'er-item';
            var img = document.createElement('img');
            img.src = em.url; img.alt = em.name || ''; img.loading = 'lazy';
            item.appendChild(img);
            item.addEventListener('click', function(){
                hideGroupEmojiRecommend();
                sendGroupEmoji(em);
            });
            groupEmojiRecommendEl.appendChild(item);
        });
        groupEmojiRecommendEl.classList.remove('hidden');
    }
    function updateGroupEmojiRecommend(){
        var text = messageInput.value.trim();
        if (!text) { hideGroupEmojiRecommend(); return; }
        loadGroupEmojiData().then(function(d){
            if (!d || !d.emojiGroups) { hideGroupEmojiRecommend(); return; }
            var all = [];
            d.emojiGroups.forEach(function(g){ (g.emojis || []).forEach(function(e){ all.push(e); }); });
            var q = text.toLowerCase();
            var keywords = [q];
            Object.keys(GROUP_EMOJI_SYN).forEach(function(k){
                if (q.indexOf(k) !== -1 || k.indexOf(q) !== -1) keywords = keywords.concat(GROUP_EMOJI_SYN[k]);
            });
            // 去重
            var seen = {};
            keywords = keywords.filter(function(k){ if (seen[k]) return false; seen[k] = true; return true; });
            var matches = all.filter(function(e){
                var n = (e.name || '').toLowerCase();
                if (!n) return false;
                return keywords.some(function(kw){ return n.indexOf(kw) !== -1 || kw.indexOf(n) !== -1; });
            });
            if (matches.length > 0) showGroupEmojiRecommend(matches);
            else hideGroupEmojiRecommend();
        });
    }
    $('emojiBtn').addEventListener('click', openGroupEmojiPanel);
    var emojiPanelCloseEl = $('emojiPanelClose');
    if (emojiPanelCloseEl) emojiPanelCloseEl.addEventListener('click', closeGroupEmojiPanel);
    var emojiPanelOverlayEl = $('emojiPanelOverlay');
    if (emojiPanelOverlayEl) emojiPanelOverlayEl.addEventListener('click', function(e){ if (e.target === emojiPanelOverlayEl) closeGroupEmojiPanel(); });
    var imgLightboxEl = $('imgLightbox');
    if (imgLightboxEl) {
        imgLightboxEl.addEventListener('click', function(e){
            if (e.target === imgLightboxEl) { closeGroupImageLightbox(); return; }
            var btn = e.target.closest('[data-act]');
            if (!btn) return;
            var act = btn.dataset.act;
            var msg = lightboxMsgId ? messages.find(function(x){ return x.id === lightboxMsgId; }) : null;
            if (act === 'cancel') {
                closeGroupImageLightbox();
            } else if (!msg) {
                closeGroupImageLightbox();
            } else if (act === 'reroll') {
                closeGroupImageLightbox();
                var who = getMember(msg.senderId) || group.members[0];
                if (who) requestGroupImage(who, msg.imageData.genPrompt || msg.imageData.desc || '图片', { replaceMsgId: msg.id });
            } else if (act === 'view') {
                closeGroupImageLightbox();
                var cur = msg.imageData.genPrompt || msg.imageData.desc || '';
                var edited = prompt('查看/修改生图要求（可修改后重新生成）', cur);
                if (edited !== null && edited.trim() !== '' && edited.trim() !== cur) {
                    var who2 = getMember(msg.senderId) || group.members[0];
                    if (who2) requestGroupImage(who2, edited.trim(), { replaceMsgId: msg.id });
                }
            } else if (act === 'save') {
                downloadGroupImage(msg.imageData.url, (msg.imageData.genPrompt || 'group-image'));
                closeGroupImageLightbox();
            }
        });
    }

    // ========== 语音弹窗 ==========
    function openVoiceSheet(){
        $('vsInput').value = '';
        setVsTab('text');
        $('voiceSheetOverlay').classList.add('active');
    }
    function closeVoiceSheet(){
        $('voiceSheetOverlay').classList.remove('active');
        if (window.__rec) { try { window.__rec.stop(); } catch(e){} window.__rec = null; }
    }
    function setVsTab(tab){
        var tabText = $('vsTabText'), tabRecord = $('vsTabRecord');
        var input = $('vsInput'), recordBtn = $('vsRecordBtn');
        if (tab === 'text') {
            tabText.classList.add('active'); tabRecord.classList.remove('active');
            input.style.display = 'block'; recordBtn.style.display = 'none';
        } else {
            tabText.classList.remove('active'); tabRecord.classList.add('active');
            input.style.display = 'block'; recordBtn.style.display = 'flex';
        }
    }
    $('vsTabText').addEventListener('click', function(){ setVsTab('text'); });
    $('vsTabRecord').addEventListener('click', function(){ setVsTab('record'); });
    $('vsClose').addEventListener('click', closeVoiceSheet);
    $('vsCancel').addEventListener('click', closeVoiceSheet);
    $('vsSend').addEventListener('click', function(){
        var t = $('vsInput').value.trim();
        if (!t) { showAlert('提示','请输入语音内容'); return; }
        var dur = Math.max(3, Math.ceil(t.length / 4));
        pushMsg({ type:'right', senderId:'me', isVoice:true, voiceData:{ duration:dur }, transcript:t });
        closeVoiceSheet();
    });
    $('vsRecordBtn').addEventListener('click', function(){
        var btn = this;
        if (btn.classList.contains('recording')) {
            btn.classList.remove('recording');
            if (window.__rec) { try { window.__rec.stop(); } catch(e){} }
            $('vsRecordIcon').className = 'fas fa-microphone';
            $('vsRecordText').textContent = '点击开始录音';
        } else {
            btn.classList.add('recording');
            $('vsRecordIcon').className = 'fas fa-stop';
            $('vsRecordText').textContent = '录音中…点击停止';
            $('vsInput').value = '';
            if (window.SpeechRecognition || window.webkitSpeechRecognition) {
                try {
                    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                    var rec = new SR();
                    rec.lang = 'zh-CN';
                    rec.continuous = true;
                    rec.interimResults = true;
                    rec.onresult = function(e){
                        var txt = '';
                        for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
                        $('vsInput').value = txt;
                    };
                    rec.onerror = function(){};
                    rec.start();
                    window.__rec = rec;
                } catch(e){}
            }
        }
    });
    $('voiceBtn').addEventListener('click', openVoiceSheet);

    // ========== 群昵称 ==========
    function openNicknamePopup(){
        var html = '<div style="max-height:300px;overflow-y:auto;">';
        group.members.forEach(function(m, i){
            html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:0.5px solid rgba(0,0,0,0.04);">' +
                '<div style="width:36px;height:36px;border-radius:50%;background:' + m.bg + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;">' + (m.initial||m.name.charAt(0)) + '</div>' +
                '<input data-idx="' + i + '" class="nick-input" type="text" value="' + (m.nick || m.name) + '" style="flex:1;border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:6px 10px;font-size:14px;outline:none;font-family:inherit;">' +
                '</div>';
        });
        html += '</div>';
        openActionPopup({
            title: '群昵称', subtitle: '修改群成员在本群的昵称',
            body: html,
            onConfirm: function(){
                document.querySelectorAll('.nick-input').forEach(function(inp){
                    var i = parseInt(inp.dataset.idx);
                    var v = inp.value.trim();
                    var m = group.members[i];
                    if (m && v && v !== m.nick) {
                        var oldNick = m.nick || m.name;
                        m.nick = v;
                        notifyGroupChange('用户把 ' + oldNick + ' 的群昵称改成了 ' + v);
                    }
                });
                saveGroup(group);
                renderMessages();
            }
        });
    }

    // ========== 通用弹窗 ==========
    var apPopup = $('actionPopup');
    var apCurrentAction = null;
    function openActionPopup(opts){
        $('apTitle').textContent = opts.title;
        $('apSubtitle').textContent = opts.subtitle || '';
        $('apBody').innerHTML = opts.body || '';
        apCurrentAction = opts.onConfirm;
        apPopup.classList.add('active');
        if (opts.onOpen) opts.onOpen();
    }
    $('apCancel').addEventListener('click', function(){ apPopup.classList.remove('active'); apCurrentAction = null; });
    $('apConfirm').addEventListener('click', function(){
        if (apCurrentAction) apCurrentAction();
        apPopup.classList.remove('active');
        apCurrentAction = null;
    });
    apPopup.addEventListener('click', function(e){ if (e.target === apPopup) { apPopup.classList.remove('active'); apCurrentAction=null; } });

    // ========== 图片弹窗 ==========
    function openImagePopup(){
        openActionPopup({
            title: '发送图片', subtitle: '选择相册或输入文字生成图片',
            body:
                '<div class="file-pick-row" id="ipPickRow">' +
                    '<span class="fp-label">从相册选择</span>' +
                    '<span class="fp-value" id="ipPickValue">' +
                        '<img class="fp-thumb" id="ipThumb">' +
                        '<span id="ipPickText">选择照片 ›</span>' +
                    '</span>' +
                '</div>' +
                '<div style="display:flex;align-items:center;padding:12px 14px;background:#fff;border-radius:12px;">' +
                    '<span style="font-size:15px;font-weight:500;color:#1c1c1e;width:70px;">文字图片</span>' +
                    '<input id="ipText" type="text" maxlength="50" placeholder="输入文字自动生成图片..." style="flex:1;border:none;outline:none;text-align:right;font-size:15px;">' +
                '</div>' +
                '<input type="file" id="ipFile" accept="image/*" style="display:none;">',
            onOpen: function(){
                var fileInput = document.getElementById('ipFile');
                document.getElementById('ipPickRow').addEventListener('click', function(){ fileInput.click(); });
                fileInput.addEventListener('change', function(){
                    var f = this.files[0];
                    if (!f) return;
                    var r = new FileReader();
                    r.onload = function(ev){
                        var thumb = document.getElementById('ipThumb');
                        thumb.src = ev.target.result;
                        thumb.classList.add('show');
                        document.getElementById('ipPickText').textContent = '已选择';
                    };
                    r.readAsDataURL(f);
                });
            },
            onConfirm: function(){
                var file = document.getElementById('ipFile').files[0];
                var text = document.getElementById('ipText').value.trim();
                if (file) {
                    var r = new FileReader();
                    r.onload = function(ev){
                        pushMsg({ type:'right', senderId:'me', isImage:true, imageData:{ url:ev.target.result, desc:'照片' } });
                    };
                    r.readAsDataURL(f);
                } else if (text) {
                    pushMsg({ type:'right', senderId:'me', isImage:true, text: text, imageData:{ textImage: true, desc: text } });
                }
            }
        });
    }

    // ========== 群公告 ==========
    function openNoticePopup(){
        openActionPopup({
            title: '发布群公告', subtitle: '所有群成员将收到并需要确认',
            body: '<textarea id="npText" placeholder="输入群公告内容..." style="width:100%;min-height:100px;resize:none;border:1px solid rgba(0,0,0,0.08);border-radius:12px;padding:12px;font-size:15px;font-family:inherit;outline:none;background:#fff;box-sizing:border-box;"></textarea>',
            onConfirm: function(){
                var text = document.getElementById('npText').value.trim();
                if (!text) { showAlert('提示','请输入公告内容'); return; }
                var noticeId = 'notice_' + Date.now();
                pushMsg({
                    type:'right', senderId:'me', isCard: true,
                    cardData: { cardType: 'notice', noticeId: noticeId, text: text, confirmed: {} }
                });
                group.notice = text;
                saveGroup(group);
                renderHeader();
                pendingNotice = noticeId;
            }
        });
    }

    // ========== 群接龙 ==========
    function openChainPopup(){
        openActionPopup({
            title: '发起群接龙', subtitle: '设置标题后群成员可参与接龙',
            body:
                '<input id="cpTitle" type="text" maxlength="20" placeholder="接龙标题，如：周六聚餐" style="width:100%;padding:12px;border:1px solid rgba(0,0,0,0.08);border-radius:12px;font-size:15px;font-family:inherit;outline:none;background:#fff;margin-bottom:8px;box-sizing:border-box;">' +
                '<input id="cpDesc" type="text" maxlength="40" placeholder="补充说明（可选）" style="width:100%;padding:12px;border:1px solid rgba(0,0,0,0.08);border-radius:12px;font-size:15px;font-family:inherit;outline:none;background:#fff;box-sizing:border-box;">',
            onConfirm: function(){
                var title = document.getElementById('cpTitle').value.trim();
                var desc = document.getElementById('cpDesc').value.trim();
                if (!title) { showAlert('提示','请输入接龙标题'); return; }
                var chainId = 'chain_' + Date.now();
                pushMsg({
                    type:'right', senderId:'me', isCard: true,
                    cardData: { cardType: 'chain', chainId: chainId, title: title, desc: desc, chain: [{ name: currentUser.nick || currentUser.name, text: '我参与' }] }
                });
                pendingChain = chainId;
            }
        });
    }

    // ========== 更多菜单 ==========
    var moreOverlay = $('moreOverlay');
    $('moreBtn').addEventListener('click', function(e){
        e.stopPropagation();
        moreOverlay.classList.toggle('active');
    });
    document.addEventListener('click', function(e){
        if (!moreOverlay.contains(e.target) && e.target !== $('moreBtn')) moreOverlay.classList.remove('active');
    });
    moreOverlay.querySelectorAll('.more-item').forEach(function(item){
        item.addEventListener('click', function(){
            var act = item.dataset.action;
            moreOverlay.classList.remove('active');
            if (act === 'reroll') doReroll();
            else if (act === 'redpacket') openRedPacketSheet();
            else if (act === 'image') openImagePopup();
            else if (act === 'chain') openChainPopup();
            else if (act === 'notice') openNoticePopup();
            else if (act === 'nickname') openNicknamePopup();
            else if (act === 'offline') openOffline();
            else if (act === 'memory') openMemory();
            else if (act === 'invitechar') openInviteCharPopup();
        });
    });

    // ========== 发红包（只普通） ==========
    var rpOverlay = $('rpOverlay');
    function openRedPacketSheet(){
        $('rpAmount').value = '0';
        $('rpWish').value = '恭喜发财';
        $('rpDisplay').textContent = '0.00';
        var maxCount = Math.max(1, group.members.length);
        $('rpCount').value = String(maxCount);
        $('rpCount').max = String(maxCount);
        rpOverlay.classList.add('active');
    }
    $('rpBack').addEventListener('click', function(){ rpOverlay.classList.remove('active'); });
    $('rpAmount').addEventListener('input', function(){
        var v = parseFloat(this.value) || 0;
        $('rpDisplay').textContent = v.toFixed(2);
    });
    $('rpSendBtn').addEventListener('click', async function(){
        var amt = parseFloat($('rpAmount').value) || 0;
        if (amt <= 0) { showAlert('提示','请输入有效金额'); return; }
        var bal = await walletGetBalance();
        if (bal <= 0) { showAlert('提示','钱包余额为 0，无法发红包'); return; }
        var wish = $('rpWish').value.trim() || '恭喜发财';
        var count = parseInt($('rpCount').value) || 1;
        var maxCount = Math.max(1, group.members.length);
        if (count < 1) count = 1;
        if (count > maxCount) count = maxCount;
        var rpId = 'rp_' + Date.now();
        pushMsg({
            type:'right', senderId:'me', isCard: true,
            cardData: {
                cardType: 'redpacket', rpId: rpId, amount: amt.toFixed(2),
                title: wish, count: count, opened: false, claims: []
            }
        });
        rpOverlay.classList.remove('active');
        walletAdd(-amt, '群红包：' + wish);
        // 点击回复后，AI 会先做出反应，成员随后领取（见 runPendingFeatureReactions）
        pendingRedPacket.push(rpId);
    });

    // ========== 开红包 ==========
    var openRpOverlay = $('openRpOverlay');
    var currentRpId = null;
    function openRedPacketOpen(rpId){
        var msg = messages.find(function(x){ return x.cardData && x.cardData.rpId === rpId; });
        if (!msg) return;
        currentRpId = rpId;
        var sender = getMember(msg.senderId) || { name: '群友', initial: '群' };
        $('openRpSender').textContent = (sender.nick || sender.name) + ' 发出的红包';
        $('openRpAvatar').textContent = sender.initial || '群';
        $('openRpWish').textContent = msg.cardData.title || '恭喜发财';
        $('openRpBtn').textContent = '開';
        $('openRpBtn').classList.remove('opened');
        openRpOverlay.classList.add('active');
    }
    $('openRpClose').addEventListener('click', function(){ openRpOverlay.classList.remove('active'); });
    $('openRpBtn').addEventListener('click', function(){
        var btn = this;
        if (btn.classList.contains('opened')) {
            openRpOverlay.classList.remove('active');
            openRpDetail(currentRpId);
            return;
        }
        var msg = messages.find(function(x){ return x.cardData && x.cardData.rpId === currentRpId; });
        if (!msg) return;
        var cd = msg.cardData;
        var total = parseFloat(cd.amount) || 0;
        var claims = cd.claims || [];
        var count = cd.count || Math.max(1, group.members.length);
        if (claims.length >= count) {
            openRpOverlay.classList.remove('active');
            showAlert('提示', '红包已被领完');
            openRpDetail(currentRpId);
            return;
        }
        var claimed = claims.reduce(function(s, c){ return s + (parseFloat(c.amount) || 0); }, 0);
        var remain = Math.max(0, Math.round((total - claimed) * 100) / 100);
        var remainCount = Math.max(1, count - claims.length);
        var take;
        if (remainCount === 1) take = remain;
        else {
            var maxTake = remain - (remainCount - 1) * 0.01;
            take = Math.round((0.01 + Math.random() * (maxTake - 0.01)) * 100) / 100;
            if (take < 0.01) take = 0.01;
            if (take > maxTake) take = maxTake;
        }
        claims.push({ name: currentUser.nick || currentUser.name, amount: take, time: nowTime(), bg: currentUser.bg, initial: currentUser.initial, isMe: true });
        cd.claims = claims;
        cd.myAmount = take;
        cd.opened = true;
        saveMsgs();
        renderMessages();
        var sender = getMember(msg.senderId) || { name: '群友' };
        pushTip((currentUser.nick || currentUser.name) + ' 领取了 ' + (sender.nick || sender.name || '群友') + ' 的红包 ' + take.toFixed(2) + ' 元');
        walletAdd(take, '领取群红包：' + (sender.nick || sender.name || '群友'));
        btn.textContent = '¥' + take.toFixed(2);
        btn.classList.add('opened');
    });

    // ========== 红包内页 ==========
    var rpDetailOverlay = $('rpDetailOverlay');
    function openRpDetail(rpId){
        var msg = messages.find(function(x){ return x.cardData && x.cardData.rpId === rpId; });
        if (!msg) return;
        var cd = msg.cardData;
        var sender = getMember(msg.senderId) || { name: '群友', initial: '群' };
        $('rpDetailSender').textContent = (sender.nick || sender.name) + ' 发出的红包';
        $('rpDetailAvatar').textContent = sender.initial || '群';
        $('rpDetailWish').textContent = cd.title || '恭喜发财';
        $('rpDetailMyAmount').textContent = (cd.myAmount || 0).toFixed(2);
        var claims = cd.claims || [];
        var totalAmt = parseFloat(cd.amount) || 0;
        $('rpDetailSummary').textContent = '共 ' + totalAmt.toFixed(2) + ' 元 · ' + claims.length + '/' + Math.max(1, cd.count || claims.length) + ' 个红包，刚刚被抢光';
        var list = $('rpDetailList');
        list.innerHTML = '';
        var maxAmount = 0, maxIdx = -1;
        claims.forEach(function(c, i){ if (c.amount > maxAmount) { maxAmount = c.amount; maxIdx = i; } });
        claims.forEach(function(c, i){
            var item = document.createElement('div');
            item.className = 'rp-detail-item';
            var name = c.name || '群友';
            var m = getMemberByName(name);
            var bg = c.bg || (m ? m.bg : '#8e8e93');
            var initial = c.initial || (m ? m.initial : name.charAt(0));
            item.innerHTML =
                '<div class="rp-di-av" style="background:' + bg + ';">' + initial + '</div>' +
                '<div class="rp-di-mid"><div class="rp-di-name">' + name + '</div><div class="rp-di-time">' + (c.time || '刚刚') + '</div></div>' +
                '<div class="rp-di-right"><div class="rp-di-amt">' + (c.amount || 0).toFixed(2) + '元</div>' + (i === maxIdx ? '<div class="rp-di-best">👑 手气最佳</div>' : '') + '</div>';
            list.appendChild(item);
        });
        rpDetailOverlay.classList.add('active');
    }
    $('rpDetailBack').addEventListener('click', function(){ rpDetailOverlay.classList.remove('active'); });

    // ========== 重roll ==========
    var groupRerollReason = '';
    async function doReroll(){
        var lastLeftIdx = -1;
        for (var i = messages.length - 1; i >= 0; i--) {
            if (messages[i].type === 'left') { lastLeftIdx = i; break; }
        }
        if (lastLeftIdx === -1) { showAlert('提示','没有可重roll的回复'); return; }
        if (window.NanoReroll) {
            var reason = await NanoReroll.ask({ title: '重roll 群聊', subtitle: '上一版哪里不对？留空也可以直接重写' });
            if (reason === null) return;
            groupRerollReason = reason || '';
        }
        var start = lastLeftIdx;
        for (var j = lastLeftIdx - 1; j >= 0; j--) {
            if (messages[j].type === 'left') start = j; else break;
        }
        messages.splice(start, lastLeftIdx - start + 1);
        saveMsgs(); renderMessages();
        setTimeout(function(){ requestGroupReply(); }, 400);
    }

    // ========== 线下 / 记忆 ==========
    function openOffline(){
        var url = 'offline.html?chat=' + encodeURIComponent(chatId) + '&name=' + encodeURIComponent(group.name || '群聊');
        if (window.parent !== window) window.parent.postMessage({ type:'openFullscreen', url:url, title:'线下' }, '*');
        else location.href = url;
    }
    function openMemory(){
        var url = 'memory.html?chat=' + encodeURIComponent(chatId) + '&group=1&name=' + encodeURIComponent(group.name || '群聊');
        if (window.parent !== window) window.parent.postMessage({ type:'openFullscreen', url:url, title:'记忆' }, '*');
        else location.href = url;
    }

    // ========== 邀请角色进群（对方私聊出现邀请卡片，同意后才进群） ==========
    function openInviteCharPopup(){
        getCharactersFromDB().then(function(allChars){
            var inIds = {};
            group.members.forEach(function(m){ inIds[m.id] = true; if (m.name) inIds[m.name] = true; });
            var pendingIds = {};
            try {
                (window.GroupInvites ? window.GroupInvites.list() : []).forEach(function(x){
                    if (x && x.status === 'pending' && x.direction === 'user' && x.groupId === chatId) pendingIds[x.toCharId] = true;
                });
            } catch(e){}
            var pool = (allChars || []).filter(function(c){ return c && c.id && !c.nanoAssistant && !inIds[c.id] && !(c.name && inIds[c.name]) && !pendingIds[c.id]; });
            var html = '<div style="max-height:320px;overflow-y:auto;">';
            if (!pool.length) {
                html += '<div style="padding:18px 0;text-align:center;color:#8e8e93;font-size:13px;">没有可邀请的角色</div>';
            } else {
                pool.forEach(function(c, i){
                    var av = c.avatar ? '<img src="' + c.avatar + '" style="width:100%;height:100%;object-fit:cover;">' : ((c.name || '?').charAt(0));
                    html += '<label style="display:flex;align-items:center;gap:10px;padding:9px 4px;cursor:pointer;border-bottom:0.5px solid rgba(0,0,0,0.05);">' +
                        '<input type="checkbox" class="invite-char-cb" data-idx="' + i + '" style="width:18px;height:18px;">' +
                        '<span style="width:38px;height:38px;border-radius:50%;background:' + memberBg(i) + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;overflow:hidden;flex-shrink:0;">' + av + '</span>' +
                        '<span style="font-size:15px;color:#1c1c1e;">' + (c.name || c.id) + '</span>' +
                        '</label>';
                });
            }
            html += '</div>';
            openActionPopup({
                title: '邀请角色进群',
                subtitle: '发送邀请后，请到该角色的私聊点“回复”，TA 同意后才会进群',
                body: html,
                onConfirm: function(){
                    var checked = document.querySelectorAll('.invite-char-cb:checked');
                    if (!checked.length) return;
                    var inviter = currentUser.nick || currentUser.name || '你';
                    var sent = 0;
                    checked.forEach(function(cb){
                        var c = pool[parseInt(cb.dataset.idx)];
                        if (!c || !window.GroupInvites) return;
                        window.GroupInvites.add({
                            groupId: chatId, groupName: group.name || '群聊',
                            fromName: inviter, toCharId: c.id, toName: c.name || c.id,
                            direction: 'user', status: 'pending'
                        });
                        pushTip('「' + inviter + '」向「' + (c.name || c.id) + '」发送了进群邀请，等待对方回复');
                        sent++;
                    });
                    if (sent) showAlert('邀请已发送', '请到被邀请角色的私聊里点击回复，TA 会自己决定是否进群');
                }
            });
        });
    }

    // ========== 提示 ==========
    function showAlert(title, msg){
        $('alertTitle').textContent = title;
        $('alertMessage').textContent = msg;
        $('iosAlert').classList.add('active');
    }
    $('alertButton').addEventListener('click', function(){ $('iosAlert').classList.remove('active'); });

    // ========== 长按/双击菜单 ==========
    var longpressMenu = $('longpressMenu');
    var longpressTarget = null;
    function showLongpress(row, x, y){
        longpressTarget = row;
        longpressMenu.classList.add('active');
        // 先展开再量尺寸，然后把菜单完整限制在屏幕内
        var pad = 10;
        var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
        var mw = longpressMenu.offsetWidth || 190;
        var mh = longpressMenu.offsetHeight || 340;
        var left = Math.max(pad, Math.min(vw - mw - pad, x - mw / 2));
        var top = Math.max(pad, Math.min(vh - mh - pad, y - 20));
        longpressMenu.style.left = left + 'px';
        longpressMenu.style.top = top + 'px';
    }
    messageContainer.addEventListener('dblclick', function(e){
        var row = e.target.closest('.message-row');
        if (!row) return;
        e.preventDefault();
        showLongpress(row, e.clientX, e.clientY);
    });
    var touchTimer = null;
    messageContainer.addEventListener('touchstart', function(e){
        var row = e.target.closest('.message-row');
        if (!row) return;
        var t = e.touches[0];
        touchTimer = setTimeout(function(){ showLongpress(row, t.clientX, t.clientY); }, 500);
    }, { passive: true });
    messageContainer.addEventListener('touchend', function(){ clearTimeout(touchTimer); });
    messageContainer.addEventListener('touchmove', function(){ clearTimeout(touchTimer); });
    document.addEventListener('click', function(e){
        if (!longpressMenu.contains(e.target)) { longpressMenu.classList.remove('active'); longpressTarget = null; }
    });
    longpressMenu.querySelectorAll('.menu-item').forEach(function(item){
        item.addEventListener('click', function(){
            var act = item.dataset.action;
            longpressMenu.classList.remove('active');
            if (!longpressTarget) return;
            var id = longpressTarget.dataset.id;
            var idx = messages.findIndex(function(m){ return m.id === id; });
            if (idx === -1) return;
            var m = messages[idx];
            if (act === 'reply') setQuote(id);
            else if (act === 'recall') {
                var recallContent = m.text || (m.isImage ? '图片' : (m.isVoice ? '语音' : (m.isCard ? '卡片' : '')));
                messages[idx].recalled = true;
                messages[idx].recallContent = recallContent;
                saveMsgs(); renderMessages();
            } else if (act === 'delete') {
                messages.splice(idx, 1);
                saveMsgs(); renderMessages();
            } else if (act === 'multiselect') enterMultiSelect();
            else if (act === 'favorite') showAlert('提示','已收藏');
            else if (act === 'edit') {
                var newText = prompt('编辑消息', m.text || '');
                if (newText !== null && newText.trim()) {
                    messages[idx].text = newText.trim();
                    saveMsgs(); renderMessages();
                }
            }
            longpressTarget = null;
        });
    });

// ========== 多选 ==========
var multiSelectBar = $('multiSelectBar');
var selectedIds = new Set();
var isMulti = false;

function enterMultiSelect(){
    isMulti = true;
    selectedIds.clear();
    multiSelectBar.style.display = 'flex';
    // 用 rAF 触发 CSS transition（因为 display 从 none → flex 时，class 切换要在下一帧才生效）
    requestAnimationFrame(function(){
        multiSelectBar.classList.add('show');
    });
    document.querySelectorAll('.message-row').forEach(function(r){
        r.classList.add('multi-mode');
    });
    messageScroll.classList.add('multi-mode');
    updateMsCount();
}

function exitMultiSelect(){
    isMulti = false;
    selectedIds.clear();
    multiSelectBar.classList.remove('show');
    setTimeout(function(){ multiSelectBar.style.display = 'none'; }, 250);
    document.querySelectorAll('.message-row').forEach(function(r){
        r.classList.remove('multi-mode');
        r.classList.remove('selected');
    });
    messageScroll.classList.remove('multi-mode');
    updateMsCount();
}

function updateMsCount(){
    $('msCount').textContent = '已选 ' + selectedIds.size + ' 条';
}

$('msCancel').addEventListener('click', exitMultiSelect);

$('msDelete').addEventListener('click', function(){
    if (selectedIds.size === 0) return;
    messages = messages.filter(function(m){ return !selectedIds.has(m.id); });
    saveMsgs();
    renderMessages();
    exitMultiSelect();
});

messageContainer.addEventListener('click', function(e){
    if (!isMulti) return;
    var row = e.target.closest('.message-row');
    if (!row) return;
    var id = row.dataset.id;
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
        row.classList.remove('selected');
    } else {
        selectedIds.add(id);
        row.classList.add('selected');
    }
    updateMsCount();
});

    // ========== 卡片点击 ==========
    messageContainer.addEventListener('click', function(e){
        var rpCard = e.target.closest('.bubble-card.redpacket');
        if (rpCard) {
            var row = rpCard.closest('.message-row');
            if (!row) return;
            var msg = messages.find(function(m){ return m.id === row.dataset.id; });
            if (!msg || !msg.cardData) return;
            if (msg.senderId === 'me' || msg.cardData.opened) openRpDetail(msg.cardData.rpId);
            else openRedPacketOpen(msg.cardData.rpId);
            return;
        }
        var noticeBtn = e.target.closest('[data-notice]');
        if (noticeBtn) {
            var nid = noticeBtn.dataset.notice;
            var nmsg = messages.find(function(m){ return m.cardData && m.cardData.noticeId === nid; });
            if (nmsg) {
                nmsg.cardData.confirmed['me'] = true;
                saveMsgs(); renderMessages();
                pushTip('用户确认了群公告');
                pendingNotes.push('用户确认了群公告');
            }
            return;
        }
        var chainBtn = e.target.closest('[data-chain]');
        if (chainBtn) {
            var cid = chainBtn.dataset.chain;
            var cmsg = messages.find(function(m){ return m.cardData && m.cardData.chainId === cid; });
            if (cmsg) {
                var text = prompt('输入你的接龙内容', '我参与');
                if (text && text.trim()) {
                    cmsg.cardData.chain.push({ name: currentUser.nick || currentUser.name, text: text.trim() });
                    saveMsgs(); renderMessages();
                    pushTip('用户接龙了「' + (cmsg.cardData.title || '') + '」');
                    pendingNotes.push('用户接龙了「' + (cmsg.cardData.title || '') + '」');
                }
            }
            return;
        }
    });

    // ========== 返回 / 设置页跳转 ==========
    $('backBtn').addEventListener('click', function(){
        if (window.parent !== window) window.parent.postMessage({ type:'closeFullscreen' }, '*');
        else history.back();
    });
    function openGroupSetting(){
        var url = 'group-setting.html?chat=' + encodeURIComponent(chatId);
        if (window.parent !== window) window.parent.postMessage({ type:'openFullscreen', url:url, title:'群设置', source:'groups' }, '*');
        else location.href = url;
    }
    $('topbarAvatar').addEventListener('click', openGroupSetting);
    $('noticeMore').addEventListener('click', openGroupSetting);
    if ($('noticeClose')) $('noticeClose').addEventListener('click', function(){
        group.notice = '';
        saveGroup(group);
        renderHeader();
        applyChatInsets();
        showAlert('提示', '群公告已移除');
    });

    // ========== 监听变化 ==========
    window.addEventListener('storage', function(e){
        if (e.key === GROUP_KEY) { __lastGroupRaw = e.newValue || ''; group = loadGroup(); renderHeader(); renderMessages(); }
        if (e.key === MSG_KEY) { messages = loadMsgs(); renderMessages(); }
        if (e.key === SETTINGS_KEY) {
            settings = loadSettings();
            currentUser.title = settings.myTitle || '群主';
            renderMessages();
        }
        if (e.key === BG_KEY) applyBackground();
    });
    document.addEventListener('visibilitychange', function(){
        if (!document.hidden) {
            group = loadGroup();
            settings = loadSettings();
            currentUser.title = settings.myTitle || '群主';
            renderHeader(); applyBackground();
            resolveIdentities().then(function(){ renderHeader(); renderMessages(); });
        }
    });

    // 兜底轮询：群设置在别的页面改了成员/资料，这里也能及时刷新（storage 事件有时收不到）
    var __lastGroupRaw = localStorage.getItem(GROUP_KEY) || '';
    setInterval(function(){
        var raw = localStorage.getItem(GROUP_KEY) || '';
        if (raw === __lastGroupRaw) return;
        __lastGroupRaw = raw;
        group = loadGroup();
        renderHeader();
        resolveIdentities().then(function(){ renderHeader(); renderMessages(); });
    }, 3000);

    // ========== 初始化 ==========
    try { if (window.NanoBadge) window.NanoBadge.setContext(chatId); } catch (e) {}
    applyBackground();
    renderHeader();
    renderMessages();
    updateSendState();
    consumePendingChanges();

    // 已退出群聊：只能围观，点击发送按钮让 AI 自己互动
    if (userLeft) {
        messageInput.disabled = true;
        messageInput.placeholder = '你已退出群聊，点击右侧按钮看大家聊天';
        var emojiBtnEl = $('emojiBtn'), voiceBtnEl = $('voiceBtn');
        if (emojiBtnEl) emojiBtnEl.style.display = 'none';
        if (voiceBtnEl) voiceBtnEl.style.display = 'none';
    }

    // 从“查找聊天记录”跳转过来：定位到指定消息
    if (jumpMsgId) {
        setTimeout(function(){
            var row = messageContainer.querySelector('[data-id="' + jumpMsgId + '"]');
            if (row) {
                row.scrollIntoView({ block: 'center', behavior: 'smooth' });
                row.classList.add('jump-highlight');
                setTimeout(function(){ row.classList.remove('jump-highlight'); }, 2000);
            }
        }, 350);
    }

    // 断点续生成：上次离开时若回复还没生成完，回来继续“正在输入”并重新请求
    if (groupPendingGet()) {
        showGroupTyping();
        setTimeout(function(){ requestGroupReply(); }, 400);
    }
    resolveIdentities().then(function(){ renderHeader(); renderMessages(); });
})();

/* iOS 键盘：收缩群聊容器，让输入栏位于键盘（含附属栏）上方；父页面也会 postMessage 同步 */
(function () {
    var parentKb = 0, localKb = 0, kbBaseH = 0;
    function apply() {
        var kb = Math.max(parentKb, localKb);
        document.documentElement.style.setProperty('--nano-kb', kb + 'px');
        document.documentElement.classList.toggle('keyboard-open', kb > 0.5);
    }
    function computeLocalKb(vv) {
        kbBaseH = Math.max(kbBaseH, window.innerHeight || 0, vv.height || 0);
        return Math.max(0, Math.round(kbBaseH - vv.height - vv.offsetTop));
    }
    try {
        if (window.visualViewport) {
            var vv = window.visualViewport;
            var upd = function () { localKb = computeLocalKb(vv); apply(); };
            vv.addEventListener('resize', upd);
            vv.addEventListener('scroll', upd);
            window.addEventListener('orientationchange', function () { kbBaseH = 0; setTimeout(upd, 350); });
        }
    } catch (e) {}
    window.addEventListener('message', function (e) {
        var d = e.data;
        if (d && d.type === 'nanoKeyboard') { parentKb = Math.max(0, Math.round(Number(d.kb) || 0)); apply(); }
    });
    function isField(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
    function requery() {
        try { if (window.parent !== window) window.parent.postMessage({ type: 'nanoKeyboardQuery' }, '*'); } catch (err) {}
        try { if (window.visualViewport) localKb = computeLocalKb(window.visualViewport); } catch (err) {}
        apply();
        // iOS 键盘弹起后把消息滚到最新，避免输入栏下方内容被键盘/附属栏挡住
        try {
            var ae = document.activeElement;
            if (isField(ae)) {
                var sc = document.getElementById('messageScroll');
                if (sc) sc.scrollTop = sc.scrollHeight;
            }
        } catch (err) {}
    }
    document.addEventListener('focusin', function (e) {
        if (!isField(e.target)) return;
        [60, 160, 320, 520].forEach(function (t) { setTimeout(requery, t); });
    });
    document.addEventListener('focusout', function () {
        setTimeout(requery, 80);
        setTimeout(requery, 320);
    });
})();