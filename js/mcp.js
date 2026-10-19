// ============================================================
// mcp.js — Nano · MCP 页（UI）。数据与执行走 window.NanoMcp（nano-mcp-runtime.js）
// ============================================================
(function () {
  'use strict';
  var M = window.NanoMcp;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var toastTimer = null;
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400); }

  // 内置远程 MCP（公开、免鉴权）
  var PRESETS = [
    { key: 'deepwiki', name: 'DeepWiki', tag: '仓库百科', desc: '查任意 GitHub 仓库的结构/内容，并可直接提问', url: 'https://mcp.deepwiki.com/mcp' },
    { key: 'gitmcp', name: 'GitMCP', tag: '文档搜索', desc: '把某个仓库的文档变成可搜索工具（可在「编辑」里改 owner/repo）', url: 'https://gitmcp.io/modelcontextprotocol/servers' },
    { key: 'mslearn', name: 'Microsoft Learn', tag: '官方文档', desc: '微软官方文档检索', url: 'https://learn.microsoft.com/api/mcp' },
    { key: 'cfdocs', name: 'Cloudflare Docs', tag: '官方文档', desc: 'Cloudflare 官方文档检索', url: 'https://docs.mcp.cloudflare.com/mcp' }
  ];

  function seedPresets() {
    var flag = '';
    try { flag = localStorage.getItem('nano_mcp_seeded') || ''; } catch (e) {}
    if (flag === '1') return;
    var list = M.getServers();
    PRESETS.forEach(function (p) { if (!list.some(function (s) { return s.url === p.url; })) list.push({ id: M.uid(), name: p.name, url: p.url, token: '', preset: p.key }); });
    M.setServers(list);
    try { localStorage.setItem('nano_mcp_seeded', '1'); } catch (e) {}
  }

  var openId = '';
  var toolsCache = {};
  var failed = {};

  /* ---------------- 渲染 ---------------- */
  function renderPresets() {
    var list = M.getServers();
    $('presetList').innerHTML = PRESETS.map(function (p) {
      var added = list.some(function (s) { return s.url === p.url || s.preset === p.key; });
      return '<div class="preset' + (added ? ' added' : '') + '">'
        + '<div class="preset-info"><strong>' + esc(p.name) + ' <span class="tag-inline">' + esc(p.tag) + '</span></strong><small>' + esc(p.desc) + '</small></div>'
        + (added ? '<button class="mini-btn" disabled style="opacity:.5">已添加</button>' : '<button class="mini-btn" data-preset="' + p.key + '">添加</button>')
        + '</div>';
    }).join('');
  }

  function switchHtml(id, on) {
    return '<button class="switch' + (on ? ' on' : '') + '" data-toggle="' + id + '" aria-label="开关"><i></i></button>';
  }

  function renderServers() {
    var list = M.allServers();
    $('serverList').innerHTML = list.map(function (s) {
      var on = M.isEnabled(s.id);
      var cls = 'server' + (openId === s.id ? ' open' : '') + (on ? '' : ' off');
      var dot = (s.native || toolsCache[s.id]) ? 'ok' : '';
      var tools = s.native ? M.NATIVE_TOOLS : toolsCache[s.id];
      var body = '';
      if (openId === s.id) {
        if (failed[s.id]) body = '<div class="server-status" style="color:#c0392b">连接失败：' + esc(failed[s.id]) + '</div>';
        else if (!tools) body = '<div class="server-status">正在连接…</div>';
        else if (!tools.length) body = '<div class="server-status">已连接，但这个服务器没有提供工具。</div>';
        else body = '<div class="server-status">共 ' + tools.length + ' 个工具，点击即可调用/测试：</div>'
          + tools.map(function (t, i) {
            return '<div class="tool" data-tool="' + s.id + '|' + i + '"><strong>' + esc(t.name) + '</strong><small>' + esc(t.description || '（无描述）') + '</small></div>';
          }).join('');
      }
      return '<div class="' + cls + '" data-server="' + s.id + '">'
        + '<div class="server-head">'
        + switchHtml(s.id, on)
        + '<div class="server-info"><strong>' + esc(s.name || '未命名') + (s.preset ? ' <span class="tag-inline">内置</span>' : '') + '</strong><small>' + esc(s.native ? '本地直接执行 · 免服务器' : s.url) + '</small></div>'
        + '<div class="server-actions">'
        + (s.native ? '' : ('<button class="mini-btn" data-edit="' + s.id + '">编辑</button><button class="mini-btn danger" data-del="' + s.id + '">删除</button>'))
        + '</div></div>'
        + '<div class="server-body">' + body + '</div>'
        + '</div>';
    }).join('');
  }

  /* ---------------- 打开/连接 ---------------- */
  async function openServer(id) {
    if (openId === id) { openId = ''; renderServers(); return; }
    openId = id; failed[id] = '';
    if (id === M.NATIVE_ID) { toolsCache[id] = M.NATIVE_TOOLS; renderServers(); return; }
    toolsCache[id] = null; renderServers();
    var s = M.getServers().filter(function (x) { return x.id === id; })[0];
    if (!s) { failed[id] = '服务器不存在'; renderServers(); return; }
    try { toolsCache[id] = await M.connect(s); }
    catch (e) { delete toolsCache[id]; failed[id] = (e && e.message) ? e.message : String(e); }
    renderServers();
  }

  /* ---------------- 服务器弹窗 ---------------- */
  var editingId = null;
  function openServerModal(id) {
    editingId = id || null;
    var s = id ? M.getServers().filter(function (x) { return x.id === id; })[0] : null;
    $('serverModalTitle').textContent = s ? '编辑 MCP 服务器' : '添加 MCP 服务器';
    $('srvName').value = s ? (s.name || '') : '';
    $('srvUrl').value = s ? (s.url || '') : '';
    $('srvToken').value = s ? (s.token || '') : '';
    $('serverModal').classList.add('show');
  }
  function closeServerModal() { $('serverModal').classList.remove('show'); editingId = null; }
  function saveServer() {
    var name = $('srvName').value.trim();
    var url = $('srvUrl').value.trim();
    if (!url) { toast('请填写服务器地址'); return; }
    if (!/^https:\/\//i.test(url)) { toast('地址需以 https:// 开头'); return; }
    var token = $('srvToken').value.trim();
    var list = M.getServers();
    if (editingId) {
      list.forEach(function (s) { if (s.id === editingId) { s.name = name || s.name; s.url = url; s.token = token; } });
      toolsCache[editingId] = undefined;
    } else {
      list.push({ id: M.uid(), name: name || url.replace(/^https?:\/\//, '').split('/')[0], url: url, token: token });
    }
    M.setServers(list);
    closeServerModal(); renderServers(); renderPresets();
    toast('已保存');
  }

  /* ---------------- 工具弹窗 ---------------- */
  var curTool = null;
  function defaultArgs(schema) {
    var o = {}, props = (schema && schema.properties) || {};
    Object.keys(props).forEach(function (k) {
      var p = props[k] || {};
      if (p.default !== undefined) o[k] = p.default;
      else if (p.type === 'boolean') o[k] = false;
      else if (p.type === 'number' || p.type === 'integer') o[k] = 0;
      else if (p.type === 'array') o[k] = [];
      else if (p.type === 'object') o[k] = {};
      else o[k] = '';
    });
    return o;
  }
  function openTool(serverId, i) {
    var tools = serverId === M.NATIVE_ID ? M.NATIVE_TOOLS : (toolsCache[serverId] || []);
    var t = tools[i];
    if (!t) return;
    curTool = { serverId: serverId, tool: t };
    $('toolModalTitle').textContent = t.name;
    $('toolDesc').textContent = t.description || '这个工具暂无描述。';
    var props = (t.inputSchema && t.inputSchema.properties) || {};
    var keys = Object.keys(props);
    if (!keys.length) {
      $('toolHint').innerHTML = '这个工具不需要参数，保留 <code>{}</code> 直接运行即可。';
    } else {
      var tip = keys.map(function (k) {
        var p = props[k] || {};
        return '<code>' + esc(k) + '</code>' + (p.type ? ' (' + esc(p.type) + ')' : '') + (p.description ? '：' + esc(p.description) : '');
      }).join('<br>');
      $('toolHint').innerHTML = 'JSON 里的字段就是工具参数，可保留默认值或自行修改：<br>' + tip;
    }
    $('toolArgs').value = JSON.stringify(defaultArgs(t.inputSchema), null, 2);
    $('toolResultWrap').style.display = 'none';
    $('toolResult').textContent = '';
    $('toolModal').classList.add('show');
  }
  function closeToolModal() { $('toolModal').classList.remove('show'); curTool = null; }
  async function runTool() {
    if (!curTool) return;
    var args;
    try { args = JSON.parse($('toolArgs').value || '{}'); } catch (e) { toast('参数不是合法 JSON'); return; }
    var btn = $('runToolBtn');
    btn.disabled = true; btn.textContent = '运行中…';
    try {
      var text = await M.execTool(curTool.serverId, curTool.tool.name, args);
      $('toolResultWrap').style.display = 'block';
      $('toolResult').textContent = text;
    } catch (e) {
      var msg = '调用失败：' + (e && e.message ? e.message : e);
      $('toolResultWrap').style.display = 'block';
      $('toolResult').textContent = msg;
    } finally {
      btn.disabled = false; btn.textContent = '运行';
    }
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', function (e) {
    var tg = e.target.closest('[data-toggle]');
    if (tg) {
      e.stopPropagation();
      var id = tg.getAttribute('data-toggle');
      var on = M.isEnabled(id);
      M.setEnabledFlag(id, !on);
      renderServers();
      toast(!on ? '已开启（char 可在聊天里调用）' : '已关闭');
      return;
    }
    var pr = e.target.closest('[data-preset]');
    if (pr) {
      e.stopPropagation();
      var p = PRESETS.filter(function (x) { return x.key === pr.getAttribute('data-preset'); })[0];
      if (!p) return;
      var list = M.getServers();
      if (list.some(function (s) { return s.url === p.url; })) { toast('已经添加过了'); return; }
      list.push({ id: M.uid(), name: p.name, url: p.url, token: '', preset: p.key });
      M.setServers(list);
      renderPresets(); renderServers(); toast('已添加 ' + p.name);
      return;
    }
    var ed = e.target.closest('[data-edit]');
    if (ed) { e.stopPropagation(); openServerModal(ed.getAttribute('data-edit')); return; }
    var dl = e.target.closest('[data-del]');
    if (dl) {
      e.stopPropagation();
      var did = dl.getAttribute('data-del');
      if (!confirm('删除这个 MCP 服务器？')) return;
      M.setServers(M.getServers().filter(function (x) { return x.id !== did; }));
      delete toolsCache[did];
      if (openId === did) openId = '';
      renderServers(); renderPresets(); toast('已删除');
      return;
    }
    var tl = e.target.closest('[data-tool]');
    if (tl) { e.stopPropagation(); var parts = tl.getAttribute('data-tool').split('|'); openTool(parts[0], parseInt(parts[1], 10)); return; }
    var sv = e.target.closest('[data-server]');
    if (sv) { openServer(sv.getAttribute('data-server')); return; }
    var hb = e.target.closest('[data-help]');
    if (hb) { var tgt = $(hb.getAttribute('data-help')); if (tgt) tgt.hidden = !tgt.hidden; return; }
  });

  function goBack() {
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'nanoCloseOverlay' }, '*'); else history.back(); } catch (e) {}
  }
  $('brandBtn').onclick = goBack;
  if ($('mcpBackBtn')) $('mcpBackBtn').onclick = goBack;
  $('addServerBtn').onclick = function () { openServerModal(null); };
  $('closeServerModal').onclick = $('cancelServerModal').onclick = closeServerModal;
  $('serverModal').addEventListener('click', function (e) { if (e.target === $('serverModal')) closeServerModal(); });
  $('saveServerModal').onclick = saveServer;
  $('closeToolModal').onclick = $('cancelToolModal').onclick = closeToolModal;
  $('toolModal').addEventListener('click', function (e) { if (e.target === $('toolModal')) closeToolModal(); });
  $('runToolBtn').onclick = runTool;

  seedPresets();
  renderPresets();
  renderServers();
})();
