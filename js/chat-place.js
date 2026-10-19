// ============================================================
// chat-place.js — 外卖 / 定位 弹窗逻辑（单聊）
// 发送后各自生成一张卡片；角色也能通过 [外卖:...] / [定位:...] 发过来。
// ============================================================
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function nowHM() {
        var d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    function send(cardData) {
        try {
            window.__chat.addMessage('right', '', nowHM(), null, false, true, cardData);
            window.__chat.saveMessages();
        } catch (e) {}
    }
    function randomEta() { return 15 + Math.floor(Math.random() * 31); } // 15~45 分钟

    // ===== 外卖 =====
    var takeoutPopup = $('takeoutPopup');
    if (takeoutPopup) {
        var cancel = $('takeoutCancel');
        if (cancel) cancel.addEventListener('click', function () { takeoutPopup.classList.remove('active'); });
        takeoutPopup.addEventListener('click', function (e) { if (e.target === takeoutPopup) takeoutPopup.classList.remove('active'); });
        var confirm = $('takeoutConfirm');
        if (confirm) confirm.addEventListener('click', function () {
            var food = ($('takeoutFood').value || '').trim();
            var shop = ($('takeoutShop').value || '').trim();
            var price = parseFloat($('takeoutPrice').value) || 0;
            var note = ($('takeoutNote').value || '').trim();
            if (!food) { window.__chat.showAlert('提示', '请输入外卖食品'); return; }
            send({
                cardType: 'takeout', food: food, shop: shop, price: Math.round(price * 100) / 100,
                note: note, eta: randomEta(), direction: 'user', status: 'pending', footer: '等待对方确认'
            });
            takeoutPopup.classList.remove('active');
            $('takeoutFood').value = ''; $('takeoutShop').value = ''; $('takeoutPrice').value = ''; $('takeoutNote').value = '';
        });
    }

    // ===== 定位：虚拟定位 / 真实定位（tab 内容不同）=====
    var locationPopup = $('locationPopup');
    if (locationPopup) {
        var locLat = null, locLng = null, locMode = 'virtual', locRealPlace = '';
        var locTabs = locationPopup.querySelectorAll('.vs-tab[data-loc]');
        function setLocMode(m) {
            locMode = m;
            locTabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-loc') === m); });
            var v = $('locPaneVirtual'), r = $('locPaneReal');
            if (v) v.style.display = (m === 'virtual') ? '' : 'none';
            if (r) r.style.display = (m === 'real') ? '' : 'none';
        }
        locTabs.forEach(function (t) {
            t.addEventListener('click', function () { setLocMode(t.getAttribute('data-loc')); });
        });
        setLocMode('virtual');

        var placeEl = $('locationPlace');
        if (placeEl) placeEl.addEventListener('input', function () {
            var l = $('locMapLabel');
            if (l) l.textContent = placeEl.value.trim() || '未选择地点';
        });

        var realBtn = $('locationRealBtn');
        if (realBtn) realBtn.addEventListener('click', function () {
            var st = $('locationStatus');
            if (!navigator.geolocation) { if (st) st.textContent = '设备不支持定位'; return; }
            if (st) st.textContent = '定位中...';
            navigator.geolocation.getCurrentPosition(function (pos) {
                locLat = pos.coords.latitude;
                locLng = pos.coords.longitude;
                var coord = locLat.toFixed(4) + ', ' + locLng.toFixed(4);
                if (st) st.textContent = '已定位';
                var l = $('locMapLabel');
                if (l) l.textContent = coord;
                // 反查地名，让角色能按地点识别（失败时回退到坐标）
                locRealPlace = '';
                try {
                    fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=zh-CN&lat=' + locLat + '&lon=' + locLng, { headers: { 'Accept': 'application/json' } })
                        .then(function (r) { return r.json(); })
                        .then(function (j) {
                            var name = j && j.display_name ? String(j.display_name) : '';
                            if (!name) return;
                            var short = name.split(',').slice(0, 3).join('·').replace(/\s+/g, ' ').trim();
                            if (!short) return;
                            locRealPlace = short;
                            if (st) st.textContent = '已定位：' + short;
                            var l2 = $('locMapLabel');
                            if (l2) l2.textContent = short;
                        })
                        .catch(function () {});
                } catch (e) {}
            }, function () {
                if (st) st.textContent = '定位失败，请改用虚拟定位';
            }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
        });

        var lcancel = $('locationCancel');
        if (lcancel) lcancel.addEventListener('click', function () { locationPopup.classList.remove('active'); });
        locationPopup.addEventListener('click', function (e) { if (e.target === locationPopup) locationPopup.classList.remove('active'); });

        var lconfirm = $('locationConfirm');
        if (lconfirm) lconfirm.addEventListener('click', function () {
            var place = '', distance = 0;
            if (locMode === 'real') {
                if (locLat == null) { window.__chat.showAlert('提示', '请先获取当前位置'); return; }
                place = locRealPlace || (locLat.toFixed(4) + ', ' + locLng.toFixed(4));
                distance = Math.max(0, Math.round(parseFloat(($('locationRealDistance') || {}).value) || 0));
            } else {
                place = (placeEl && placeEl.value || '').trim();
                if (!place) { window.__chat.showAlert('提示', '请输入地点'); return; }
                distance = Math.max(0, Math.round(parseFloat(($('locationDistance') || {}).value) || 0));
            }
            send({
                cardType: 'location', place: place, lat: locLat, lng: locLng, distance: distance,
                direction: 'user', status: 'sent', footer: '位置'
            });
            locationPopup.classList.remove('active');
            if (placeEl) placeEl.value = '';
            var dEl = $('locationDistance'); if (dEl) dEl.value = '';
            var dEl2 = $('locationRealDistance'); if (dEl2) dEl2.value = '';
            var st2 = $('locationStatus'); if (st2) st2.textContent = '未定位';
            var l2 = $('locMapLabel'); if (l2) l2.textContent = '未选择地点';
            locLat = null; locLng = null; locRealPlace = '';
            setLocMode('virtual');
        });
    }
})();
