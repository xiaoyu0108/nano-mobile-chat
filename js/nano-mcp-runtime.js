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
    { name: 'get_hot_topics', description: '获取实时热点/热搜：微博、抖音、百度、今日头条、B站。用户问“今天有什么热点/热搜/新闻”时可调用', inputSchema: { type: 'object', properties: { source: { type: 'string', description: 'weibo | douyin | baidu | toutiao | bilibili（留空=全部）' }, limit: { type: 'number', description: '每个来源返回几条，默认 10，最多 20' } } } },
    { name: 'get_location', description: '读取用户当前所在位置（会请求定位授权），返回地址与坐标', inputSchema: { type: 'object', properties: {} } },
    { name: 'open_map', description: '在地图上打开一个地点或坐标', inputSchema: { type: 'object', properties: { place: { type: 'string', description: '地点名，如 长沙五一广场' }, lat: { type: 'number', description: '纬度（可选）' }, lng: { type: 'number', description: '经度（可选）' } } } },
    { name: 'open_url', description: '在浏览器里打开一个网页', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'https 开头的网址' } }, required: ['url'] } },
    { name: 'open_app', description: '打开手机 App：小红书 / 抖音 / QQ / 微信 / 微博 / 淘宝 / 支付宝 / B站 / 浏览器', inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'xiaohongshu | douyin | qq | wechat | weibo | taobao | alipay | bilibili | browser' } }, required: ['app'] } },
    { name: 'parse_douyin', description: '解析抖音分享链接：读取视频文案、作者、话题、音乐、点赞/评论数据、封面和热评。用户发来抖音链接、或问这个视频讲了什么时调用', inputSchema: { type: 'object', properties: { url: { type: 'string', description: '抖音分享链接或包含链接的整段分享文案' } }, required: ['url'] } }
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
  async function nativeHotTopics(args) {
    args = args || {};
    var src = String(args.source || '').trim().toLowerCase();
    var limit = Math.max(1, Math.min(20, parseInt(args.limit, 10) || 10));
    var url = baseURL() + '/hot' + (src ? ('?source=' + encodeURIComponent(src)) : '');
    var r = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
    if (!r || !r.ok) throw new Error('热点服务暂时不可用');
    var j = await r.json();
    if (!j || !j.ok) throw new Error('热点服务返回异常');
    var lines = [];
    (j.sources || []).forEach(function (s) {
      var items = (s.items || []).slice(0, limit);
      if (!items.length) return;
      lines.push('【' + (s.label || s.source) + '】');
      items.forEach(function (it, i) {
        lines.push((i + 1) + '. ' + it.title + (it.hot ? (' · ' + Math.round(it.hot)) : ''));
      });
    });
    return lines.length ? lines.join('\n') : '暂时没有取到热点，请稍后再试';
  }
  function dyTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms || 9000); })
    ]);
  }
  function dyExtractUrl(raw) {
    var s = String(raw || '');
    var m = s.match(/https?:\/\/[^\s"'<>]+/g) || [];
    for (var i = 0; i < m.length; i++) {
      if (/douyin\.com|iesdouyin\.com|v\.douyin\.com/i.test(m[i])) return m[i].replace(/[),，。]+$/, '');
    }
    return m[0] || '';
  }
  function dyExtractId(url, html) {
    var m = String(url || '').match(/\/(?:video|note|slides)\/(\d{8,})/);
    if (m) return m[1];
    m = String(html || '').match(/"aweme_id"\s*:\s*"(\d{8,})"/);
    if (m) return m[1];
    m = String(url || '').match(/[?&](?:modal_id|aweme_id|item_id)=(\d{8,})/);
    return m ? m[1] : '';
  }
  async function dyFetchJson(url, ms) {
    var proxies = [
      function (u) { return u; },
      function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
      function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); }
    ];
    for (var i = 0; i < proxies.length; i++) {
      try {
        var r = await dyTimeout(fetch(proxies[i](url), { cache: 'no-store' }), ms || 8000);
        if (!r || !r.ok) continue;
        var t = await r.text();
        try { return JSON.parse(t); } catch (e) {}
        return { __html: t };
      } catch (e) {}
    }
    return null;
  }
  async function dyHtml(url, ms) {
    var proxies = [
      function (u) { return 'https://r.jina.ai/' + u; },
      function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
      function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); }
    ];
    for (var i = 0; i < proxies.length; i++) {
      try {
        var r = await dyTimeout(fetch(proxies[i](url), { cache: 'no-store' }), ms || 9000);
        if (r && r.ok) return await r.text();
      } catch (e) {}
    }
    return '';
  }
  // 抖音分享页会把完整视频信息塞进 _ROUTER_DATA / RENDER_DATA。公开的 iteminfo 接口
  // 经常被限流或返回空，直接解析分享页更稳，也能拿到封面、作者、数据和热评。
  function dyFindAweme(obj, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 9) return null;
    if (obj.desc && (obj.author || obj.video || obj.images) && (obj.aweme_id || obj.awemeId || obj.statistics)) return obj;
    if (obj.aweme_detail && obj.aweme_detail.desc) return obj.aweme_detail;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      try {
        var hit = dyFindAweme(obj[keys[i]], (depth || 0) + 1);
        if (hit) return hit;
      } catch (e) {}
    }
    return null;
  }
  function dyParseShareHtml(text) {
    var s = String(text || '');
    function tryJson(raw) {
      if (!raw) return null;
      var t = raw.trim().replace(/;$/, '');
      try { return dyFindAweme(JSON.parse(t), 0); } catch (e) {}
      try { return dyFindAweme(JSON.parse(decodeURIComponent(t)), 0); } catch (e) {}
      return null;
    }
    var m = s.match(/<script[^>]+id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i);
    var hit = m ? tryJson(m[1]) : null;
    if (hit) return hit;
    m = s.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i) ||
        s.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
    hit = m ? tryJson(m[1]) : null;
    if (hit) return hit;
    m = s.match(/"aweme_id"\s*:\s*"(\d{8,})"[\s\S]{0,200000}?"desc"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (m) return { aweme_id: m[1], desc: m[2].replace(/\\n/g, ' ').replace(/\\"/g, '"') };
    return null;
  }
  function dyPickCover(item) {
    item = item || {};
    var out = '';
    function fromObj(cov) {
      if (!cov) return '';
      if (typeof cov === 'string') return cov;
      if (Array.isArray(cov.url_list) && cov.url_list[0]) return cov.url_list[0];
      if (Array.isArray(cov.uri) && cov.uri[0]) return cov.uri[0];
      if (typeof cov.url === 'string') return cov.url;
      return '';
    }
    out = fromObj(item.video && (item.video.cover || item.video.dynamic_cover || item.video.origin_cover));
    if (!out && Array.isArray(item.images) && item.images.length) out = fromObj(item.images[0]);
    if (!out && item.video && item.video.play_addr) out = fromObj(item.video.play_addr);
    if (!out && item.share_info) out = String(item.share_info.share_image_url || '');
    return out;
  }
  // 抖音给搜索引擎蜘蛛的分享页里，封面和文案都在 meta 标签里，不触发反爬。
  function dyParseSeoMeta(text) {
    var s = String(text || '');
    function meta(name) {
      var esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var m = s.match(new RegExp('<meta[^>]+name=["\']' + esc + '["\'][^>]*content=["\']([^"\']*)["\']', 'i')) ||
        s.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*name=["\']' + esc + '["\']', 'i'));
      return m ? String(m[1]).replace(/&amp;/g, '&') : '';
    }
    var desc = meta('description');
    var am = desc.match(/ - (.+?)于\s*\d{8}\s*发布在抖音/);
    return {
      title: meta('lark:url:video_title') || meta('lark:url:note_title') || meta('og:title'),
      desc: desc,
      cover: meta('lark:url:video_cover_image_url') || meta('lark:url:note_cover_image_url') || meta('og:image'),
      author: am ? am[1] : ''
    };
  }
  async function nativeParseDouyin(args) {
    var url = dyExtractUrl((args && (args.url || args.text)) || '');
    if (!url) throw new Error('请提供抖音分享链接');
    var out = { title: '', desc: '', author: '', content: '', cover: '', stats: {}, comments: [], music: '', tags: [], awemeId: '' };
    // 1) 优先用 Worker 的分享链接解析（服务端抓取，能拿到文案/作者/封面/热评）
    try {
      var base = baseURL();
      var tok = '';
      try { tok = localStorage.getItem('nano_peek_token') || localStorage.getItem('nano_push_token') || ''; } catch (e) {}
      var wr = await dyTimeout(fetch(base + '/link/preview?url=' + encodeURIComponent(url) + (tok ? ('&token=' + encodeURIComponent(tok)) : ''), { cache: 'no-store' }), 12000);
      if (wr && wr.ok) {
        var wj = await wr.json();
        if (wj && wj.ok) {
          out.title = String(wj.title || '');
          out.desc = String(wj.desc || '');
          out.content = String(wj.content || '');
          out.author = String(wj.author || '');
          out.cover = (wj.images && wj.images[0]) || wj.cover || '';
          out.stats = wj.stats || {};
          out.comments = Array.isArray(wj.comments) ? wj.comments : [];
          out.music = String(wj.music || '');
          out.tags = Array.isArray(wj.tags) ? wj.tags : [];
          out.awemeId = String(wj.awemeId || '');
        }
      }
    } catch (e) {}
    // 2) Worker 未部署新字段 / 短链无法解析时，客户端再走公开接口补一次
    if (!out.awemeId || !out.desc || !out.comments.length || !out.cover) {
      var html = '';
      if (!out.awemeId) {
        try { html = await dyHtml(url, 9000); } catch (e) {}
        out.awemeId = dyExtractId(url, html);
      }
      if (!out.awemeId) {
        var tm = String(html || '').match(/https?:\/\/(?:www\.)?douyin\.com\/(?:video|note|slides)\/(\d{8,})/);
        if (tm) out.awemeId = tm[1];
      }
      if (out.awemeId) {
        var dyKind = ((String(url).match(/\/(video|note|slides)\//i) || [])[1] || 'video').toLowerCase();
        var info = await dyFetchJson('https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=' + encodeURIComponent(out.awemeId), 9000);
        var item = info && info.item_list && info.item_list[0];
        if (!item) {
          var dj = await dyFetchJson('https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=' + encodeURIComponent(out.awemeId) + '&aid=6383', 9000);
          item = (dj && (dj.aweme_detail || (dj.aweme_details && dj.aweme_details[0]))) || null;
        }
        // 公开接口失效时，直接抓 iesdouyin 分享页里的 _ROUTER_DATA / SEO meta（封面通常只在这里）。
        if (!item || !item.desc || !dyPickCover(item)) {
          var shareHtml = '';
          try { shareHtml = await dyHtml('https://www.iesdouyin.com/share/' + dyKind + '/' + out.awemeId + '/', 9000); } catch (e) {}
          var seo = dyParseSeoMeta(shareHtml);
          var parsed = dyParseShareHtml(shareHtml);
          if (parsed) item = parsed;
          if (seo.cover || seo.desc) {
            out.cover = out.cover || seo.cover;
            out.desc = out.desc || seo.desc;
            out.title = out.title || seo.title;
            out.author = out.author || seo.author;
          }
        }
        if (item) {
          out.desc = out.desc || String(item.desc || '').replace(/\s+/g, ' ').trim();
          out.title = out.title || out.desc.slice(0, 120);
          out.author = out.author || String((item.author && (item.author.nickname || item.author.unique_id)) || '');
          out.stats = (out.stats && Object.keys(out.stats).length) ? out.stats : (item.statistics || {});
          out.music = out.music || String((item.music && (item.music.title || item.music.author)) || '');
          out.tags = (out.tags && out.tags.length) ? out.tags : (Array.isArray(item.text_extra) ? item.text_extra.map(function (t) { return t && t.hashtag_name ? '#' + t.hashtag_name : ''; }).filter(Boolean) : []);
          if (!out.cover) out.cover = dyPickCover(item);
          if (!out.content) {
            var cp = [out.desc, out.author ? ('作者：' + out.author) : '', (out.tags || []).join(' '), out.music ? ('音乐：' + out.music) : ''].filter(Boolean);
            out.content = cp.join('\n');
          }
        }
        if (!out.comments.length) {
          var cj = await dyFetchJson('https://www.iesdouyin.com/web/api/v2/comment/list/?aweme_id=' + encodeURIComponent(out.awemeId) + '&cursor=0&count=12&item_type=0', 9000);
          var list = (cj && (cj.comments || (cj.data && cj.data.comments))) || (item && item.comments) || [];
          out.comments = list.map(function (c) {
            return {
              author: String((c.user && (c.user.nickname || c.user.unique_id)) || (c.author && (c.author.nickname || c.author.unique_id)) || ''),
              text: String(c.text || c.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
              likes: Number(c.digg_count || c.like_count || 0) || 0
            };
          }).filter(function (c) { return c.text; }).slice(0, 12);
        }
      }
    }
    // 通用 Logo 不算封面，清掉避免卡片显示成抖音启动图。
    if (out.cover && /logo_launcher|douyinstatic\.com\/obj\/eden-cn/i.test(String(out.cover))) out.cover = '';
    // 3) 最后兜底：用无头浏览器服务渲染分享页，读取真实 og:image 封面。
    //    抖音的公开接口经常限流，但分享页的 OG 标签通常还在。
    if (!out.cover || !out.desc) {
      try {
        var mu = 'https://api.microlink.io/?url=' + encodeURIComponent(url) + '&meta=true';
        var mr = await dyTimeout(fetch(mu, { cache: 'no-store' }), 20000);
        var mj = mr && mr.ok ? await mr.json() : null;
        if (mj && mj.status === 'success' && mj.data) {
          var md = mj.data;
          if (!out.desc && md.description) out.desc = String(md.description).replace(/\s+/g, ' ').trim();
          if (!out.title && md.title) out.title = String(md.title).trim();
          var mi = md.image && (md.image.url || md.image);
          if (!out.cover && mi && !/logo_launcher|douyinstatic\.com\/obj\/eden-cn/i.test(String(mi))) {
            out.cover = String(mi);
          }
        }
      } catch (e) {}
    }
    var lines = [];
    if (out.desc) lines.push('文案：' + out.desc);
    if (out.author) lines.push('作者：' + out.author);
    if (out.tags && out.tags.length) lines.push('话题：' + out.tags.join(' '));
    if (out.music) lines.push('音乐：' + out.music);
    var st = out.stats || {};
    var stLine = [
      st.digg_count != null ? ('点赞 ' + st.digg_count) : '',
      st.comment_count != null ? ('评论 ' + st.comment_count) : '',
      st.share_count != null ? ('分享 ' + st.share_count) : '',
      st.collect_count != null ? ('收藏 ' + st.collect_count) : ''
    ].filter(Boolean).join(' · ');
    if (stLine) lines.push('数据：' + stLine);
    if (out.comments && out.comments.length) {
      lines.push('热评：');
      out.comments.slice(0, 8).forEach(function (c, i) {
        lines.push((i + 1) + '. ' + (c.author ? (c.author + '：') : '') + c.text + (c.likes ? ('（赞 ' + c.likes + '）') : ''));
      });
    }
    if (out.cover) lines.push('封面图：' + out.cover);
    if (!lines.length) {
      // 至少返回分享文案，避免角色只看到一条链接
      var share = String((args && (args.text || args.url)) || '').replace(url, ' ').replace(/\s+/g, ' ').trim();
      if (share) lines.push('分享文案：' + share);
      lines.push('（抖音页面被反爬拦截，以上是分享文案；不要回复“打不开”，根据已有信息自然接话。）');
    }
    return lines.join('\n');
  }
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
    if (tool === 'get_hot_topics') return nativeHotTopics(args || {});
    if (tool === 'get_location') return nativeLocation();
    if (tool === 'open_map') return nativeOpenMap(args || {});
    if (tool === 'open_url') return nativeOpenUrl(args || {});
    if (tool === 'open_app') return nativeOpenApp(args || {});
    if (tool === 'parse_douyin') return await nativeParseDouyin(args || {});
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
