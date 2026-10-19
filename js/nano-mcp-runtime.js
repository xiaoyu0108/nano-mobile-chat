// ============================================================
// nano-mcp-runtime.js — MCP 共享运行时（MCP 页 与 聊天 共用）
//   window.NanoMcp.*
// 数据：localStorage
//   nano_mcp_servers   [{id,name,url,token,preset?}]
//   nano_mcp_enabled   {id:true|false}      每个服务器/开关
//   nano_mcp_toolcache {id:[tools]}         连接成功后缓存的工具清单
// ============================================================
(function () {
  'use strict';
  if (window.NanoMcp) return;

  var DEFAULT_BASE = 'https://nanopush.nano315.online';
  var SERVERS_KEY = 'nano_mcp_servers';
  var ENABLED_KEY = 'nano_mcp_enabled';
  var TOOLCACHE_KEY = 'nano_mcp_toolcache';
  var NATIVE_ID = '__native__';

  function baseURL() {
    var v = '';
    try { v = (localStorage.getItem('nano_push_endpoint') || '').trim(); } catch (e) {}
    return (v || DEFAULT_BASE).replace(/\/+$/, '');
  }
  function uid() { return 's' + Date.now() + Math.random().toString(36).slice(2, 5); }

  function getServers() { try { return JSON.parse(localStorage.getItem(SERVERS_KEY) || '[]') || []; } catch (e) { return []; } }
  function setServers(l) { try { localStorage.setItem(SERVERS_KEY, JSON.stringify(l)); } catch (e) {} }
  function getEnabled() { try { return JSON.parse(localStorage.getItem(ENABLED_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setEnabled(m) { try { localStorage.setItem(ENABLED_KEY, JSON.stringify(m)); } catch (e) {} }
  function isEnabled(id) { var m = getEnabled(); return (m[id] === undefined) ? true : !!m[id]; }
  function setEnabledFlag(id, on) { var m = getEnabled(); m[id] = !!on; setEnabled(m); }
  function getToolCache() { try { return JSON.parse(localStorage.getItem(TOOLCACHE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function cacheTools(id, tools) { var c = getToolCache(); c[id] = tools; try { localStorage.setItem(TOOLCACHE_KEY, JSON.stringify(c)); } catch (e) {} }
  function getCachedTools(id) { return getToolCache()[id] || null; }

  /* ---------------- 原生「陪伴」工具（本地执行） ---------------- */
  var NATIVE_TOOLS = [
    { name: 'get_weather', description: '查天气：给城市名查该城市；不给城市则查用户当前位置的天气', inputSchema: { type: 'object', properties: { city: { type: 'string', description: '城市名，例如 北京（留空=当前位置）' } } } },
    { name: 'get_time', description: '获取当前的日期、星期和时间', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_location', description: '读取用户当前所在位置（会请求定位授权），返回地址与坐标', inputSchema: { type: 'object', properties: {} } },
    { name: 'open_map', description: '在地图上打开一个地点或坐标', inputSchema: { type: 'object', properties: { place: { type: 'string', description: '地点名，如 长沙五一广场' }, lat: { type: 'number', description: '纬度（可选）' }, lng: { type: 'number', description: '经度（可选）' } } } },
    { name: 'open_url', description: '在浏览器里打开一个网页', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'https 开头的网址' } }, required: ['url'] } },
    { name: 'open_app', description: '打开手机 App：小红书 / 抖音 / QQ / 微信 / 微博 / 淘宝 / 支付宝 / B站 / 浏览器', inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'xiaohongshu | douyin | qq | wechat | weibo | taobao | alipay | bilibili | browser' } }, required: ['app'] } }
  ];
  function nativeServer() { return { id: NATIVE_ID, name: 'Nano 原生工具', url: 'native://companion', native: true, preset: 'native' }; }

  var WMO = { 0: '晴', 1: '多云间晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '小雨', 55: '中雨', 56: '冻雨', 57: '冻雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪', 95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴冰雹' };
  async function nativeWeather(args) {
    var city = String((args && args.city) || '').trim();
    var lat, lon, placeName;
    if (city) {
      var g = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=' + encodeURIComponent(city)).then(function (r) { return r.json(); });
      var loc = g.results && g.results[0];
      if (!loc) throw new Error('没找到城市：' + city);
      lat = loc.latitude; lon = loc.longitude; placeName = (loc.name || city) + (loc.admin1 ? (' · ' + loc.admin1) : '');
    } else {
      var p = await getPosition();
      lat = p.coords.latitude; lon = p.coords.longitude; placeName = '当前位置';
    }
    var f = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3').then(function (r) { return r.json(); });
    var cur = f.current || {}, d = f.daily || {}, lines = [];
    lines.push(placeName + ' 现在' + (WMO[cur.weather_code] || '—') + '，' + Math.round(cur.temperature_2m) + '℃（体感 ' + Math.round(cur.apparent_temperature) + '℃）');
    lines.push('湿度 ' + cur.relative_humidity_2m + '% · 风速 ' + cur.wind_speed_10m + ' km/h');
    if (d.time) for (var i = 0; i < d.time.length; i++) lines.push(d.time[i] + '：' + (WMO[d.weather_code[i]] || '—') + ' ' + Math.round(d.temperature_2m_min[i]) + '~' + Math.round(d.temperature_2m_max[i]) + '℃');
    return lines.join('\n');
  }
  function getPosition() {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) return rej(new Error('设备不支持定位'));
      navigator.geolocation.getCurrentPosition(function (p) { res(p); }, function () { rej(new Error('定位失败或被拒绝，请在浏览器里允许定位')); }, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 });
    });
  }
  async function nativeLocation() {
    var p = await getPosition();
    var lat = p.coords.latitude, lng = p.coords.longitude, addr = '';
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=zh-CN&lat=' + lat + '&lon=' + lng, { headers: { 'Accept': 'application/json' } }).then(function (x) { return x.json(); });
      addr = r.display_name || (r.address ? Object.keys(r.address).map(function (k) { return r.address[k]; }).join('') : '');
    } catch (e) {}
    return '当前位置：' + (addr || '（未能解析出地址）')
      + '\n坐标：' + lat.toFixed(5) + ', ' + lng.toFixed(5)
      + '\n地图链接：https://uri.amap.com/marker?position=' + lng + ',' + lat;
  }
  function nativeOpenMap(args) {
    args = args || {};
    var name = String(args.place || args.name || '').trim();
    var url;
    if (args.lat != null && args.lng != null) url = 'https://uri.amap.com/marker?position=' + args.lng + ',' + args.lat + (name ? ('&name=' + encodeURIComponent(name)) : '');
    else if (name) url = 'https://uri.amap.com/search?keyword=' + encodeURIComponent(name);
    else throw new Error('需要 place，或 lat + lng');
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'openFullscreen', url: url, title: '地图', showBack: true, source: 'appstore' }, '*'); } catch (e) {}
    try { window.open(url, '_blank'); } catch (e) {}
    return '已在地图打开：' + (name || (args.lat + ', ' + args.lng));
  }
  function nativeTime() { return new Date().toLocaleString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function nativeOpenUrl(args) {
    var url = String((args && args.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('url 需以 http(s):// 开头');
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'openFullscreen', url: url, title: '', showBack: true, source: 'appstore' }, '*'); } catch (e) {}
    try { window.open(url, '_blank'); } catch (e) {}
    return '已打开：' + url;
  }
  var APP_SCHEMES = {
    xiaohongshu: 'xhsdiscover://', redbook: 'xhsdiscover://',
    douyin: 'snssdk1128://', tiktok: 'snssdk1128://', dy: 'snssdk1128://',
    qq: 'mqq://',
    wechat: 'weixin://', weixin: 'weixin://',
    weibo: 'sinaweibo://',
    taobao: 'taobao://',
    alipay: 'alipay://', zhifubao: 'alipay://',
    bilibili: 'bilibili://', bzhan: 'bilibili://',
    wechatmp: 'weixin://',
    browser: 'https://www.baidu.com'
  };
  function nativeOpenApp(args) {
    var key = String((args && args.app) || '').trim().toLowerCase();
    var scheme = APP_SCHEMES[key];
    if (!scheme) throw new Error('支持的 app：xiaohongshu / douyin / qq / wechat / weibo / taobao / alipay / bilibili / browser');
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'openFullscreen', url: scheme, title: '', showBack: true, source: 'appstore' }, '*');
      else window.location.href = scheme;
    } catch (e) {}
    return '已尝试打开：' + key + '（' + scheme + '）';
  }
  async function runNative(tool, args) {
    if (tool === 'get_weather') return nativeWeather(args || {});
    if (tool === 'get_time') return nativeTime();
    if (tool === 'get_location') return nativeLocation();
    if (tool === 'open_map') return nativeOpenMap(args || {});
    if (tool === 'open_url') return nativeOpenUrl(args || {});
    if (tool === 'open_app') return nativeOpenApp(args || {});
    throw new Error('未知原生工具：' + tool);
  }

  /* ---------------- 远程 MCP（经 Worker 中转） ---------------- */
  var sessions = {};
  function parseBody(res) {
    var ct = (res.contentType || '').toLowerCase(), text = res.text || '';
    if (ct.indexOf('text/event-stream') >= 0 || /(^|\n)data:/.test(text)) {
      var out = null;
      text.split(/\r?\n/).forEach(function (line) {
        var m = line.match(/^data:\s?(.*)$/);
        if (!m) return;
        var p = m[1]; if (!p || p === '[DONE]') return;
        try { var o = JSON.parse(p); if (o && (o.result !== undefined || o.error)) out = o; } catch (e) {}
      });
      return out;
    }
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  function proxy(server, rpcBody) {
    var headers = { 'Content-Type': 'application/json' };
    try { var t = localStorage.getItem('nano_mcp_token'); if (t) headers['X-Mcp-Token'] = t; } catch (e) {}
    return fetch(baseURL() + '/mcp/proxy', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ url: server.url, token: server.token || '', sessionId: sessions[server.id] || '', body: rpcBody })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || '代理请求失败');
      if (res.sessionId) sessions[server.id] = res.sessionId;
      return res;
    });
  }
  var seq = 1;
  async function rpc(server, method, params) {
    var res = await proxy(server, { jsonrpc: '2.0', id: seq++, method: method, params: params || {} });
    var parsed = parseBody(res);
    if (parsed && parsed.error) throw new Error(parsed.error.message || 'MCP 错误');
    if (!parsed || parsed.result === undefined) { if (res.status >= 400) throw new Error('HTTP ' + res.status); throw new Error('无有效响应'); }
    return parsed.result;
  }
  async function notify(server, method, params) { try { await proxy(server, { jsonrpc: '2.0', method: method, params: params || {} }); } catch (e) {} }
  async function connect(server) {
    await rpc(server, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Nano MCP', version: '1.0' } });
    await notify(server, 'notifications/initialized');
    var r = await rpc(server, 'tools/list', {});
    var tools = (r && r.tools) || [];
    cacheTools(server.id, tools);
    return tools;
  }
  function resultText(r) {
    if (!r) return '(空结果)';
    if (r.content && r.content.length) {
      return r.content.map(function (c) {
        if (typeof c === 'string') return c;
        if (c.type === 'text') return c.text || '';
        if (c.type === 'image') return '[图片 base64，长度 ' + String((c.data || '').length) + ']';
        return JSON.stringify(c);
      }).join('\n');
    }
    if (r.structuredContent) return JSON.stringify(r.structuredContent, null, 2);
    return JSON.stringify(r, null, 2);
  }
  async function callTool(server, name, args) { return await rpc(server, 'tools/call', { name: name, arguments: args || {} }); }

  function allServers() { return [nativeServer()].concat(getServers()); }

  // 供聊天使用：已开启服务器的扁平工具列表
  function listEnabledTools() {
    var out = [];
    if (isEnabled(NATIVE_ID)) NATIVE_TOOLS.forEach(function (t) { out.push({ serverId: NATIVE_ID, native: true, name: t.name, description: t.description, inputSchema: t.inputSchema }); });
    getServers().forEach(function (s) {
      if (!isEnabled(s.id)) return;
      var tools = getCachedTools(s.id) || [];
      tools.forEach(function (t) { out.push({ serverId: s.id, native: false, name: t.name, description: t.description, inputSchema: t.inputSchema }); });
    });
    return out;
  }
  async function execTool(serverId, name, args) {
    if (serverId === NATIVE_ID) return await runNative(name, args);
    var s = getServers().filter(function (x) { return x.id === serverId; })[0];
    if (!s) throw new Error('服务器不存在或已删除');
    return resultText(await callTool(s, name, args));
  }

  window.NanoMcp = {
    baseURL: baseURL, uid: uid,
    NATIVE_ID: NATIVE_ID, NATIVE_TOOLS: NATIVE_TOOLS, nativeServer: nativeServer, allServers: allServers,
    getServers: getServers, setServers: setServers,
    isEnabled: isEnabled, setEnabledFlag: setEnabledFlag,
    cacheTools: cacheTools, getCachedTools: getCachedTools,
    connect: connect, callTool: callTool, resultText: resultText, runNative: runNative, proxy: proxy,
    listEnabledTools: listEnabledTools, execTool: execTool
  };
})();
