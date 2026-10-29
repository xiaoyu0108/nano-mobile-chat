// nano-holiday.js — 中国法定节假日 / 周末 / 调休 与「时间感知」文案生成
// 供 chat-core（单聊）、groups（群聊）、offline（线下）共用。
// 数据来源：国务院办公厅公布的各年「部分节假日安排」。收录 2024~2026，
// 之后年份仅按周末判断；如需补充，往 REST / WORK 里加即可。
(function () {
  'use strict';

  // 放假日区间：[节日名, 起(YYYY-MM-DD), 止(YYYY-MM-DD，含)]
  var REST = [
    // 2024
    ['元旦', '2023-12-30', '2024-01-01'],
    ['春节', '2024-02-10', '2024-02-17'],
    ['清明节', '2024-04-04', '2024-04-06'],
    ['劳动节', '2024-05-01', '2024-05-05'],
    ['端午节', '2024-06-08', '2024-06-10'],
    ['中秋节', '2024-09-15', '2024-09-17'],
    ['国庆节', '2024-10-01', '2024-10-07'],
    // 2025
    ['元旦', '2025-01-01', '2025-01-01'],
    ['春节', '2025-01-28', '2025-02-04'],
    ['清明节', '2025-04-04', '2025-04-06'],
    ['劳动节', '2025-05-01', '2025-05-05'],
    ['端午节', '2025-05-31', '2025-06-02'],
    ['国庆节、中秋节', '2025-10-01', '2025-10-08'],
    // 2026
    ['元旦', '2026-01-01', '2026-01-03'],
    ['春节', '2026-02-15', '2026-02-22'],
    ['清明节', '2026-04-04', '2026-04-06'],
    ['劳动节', '2026-05-01', '2026-05-05'],
    ['端午节', '2026-06-19', '2026-06-21'],
    ['中秋节', '2026-09-25', '2026-09-27'],
    ['国庆节', '2026-10-01', '2026-10-07']
  ];

  // 调休上班日（本来就是周末但要上班）
  var WORK = [
    '2024-02-04', '2024-02-18', '2024-04-07', '2024-04-28', '2024-05-11',
    '2024-09-14', '2024-09-29', '2024-10-12',
    '2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11',
    '2026-02-14', '2026-02-28', '2026-05-09', '2026-10-10'
  ];

  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // ===== 国籍 → 角色当地时间（IANA 时区）=====
  // 角色的作息、日期、早晚都必须按「他所在国家/城市」的当地时间判断，
  // 不能永远用设备本地时间（否则美国角色会在中国的早上说晚安）。
  var TZ_BY_NAT = {
    '美国': 'America/New_York', 'usa': 'America/New_York', 'united states': 'America/New_York', 'america': 'America/New_York',
    '英国': 'Europe/London', 'uk': 'Europe/London', 'england': 'Europe/London', 'britain': 'Europe/London',
    '加拿大': 'America/Toronto', 'canada': 'America/Toronto',
    '澳大利亚': 'Australia/Sydney', '澳洲': 'Australia/Sydney', 'australia': 'Australia/Sydney',
    '新西兰': 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland',
    '法国': 'Europe/Paris', 'france': 'Europe/Paris',
    '德国': 'Europe/Berlin', 'germany': 'Europe/Berlin',
    '奥地利': 'Europe/Vienna', 'austria': 'Europe/Vienna',
    '意大利': 'Europe/Rome', 'italy': 'Europe/Rome',
    '西班牙': 'Europe/Madrid', 'spain': 'Europe/Madrid',
    '葡萄牙': 'Europe/Lisbon', 'portugal': 'Europe/Lisbon',
    '荷兰': 'Europe/Amsterdam', 'netherlands': 'Europe/Amsterdam',
    '比利时': 'Europe/Brussels', 'belgium': 'Europe/Brussels',
    '瑞士': 'Europe/Zurich', 'switzerland': 'Europe/Zurich',
    '瑞典': 'Europe/Stockholm', 'sweden': 'Europe/Stockholm',
    '挪威': 'Europe/Oslo', 'norway': 'Europe/Oslo',
    '丹麦': 'Europe/Copenhagen', 'denmark': 'Europe/Copenhagen',
    '芬兰': 'Europe/Helsinki', 'finland': 'Europe/Helsinki',
    '波兰': 'Europe/Warsaw', 'poland': 'Europe/Warsaw',
    '希腊': 'Europe/Athens', 'greece': 'Europe/Athens',
    '爱尔兰': 'Europe/Dublin', 'ireland': 'Europe/Dublin',
    '俄罗斯': 'Europe/Moscow', 'russia': 'Europe/Moscow',
    '乌克兰': 'Europe/Kyiv', 'ukraine': 'Europe/Kyiv',
    '土耳其': 'Europe/Istanbul', 'turkey': 'Europe/Istanbul',
    '日本': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
    '韩国': 'Asia/Seoul', '南韩': 'Asia/Seoul', 'korea': 'Asia/Seoul',
    '新加坡': 'Asia/Singapore', 'singapore': 'Asia/Singapore',
    '马来西亚': 'Asia/Kuala_Lumpur', 'malaysia': 'Asia/Kuala_Lumpur',
    '泰国': 'Asia/Bangkok', 'thailand': 'Asia/Bangkok',
    '越南': 'Asia/Ho_Chi_Minh', 'vietnam': 'Asia/Ho_Chi_Minh',
    '菲律宾': 'Asia/Manila', 'philippines': 'Asia/Manila',
    '印度尼西亚': 'Asia/Jakarta', '印尼': 'Asia/Jakarta', 'indonesia': 'Asia/Jakarta',
    '印度': 'Asia/Kolkata', 'india': 'Asia/Kolkata',
    '巴基斯坦': 'Asia/Karachi', 'pakistan': 'Asia/Karachi',
    '孟加拉': 'Asia/Dhaka', 'bangladesh': 'Asia/Dhaka',
    '尼泊尔': 'Asia/Kathmandu', 'nepal': 'Asia/Kathmandu',
    '斯里兰卡': 'Asia/Colombo', 'sri lanka': 'Asia/Colombo',
    '沙特阿拉伯': 'Asia/Riyadh', '沙特': 'Asia/Riyadh', 'saudi': 'Asia/Riyadh',
    '阿联酋': 'Asia/Dubai', '迪拜': 'Asia/Dubai', 'uae': 'Asia/Dubai', 'dubai': 'Asia/Dubai',
    '以色列': 'Asia/Jerusalem', 'israel': 'Asia/Jerusalem',
    '伊朗': 'Asia/Tehran', 'iran': 'Asia/Tehran',
    '墨西哥': 'America/Mexico_City', 'mexico': 'America/Mexico_City',
    '巴西': 'America/Sao_Paulo', 'brazil': 'America/Sao_Paulo',
    '阿根廷': 'America/Argentina/Buenos_Aires', 'argentina': 'America/Argentina/Buenos_Aires',
    '智利': 'America/Santiago', 'chile': 'America/Santiago',
    '哥伦比亚': 'America/Bogota', 'colombia': 'America/Bogota',
    '秘鲁': 'America/Lima', 'peru': 'America/Lima',
    '委内瑞拉': 'America/Caracas', 'venezuela': 'America/Caracas',
    '古巴': 'America/Havana', 'cuba': 'America/Havana',
    '埃及': 'Africa/Cairo', 'egypt': 'Africa/Cairo',
    '南非': 'Africa/Johannesburg', 'south africa': 'Africa/Johannesburg'
  };

  function isChineseArea(nat) {
    var n = String(nat || '').trim();
    if (!n || n === '未知' || n === '未设定' || /^unknown$/i.test(n)) return true;
    return /中国|中國|china|chinese|台湾|台灣|taiwan|香港|hong\s*kong|澳门|澳門|macau|macao/i.test(n);
  }

  function tzForNationality(nat) {
    var n = String(nat || '').trim();
    if (!n || n === '未知' || n === '未设定' || /^unknown$/i.test(n)) return '';
    if (/香港|hong\s*kong/i.test(n)) return 'Asia/Hong_Kong';
    if (/澳门|澳門|macau|macao/i.test(n)) return 'Asia/Macau';
    if (/台湾|台灣|taiwan/i.test(n)) return 'Asia/Taipei';
    if (/中国|中國|china|chinese/i.test(n)) return 'Asia/Shanghai';
    var low = n.toLowerCase();
    for (var k in TZ_BY_NAT) {
      if (n.indexOf(k) > -1 || low.indexOf(k.toLowerCase()) > -1) return TZ_BY_NAT[k];
    }
    return '';
  }

  // 把任意时刻换算成「目标时区墙上时间」的 Date：
  // 只用于读取年月日/星期/几点，不参与时间戳差值计算。
  var __dtfCache = {};
  function __dtf(tz) {
    if (!__dtfCache[tz]) {
      __dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
      });
    }
    return __dtfCache[tz];
  }
  function wallClock(date, tz) {
    date = date instanceof Date ? date : new Date(date || Date.now());
    if (!tz) return date;
    try {
      var parts = __dtf(tz).formatToParts(date);
      var m = {};
      for (var i = 0; i < parts.length; i++) m[parts[i].type] = parts[i].value;
      var hh = parseInt(m.hour, 10);
      if (hh === 24) hh = 0;
      return new Date(parseInt(m.year, 10), parseInt(m.month, 10) - 1, parseInt(m.day, 10),
        hh || 0, parseInt(m.minute, 10) || 0, parseInt(m.second, 10) || 0);
    } catch (e) {
      return date;
    }
  }

  function localDescribe(d) {
    var dow = d.getDay();
    var rest = (dow === 0 || dow === 6);
    return '今天是' + keyOf(d) + ' 星期' + WEEKDAYS[dow] + '，' + (rest ? '周末（休息日）' : '工作日');
  }

  function inRest(k) {
    for (var i = 0; i < REST.length; i++) {
      if (k >= REST[i][1] && k <= REST[i][2]) return REST[i];
    }
    return null;
  }
  function isWorkMakeup(k) { return WORK.indexOf(k) !== -1; }

  function dayGap(k, start, end) {
    var a = new Date(start + 'T00:00:00');
    var b = new Date(k + 'T00:00:00');
    var c = new Date(end + 'T00:00:00');
    return {
      idx: Math.round((b - a) / 86400000) + 1,
      total: Math.round((c - a) / 86400000) + 1
    };
  }

  // 返回某天的完整日历信息
  function info(date) {
    date = date || new Date();
    var k = keyOf(date);
    var dow = date.getDay();
    var isWeekend = (dow === 0 || dow === 6);
    var rest = inRest(k);
    var makeup = isWorkMakeup(k);
    var isHoliday = !!rest;
    var isRestDay = (isWeekend || isHoliday) && !makeup;
    var name = rest ? rest[0] : '';
    var gap = rest ? dayGap(k, rest[1], rest[2]) : null;

    var label;
    if (makeup) label = '调休上班日';
    else if (isHoliday) label = '法定假期';
    else if (isWeekend) label = '周末';
    else label = '工作日';

    // 粗略的假期/季节（供“上学日 / 假期”感知；仅作参考）
    var mon = date.getMonth() + 1, day = date.getDate();
    var season = '';
    if (mon === 7 || mon === 8) season = '暑假期间';
    else if (mon === 1 && day >= 15) season = '寒假期间';
    else if (mon === 2 && day <= 20) season = '寒假期间';

    return {
      key: k, date: date, dow: dow, weekday: '星期' + WEEKDAYS[dow],
      isWeekend: isWeekend, isHoliday: isHoliday, holidayName: name,
      makeup: makeup, isRestDay: isRestDay, isWorkday: !isRestDay,
      isSchoolDay: !isRestDay, vacation: season,
      dayIndex: gap ? gap.idx : 0, dayTotal: gap ? gap.total : 0,
      label: label
    };
  }

  // 一句话描述当天，例如“工作日”“周末”“国庆节假期第2天（共7天）”“调休上班（今天要上班）”
  function describe(date) {
    var o = info(date);
    if (o.makeup) return '今天是' + o.key + ' ' + o.weekday + '，属于调休上班日（虽然是周末但要上班/上学）';
    if (o.isHoliday) {
      var s = '今天是' + o.key + ' ' + o.weekday + '，是' + o.holidayName + '假期';
      if (o.dayTotal > 1) s += '第' + o.dayIndex + '天（共' + o.dayTotal + '天）';
      return s;
    }
    if (o.isWeekend) return '今天是' + o.key + ' ' + o.weekday + '，是周末（休息日）';
    var base = '今天是' + o.key + ' ' + o.weekday + '，是工作日';
    if (o.vacation) base += '（' + o.vacation + '）';
    return base;
  }

  // 精确到分钟/小时/天：开启时间感知时，角色要真的知道「多久没联系」，
  // 不能把 2 小时 50 分说成 2 小时，也不能把 40 天笼统说成 1 个月。
  function fmtGap(ms) {
    if (!(ms > 0)) return '';
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return '不到 1 分钟';
    if (mins < 60) return mins + ' 分钟';
    var hours = Math.floor(mins / 60);
    var remMin = mins % 60;
    if (hours < 24) return hours + ' 小时' + (remMin ? ' ' + remMin + ' 分钟' : '');
    var days = Math.floor(hours / 24);
    var remHour = hours % 24;
    if (days < 365) return days + ' 天' + (remHour ? ' ' + remHour + ' 小时' : '');
    var years = Math.floor(days / 365);
    var remDay = days % 365;
    return years + ' 年' + (remDay ? ' ' + remDay + ' 天' : '');
  }

  // 生成注入到系统提示词里的「时间感知」整块文案
  // opts: { lastUserMs, lastAiMs, nationality, tz }（epoch ms 可选；nationality 用于换算角色当地时间）
  function buildTimeBlock(now, opts) {
    now = now || new Date();
    opts = opts || {};
    var nat = String(opts.nationality || '').trim();
    var tz = opts.tz || tzForNationality(nat);
    var cn = isChineseArea(nat);
    var wall = wallClock(now, tz);
    var o = info(wall);
    var timeStr = wall.getFullYear() + '年' + (wall.getMonth() + 1) + '月' + wall.getDate() + '日 ' +
      o.weekday + ' ' + pad(wall.getHours()) + ':' + pad(wall.getMinutes());
    var dayText = cn ? describe(wall).replace(/^今天是[^，]*，/, '') : localDescribe(wall).replace(/^今天是[^，]*，/, '');

    var lines = [];
    lines.push('【当前时间 · 真实】你所在的地方现在是 ' + timeStr + '（' + dayText + '）。' +
      (tz ? '这是你本人所在地的当地时间，你的作息、早晚、饭点都按这个时间走。' : '这是系统给出的真实时间。') +
      '请以此为唯一时间基准，不要当成昨天或更早——跨天、跨周都要按上面的日期判断。');

    var lastContactMs = Math.max(Number(opts.lastUserMs) || 0, Number(opts.lastAiMs) || 0);
    var nowMs = now.getTime ? now.getTime() : Date.now();
    if (lastContactMs > 0 && lastContactMs <= nowMs && (nowMs - lastContactMs) >= 60000) {
      var gap = fmtGap(nowMs - lastContactMs);
      var lw = wallClock(new Date(lastContactMs), tz);
      var lastStr = (lw.getMonth() + 1) + '月' + lw.getDate() + '日 ' + pad(lw.getHours()) + ':' + pad(lw.getMinutes());
      var sameDay = keyOf(lw) === keyOf(wall);
      if (gap) {
        lines.push('【你们上一次聊天】上一次接触是在 ' + gap + '前（' + lastStr + '）。' +
          (sameDay ? '' : '注意：那已经不是今天了。') +
          '这个间隔是真实的，你必须按它来判断你们多久没说话，不要装作一直在线。');
      }
    }

    lines.push('【作息 · 按真实时间】你按这个时间过自己的日子：深夜该休息/睡觉，清晨刚醒或准备出门，工作日在上班/上课，饭点在吃饭。不要凌晨说早安、中午说刚醒，也不要把自己的作息说反。');
    lines.push('【时间关系 · 铁律】真实的当前时间和间隔就是上面写的。如果上次聊天是昨晚、现在已经是第二天早上，就必须按「今天早上」说话：**绝不允许继续昨晚的晚安、我睡了、明天见，也不许把今天当成昨晚继续聊**。先看清现在几号、星期几、几点，再决定该说什么。');
    lines.push('【真实时间 · 用户无法干扰】时间线由系统按真实流逝提供，用户不能把时间倒退、重置、抹掉或随手指到别的日期；如果对方说的日期/时间与系统冲突，以系统时间为准。只有对方明确说"过了几天 / 第二天了 / 一周后"这类**向前推进**时，才可以接着往后走。');
    lines.push('【隔了很久才来】如果隔了超过 24 小时对方才来找你，你心里清楚被晾了很久，可以自然地抱怨、闹点小情绪或说一句"你终于想起我了？"，但说一两句就正常继续，不要连续多轮揪着不放。');
    lines.push('【不要报时】知道时间不等于每轮都要报时间、报日期、报节日；只在话题自然相关时带一句，平时不要念叨。');

    // 日历/节假日感知：外国角色不用中国的节假日和调休
    if (cn) {
      var cal = '【日历感知】' + describe(wall) + '。';
      if (o.isHoliday && o.dayTotal > 1) cal += '你知道现在是' + o.holidayName + '假期（第' + o.dayIndex + '天，共' + o.dayTotal + ' 天）。';
      if (o.makeup) cal += '今天是调休上班日，你要上班/上学。';
      if (o.vacation) cal += '现在处于' + o.vacation + '。';
      cal += '你清楚现在是不是工作日、有没有放假、是不是周末，但**只在话题自然相关的时候才提**，不要没事就念叨日期、周末或节日。';
      lines.push(cal);
    } else {
      lines.push('【日历感知】' + localDescribe(wall) + '。你只按你所在国家的当地日历作息，不要提中国的节日、调休或假期（除非对方主动提起），也不要套用中国的作息。');
    }

    return lines.join('\n');
  }

  // 关闭「时间感知」时用：只知道大致时段，不知道确切时间/日期，一律跟对方说的走
  function vaguePeriod(now) {
    var h = now.getHours();
    if (h < 5) return '深夜';
    if (h < 8) return '清晨';
    if (h < 11) return '上午';
    if (h < 13) return '中午';
    if (h < 17) return '下午';
    if (h < 19) return '傍晚';
    if (h < 23) return '晚上';
    return '深夜';
  }
  function buildVagueTimeBlock(now, opts) {
    now = now || new Date();
    opts = opts || {};
    var nat = String(opts.nationality || '').trim();
    var tz = opts.tz || tzForNationality(nat);
    var wall = wallClock(now, tz);
    var p = vaguePeriod(wall);
    return [
      '【时间 · 模糊参考】你只大概知道现在是' + p + '，但**不确定具体日期、星期，也记不清具体隔了多久**。',
      '没被特意提及时，说话可以带一点自然的时间感（如"这么晚还没睡？""中午了记得吃饭"），但**不要报具体的日期、星期几或几点几分**，也别把参考时间说得太死。',
      '【接着上次聊】就算隔了很久没聊，也当作接着上次聊天的时间线继续，不要自行跳到新的一天，也不要强调"好久没聊"。',
      '【以对方 / 剧情为准】一旦对方强调或提到了时间（几点、过了多久、几天后…），或剧情里明确推进了时间（"天亮了""第二天""过了一周"），就**以对方和剧情的时间为准**，可以自然调整视角与时间线，绝不用这个参考时间去纠正或反驳。'
    ].join('\n');
  }

  // 把某个时间戳格式化成「角色当地时间」的简短标注，供聊天记录标注使用
  function fmtMoment(ts, opts) {
    opts = opts || {};
    var tz = opts.tz || tzForNationality(opts.nationality);
    var d = wallClock(new Date(Number(ts) || Date.now()), tz);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // 极简「时间锚点」：放在最新一条用户消息之前，防止长提示词把时间感知挤没
  function nowAnchor(now, opts) {
    now = now || new Date();
    opts = opts || {};
    var tz = opts.tz || tzForNationality(opts.nationality);
    var wall = wallClock(now, tz);
    var s = wall.getFullYear() + '年' + (wall.getMonth() + 1) + '月' + wall.getDate() + '日 星期' +
      WEEKDAYS[wall.getDay()] + ' ' + pad(wall.getHours()) + ':' + pad(wall.getMinutes());
    var lastMs = Math.max(Number(opts.lastUserMs) || 0, Number(opts.lastAiMs) || 0);
    var gap = '';
    if (lastMs > 0 && lastMs <= now.getTime() && (now.getTime() - lastMs) >= 60000) gap = fmtGap(now.getTime() - lastMs);
    return s + (gap ? ('，距离你们上次聊天已经 ' + gap) : '');
  }

  window.NanoHoliday = {
    info: info,
    describe: describe,
    buildTimeBlock: buildTimeBlock,
    buildVagueTimeBlock: buildVagueTimeBlock,
    fmtGap: fmtGap,
    fmtMoment: fmtMoment,
    nowAnchor: nowAnchor,
    wallClock: wallClock,
    tzForNationality: tzForNationality,
    isChineseArea: isChineseArea,
    pad: pad
  };
})();
