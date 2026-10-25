// ============================================================
// mall.js — Store 商城 / 外卖
// 支付：本人银行卡 / 亲属卡 / Char 代付
// 礼物卡片通过 localStorage 队列同步到私聊
// ============================================================
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
        });
    }
    function money(n) {
        return '¥' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    function uid() {
        try {
            var d = JSON.parse(localStorage.getItem('nano_mask_data') || 'null');
            if (d && d.currentMaskId != null && d.currentMaskId !== '') return String(d.currentMaskId);
        } catch (e) {}
        return 'default';
    }
    function userName() {
        try {
            if (window.NanoUserScope && NanoUserScope.currentUserName) return NanoUserScope.currentUserName();
        } catch (e) {}
        return '我';
    }
    function dataKey() { return 'nano_mall_data__' + uid(); }

    // ===== 默认商品 =====
    function seedProducts() {
        return [
            { id: 'p1', name: '无线降噪耳机', desc: '轻量头戴，四十小时续航。', price: 399, cat: 'digital', type: 'shop' },
            { id: 'p2', name: '雪松香薰蜡烛', desc: '木质调，燃烧约四十五小时。', price: 89, cat: 'home', type: 'shop' },
            { id: 'p3', name: '不锈钢保温杯', desc: '五百毫升，全天保温。', price: 129, cat: 'home', type: 'shop' },
            { id: 'p4', name: '帆布托特包', desc: '加厚帆布，通勤容量。', price: 159, cat: 'gift', type: 'shop' },
            { id: 'p5', name: '机械键盘', desc: '八十七键，静音轴。', price: 329, cat: 'digital', type: 'shop' },
            { id: 'p6', name: '护手霜礼盒', desc: '三支装，清爽不黏。', price: 79, cat: 'beauty', type: 'shop' },
            { id: 'p7', name: '胶片相机', desc: '一次性胶卷相机。', price: 219, cat: 'gift', type: 'shop' },
            { id: 'p8', name: '羊毛围巾', desc: '柔软亲肤，纯色。', price: 199, cat: 'gift', type: 'shop' },
            { id: 'p9', name: '手账本套装', desc: '方格内页，含贴纸。', price: 59, cat: 'stationery', type: 'shop' },
            { id: 'p10', name: '无线蓝牙音箱', desc: '小巧低音，浴室也能放。', price: 299, cat: 'digital', type: 'shop' },
            { id: 'p11', name: '冷萃咖啡壶', desc: '玻璃壶身，冷萃一晚刚好。', price: 229, cat: 'home', type: 'shop' },
            { id: 'p12', name: '香氛沐浴礼盒', desc: '雪松与白麝香，留香很久。', price: 259, cat: 'beauty', type: 'shop' },
            { id: 'p13', name: '钢笔礼盒', desc: '磨砂笔身，附墨水和卡片。', price: 189, cat: 'stationery', type: 'shop' },
            { id: 'p14', name: '拍立得相纸', desc: '二十张装，白边。', price: 69, cat: 'gift', type: 'shop' },
            { id: 'p15', name: '真丝眼罩', desc: '遮光柔软，适合长途飞行。', price: 99, cat: 'gift', type: 'shop' },
            { id: 'p16', name: '桌面加湿器', desc: '静音喷雾，小夜灯。', price: 139, cat: 'home', type: 'shop' },
            { id: 'p17', name: '拍立得相机', desc: '即拍即得，带自拍镜。', price: 499, cat: 'digital', type: 'shop' },
            { id: 'p18', name: '香根草香水', desc: '干净木质调，三十毫升。', price: 359, cat: 'beauty', type: 'shop' },
            { id: 'f1', name: '牛肉饭', desc: '现炒牛肉，米饭免费加。', price: 32, cat: 'meal', type: 'food' },
            { id: 'f2', name: '鸡胸沙拉', desc: '低脂高蛋白，油醋汁。', price: 28, cat: 'meal', type: 'food' },
            { id: 'f3', name: '冰拿铁', desc: '双份浓缩，少冰。', price: 22, cat: 'coffee', type: 'food' },
            { id: 'f4', name: '黄油可颂', desc: '现烤，外酥内软。', price: 16, cat: 'dessert', type: 'food' },
            { id: 'f5', name: '提拉米苏', desc: '马斯卡彭，微苦可可。', price: 26, cat: 'dessert', type: 'food' },
            { id: 'f6', name: '关东煮拼盘', desc: '六串组合，微辣汤底。', price: 24, cat: 'night', type: 'food' },
            { id: 'f7', name: '麻辣烫', desc: '自选十样，微辣。', price: 35, cat: 'meal', type: 'food' },
            { id: 'f8', name: '寿司拼盘', desc: '三文鱼与甜虾，十二贯。', price: 58, cat: 'meal', type: 'food' },
            { id: 'f9', name: '生椰拿铁', desc: '椰乳清甜，少糖。', price: 22, cat: 'coffee', type: 'food' },
            { id: 'f10', name: '芝士蛋糕', desc: '厚切，冷藏后更好吃。', price: 32, cat: 'dessert', type: 'food' },
            { id: 'f11', name: '烧烤拼盘', desc: '十串荤素搭配，孜然味。', price: 68, cat: 'night', type: 'food' },
            { id: 'f12', name: '小笼包', desc: '一笼八只，鲜肉汤汁。', price: 18, cat: 'meal', type: 'food' },
            { id: 'f13', name: '水果茶', desc: '当季水果，少冰。', price: 20, cat: 'coffee', type: 'food' },
            { id: 'f14', name: '炸鸡桶', desc: '半只鸡，配两种蘸酱。', price: 49, cat: 'night', type: 'food' }
        ];
    }

    var SHOP_CATS = [
        { id: 'all', label: '全部' }, { id: 'digital', label: '数码' }, { id: 'home', label: '居家' },
        { id: 'gift', label: '礼物' }, { id: 'beauty', label: '美妆' }, { id: 'stationery', label: '文具' }
    ];
    var FOOD_CATS = [
        { id: 'all', label: '全部' }, { id: 'meal', label: '简餐' }, { id: 'coffee', label: '咖啡' },
        { id: 'dessert', label: '甜点' }, { id: 'night', label: '夜宵' }
    ];

    var state = {
        products: [], cart: [], orders: [], inventory: [],
        selected: {}, tab: 'shop', shopCat: 'all', foodCat: 'all', search: ''
    };
    var chars = [];
    var wallet = null;
    var paySettings = { hasPassword: false, freePay: false };
    var familyCards = [];
    var checkoutCtx = null;
    var paying = false;
    var passwordCb = null;
    var userProfile = { name: '', avatar: '' };

    function currentMaskId() {
        try {
            var md = JSON.parse(localStorage.getItem('nano_mask_data') || localStorage.getItem('nano_home_data') || 'null');
            if (md) return String(md.currentMaskId || (md.masks && md.masks[0] && md.masks[0].id) || '');
        } catch (e) {}
        return '';
    }
    function idbRecord(dbName, storeName, version, key) {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open(dbName, version || 1);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: storeName === 'avatars' ? 'id' : 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) {
                    var db = e.target.result;
                    try {
                        var g = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
                        g.onsuccess = function () { resolve(g.result || null); try { db.close(); } catch (er) {} };
                        g.onerror = function () { resolve(null); try { db.close(); } catch (er) {} };
                    } catch (err) { resolve(null); }
                };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }
    async function loadUserProfile() {
        var mask = null;
        try { if (window.NanoUserScope && NanoUserScope.currentUser) mask = NanoUserScope.currentUser(); } catch (e) {}
        var name = (mask && mask.name) ? String(mask.name) : '';
        if (!name) {
            try { name = localStorage.getItem('user_name_data') || ''; } catch (e) {}
        }
        if (!name) name = userName();
        // 先读 mask 头像，保证和 More / 私聊里的当前人设一致
        var avatar = '';
        var mid = (mask && mask.id != null) ? String(mask.id) : currentMaskId();
        if (mid) {
            var av = await idbRecord('MaskAvatarDB', 'avatars', 1, mid);
            if (av && av.data) avatar = String(av.data);
        }
        if (!avatar) {
            var rec = await idbRecord('nano_user_db', 'user_data', 1, 'user_avatar_data');
            if (rec && rec.value) avatar = String(rec.value);
        }
        return { name: name || '我', avatar: avatar || '' };
    }

    // ===== 图标 =====
    function artSvg(cat) {
        if (cat === 'digital') return '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="7" rx="2"/><rect x="17" y="13" width="4" height="7" rx="2"/></svg>';
        if (cat === 'home') return '<svg viewBox="0 0 24 24"><path d="M9 21h6M12 17v4M7 10a5 5 0 0 1 10 0c0 2-1 3-1 5H8c0-2-1-3-1-5z"/><path d="M7 10H5M19 10h-2"/></svg>';
        if (cat === 'gift') return '<svg viewBox="0 0 24 24"><path d="M20 12v8H4v-8"/><path d="M2 8h20v4H2z"/><path d="M12 8v12"/><path d="M12 8C10.5 4.5 6 5 6 7.5 6 8.5 7 8 8 8h4zM12 8c1.5-3.5 6-3 6-.5 0 1-1 .5-2 .5h-4z"/></svg>';
        if (cat === 'beauty') return '<svg viewBox="0 0 24 24"><path d="M10 3h4v4h-4zM8 7h8l1 14H7L8 7z"/><path d="M9 12h6"/></svg>';
        if (cat === 'stationery') return '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>';
        if (cat === 'meal') return '<svg viewBox="0 0 24 24"><path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M8 21h8"/><path d="M9 7c0-1.2 1-1.8 1-3M14 7c0-1.2 1-1.8 1-3"/></svg>';
        if (cat === 'coffee') return '<svg viewBox="0 0 24 24"><path d="M5 8h12v6a5 5 0 0 1-10 0V8z"/><path d="M17 9h2a2 2 0 0 1 0 4h-2"/><path d="M5 21h12"/></svg>';
        if (cat === 'dessert') return '<svg viewBox="0 0 24 24"><path d="M4 20h16L18 9H6L4 20z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/><path d="M8 14h8"/></svg>';
        if (cat === 'night') return '<svg viewBox="0 0 24 24"><path d="M4 10h16l-2 10H6L4 10z"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M9 14h6"/></svg>';
        return '<svg viewBox="0 0 24 24"><path d="M4 7h16v13H4z"/><path d="M4 7l3-3h10l3 3"/><path d="M9 7v13"/></svg>';
    }
    function productArt(p) {
        if (p.image) return '<img src="' + esc(p.image) + '" alt="">';
        return artSvg(p.cat);
    }

    // ===== 数据（localStorage，避免部分 WebView 的 IndexedDB 卡死） =====
    function loadData() {
        var data = null;
        try { data = JSON.parse(localStorage.getItem(dataKey()) || 'null'); } catch (e) { data = null; }
        if (!data || typeof data !== 'object') {
            data = { products: seedProducts(), cart: [], orders: [] };
            try { localStorage.setItem(dataKey(), JSON.stringify(data)); } catch (e) {}
        }
        state.products = Array.isArray(data.products) ? data.products : [];
        state.cart = Array.isArray(data.cart) ? data.cart : [];
        state.orders = Array.isArray(data.orders) ? data.orders : [];
        state.inventory = Array.isArray(data.inventory) ? data.inventory : [];
        // 老用户也补上新增的默认商品（自定义商品 id 以 custom_ 开头，不受影响）
        var addedDefault = false;
        seedProducts().forEach(function (p) {
            if (!state.products.some(function (x) { return x && x.id === p.id; })) {
                state.products.push(p);
                addedDefault = true;
            }
        });
        state.cart.forEach(function (c) {
            if (state.selected[c.productId] === undefined) state.selected[c.productId] = true;
        });
        if (addedDefault) saveData();
        return Promise.resolve();
    }
    function saveData() {
        try {
            localStorage.setItem(dataKey(), JSON.stringify({
                products: state.products,
                cart: state.cart,
                orders: state.orders,
                inventory: state.inventory
            }));
        } catch (e) {
            toast('存储空间不足，图片可能过大');
        }
        return Promise.resolve();
    }

    function productById(id) {
        for (var i = 0; i < state.products.length; i++) if (state.products[i].id === id) return state.products[i];
        return null;
    }
    function cartItems() {
        var out = [];
        state.cart.forEach(function (c) {
            var p = productById(c.productId);
            if (p) out.push({ product: p, qty: Math.max(1, parseInt(c.qty, 10) || 1) });
        });
        return out;
    }
    function selectedCartItems() {
        return cartItems().filter(function (x) { return state.selected[x.product.id] !== false; });
    }
    function cartCount() {
        return state.cart.reduce(function (n, c) { return n + (parseInt(c.qty, 10) || 0); }, 0);
    }
    function totalOf(items) {
        return Math.round(items.reduce(function (s, x) { return s + Number(x.product.price) * x.qty; }, 0) * 100) / 100;
    }

    // ===== 角色 / 支付上下文 =====
    async function loadChars() {
        try {
            if (window.NanoUserScope && NanoUserScope.loadChars) {
                var list = await NanoUserScope.loadChars();
                return (list || []).map(function (c) { return { id: String(c.id), name: c.name || '角色', avatar: c.avatar || '' }; });
            }
        } catch (e) {}
        return [];
    }
    function loadFamilyCards() {
        var prefix = 'nano_family_cards__' + uid() + '_';
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(prefix) !== 0) continue;
                var chatId = k.slice(prefix.length);
                var arr = [];
                try { arr = JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) { arr = []; }
                arr.forEach(function (c) {
                    if (!c || c.issuer !== 'char' || c.holder !== 'user' || c.status !== 'active') return;
                    var limit = Number(c.limit || 0);
                    var spent = Number(c.spent || 0);
                    var remain = Math.max(0, limit - spent);
                    if (remain <= 0) return;
                    out.push(Object.assign({}, c, { _chatId: chatId, _remain: remain }));
                });
            }
        } catch (e) {}
        return out;
    }
    function withTimeout(promise, ms, fallback) {
        return Promise.race([
            Promise.resolve(promise).catch(function () { return fallback; }),
            new Promise(function (resolve) { setTimeout(function () { resolve(fallback); }, ms); })
        ]);
    }
    async function refreshContext() {
        var res = await Promise.all([
            withTimeout(loadChars(), 1500, []),
            withTimeout(NanoPay.readWallet(), 1500, { balance: 5000, transactions: [] }),
            withTimeout(NanoPay.getSettings(), 1200, { hasPassword: false, freePay: false })
        ]);
        chars = res[0] || [];
        wallet = res[1] || { balance: 5000, transactions: [] };
        paySettings = res[2] || { hasPassword: false, freePay: false };
        familyCards = loadFamilyCards();
    }
    function charName(id) {
        for (var i = 0; i < chars.length; i++) if (chars[i].id === String(id)) return chars[i].name;
        return '角色';
    }
    function charWalletBalance(id) {
        try {
            var w = window.NanoFamilyCardStore ? NanoFamilyCardStore.readCharWallet(id) : null;
            return w ? Number(w.balance) || 0 : 0;
        } catch (e) { return 0; }
    }

    // ===== UI 工具 =====
    var toastEl = $('toast');
    function toast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
    }
    function openSheet(title, body, foot) {
        $('sheetTitle').textContent = title;
        $('sheetBody').innerHTML = body;
        $('sheetFoot').innerHTML = foot || '';
        $('overlay').classList.add('show');
        $('sheet').classList.add('show');
        $('sheetBody').scrollTop = 0;
    }
    function closeSheet() {
        $('overlay').classList.remove('show');
        $('sheet').classList.remove('show');
        passwordCb = null;
    }

    // ===== 渲染 =====
    function renderChips() {
        $('shopChips').innerHTML = SHOP_CATS.map(function (c) {
            return '<button class="chip' + (state.shopCat === c.id ? ' active' : '') + '" data-shop-cat="' + c.id + '" type="button">' + c.label + '</button>';
        }).join('');
        $('foodChips').innerHTML = FOOD_CATS.map(function (c) {
            return '<button class="chip' + (state.foodCat === c.id ? ' active' : '') + '" data-food-cat="' + c.id + '" type="button">' + c.label + '</button>';
        }).join('');
    }

    function renderShop() {
        var q = state.search.trim().toLowerCase();
        var list = state.products.filter(function (p) {
            if (p.type === 'food') return false;
            if (state.shopCat !== 'all' && p.cat !== state.shopCat) return false;
            if (q && (String(p.name) + ' ' + String(p.desc || '')).toLowerCase().indexOf(q) === -1) return false;
            return true;
        });
        $('shopCount').textContent = list.length + ' 件';
        $('productGrid').innerHTML = list.length ? list.map(function (p) {
            return '<article class="product-card">' +
                '<div class="product-art" data-action="detail" data-id="' + esc(p.id) + '">' + productArt(p) + '</div>' +
                '<div class="product-body">' +
                    '<div class="product-name" data-action="detail" data-id="' + esc(p.id) + '">' + esc(p.name) + '</div>' +
                    '<div class="product-foot"><span class="product-price">' + money(p.price) + '</span>' +
                    '<button class="add-btn" data-action="add" data-id="' + esc(p.id) + '" type="button" aria-label="加入购物车"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>' +
                '</div></article>';
        }).join('') : '<div class="cart-empty" style="grid-column:1/-1;"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg><span>没有找到商品</span></div>';
    }

    function renderFood() {
        var list = state.products.filter(function (p) {
            if (p.type !== 'food') return false;
            if (state.foodCat !== 'all' && p.cat !== state.foodCat) return false;
            return true;
        });
        $('foodList').innerHTML = list.length ? list.map(function (p) {
            return '<div class="food-row">' +
                '<div class="food-thumb" data-action="detail" data-id="' + esc(p.id) + '">' + productArt(p) + '</div>' +
                '<div class="food-info" data-action="detail" data-id="' + esc(p.id) + '">' +
                    '<span class="food-name">' + esc(p.name) + '</span>' +
                    '<span class="food-desc">' + esc(p.desc || '') + '</span>' +
                    '<span class="food-price">' + money(p.price) + '</span>' +
                '</div>' +
                '<button class="food-add" data-action="add" data-id="' + esc(p.id) + '" type="button" aria-label="加入购物车"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>' +
            '</div>';
        }).join('') : '<div class="cart-empty"><span>暂无餐食</span></div>';
    }

    function renderCart() {
        var items = cartItems();
        var sel = selectedCartItems();
        var has = items.length > 0;
        $('cartEmpty').style.display = has ? 'none' : 'flex';
        $('cartList').style.display = has ? 'flex' : 'none';
        $('cartCount').textContent = cartCount() + ' 件';
        $('selectAllCart').checked = has && sel.length === items.length;
        $('cartList').innerHTML = items.map(function (x) {
            var p = x.product;
            return '<div class="cart-row">' +
                '<label class="check"><input type="checkbox" data-cart-check="' + esc(p.id) + '"' + (state.selected[p.id] !== false ? ' checked' : '') + '><span class="check-box"><svg viewBox="0 0 24 24"><path d="M5 12l4.5 4.5L19 7"/></svg></span></label>' +
                '<div class="cart-thumb" data-action="detail" data-id="' + esc(p.id) + '">' + productArt(p) + '</div>' +
                '<div class="cart-info"><div class="cart-name">' + esc(p.name) + '</div><div class="cart-price">' + money(p.price) + '</div></div>' +
                '<div class="qty"><button data-action="dec" data-id="' + esc(p.id) + '" type="button">−</button><span>' + x.qty + '</span><button data-action="inc" data-id="' + esc(p.id) + '" type="button">+</button></div>' +
            '</div>';
        }).join('');
        updateCartBar();
    }

    function updateCartBar() {
        var items = selectedCartItems();
        var total = totalOf(items);
        $('checkoutTotal').textContent = money(total);
        $('checkoutBtn').disabled = !items.length;
        $('askCharPayBtn').disabled = !items.length;
        $('checkoutBar').style.display = (state.tab === 'cart' && items.length) ? 'flex' : 'none';
    }

    function renderOrders() {
        $('ordersEmpty').style.display = state.orders.length ? 'none' : 'flex';
        $('orderList').innerHTML = state.orders.map(function (o) {
            var lines = (o.items || []).map(function (it) {
                return '<div class="order-line"><span>' + esc(it.name) + ' × ' + (it.qty || 1) + '</span><span>' + money(it.price * (it.qty || 1)) + '</span></div>';
            }).join('');
            var extra = o.gift ? (' · 送给 ' + esc(o.recipient || '')) : '';
            return '<div class="order-card">' +
                '<div class="order-top"><span class="order-id">' + esc(o.id) + ' · ' + esc((o.time || '').slice(0, 16).replace('T', ' ')) + '</span><span class="order-status">' + esc(o.status || '已支付') + '</span>' +
                '<button class="order-del" data-order-del="' + esc(o.id) + '" type="button" aria-label="删除订单"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></svg></button></div>' +
                '<div class="order-items">' + lines + '</div>' +
                '<div class="order-foot"><span class="order-pay">' + esc(o.payment || '') + extra + '</span><span class="order-total">' + money(o.total) + '</span></div>' +
            '</div>';
        }).join('');
    }

    function renderInventory() {
        var list = Array.isArray(state.inventory) ? state.inventory : [];
        var countEl = $('inventoryCount');
        var listEl = $('inventoryList');
        if (countEl) countEl.textContent = list.length + ' 件';
        if (!listEl) return;
        listEl.innerHTML = list.length ? list.map(function (it) {
            return '<div class="my-product-row">' +
                '<div class="my-product-thumb">' + productArt({ image: it.image || '', cat: it.cat || 'gift' }) + '</div>' +
                '<div class="my-product-info"><div class="my-product-name">' + esc(it.name) + '</div><div class="my-product-price">' + money(it.price) + (it.fromChar ? (' · 来自 ' + esc(it.fromChar)) : '') + '</div></div>' +
                '<div class="inv-actions">' +
                    '<button class="inv-btn" data-inv-use="' + esc(it.invId) + '" type="button">使用</button>' +
                    '<button class="inv-btn primary" data-inv-gift="' + esc(it.invId) + '" type="button">送出</button>' +
                '</div>' +
            '</div>';
        }).join('') : '<div class="cart-empty" style="padding:26px 0;"><span>仓库是空的</span></div>';
    }

    function renderMe() {
        var name = userProfile.name || userName() || '我';
        $('profileName').textContent = name;
        var avatarEl = $('profileAvatar');
        if (userProfile.avatar) {
            avatarEl.innerHTML = '<img src="' + esc(userProfile.avatar) + '" alt="">';
        } else {
            avatarEl.textContent = name ? name.slice(0, 1) : 'ME';
        }
        $('walletAmount').textContent = money(wallet ? wallet.balance : 0);
        $('walletNote').textContent = paySettings.hasPassword
            ? (paySettings.freePay ? '免密支付已开启' : '已设置支付密码')
            : (paySettings.freePay ? '免密支付已开启' : '未设置支付密码');
        renderInventory();
    }

    function renderBadge() {
        var n = cartCount();
        ['topCartBadge', 'tabCartBadge'].forEach(function (id) {
            var el = $(id);
            if (!el) return;
            el.textContent = n > 99 ? '99+' : String(n);
            el.classList.toggle('show', n > 0);
        });
    }

    function setTab(tab) {
        state.tab = tab;
        Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (b) {
            b.classList.toggle('active', b.getAttribute('data-tab') === tab);
        });
        Array.prototype.forEach.call(document.querySelectorAll('.page'), function (p) {
            p.classList.toggle('active', p.id === 'page-' + tab);
        });
        if (tab === 'shop') renderShop();
        if (tab === 'food') renderFood();
        if (tab === 'cart') renderCart();
        if (tab === 'orders') renderOrders();
        if (tab === 'me') { refreshContext().then(renderMe); }
        updateCartBar();
        $('mainScroll').scrollTop = 0;
    }

    // ===== 购物车操作 =====
    function addToCart(product, qty) {
        qty = Math.max(1, parseInt(qty, 10) || 1);
        var hit = null;
        for (var i = 0; i < state.cart.length; i++) if (state.cart[i].productId === product.id) hit = state.cart[i];
        if (hit) hit.qty = Math.max(1, (parseInt(hit.qty, 10) || 1) + qty);
        else state.cart.push({ productId: product.id, qty: qty });
        state.selected[product.id] = true;
        saveData();
        renderBadge();
        if (state.tab === 'cart') renderCart();
        toast('已加入购物车');
    }
    function changeQty(productId, delta) {
        for (var i = 0; i < state.cart.length; i++) {
            if (state.cart[i].productId !== productId) continue;
            state.cart[i].qty = Math.max(1, (parseInt(state.cart[i].qty, 10) || 1) + delta);
        }
        saveData();
        renderCart();
    }

    // ===== 商品详情 =====
    var detailProduct = null;
    var detailQty = 1;
    function openDetail(product) {
        detailProduct = product;
        detailQty = 1;
        renderDetail();
    }
    function renderDetail() {
        var p = detailProduct;
        if (!p) return;
        var body = '<div class="detail-art">' + productArt(p) + '</div>' +
            '<div class="detail-name">' + esc(p.name) + '</div>' +
            '<div class="detail-desc">' + esc(p.desc || '') + '</div>' +
            '<div class="detail-price">' + money(p.price) + '</div>' +
            '<div class="detail-row"><span class="detail-label">数量</span><div class="qty"><button data-action="detail-dec" type="button">−</button><span id="detailQty">' + detailQty + '</span><button data-action="detail-inc" type="button">+</button></div></div>' +
            '<button class="btn ghost block" data-action="share-product" type="button">分享商品给 TA</button>' +
            (p.custom ? '<button class="btn ghost block" data-action="delete-product-detail" type="button" style="margin-top:8px;">删除商品</button>' : '');
        var foot = '<button class="btn ghost" data-action="detail-cart" type="button">加入购物车</button><button class="btn primary" data-action="detail-buy" type="button">立即购买</button>';
        openSheet('商品详情', body, foot);
    }

    // ===== 结算 =====
    async function openCheckout(items, opts) {
        opts = opts || {};
        if (!items.length) { toast('请选择商品'); return; }
        await refreshContext();
        var total = totalOf(items);
        checkoutCtx = {
            items: items,
            total: total,
            fromCart: !!opts.fromCart,
            recipient: 'self',
            payMethod: opts.payMethod || 'own',
            familyCardId: '',
            payerCharId: chars.length ? chars[0].id : '',
            cardId: (wallet && wallet.activeCardId) || '',
            note: ''
        };
        if (checkoutCtx.payMethod === 'char' && !chars.length) checkoutCtx.payMethod = 'own';
        renderCheckout();
    }

    function renderCheckout() {
        var ctx = checkoutCtx;
        if (!ctx) return;
        var itemLines = ctx.items.map(function (x) {
            return '<div class="summary-line"><span>' + esc(x.product.name) + ' × ' + x.qty + '</span><span>' + money(x.product.price * x.qty) + '</span></div>';
        }).join('');
        var recipientOptions = '<option value="self">自己</option>' + chars.map(function (c) {
            return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
        }).join('');

        var payHtml = '';
        var myCards = (wallet && Array.isArray(wallet.cards)) ? wallet.cards : [];
        var activeCard = myCards.filter(function (c) { return String(c.id) === String(ctx.cardId || (wallet && wallet.activeCardId)); })[0] || myCards[0];
        var cardOptions = myCards.map(function (c) {
            var last = String(c.cardNumber || '').slice(-4);
            return '<option value="' + esc(c.id) + '"' + (activeCard && String(c.id) === String(activeCard.id) ? ' selected' : '') + '>' +
                esc(c.bankName || '银行卡') + (last ? (' · 尾号 ' + last) : '') + ' · ¥' + Number(c.balance || 0).toFixed(2) + '</option>';
        }).join('');
        payHtml += '<label class="pay-option' + (ctx.payMethod === 'own' ? ' active' : '') + '" data-pay="own">' +
            '<span class="pay-radio"></span>' +
            '<span class="pay-main"><span class="pay-name">我的银行卡</span><span class="pay-sub">余额 ' + money(activeCard ? activeCard.balance : (wallet ? wallet.balance : 0)) +
            (paySettings.hasPassword ? (paySettings.freePay ? ' · 免密支付' : ' · 需支付密码') : ' · 未设置密码') + '</span>' +
            (myCards.length > 1 ? '<select class="select" id="coCard" style="margin-top:8px;">' + cardOptions + '</select>' : '') +
            '</span>' +
            '<span class="pay-amount">' + money(ctx.total) + '</span></label>';

        familyCards.forEach(function (c) {
            var name = charName(c._chatId);
            payHtml += '<label class="pay-option' + (ctx.payMethod === 'family' && ctx.familyCardId === c.id ? ' active' : '') + '" data-pay="family" data-card="' + esc(c.id) + '">' +
                '<span class="pay-radio"></span>' +
                '<span class="pay-main"><span class="pay-name">亲属卡 · ' + esc(name) + '</span><span class="pay-sub">剩余额度 ' + money(c._remain) + '</span></span>' +
                '<span class="pay-amount">' + money(ctx.total) + '</span></label>';
        });

        if (chars.length) {
            var payerOptions = chars.map(function (c) {
                return '<option value="' + esc(c.id) + '"' + (ctx.payerCharId === c.id ? ' selected' : '') + '>' + esc(c.name) + ' · ' + money(charWalletBalance(c.id)) + '</option>';
            }).join('');
            payHtml += '<label class="pay-option' + (ctx.payMethod === 'char' ? ' active' : '') + '" data-pay="char">' +
                '<span class="pay-radio"></span>' +
                '<span class="pay-main"><span class="pay-name">请 TA 代付</span><span class="pay-sub">发送订单卡片，由 TA 一次性结算</span>' +
                '<select class="select" id="coPayer" style="margin-top:8px;">' + payerOptions + '</select></span>' +
                '</label>';
        } else {
            payHtml += '<div class="pay-option" style="opacity:.45;cursor:default;"><span class="pay-radio"></span><span class="pay-main"><span class="pay-name">请 TA 代付</span><span class="pay-sub">暂无可用角色</span></span></div>';
        }

        var body = '<div class="summary-box">' + itemLines + '<div class="summary-total"><span>合计</span><span>' + money(ctx.total) + '</span></div></div>' +
            '<div class="field-label">收礼人</div>' +
            '<select class="select" id="coRecipient">' + recipientOptions + '</select>' +
            '<div id="coGiftNote" style="display:' + (ctx.recipient !== 'self' ? 'block' : 'none') + ';">' +
                '<div class="field-label">礼物备注</div><input class="input" id="coNote" placeholder="写一句话" value="' + esc(ctx.note) + '">' +
            '</div>' +
            '<div class="field-label">支付方式</div><div class="pay-list" id="payList">' + payHtml + '</div>';

        var foot = '<button class="btn ghost" data-action="checkout-cancel" type="button">取消</button><button class="btn primary" data-action="checkout-pay" type="button">确认支付</button>';
        openSheet('确认订单', body, foot);

        $('coRecipient').value = ctx.recipient;
        $('coRecipient').addEventListener('change', function () {
            ctx.recipient = this.value;
            $('coGiftNote').style.display = ctx.recipient === 'self' ? 'none' : 'block';
        });
        var note = $('coNote');
        if (note) note.addEventListener('input', function () { ctx.note = this.value; });
        var payer = $('coPayer');
        if (payer) payer.addEventListener('change', function () { ctx.payerCharId = this.value; });
        var coCard = $('coCard');
        if (coCard) coCard.addEventListener('change', function () {
            ctx.cardId = this.value;
            var c = myCards.filter(function (x) { return String(x.id) === String(ctx.cardId); })[0];
            var sub = this.closest('.pay-option') && this.closest('.pay-option').querySelector('.pay-sub');
            if (c && sub) sub.firstChild.nodeValue = '余额 ' + money(c.balance) + (paySettings.hasPassword ? (paySettings.freePay ? ' · 免密支付' : ' · 需支付密码') : ' · 未设置密码');
        });
        var payList = $('payList');
        if (payList) payList.addEventListener('click', function (e) {
            var opt = e.target.closest('.pay-option[data-pay]');
            if (!opt) return;
            if (e.target.closest('select')) return;
            ctx.payMethod = opt.getAttribute('data-pay');
            ctx.familyCardId = opt.getAttribute('data-card') || '';
            Array.prototype.forEach.call(payList.querySelectorAll('.pay-option'), function (o) { o.classList.toggle('active', o === opt); });
        });
    }

    function validateCheckout() {
        var ctx = checkoutCtx;
        if (!ctx) return '结算已失效';
        if (ctx.recipient !== 'self' && ctx.payMethod === 'char' && ctx.payerCharId === ctx.recipient) {
            return '不能让收礼人代付';
        }
        if (ctx.payMethod === 'own') {
            var myCards = (wallet && Array.isArray(wallet.cards)) ? wallet.cards : [];
            var card = myCards.filter(function (c) { return String(c.id) === String(ctx.cardId || (wallet && wallet.activeCardId)); })[0] || myCards[0];
            if ((Number(card ? card.balance : (wallet ? wallet.balance : 0)) || 0) < ctx.total) return '银行卡余额不足';
        } else if (ctx.payMethod === 'family') {
            var card = null;
            familyCards.forEach(function (c) { if (c.id === ctx.familyCardId) card = c; });
            if (!card) return '请选择亲属卡';
            if (card._remain < ctx.total) return '亲属卡额度不足';
            if (charWalletBalance(card._chatId) < ctx.total) return '出资方银行卡余额不足';
        } else if (ctx.payMethod === 'char') {
            if (ctx.recipient !== 'self') return '代付只能给自己购买';
            if (!ctx.payerCharId) return '请选择代付角色';
            if (charWalletBalance(ctx.payerCharId) < ctx.total) return 'TA 的银行卡余额不足';
        }
        return '';
    }

    function snapshotItems(items) {
        return items.map(function (x) {
            return { name: x.product.name, price: Number(x.product.price), qty: x.qty, image: x.product.image || '', cat: x.product.cat };
        });
    }
    function addItemsToInventory(items) {
        items.forEach(function (x) {
            state.inventory.unshift({
                invId: 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: x.product.name,
                price: Number(x.product.price),
                qty: x.qty,
                image: x.product.image || '',
                cat: x.product.cat,
                acquiredAt: new Date().toISOString()
            });
        });
    }
    function removePurchasedFromCart(ctx) {
        if (!ctx.fromCart) return;
        var bought = {};
        ctx.items.forEach(function (x) { bought[x.product.id] = true; });
        state.cart = state.cart.filter(function (c) { return !bought[c.productId]; });
        Object.keys(bought).forEach(function (id) { delete state.selected[id]; });
    }
    function showRequestSent(payerName, ctx) {
        var body = '<div class="result-wrap"><div class="result-icon"><svg viewBox="0 0 24 24"><path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg></div>' +
            '<div class="result-title">代付请求已发送</div><div class="result-sub">' + esc(payerName) + ' 会在回复你时决定要不要付</div>' +
            '<div class="result-amount">' + money(ctx.total) + '</div></div>';
        openSheet('请求已发送', body, '<button class="btn ghost" data-action="result-orders" type="button">查看订单</button><button class="btn primary" data-action="result-done" type="button">完成</button>');
        checkoutCtx = null;
    }

    async function performPayment() {
        var ctx = checkoutCtx;
        if (!ctx || paying) return;
        var err = validateCheckout();
        if (err) { toast(err); return; }
        paying = true;
        try {
            var desc = '商城 · ' + ctx.items.map(function (x) { return x.product.name; }).slice(0, 2).join('、');

            // 请 TA 代付：只发请求卡片，不扣款、不自动调用 API
            if (ctx.payMethod === 'char') {
                var payer = ctx.payerCharId;
                var requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
                var reqItems = snapshotItems(ctx.items);
                var reqOrder = makeOrder(requestId, reqItems, ctx.total, '待 TA 确认', 'TA 代付', { gift: false, note: ctx.note || '' });
                state.orders.unshift(reqOrder);
                if (state.orders.length > 100) state.orders = state.orders.slice(0, 100);
                removePurchasedFromCart(ctx);
                await saveData();
                queueCard(payer, {
                    card: {
                        cardType: 'store',
                        storeKind: 'pay_request',
                        direction: 'char',
                        title: '商城代付请求',
                        sub: reqItems.map(function (it) { return it.name; }).join('、'),
                        amount: money(ctx.total),
                        total: ctx.total,
                        items: reqItems,
                        requestId: requestId,
                        status: 'pending',
                        from: 'user'
                    },
                    side: 'right',
                    notice: '你向 ' + charName(payer) + ' 发送了商城代付请求'
                });
                closeSheet();
                renderBadge();
                if (state.tab === 'cart') renderCart();
                if (state.tab === 'orders') renderOrders();
                showRequestSent(charName(payer), ctx);
                return;
            }

            var paymentLabel = '';
            if (ctx.payMethod === 'own') {
                var auth = await NanoPay.pay(ctx.total, desc, { password: ctx._password || '', cardId: ctx.cardId });
                var paidCard = auth && auth.card;
                paymentLabel = paidCard ? ((paidCard.bankName || '我的银行卡') + (paidCard.cardNumber ? (' · 尾号 ' + String(paidCard.cardNumber).slice(-4)) : '')) : '我的银行卡';
            } else {
                var card = null;
                familyCards.forEach(function (c) { if (c.id === ctx.familyCardId) card = c; });
                if (!card) throw new Error('亲属卡不存在');
                await NanoFamilyCardStore.charSpend(card._chatId, '亲属卡 · ' + desc, ctx.total);
                NanoFamilyCardStore.update(card._chatId, card.id, { spent: Number(card.spent || 0) + ctx.total });
                paymentLabel = '亲属卡 · ' + charName(card._chatId);
            }

            var recipientName = ctx.recipient === 'self' ? userName() : charName(ctx.recipient);
            var order = makeOrder('', snapshotItems(ctx.items), ctx.total, '已支付', paymentLabel, {
                recipient: recipientName,
                gift: ctx.recipient !== 'self',
                note: ctx.note || ''
            });
            state.orders.unshift(order);
            if (state.orders.length > 100) state.orders = state.orders.slice(0, 100);
            if (ctx.recipient === 'self') addItemsToInventory(ctx.items);
            removePurchasedFromCart(ctx);
            await saveData();

            sendStoreCards(ctx, paymentLabel, recipientName);
            closeSheet();
            try { await refreshContext(); } catch (e) {}
            renderBadge();
            if (state.tab === 'cart') renderCart();
            if (state.tab === 'orders') renderOrders();
            if (state.tab === 'me') { await refreshContext(); renderMe(); }
            showResult(ctx, paymentLabel, recipientName);
        } catch (e) {
            paying = false;
            if (e && (e.code === 'NEED_PASSWORD' || e.code === 'BAD_PASSWORD')) {
                if (e.code === 'BAD_PASSWORD') ctx._password = '';
                openPassword(function (pwd) {
                    if (!checkoutCtx) return;
                    checkoutCtx._password = pwd;
                    performPayment();
                });
                return;
            }
            toast((e && e.message) || '支付失败');
        } finally {
            paying = false;
        }
    }

    function sendStoreCards(ctx, paymentLabel, recipientName) {
        try {
            if (ctx.recipient === 'self') return;
            var foodItems = [], giftItems = [];
            (ctx.items || []).forEach(function (it) {
                var p = (it && it.product) || {};
                if (p.type === 'food') foodItems.push(it);
                else giftItems.push(it);
            });

            // 点外卖送给别人：外卖卡片（餐品 / 备注 / 金额），不是礼物卡片
            if (foodItems.length) {
                var foodTotal = 0;
                var foodName = foodItems.map(function (it) {
                    var p = it.product || {};
                    foodTotal += Number(p.price || 0) * Number(it.qty || 1);
                    return String(p.name || '外卖') + (Number(it.qty || 1) > 1 ? (' × ' + it.qty) : '');
                }).join('、');
                queueCard(ctx.recipient, {
                    card: {
                        cardType: 'takeout',
                        food: foodName || '外卖',
                        shop: 'Nano Store · 外卖',
                        price: Math.round(foodTotal * 100) / 100,
                        note: ctx.note || '',
                        eta: 30,
                        direction: 'user',
                        status: 'pending',
                        footer: '等待对方确认'
                    },
                    side: 'right',
                    notice: '你给 ' + recipientName + ' 点了一份外卖'
                });
            }

            // 商城商品送人：礼物卡片
            if (giftItems.length) {
                var giftTotal = 0;
                var giftNames = giftItems.map(function (it) {
                    var p = it.product || {};
                    giftTotal += Number(p.price || 0) * Number(it.qty || 1);
                    return String(p.name || '礼物') + (Number(it.qty || 1) > 1 ? (' × ' + it.qty) : '');
                });
                var giftCard = {
                    cardType: 'gift',
                    title: giftItems.length === 1 ? (giftItems[0].product.name || '商城礼物') : ('商城礼物 · ' + giftItems.length + ' 件'),
                    sub: '来自 ' + userName() + (ctx.note ? ' · ' + ctx.note : ''),
                    amount: money(giftTotal),
                    items: giftItems.map(function (it) {
                        return { name: it.product.name, price: Number(it.product.price || 0), qty: Number(it.qty || 1), image: it.product.image || '', cat: it.product.cat || 'gift' };
                    }),
                    footer: '点击领取',
                    status: 'pending'
                };
                queueCard(ctx.recipient, { card: giftCard, side: 'right', notice: '你把商城礼物送给了 ' + recipientName });
            }
        } catch (e) {}
    }

    function queueCard(chatId, payload) {
        if (!chatId) return;
        var q = {};
        try { q = JSON.parse(localStorage.getItem('nano_pending_store_cards') || '{}') || {}; } catch (e) { q = {}; }
        if (!Array.isArray(q[chatId])) q[chatId] = [];
        q[chatId].push(payload);
        try { localStorage.setItem('nano_pending_store_cards', JSON.stringify(q)); } catch (e) {}
    }

    function showResult(ctx, paymentLabel, recipientName) {
        var sub = paymentLabel;
        if (ctx.recipient !== 'self') sub += ' · 已送给 ' + recipientName;
        if (ctx.payMethod === 'char') sub += ' · 已发送订单卡片';
        var body = '<div class="result-wrap"><div class="result-icon"><svg viewBox="0 0 24 24"><path d="M5 12l4.5 4.5L19 7"/></svg></div>' +
            '<div class="result-title">支付成功</div><div class="result-sub">' + esc(sub) + '</div>' +
            '<div class="result-amount">' + money(ctx.total) + '</div></div>';
        var foot = '<button class="btn ghost" data-action="result-orders" type="button">查看订单</button><button class="btn primary" data-action="result-done" type="button">完成</button>';
        openSheet('支付结果', body, foot);
        checkoutCtx = null;
    }

    // ===== 密码 =====
    function openPassword(cb) {
        passwordCb = cb;
        var body = '<div class="password-wrap"><div class="password-title">输入支付密码</div>' +
            '<div class="password-sub">' + money(checkoutCtx ? checkoutCtx.total : 0) + '</div>' +
            '<input class="password-input" id="payPwd" type="text" data-masked-key="1" inputmode="numeric" maxlength="6" autocomplete="off">' +
            '<div class="password-error" id="payPwdError"></div></div>';
        var foot = '<button class="btn ghost" data-action="pwd-cancel" type="button">取消</button><button class="btn primary" data-action="pwd-confirm" type="button">确认</button>';
        openSheet('支付密码', body, foot);
        setTimeout(function () { var el = $('payPwd'); if (el) el.focus(); }, 120);
    }

    async function confirmPassword() {
        var el = $('payPwd');
        var errEl = $('payPwdError');
        if (!el) return;
        var pwd = el.value.trim();
        if (!/^\d{6}$/.test(pwd)) {
            if (errEl) errEl.textContent = '请输入 6 位数字密码';
            return;
        }
        var ok = await NanoPay.verifyPassword(pwd);
        if (!ok) {
            if (errEl) errEl.textContent = '密码不正确';
            el.value = '';
            return;
        }
        var cb = passwordCb;
        passwordCb = null;
        closeSheet();
        if (cb) cb(pwd);
    }

    // ===== 商品编辑 =====
    var newProductImage = '';
    function openProductForm() {
        newProductImage = '';
        var cats = [
            { v: 'digital', t: '数码' }, { v: 'home', t: '居家' }, { v: 'gift', t: '礼物' },
            { v: 'beauty', t: '美妆' }, { v: 'stationery', t: '文具' }, { v: 'meal', t: '简餐' },
            { v: 'coffee', t: '咖啡' }, { v: 'dessert', t: '甜点' }, { v: 'night', t: '夜宵' }
        ];
        var body = '<div class="field-label">名称</div><input class="input" id="npName" placeholder="商品名称" maxlength="30">' +
            '<div class="field-label">描述</div><textarea class="input" id="npDesc" placeholder="简短描述" maxlength="120"></textarea>' +
            '<div class="field-label">价格</div><input class="input" id="npPrice" type="number" inputmode="decimal" placeholder="0.00" min="0.01" step="0.01">' +
            '<div class="field-label">分类</div><select class="select" id="npCat">' + cats.map(function (c) { return '<option value="' + c.v + '">' + c.t + '</option>'; }).join('') + '</select>' +
            '<div class="field-label">图片链接</div><input class="input" id="npImageUrl" placeholder="https://..." autocomplete="off">' +
            '<div class="field-label">或上传图片</div>' +
            '<div class="upload-row"><input id="npImageFile" type="file" accept="image/*" hidden>' +
            '<label class="upload-btn" for="npImageFile"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l4.5-4.5L13 17l3-3 4 4"/></svg>选择照片</label>' +
            '<span class="upload-name" id="npImageName">未选择</span></div>' +
            '<div id="npPreview" style="margin-top:12px;"></div>';
        var foot = '<button class="btn ghost" data-action="np-cancel" type="button">取消</button><button class="btn primary" data-action="np-save" type="button">保存商品</button>';
        openSheet('添加商品', body, foot);
        $('npImageFile').addEventListener('change', function () {
            var f = this.files && this.files[0];
            if (!f) return;
            var nameEl = $('npImageName');
            if (nameEl) nameEl.textContent = f.name || '已选择';
            readImage(f, function (dataUrl) {
                newProductImage = dataUrl;
                $('npPreview').innerHTML = '<div class="detail-art" style="margin-bottom:0;aspect-ratio:1.8/1;"><img src="' + dataUrl + '" alt=""></div>';
            });
        });
    }

    function readImage(file, cb) {
        var reader = new FileReader();
        reader.onload = function () {
            var img = new Image();
            img.onload = function () {
                try {
                    var max = 700;
                    var scale = Math.min(1, max / Math.max(img.width, img.height));
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.width * scale));
                    canvas.height = Math.max(1, Math.round(img.height * scale));
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    cb(canvas.toDataURL('image/jpeg', 0.82));
                } catch (e) { cb(String(reader.result || '')); }
            };
            img.onerror = function () { cb(String(reader.result || '')); };
            img.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
    }

    function saveProduct() {
        var name = ($('npName') && $('npName').value || '').trim();
        var desc = ($('npDesc') && $('npDesc').value || '').trim();
        var price = parseFloat($('npPrice') && $('npPrice').value || '0');
        var cat = $('npCat') && $('npCat').value || 'gift';
        var url = ($('npImageUrl') && $('npImageUrl').value || '').trim();
        if (!name) { toast('请输入商品名称'); return; }
        if (!price || price <= 0) { toast('请输入正确价格'); return; }
        var foodCats = { meal: 1, coffee: 1, dessert: 1, night: 1 };
        state.products.unshift({
            id: 'custom_' + Date.now(),
            name: name,
            desc: desc,
            price: Math.round(price * 100) / 100,
            cat: cat,
            type: foodCats[cat] ? 'food' : 'shop',
            custom: true,
            image: newProductImage || url || ''
        });
        saveData();
        closeSheet();
        renderShop();
        renderFood();
        toast('商品已添加');
    }

    // ===== 角色选择器 =====
    var charPickCb = null;
    function pickChar(title, cb) {
        charPickCb = cb;
        refreshContext().then(function () {
            if (!chars.length) { toast('暂无可用角色'); return; }
            var body = chars.map(function (c) {
                return '<button class="menu-row" data-action="pick-char" data-id="' + esc(c.id) + '" type="button" style="width:100%;border-bottom:1px solid var(--line-soft);">' +
                    '<span class="menu-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg></span>' +
                    '<span class="menu-label">' + esc(c.name) + '<span style="display:block;font-size:10.5px;color:var(--muted);font-weight:500;margin-top:2px;">余额 ' + money(charWalletBalance(c.id)) + '</span></span>' +
                    '<svg class="menu-arrow" viewBox="0 0 8 13"><path d="M1 1.5L6.5 6.5L1 11.5"/></svg></button>';
            }).join('');
            openSheet(title, body, '<button class="btn ghost" data-action="result-done" type="button">关闭</button>');
        });
    }

    function makeOrder(requestId, items, total, status, payment, extra) {
        var o = {
            id: 'S' + Date.now().toString().slice(-9),
            requestId: requestId || '',
            items: items,
            total: Number(total) || 0,
            time: new Date().toISOString(),
            status: status,
            payment: payment,
            recipient: userName(),
            gift: false
        };
        return Object.assign(o, extra || {});
    }

    // ===== 商品分享 / 请求卡 =====
    function openProductSharePicker(product) {
        if (!product) return;
        pickChar('分享商品给 TA', function (charId) {
            sendProductShareRequest(charId, product);
        });
    }
    async function sendProductShareRequest(charId, product) {
        var requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
        var items = [{ name: product.name, price: Number(product.price), qty: 1, image: product.image || '', cat: product.cat }];
        var order = makeOrder(requestId, items, Number(product.price), '待 TA 确认', 'TA 购买', { gift: true });
        state.orders.unshift(order);
        if (state.orders.length > 100) state.orders = state.orders.slice(0, 100);
        await saveData();
        queueCard(charId, {
            card: {
                cardType: 'store',
                storeKind: 'product_share',
                direction: 'char',
                title: '想买这个',
                sub: product.name,
                amount: money(product.price),
                total: Number(product.price),
                items: items,
                requestId: requestId,
                status: 'pending',
                from: 'user'
            },
            side: 'right',
            notice: '你把商品「' + product.name + '」分享给了 ' + charName(charId)
        });
        closeSheet();
        renderOrders();
        openSheet('请求已发送', '<div class="result-wrap"><div class="result-icon"><svg viewBox="0 0 24 24"><path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg></div><div class="result-title">' + esc(charName(charId)) + ' 收到了你的分享</div><div class="result-sub">点聊天里的回复，TA 才会决定要不要买给你</div><div class="result-amount">' + money(product.price) + '</div></div>', '<button class="btn ghost" data-action="result-orders" type="button">查看订单</button><button class="btn primary" data-action="result-done" type="button">完成</button>');
    }

    // ===== 仓库 =====
    function openInventoryGift(item) {
        if (!item) return;
        pickChar('送给谁', function (charId) {
            queueCard(charId, {
                card: {
                    cardType: 'gift',
                    title: item.name,
                    sub: '来自 ' + userName() + ' 的礼物',
                    amount: money(item.price),
                    footer: '点击领取',
                    status: 'pending'
                },
                side: 'right',
                notice: '你把仓库里的「' + item.name + '」送给了 ' + charName(charId)
            });
            state.inventory = state.inventory.filter(function (x) { return x.invId !== item.invId; });
            saveData();
            closeSheet();
            renderMe();
            toast('礼物卡片已发到私聊');
        });
    }

    // ===== 事件 =====
    function bind() {
        $('backBtn').addEventListener('click', function () {
            if ($('sheet').classList.contains('show')) { closeSheet(); return; }
            try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); }
            catch (e) { history.back(); }
        });
        $('topCartBtn').addEventListener('click', function () { setTab('cart'); });
        $('sheetClose').addEventListener('click', closeSheet);
        $('overlay').addEventListener('click', closeSheet);

        $('searchInput').addEventListener('input', function () { state.search = this.value; renderShop(); });
        $('shopChips').addEventListener('click', function (e) {
            var b = e.target.closest('[data-shop-cat]');
            if (!b) return;
            state.shopCat = b.getAttribute('data-shop-cat');
            renderChips();
            renderShop();
        });
        $('foodChips').addEventListener('click', function (e) {
            var b = e.target.closest('[data-food-cat]');
            if (!b) return;
            state.foodCat = b.getAttribute('data-food-cat');
            renderChips();
            renderFood();
        });

        $('productGrid').addEventListener('click', function (e) {
            var b = e.target.closest('[data-action]');
            if (!b) return;
            var p = productById(b.getAttribute('data-id'));
            if (!p) return;
            if (b.getAttribute('data-action') === 'add') addToCart(p, 1);
            else openDetail(p);
        });
        $('foodList').addEventListener('click', function (e) {
            var b = e.target.closest('[data-action]');
            if (!b) return;
            var p = productById(b.getAttribute('data-id'));
            if (!p) return;
            if (b.getAttribute('data-action') === 'add') addToCart(p, 1);
            else openDetail(p);
        });
        $('cartList').addEventListener('click', function (e) {
            var b = e.target.closest('[data-action]');
            if (!b) return;
            var id = b.getAttribute('data-id');
            var act = b.getAttribute('data-action');
            if (act === 'inc') changeQty(id, 1);
            else if (act === 'dec') changeQty(id, -1);
            else { var p = productById(id); if (p) openDetail(p); }
        });
        $('cartList').addEventListener('change', function (e) {
            var c = e.target.closest('[data-cart-check]');
            if (!c) return;
            state.selected[c.getAttribute('data-cart-check')] = !!c.checked;
            renderCart();
        });
        $('selectAllCart').addEventListener('change', function () {
            var checked = !!this.checked;
            cartItems().forEach(function (x) { state.selected[x.product.id] = checked; });
            renderCart();
        });

        $('checkoutBtn').addEventListener('click', function () {
            openCheckout(selectedCartItems(), { fromCart: true, payMethod: 'own' });
        });
        $('askCharPayBtn').addEventListener('click', function () {
            openCheckout(selectedCartItems(), { fromCart: true, payMethod: 'char' });
        });

        $('tabbar').addEventListener('click', function (e) {
            var b = e.target.closest('.tab[data-tab]');
            if (!b) return;
            setTab(b.getAttribute('data-tab'));
        });

        $('addProductBtn').addEventListener('click', openProductForm);
        var invList = $('inventoryList');
        if (invList) invList.addEventListener('click', function (e) {
            var useBtn = e.target.closest('[data-inv-use]');
            if (useBtn) {
                var useId = useBtn.getAttribute('data-inv-use');
                state.inventory = state.inventory.filter(function (x) { return x.invId !== useId; });
                saveData();
                renderMe();
                toast('已使用');
                return;
            }
            var b = e.target.closest('[data-inv-gift]');
            if (!b) return;
            var invId = b.getAttribute('data-inv-gift');
            var item = null;
            state.inventory.forEach(function (x) { if (x.invId === invId) item = x; });
            if (item) openInventoryGift(item);
        });

        var orderList = $('orderList');
        if (orderList) orderList.addEventListener('click', function (e) {
            var b = e.target.closest('[data-order-del]');
            if (!b) return;
            var oid = b.getAttribute('data-order-del');
            state.orders = state.orders.filter(function (o) { return o.id !== oid; });
            saveData();
            renderOrders();
            toast('订单已删除');
        });

        // 动态 sheet 按钮
        $('sheet').addEventListener('click', function (e) {
            var b = e.target.closest('[data-action]');
            if (!b) return;
            var act = b.getAttribute('data-action');
            if (act === 'detail-inc') { detailQty = Math.min(99, detailQty + 1); renderDetail(); }
            else if (act === 'detail-dec') { detailQty = Math.max(1, detailQty - 1); renderDetail(); }
            else if (act === 'detail-cart') { if (detailProduct) { addToCart(detailProduct, detailQty); closeSheet(); } }
            else if (act === 'detail-buy') { if (detailProduct) { var p = detailProduct; closeSheet(); openCheckout([{ product: p, qty: detailQty }], { fromCart: false, payMethod: 'own' }); } }
            else if (act === 'checkout-cancel') { closeSheet(); checkoutCtx = null; }
            else if (act === 'checkout-pay') {
                var err = validateCheckout();
                if (err) { toast(err); return; }
                if (checkoutCtx.payMethod === 'own' && paySettings.hasPassword && !paySettings.freePay) {
                    openPassword(function (pwd) {
                        if (!checkoutCtx) return;
                        checkoutCtx._password = pwd;
                        performPayment();
                    });
                } else {
                    performPayment();
                }
            }
            else if (act === 'pwd-cancel') { closeSheet(); }
            else if (act === 'pwd-confirm') { confirmPassword(); }
            else if (act === 'result-done') { closeSheet(); }
            else if (act === 'result-orders') { closeSheet(); setTab('orders'); }
            else if (act === 'np-cancel') { closeSheet(); }
            else if (act === 'np-save') { saveProduct(); }
            else if (act === 'share-product') {
                if (!detailProduct) return;
                var prod = detailProduct;
                closeSheet();
                setTimeout(function () { openProductSharePicker(prod); }, 180);
            }
            else if (act === 'delete-product-detail') {
                if (!detailProduct) return;
                var pid = detailProduct.id;
                state.products = state.products.filter(function (p) { return p.id !== pid; });
                state.cart = state.cart.filter(function (c) { return c.productId !== pid; });
                saveData();
                closeSheet();
                renderShop(); renderFood(); renderBadge();
                toast('已删除');
            }
            else if (act === 'pick-char') {
                var cb = charPickCb;
                charPickCb = null;
                var cid = b.getAttribute('data-id');
                closeSheet();
                if (cb) cb(cid);
            }
        });

        // 密码输入回车
        $('sheet').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.target && e.target.id === 'payPwd') { e.preventDefault(); confirmPassword(); }
        });

        // 聊天里确认礼物 / 付款后，商城同步仓库和订单
        window.addEventListener('storage', function (e) {
            if (!e || !e.key) return;
            if (e.key !== 'nano_mall_event' && e.key !== dataKey()) return;
            loadData().then(function () {
                renderBadge();
                renderCart();
                renderOrders();
                renderFood();
                renderShop();
                if (state.tab === 'me') refreshContext().then(renderMe);
            });
        });
    }

    // ===== 启动 =====
    (async function init() {
        await loadData();
        renderChips();
        renderShop();
        renderFood();
        renderCart();
        renderOrders();
        renderMe();
        renderBadge();
        bind();
        setTab('shop');
        refreshContext().then(function () {
            renderMe();
            // 不再内置「角色主动发商城代付/心愿卡」：这类卡片必须由角色在正常回复里
            // 自然带入，且不能额外调用一次 API；商城页打开时静默加载即可。
        }).catch(function () {});
        withTimeout(loadUserProfile(), 1600, { name: userName(), avatar: '' }).then(function (p) {
            userProfile = p || { name: userName(), avatar: '' };
            renderMe();
        }).catch(function () {});
        try {
            var qt = new URLSearchParams(location.search).get('tab');
            if (qt && ['shop', 'food', 'cart', 'orders', 'me'].indexOf(qt) !== -1) setTab(qt);
        } catch (e) {}
    })();
})();
