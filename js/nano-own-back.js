(function () {
  'use strict';
  if (window.parent === window) return;
  var bar = document.querySelector('.top-title-wrap') || document.querySelector('.top-bar') || document.querySelector('header.top');
  if (!bar) return;
  try {
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.gap = '6px';
  } catch (e) {}
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'nano-own-back';
  b.setAttribute('aria-label', '返回');
  b.textContent = '‹';
  b.style.cssText = 'width:34px;height:34px;border:0;background:transparent;color:#111;font-size:28px;line-height:1;display:grid;place-items:center;flex:none;';
  b.addEventListener('click', function () {
    try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); } catch (e) {}
  });
  bar.insertBefore(b, bar.firstChild);
})();
