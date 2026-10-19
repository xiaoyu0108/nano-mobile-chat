// ============================================================
// nano-status-bar.js — 通用「状态栏」组件 + 折叠/展开 JS
// ------------------------------------------------------------
// 只要一段 HTML 按下面的结构写，就自动具备折叠 / 展开能力（无需额外 JS）：
//
//   <div class="nano-status" data-status="心声" data-default="open">
//     <div class="nano-status-head">
//       <span class="nano-status-title">心声</span>
//       <svg class="nano-status-arrow" ...></svg>
//     </div>
//     <div class="nano-status-body">内容…</div>
//   </div>
//
// - data-status   ：状态栏名字（用于记住这栏是展开还是折叠）
// - data-default  ：open（默认展开）/ collapsed（默认折叠）
// - 点 .nano-status-head 即折叠/展开；折叠状态按「名字」记忆，重渲染后仍保持。
//
// 也可用 JS 生成： NanoStatusBar.html({ name:'着装', body:'黑色卫衣…', defaultCollapsed:true })
// 生成后调用 NanoStatusBar.enhance(root)（或插入后自动生效，点击是事件委托）。
// ============================================================
(function () {
  'use strict';
  if (window.NanoStatusBar) return;

  var LS_KEY = 'nano_status_collapsed';

  function readMap() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  function writeMap(m) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(m || {})); } catch (e) {}
  }

  function getCollapsed(name) {
    if (!name) return null;
    var m = readMap();
    return Object.prototype.hasOwnProperty.call(m, name) ? !!m[name] : null;
  }
  function setCollapsed(name, val) {
    if (!name) return;
    var m = readMap();
    m[name] = !!val;
    writeMap(m);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 生成一段标准状态栏 HTML。body 默认按纯文本转义（用 bodyHtml:true 可传 HTML）。
  function html(o) {
    o = o || {};
    var name = o.name || '';
    var collapsed;
    var saved = getCollapsed(name);
    if (saved !== null) collapsed = saved;
    else collapsed = (o.defaultCollapsed === true) || (o.collapsed === true);
    var defaultCollapsed = (o.defaultCollapsed === true) ? 'collapsed' : 'open';
    var body = o.bodyHtml ? String(o.body == null ? '' : o.body) : esc(o.body);
    return '<div class="nano-status' + (collapsed ? ' collapsed' : '') + '"' +
      ' data-status="' + esc(name) + '" data-default="' + defaultCollapsed + '"' +
      (o.attr || '') + '>' +
      '<div class="nano-status-head" role="button" tabindex="0" aria-expanded="' + (collapsed ? 'false' : 'true') + '">' +
      '<span class="nano-status-title">' + esc(o.title != null ? o.title : name) + '</span>' +
      '<svg class="nano-status-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</div>' +
      '<div class="nano-status-body">' + body + '</div>' +
      '</div>';
  }

  function toggle(bar) {
    if (!bar) return;
    var collapsed = bar.classList.toggle('collapsed');
    var head = bar.querySelector('.nano-status-head');
    if (head) head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var name = bar.getAttribute('data-status');
    if (name) setCollapsed(name, collapsed);
  }

  // 按记忆/默认值，把 root 内的状态栏状态补齐（新增 HTML 后可选调用）
  function enhance(root) {
    var scope = root || document;
    var bars = scope.querySelectorAll ? scope.querySelectorAll('.nano-status') : [];
    Array.prototype.forEach.call(bars, function (bar) {
      var name = bar.getAttribute('data-status');
      var saved = getCollapsed(name);
      var collapsed;
      if (saved !== null) collapsed = saved;
      else collapsed = bar.getAttribute('data-default') === 'collapsed';
      bar.classList.toggle('collapsed', !!collapsed);
      var head = bar.querySelector('.nano-status-head');
      if (head) head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
  }

  // 事件委托：任何 .nano-status-head 被点击/回车都折叠/展开
  document.addEventListener('click', function (e) {
    var head = e.target && e.target.closest ? e.target.closest('.nano-status-head') : null;
    if (!head) return;
    var bar = head.closest('.nano-status');
    if (!bar) return;
    toggle(bar);
  }, false);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var head = e.target && e.target.closest ? e.target.closest('.nano-status-head') : null;
    if (!head) return;
    e.preventDefault();
    toggle(head.closest('.nano-status'));
  }, false);

  // 通用「条目式」状态栏 HTML 模板：{{content}} 是每轮 AI 内容要填的位置
  var TEMPLATE = [
    '<div class="nano-status" data-status="着装" data-default="open">',
    '  <div class="nano-status-head">',
    '    <span class="nano-status-title">着装</span>',
    '    <svg class="nano-status-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    '  </div>',
    '  <div class="nano-status-body">{{content}}</div>',
    '</div>'
  ].join('\n');

  window.NanoStatusBar = {
    html: html,
    enhance: enhance,
    toggle: toggle,
    getCollapsed: getCollapsed,
    setCollapsed: setCollapsed,
    esc: esc,
    TEMPLATE: TEMPLATE
  };
})();
