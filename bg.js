(function () {
    'use strict';

    function apply() {
        var el = document.querySelector('.bg');
        if (!el) return;
        var v = '';
        try { v = localStorage.getItem('appBg') || ''; } catch (e) { v = ''; }
        if (v) {
            el.style.background = v;
            // background 简写会把 background-size / position 重置掉，这里补回来，保证图片铺满
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center';
        } else {
            el.style.background = '';
        }
    }

    window.applyAppBg = apply;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }

    window.addEventListener('pageshow', apply);
    window.addEventListener('appBgChanged', apply);
    window.addEventListener('storage', function (e) {
        if (!e.key || e.key === 'appBg') apply();
    });
})();
