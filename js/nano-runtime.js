(function () {
  'use strict';

  var script = document.currentScript;
  var root = './';
  try {
    if (script && script.src) root = new URL('../', script.src).href;
  } catch (e) {}
  window.NANO_ROOT = root;

  function enabled() {
    try {
      var v = localStorage.getItem('nano_top_inset_enabled');
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) {}
    try { return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''); } catch (e) { return false; }
  }

  function standalone() {
    try {
      if (navigator.standalone === true) return true;
      if (window.matchMedia && (matchMedia('(display-mode: standalone)').matches ||
          matchMedia('(display-mode: fullscreen)').matches ||
          matchMedia('(display-mode: minimal-ui)').matches)) return true;
    } catch (e) {}
    return false;
  }

  function insets() {
    var top = 0, bottom = 0;
    try {
      var probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;visibility:hidden;' +
        'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
      document.body.appendChild(probe);
      var cs = getComputedStyle(probe);
      top = parseFloat(cs.paddingTop) || 0;
      bottom = parseFloat(cs.paddingBottom) || 0;
      probe.parentNode.removeChild(probe);
    } catch (e) {}

    var custom = NaN;
    try { custom = parseFloat(localStorage.getItem('nano_top_inset')); } catch (e) {}

    if (enabled() && isFinite(custom) && custom >= 0) top = custom;
    else if (top > 0) top = Math.min(top, 54);
    else if (enabled() && standalone() && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) top = 48;
    else if (enabled() && standalone() && /Android/i.test(navigator.userAgent || '')) top = 40;
    else top = 0;

    return { top: Math.round(top), bottom: Math.round(bottom) };
  }

  function apply() {
    try {
      var v = insets();
      var de = document.documentElement;
      de.style.setProperty('--safe-top', v.top + 'px');
      de.style.setProperty('--safe-t', v.top + 'px');
      de.style.setProperty('--safe-inset-top', v.top + 'px');
      de.style.setProperty('--safe-bottom', v.bottom + 'px');
      de.style.setProperty('--safe-b', v.bottom + 'px');
      de.style.setProperty('--nano-safe-bottom', v.bottom + 'px');
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
  window.addEventListener('pageshow', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  try { if (window.visualViewport) window.visualViewport.addEventListener('resize', apply); } catch (e) {}
})();
