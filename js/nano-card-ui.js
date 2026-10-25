/* ============================================================
   js/nano-card-ui.js
   Nano 通用卡片 UI（初始卡片统一版式）
   ------------------------------------------------------------
   版式来自根目录「通用模板.html」：
     顶部状态栏（深色） + 主内容（金额 / 图标+标题） +
     两列信息区 + 留言区 + 底部按钮（次要 + 主要）
   私聊 / 群聊 / 一起听 / 情侣空间 / 查手机 / 通话 / 文件等
   所有卡片都走这里，样式见 css/chat-inner.css、css/groups.css。
   ============================================================ */
(function () {
    'use strict';
    if (window.NanoCardUI) return;

    var ICONS = {
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
        clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
        user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        userPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
        users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
        hash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>',
        box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 8-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
        gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18M12 8v13"/><path d="M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5h4z"/><path d="M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5h-4z"/></svg>',
        wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v10a2 2 0 0 0 2 2h15V7H5"/><path d="M17 13h.01"/></svg>',
        card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>',
        bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
        store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16l-1-5H5L4 9z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg>',
        pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
        phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
        video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
        headphones: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5z"/><path d="M20 14h-3v6h2a1 1 0 0 0 1-1v-5z"/></svg>',
        heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
        file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>',
        book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 0-4 4z"/><path d="M8 4v16"/><path d="M12 8h5M12 12h5"/></svg>',
        bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
        list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
        utensil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10"/><path d="M17 3c-1.5 2-2 4-2 7h4c0-3-.5-5-2-7zM17 10v11"/></svg>',
        truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
        redpacket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="12" cy="14" r="2"/></svg>',
        receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>',
        image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-5 5-3-3-5 5"/></svg>'
    };

    function icon(name) { return ICONS[name] || ICONS.box; }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function clip(v, n) {
        var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
        return s.length > n ? s.slice(0, n) + '…' : s;
    }

    // 允许卡片数据直接换图标：iconSvg（内联 SVG）/ icon（URL，或内联 SVG）
    function iconHtml(name, cd) {
        var custom = cd && (cd.iconSvg || cd.svg || cd.icon);
        if (custom) {
            var s = String(custom).trim();
            if (/^<svg[\s>]/i.test(s)) return s;
            if (/^(https?:|data:image|blob:|\/|\.\/|\.\.\/)/i.test(s)) return '<img src="' + esc(s) + '" alt="">';
        }
        return icon(name);
    }

    // 统一推导「谁发起 / 谁收下」。旧数据没有 direction 时按气泡方向兜底，
    // 响应卡会沿用原卡的 direction，所以灰色卡片不会把收款人/送礼人弄反。
    function rolesOf(cd, side, me, other) {
        var origin = '';
        if (cd && cd.from === 'char') origin = 'char';
        else if (cd && cd.from === 'user') origin = 'user';
        else if (cd && (cd.storeKind === 'char_gift' || cd.storeKind === 'char_share' || cd.storeKind === 'char_pay_request')) origin = 'char';
        else if (cd && cd.direction === 'user') origin = 'char';
        else if (cd && cd.direction === 'char') origin = 'user';
        else origin = side === 'left' ? 'char' : 'user';
        var sender = (cd && (cd.senderName || cd.fromName)) || (origin === 'char' ? other : me);
        var recipient = (cd && (cd.recipientName || cd.toName)) || (origin === 'char' ? me : other);
        return { origin: origin, sender: sender, recipient: recipient };
    }

    function money(v) {
        var s = String(v == null ? '' : v).trim();
        var m = s.match(/^([¥$€£])\s*(.*)$/);
        if (m) return '<span>' + esc(m[1]) + '</span>' + esc(m[2]);
        return esc(s);
    }

    function header(statusIcon, statusText, time) {
        return '<div class="card-header">' +
            '<div class="status">' + icon(statusIcon || 'checkCircle') + '<span>' + esc(statusText || '') + '</span></div>' +
            '<div class="time">' + esc(time || '刚刚') + '</div>' +
            '</div>';
    }

    var currentCard = null;

    function mainAmount(label, amount, iconName, cd) {
        cd = cd || currentCard;
        // 金额卡默认不带图标（与初始模板一致）；数据里给了 iconSvg/icon 时才渲染
        var hasCustomIcon = !!(cd && (cd.iconSvg || cd.svg || cd.icon));
        return '<div class="main-section card-main">' +
            (iconName || hasCustomIcon ? '<div class="main-icon icon-wrap">' + iconHtml(iconName || 'wallet', cd) + '</div>' : '') +
            '<div class="main-text card-main-text">' +
            '<div class="main-label card-title">' + esc(label || '金额') + '</div>' +
            '<div class="amount card-sub">' + money(amount) + '</div>' +
            '</div></div>';
    }

    function mainTitle(iconName, label, title, sub, cd) {
        cd = cd || currentCard;
        return '<div class="main-section card-main">' +
            '<div class="main-icon icon-wrap">' + iconHtml(iconName, cd) + '</div>' +
            '<div class="main-text card-main-text">' +
            '<div class="main-label">' + esc(label || '') + '</div>' +
            '<div class="main-title card-title">' + esc(title || '') + '</div>' +
            (sub ? '<div class="main-sub card-sub">' + esc(sub) + '</div>' : '') +
            '</div></div>';
    }

    function normalizeItems(custom) {
        if (!Array.isArray(custom)) return null;
        var out = [];
        custom.forEach(function (it) {
            if (!it) return;
            if (Array.isArray(it)) out.push([it[0], it[1], it[2]]);
            else if (typeof it === 'object') out.push([it.label || it.name || it.key, it.value == null ? it.text : it.value, it.icon || it.svg]);
        });
        return out;
    }

    // 卡片数据里的 info / fields / rows 可完全替换四条目，满足任意 DIY；
    // 不传时仍使用各卡片自己的默认条目，旧美化选择器不受影响。
    // hideInfo:true（或 info:[]）可以隐藏整块信息区。
    function info(items, cd) {
        cd = cd || currentCard;
        if (cd && (cd.hideInfo === true || cd.info === false || cd.fields === false || cd.rows === false)) return '';
        var custom = cd && normalizeItems(cd.info || cd.fields || cd.rows);
        if (custom) items = custom;
        else if (cd && (Array.isArray(cd.extraInfo) || Array.isArray(cd.extraFields))) {
            items = (items || []).concat(cd.extraInfo || cd.extraFields || []);
        }
        var rows = [];
        (items || []).forEach(function (it) {
            if (!it) return;
            var value = it[1];
            if (value == null || value === '') return;
            rows.push('<div class="info-item">' +
                '<div class="icon-box">' + icon(it[2] || 'box') + '</div>' +
                '<div class="info-content">' +
                '<div class="info-label">' + esc(it[0] || '') + '</div>' +
                '<div class="info-value">' + esc(value) + '</div>' +
                '</div></div>');
        });
        if (!rows.length) return '';
        return '<div class="info-section"><div class="info-grid">' + rows.join('') + '</div></div>';
    }

    function note(text) {
        if (text == null || String(text).trim() === '') return '';
        return '<div class="message-box card-note">' + esc(clip(text, 180)) + '</div>';
    }

    function actionButton(label, act, primary, attrs) {
        return '<button type="button" class="btn ' + (primary ? 'btn-primary primary' : 'btn-secondary secondary return-btn') +
            ' card-btn" ' + (act ? 'data-act="' + esc(act) + '" ' : '') + (attrs || '') + '>' + esc(label) + '</button>';
    }

    function actions(buttons) {
        if (!buttons || !buttons.length) return '';
        return '<div class="card-footer"><span class="card-actions">' +
            buttons.map(function (b) { return actionButton(b[0], b[1], b[2], b[3]); }).join('') +
            '</span></div>';
    }

    function statusFoot(text) {
        if (!text) return '';
        return '<div class="card-footer status-only"><span class="card-footer-text">' + esc(text) + '</span></div>';
    }

    function build(cardData, opts) {
        var cd = Object.assign({}, cardData || {});
        currentCard = cd;
        opts = opts || {};
        var side = opts.side === 'right' ? 'right' : 'left';
        var me = opts.meName || '我';
        var other = opts.otherName || 'TA';
        var time = opts.time || '';
        var type = cd.cardType || '';
        var st = cd.status || 'pending';
        var roles = rolesOf(cd, side, me, other);
        var items = Array.isArray(cd.items) ? cd.items : [];
        var itemText = items.map(function (it) { return ((it && it.name) || '商品') + (it && it.qty > 1 ? (' ×' + it.qty) : ''); }).join('、');
        // 自动补全：旧消息缺金额/标题/副标题时，用 total、items、title 兜底，避免卡片空白或串内容
        if (!cd.amount && cd.total != null && Number(cd.total)) cd.amount = '¥' + Number(cd.total).toFixed(2);
        if (!cd.title && itemText) cd.title = itemText;
        if (!cd.sub && itemText && itemText !== cd.title) cd.sub = itemText;
        if (!cd.time) cd.time = time;
        var html = '';

        if (type === 'transfer') {
            var amount = cd.amount || '¥0.00';
            var isResponse = !!cd.response;
            var headText = '转账待领取';
            var headIcon = 'clock';
            if (isResponse && st === 'received') { headText = side === 'right' ? '你已收下' : '对方已收下'; headIcon = 'checkCircle'; }
            else if (isResponse && st === 'returned') { headText = side === 'right' ? '你已退还' : '对方已退还'; headIcon = 'x'; }
            else if (st === 'received') { headText = side === 'right' ? '对方已收款' : '已收款'; headIcon = 'checkCircle'; }
            else if (st === 'returned') { headText = side === 'right' ? '对方已退还' : '已退还'; headIcon = 'x'; }
            else if (side === 'right') { headText = '转账已发出'; headIcon = 'clock'; }
            var foot = '';
            if (isResponse && st === 'received') foot = statusFoot(side === 'right' ? '你已收下这笔转账' : '对方已收下这笔转账');
            else if (isResponse && st === 'returned') foot = statusFoot(side === 'right' ? '你已退还这笔转账' : '对方已退还这笔转账');
            else if (st === 'received') foot = statusFoot(side === 'right' ? '对方已收款' : '这笔转账已收款');
            else if (st === 'returned') foot = statusFoot(side === 'right' ? '对方已退还' : '这笔转账已退还');
            else if (side === 'right') foot = statusFoot('等待对方接收');
            else foot = actions([['退还', 'return', false], ['接收', 'receive', true]]);
            html = header(headIcon, headText, time) +
                mainAmount('转账金额', amount, null, cd) +
                info([
                    ['转账人', roles.sender, 'user'],
                    ['收款人', roles.recipient, 'user'],
                    ['转账说明', cd.title || '转账', 'hash'],
                    ['交易时间', cd.time || '刚刚', 'clock']
                ], cd) + foot;
        } else if (type === 'gift') {
            var gHead = st === 'received' ? (side === 'right' && !cd.response ? '对方已查收' : '礼物已查收')
                : (st === 'returned' ? (side === 'right' && !cd.response ? '对方已退还' : '礼物已退还')
                    : (side === 'left' ? '礼物待查收' : '礼物已送出'));
            if (st === 'received' && cd.response) gHead = side === 'right' ? '你已查收' : '对方已查收';
            if (st === 'returned' && cd.response) gHead = side === 'right' ? '你已退还' : '对方已退还';
            var gIcon = st === 'pending' ? (side === 'left' ? 'gift' : 'clock') : 'checkCircle';
            if (st === 'returned') gIcon = 'x';
            var gFoot = '';
            if (st === 'received') gFoot = statusFoot(side === 'left' && cd.response ? '你已查收这份礼物' : (side === 'right' && cd.response ? '对方已查收这份礼物' : '这份礼物已查收'));
            else if (st === 'returned') gFoot = statusFoot(side === 'left' && cd.response ? '你已退还这份礼物' : (side === 'right' && cd.response ? '对方已退还这份礼物' : '这份礼物已退还'));
            else if (side === 'right') gFoot = statusFoot('等待对方查收');
            else gFoot = actions([['退还', 'return', false], ['接受', 'receive', true]]);
            var giftSub = cd.amount
                ? ('价值 ' + String(cd.amount) + (cd.sub ? ' · ' + cd.sub : ''))
                : (cd.sub || '');
            html = header(gIcon, gHead, time) +
                mainTitle('gift', side === 'left' ? '收到一份礼物' : '送出一份礼物', cd.title || '礼物', giftSub, cd) +
                info([
                    ['送礼人', roles.sender, 'user'],
                    ['收礼人', roles.recipient, 'user'],
                    ['礼物价值', cd.amount || '未标价', 'wallet'],
                    ['礼物类型', cd.giftType || '心意礼物', 'gift']
                ], cd) + gFoot;
        } else if (type === 'store') {
            var kind = cd.storeKind || 'pay_request';
            var origin = roles.origin;
            var orderBy = origin === 'char' ? other : me;
            var forWhom = (origin === 'char' && kind !== 'char_gift') ? other : me;
            var sHead = st === 'accepted'
                ? (kind === 'char_gift' ? '礼物已确认' : (origin === 'char' ? '你已帮 TA 付款' : '订单已确认'))
                : (st === 'declined' ? '订单已拒绝' : (st === 'returned' ? '订单已退回' : (origin === 'char' ? '订单待处理' : '订单进行中')));
            var sIcon = st === 'accepted' ? 'checkCircle' : (st === 'declined' || st === 'returned' ? 'x' : 'clock');
            var sFoot = '';
            if (st === 'accepted') {
                if (kind === 'char_gift') sFoot = statusFoot('已确认收货');
                else if (kind === 'char_share' || kind === 'char_pay_request') sFoot = statusFoot('你已帮 TA 付款');
                else sFoot = statusFoot('TA 已' + (kind === 'pay_request' ? '代付' : '买给你'));
            } else if (st === 'declined') {
                sFoot = statusFoot(origin === 'char' ? '你已拒绝' : 'TA 拒绝了');
            } else if (st === 'returned') {
                sFoot = statusFoot('已退回');
            } else if (origin === 'char') {
                if (kind === 'char_gift') sFoot = actions([['拒收', 'store-gift-reject', false], ['确认收货', 'store-gift-confirm', true]]);
                else if (kind === 'char_share') sFoot = actions([['拒绝', 'store-reject-char', false], ['帮他买', 'store-buy-char', true]]);
                else sFoot = actions([['拒绝', 'store-reject-char', false], ['帮他付', 'store-pay-char', true]]);
            } else {
                sFoot = statusFoot(kind === 'pay_request' ? '等待 TA 代付（点右下角回复）' : '等待 TA 决定（点右下角回复）');
            }
            var sMain = cd.amount ? mainAmount('订单金额', cd.amount, null, cd) : mainTitle('bag', '商城订单', cd.title || '商城', itemText || cd.sub || '', cd);
            html = header(sIcon, sHead, time) + sMain +
                info([
                    ['商品', itemText || cd.title || '商城订单', 'bag'],
                    ['下单人', orderBy, 'user'],
                    ['收件人', forWhom, 'user'],
                    ['订单金额', cd.amount || '待确认', 'wallet']
                ], cd) + note(cd.sub && cd.sub !== itemText ? cd.sub : '') + sFoot;
        } else if (type === 'familycard') {
            var lim = Number(cd.limit || 0);
            var used = Number(cd.spent || 0);
            var issuer = cd.issuer === 'char' ? 'char' : 'user';
            var fHead = st === 'active' ? '亲属卡已开启' : (st === 'rejected' ? '亲属卡已拒绝' : (issuer === 'user' ? '亲属卡待接受' : '亲属卡邀请'));
            var fIcon = st === 'active' ? 'checkCircle' : (st === 'rejected' ? 'x' : 'clock');
            var fFoot = '';
            if (st === 'active') fFoot = statusFoot('已开启 · 已用 ¥' + used.toFixed(2));
            else if (st === 'rejected') fFoot = statusFoot('已拒绝');
            else if (issuer === 'user') fFoot = statusFoot('等待对方回应（点右下角回复）');
            else fFoot = actions([['拒绝', 'family-reject', false], ['接受', 'family-accept', true]]);
            html = header(fIcon, fHead, time) +
                mainTitle('card', '亲属卡', '亲属卡', '额度 ¥' + lim.toFixed(2)) +
                info([
                    ['开卡人', issuer === 'char' ? other : me, 'user'],
                    ['可用额度', '¥' + lim.toFixed(2), 'wallet'],
                    ['已用额度', '¥' + used.toFixed(2), 'receipt'],
                    ['卡片状态', st === 'active' ? '使用中' : (st === 'rejected' ? '已拒绝' : '待接受'), 'card']
                ]) + fFoot;
        } else if (type === 'takeout') {
            var price = Number(cd.price || 0);
            var eta = Number(cd.eta || 0);
            var tDir = cd.direction === 'char' ? 'char' : 'user';
            var tHead = st === 'accepted' ? '外卖已确认' : (st === 'rejected' ? '外卖已取消' : '外卖订单');
            var tIcon = st === 'accepted' ? 'checkCircle' : (st === 'rejected' ? 'x' : 'truck');
            var tFoot = '';
            if (st === 'accepted') tFoot = statusFoot('已确认，等待送达');
            else if (st === 'rejected') tFoot = statusFoot('已取消');
            else if (tDir === 'char') tFoot = actions([['取消', 'takeout-reject', false], ['确认外卖', 'takeout-accept', true]]);
            else tFoot = statusFoot('等待对方确认');
            var priceText = price > 0 ? ('¥' + price.toFixed(2)) : '';
            var tSub = [cd.shop || '外卖', priceText].filter(Boolean).join(' · ');
            var tMain = mainTitle('utensil', '外卖订单', cd.food || '外卖', tSub, cd);
            var etaText = eta > 0 ? (eta + ' 分钟') : '配送中';
            var tStatus = st === 'accepted' ? '已确认' : (st === 'rejected' ? '已取消' : '待确认');
            var tMap = '<div class="takeout-map">' +
                '<span class="tm-route"></span><span class="tm-pin"></span>' +
                '<span class="tm-eta">' + etaText + ' 到达</span>' +
                '<span class="tm-status">' + tStatus + '</span></div>';
            html = header(tIcon, tHead, time) + tMain + tMap +
                info([
                    ['店铺', cd.shop || '外卖', 'store'],
                    ['餐品', cd.food || '外卖', 'utensil'],
                    ['预计送达', etaText, 'clock'],
                    ['订单状态', tStatus, 'receipt']
                ]) + note(cd.note || '') + tFoot;
        } else if (type === 'location') {
            var dist = Number(cd.distance || 0);
            var distText = dist > 0 ? ('距你 ' + (dist >= 1000 ? (dist / 1000).toFixed(1) + ' 公里' : dist + ' 米')) : '共享位置';
            var coord = (cd.lat != null && cd.lng != null) ? (Number(cd.lat).toFixed(4) + ', ' + Number(cd.lng).toFixed(4)) : '';
            html = header('pin', '位置分享', time) +
                mainTitle('pin', '共享位置', cd.place || '位置', distText) +
                info([
                    ['距离', distText, 'pin'],
                    ['分享人', side === 'left' ? other : me, 'user'],
                    ['坐标', coord || '未提供', 'hash'],
                    ['分享时间', time || '刚刚', 'clock']
                ]) + statusFoot('点击卡片查看位置详情');
        } else if (type === 'addfriend') {
            var aName = cd.altName || '小号';
            var aSetting = cd.altSetting || '陌生人';
            var aHead = st === 'accepted' ? '已添加好友' : (st === 'rejected' ? '已拒绝' : '好友申请');
            var aIcon = st === 'accepted' ? 'checkCircle' : (st === 'rejected' ? 'x' : 'userPlus');
            var aFoot = st === 'accepted' ? statusFoot('已添加好友') : (st === 'rejected' ? statusFoot('已拒绝') : actions([['拒绝', 'altfriend-reject', false], ['接受', 'altfriend-accept', true]]));
            html = header(aIcon, aHead, time) +
                mainTitle('userPlus', '好友申请', aName, aSetting) +
                info([
                    ['昵称', aName, 'user'],
                    ['来源', aSetting, 'hash'],
                    ['申请时间', time || '刚刚', 'clock'],
                    ['申请状态', st === 'accepted' ? '已添加' : (st === 'rejected' ? '已拒绝' : '待处理'), 'box']
                ]) + note(cd.altFirst || '') + aFoot;
        } else if (type === 'invite') {
            var isUserInvite = cd.direction === 'user';
            var title = isUserInvite ? '我邀请你加入群聊' : ((cd.fromName || '角色') + ' 邀请你加入群聊');
            var iHead = st === 'accepted' ? '已加入群聊' : (st === 'rejected' ? '邀请已拒绝' : '群聊邀请');
            var iIcon = st === 'accepted' ? 'checkCircle' : (st === 'rejected' ? 'x' : 'users');
            var iFoot = st === 'accepted'
                ? statusFoot(isUserInvite ? '对方已同意，已加入群聊' : '已同意，可在聊天页进入该群')
                : (st === 'rejected'
                    ? statusFoot(isUserInvite ? '对方拒绝了邀请' : '已拒绝')
                    : (isUserInvite ? statusFoot('等待 ' + (cd.toName || '对方') + ' 回应（点右下角回复）')
                        : actions([['拒绝', 'reject', false], ['同意', 'accept', true]])));
            html = header(iIcon, iHead, time) +
                mainTitle('users', '群聊邀请', title, '群聊：' + (cd.groupName || '')) +
                info([
                    ['群聊名称', cd.groupName || '群聊', 'users'],
                    ['邀请人', isUserInvite ? me : (cd.fromName || other), 'user'],
                    ['群成员', opts.groupMemberCount ? (opts.groupMemberCount + ' 人') : '—', 'users'],
                    ['邀请状态', st === 'accepted' ? '已加入' : (st === 'rejected' ? '已拒绝' : '待处理'), 'box']
                ]) + iFoot;
        } else if (type === 'call') {
            var isVideo = !!cd.video;
            var missed = !!cd.missed;
            var dur = cd.duration || '00:00';
            var cTitle = isVideo ? '视频通话' : '语音通话';
            var cHead = missed ? (isVideo ? '未接视频通话' : '未接来电') : cTitle;
            var cSub = missed ? '对方已取消' : ('通话时长 ' + dur);
            html = header(missed ? 'x' : (isVideo ? 'video' : 'phone'), cHead, time) +
                mainTitle(isVideo ? 'video' : 'phone', '通话记录', cTitle, cSub) +
                info([
                    ['通话类型', isVideo ? '视频通话' : '语音通话', isVideo ? 'video' : 'phone'],
                    ['通话时长', missed ? '未接通' : dur, 'clock'],
                    ['呼叫方向', side === 'left' ? '对方来电' : '我拨出', 'user'],
                    ['通话时间', time || '刚刚', 'calendar']
                ]) + statusFoot('点击卡片查看通话详情');
        } else if (type === 'listen') {
            var song = String(cd.title || '').trim();
            var artist = String(cd.sub || '').trim();
            var lDir = cd.direction || 'user';
            var lSub = song ? ('《' + song + '》' + (artist ? (' · ' + artist) : '')) : '邀请一起听歌';
            var lHead = st === 'accepted' ? '一起听中' : (st === 'rejected' ? '邀请已婉拒' : (st === 'ended' ? '一起听已结束' : (st === 'expired' ? '邀请已过期' : '一起听邀请')));
            var lIcon = st === 'accepted' ? 'headphones' : (st === 'rejected' || st === 'ended' || st === 'expired' ? 'x' : 'clock');
            var lFoot = '';
            if (st === 'accepted') lFoot = statusFoot(lDir === 'char' ? '你已接受，一起听开始' : 'TA 接受了，一起听中');
            else if (st === 'rejected') lFoot = statusFoot(lDir === 'char' ? '你婉拒了邀请' : 'TA 婉拒了邀请');
            else if (st === 'ended') lFoot = statusFoot('一起听已结束');
            else if (st === 'expired') lFoot = statusFoot('邀请已过期');
            else if (lDir === 'char') lFoot = actions([['婉拒', 'listen-reject', false], ['接收', 'listen-accept', true]]);
            else lFoot = statusFoot('等待 ' + (cd.toName || '对方') + ' 回应（点右下角回复）');
            html = header(lIcon, lHead, time) +
                mainTitle('headphones', '一起听', song || '一起听', lSub) +
                info([
                    ['歌曲', song || '一起听歌', 'headphones'],
                    ['歌手', artist || '—', 'user'],
                    ['发起人', lDir === 'user' ? me : other, 'user'],
                    ['邀请状态', st === 'accepted' ? '一起听中' : (st === 'rejected' ? '已婉拒' : (st === 'ended' ? '已结束' : (st === 'expired' ? '已过期' : '待回应'))), 'box']
                ]) + lFoot;
        } else if (type === 'couple') {
            var kind = cd.coupleKind || '';
            var kindMap = {
                survey: ['问卷分享', 'users'],
                personality: ['人格分析', 'sparkles'],
                judge: ['恋爱裁判', 'heart'],
                letters: ['情书', 'file'],
                diary: ['恋爱日记', 'book'],
                draw: ['双人画板', 'image'],
                anniv: ['纪念日', 'calendar'],
                takeover: ['查手机', 'phone'],
                invite: ['空间邀请', 'heart']
            };
            var kInfo = kindMap[kind] || ['情侣空间', 'heart'];
            var cTitle2 = cd.title || (kind === 'invite' ? '情侣空间邀请' : (kind === 'takeover' ? 'TA 查看了你的手机' : '情侣空间'));
            var cHead2 = kind === 'invite' ? '情侣空间邀请' : (kind === 'takeover' ? '手机查看分享' : '情侣空间分享');
            var cFoot2 = '点击卡片查看完整内容';
            if (kind === 'takeover') cFoot2 = '点击查看 TA 看到的内容';
            else if (kind === 'invite') {
                var cst = cd.status || 'pending';
                if (cst === 'accepted') cFoot2 = 'TA 已同意，可回到情侣空间开通';
                else if (cst === 'rejected') cFoot2 = 'TA 暂时没有答应';
                else cFoot2 = '点右下角「回复」，让 TA 决定是否开通';
            }
            html = header(kind === 'takeover' ? 'phone' : 'heart', cHead2, time) +
                mainTitle(kInfo[1], '情侣空间', cTitle2, '') +
                info([
                    ['分享类型', kInfo[0], kInfo[1]],
                    ['分享人', side === 'left' ? other : me, 'user'],
                    ['来源', '情侣空间', 'heart'],
                    ['分享时间', time || '刚刚', 'clock']
                ]) + note(cd.coupleSummary || '') + statusFoot(cFoot2);
        } else if (type === 'fanfic') {
            var chapters = Number(cd.chapters || 0);
            var fHead2 = '同人文';
            html = header('book', fHead2, time) +
                mainTitle('book', '同人文', cd.title || '同人文', [cd.sub, cd.genres].filter(Boolean).join(' · ')) +
                info([
                    ['类型', cd.genres || '同人文', 'book'],
                    ['章节', chapters ? (chapters + ' 章') : '—', 'list'],
                    ['结局', cd.ending || 'HE', 'heart'],
                    ['阅读状态', '可阅读', 'checkCircle']
                ]) + note(cd.excerpt || '') +
                actions([['阅读', 'open-fanfic', true]]);
        } else if (type === 'file') {
            var fname = cd.name || '文件';
            var fsize = cd.size || '文件';
            var dot = fname.lastIndexOf('.');
            var ext = dot > -1 ? fname.slice(dot + 1).toUpperCase() : '文件';
            var preview = cd.content ? clip(String(cd.content).replace(/\s+/g, ' '), 90) : '';
            html = header('file', '文件', time) +
                mainTitle('file', '收到一个文件', fname, fsize) +
                info([
                    ['文件类型', ext, 'file'],
                    ['文件大小', fsize, 'box'],
                    ['发送人', side === 'right' ? me : other, 'user'],
                    ['发送时间', time || '刚刚', 'clock']
                ]) + note(preview) + statusFoot('点击卡片查看文件内容');
        } else if (type === 'study') {
            var studyMins = Number(cd.minutes || 0);
            var studyPomos = Number(cd.pomos || 0);
            html = header('book', '学习陪伴', time) +
                mainTitle('clock', '番茄钟', cd.title || '学习', cd.date || '') +
                info([
                    ['学习主题', cd.title || '学习', 'book'],
                    ['专注时长', studyMins ? (studyMins + ' 分钟') : (cd.duration || '—'), 'clock'],
                    ['完成番茄', studyPomos ? (studyPomos + ' 个') : '—', 'checkCircle'],
                    ['陪伴 char', side === 'left' ? other : me, 'user']
                ]) + note(cd.summary || '') + statusFoot('点击查看本次学习内容与对话');
        } else if (type === 'scheduleReport') {
            var imgSrc = String(cd.img || '');
            var imgHtml = imgSrc ? '<div class="card-image"><img src="' + esc(imgSrc) + '" alt=""></div>' : '';
            var sub = [cd.start, cd.place].filter(Boolean).join(' · ');
            html = header('calendar', '日程报备', time) + imgHtml +
                mainTitle('calendar', '日程报备', cd.title || '刚刚的记录', sub) +
                info([
                    ['开始时间', cd.start || time || '—', 'clock'],
                    ['地点', cd.place || '—', 'pin'],
                    ['记录人', side === 'left' ? other : me, 'user'],
                    ['记录时间', time || '刚刚', 'calendar']
                ]) + note(cd.note || '') + statusFoot('点击查看图片与备注');
        } else if (type === 'redpacket') {
            var rpCount = Math.max(1, parseInt(cd.count, 10) || 1);
            var rpClaims = Array.isArray(cd.claims) ? cd.claims.length : 0;
            var rpDone = rpClaims >= rpCount;
            var rpStatus = rpDone ? ('已领完 ' + rpClaims + '/' + rpCount) : (rpClaims ? ('已领取 ' + rpClaims + '/' + rpCount) : ('待领取 0/' + rpCount));
            var rpHead = rpDone ? '红包已领完' : (cd.opened ? '红包已领取' : (side === 'right' ? '红包已发出' : '收到一个红包'));
            html = header(rpDone ? 'checkCircle' : 'redpacket', rpHead, time) +
                mainTitle('redpacket', cd.opened ? '已拆开' : (rpDone ? '红包已领完' : '恭喜发财，大吉大利'), cd.title || '恭喜发财，大吉大利', rpCount + ' 个红包') +
                info([
                    ['红包类型', '拼手气红包', 'redpacket'],
                    ['红包个数', rpCount + ' 个', 'hash'],
                    ['发送人', side === 'left' ? other : me, 'user'],
                    ['红包状态', rpStatus, 'box']
                ]) + statusFoot(cd.opened ? '已拆开' : (rpDone ? '已领完' : '点击领取'));
        } else if (type === 'notice') {
            var confirmed = cd.confirmed || {};
            var count = Object.keys(confirmed).length + 1;
            var total = opts.groupMemberCount ? (opts.groupMemberCount + 1) : count;
            var isMe = !!confirmed['me'];
            var nFoot = side === 'right'
                ? statusFoot('由你发布 · ' + count + '/' + total)
                : (isMe
                    ? statusFoot('已确认 · ' + count + '/' + total)
                    : actions([['确认', '', true, 'data-notice="' + esc(cd.noticeId || '') + '"']]));
            html = header('bell', '群公告', time) +
                mainTitle('bell', '群公告', '群公告', (cd.text || '').slice(0, 24)) +
                info([
                    ['发布人', side === 'left' ? other : me, 'user'],
                    ['已确认', count + '/' + total, 'users'],
                    ['发布时间', time || '刚刚', 'clock'],
                    ['公告状态', side === 'right' ? '已发布' : (isMe ? '已确认' : '待确认'), 'box']
                ]) + note(cd.text || '') + nFoot;
        } else if (type === 'chain') {
            var chain = Array.isArray(cd.chain) ? cd.chain : [];
            var chainHtml = chain.length
                ? '<div class="chain-list">' + chain.map(function (it, idx) {
                    return '<div class="chain-item"><span class="idx">' + (idx + 1) + '.</span>' + esc(it.text || '') +
                        ' <span class="chain-name">— ' + esc(it.name || '') + '</span></div>';
                }).join('') + '</div>'
                : '';
            html = header('list', '群接龙', time) +
                mainTitle('list', '群接龙', cd.title || '群接龙', cd.desc || (side === 'right' ? '等待群友接龙' : '点击下方按钮参与接龙')) +
                info([
                    ['发起人', side === 'left' ? other : me, 'user'],
                    ['参与人数', chain.length + ' 人', 'users'],
                    ['接龙状态', '进行中', 'box'],
                    ['发起时间', time || '刚刚', 'clock']
                ]) + chainHtml + (side === 'right' ? statusFoot('由你发起') : actions([['我要接龙', '', true, 'data-chain="' + esc(cd.chainId || '') + '"']]));
        } else if (type === 'cycle') {
            html = header('calendar', cd.title || '经期提醒', time) +
                mainTitle('calendar', '经期提醒', cd.sub || '', cd.date || '', cd) +
                info([
                    ['预计', cd.date || '—', 'calendar'],
                    ['周期', cd.cycle || '—', 'clock'],
                    ['提醒', cd.note || '记得照顾好自己', 'heart']
                ]) + statusFoot(cd.footer || '');
        } else {
            html = header('box', cd.title || '卡片', time) +
                mainTitle('box', '卡片消息', cd.title || '卡片', cd.sub || '') +
                info([
                    ['标题', cd.title || '卡片', 'box'],
                    ['内容', cd.sub || '—', 'hash'],
                    ['时间', time || '刚刚', 'clock'],
                    ['状态', st, 'checkCircle']
                ]) + statusFoot(cd.footer || '');
        }
        return html;
    }

    window.NanoCardUI = { build: build, icons: ICONS };
})();
