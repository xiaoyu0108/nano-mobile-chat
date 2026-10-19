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

  function fmtGap(ms) {
    if (!(ms > 0)) return '';
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + ' 分钟';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' 小时';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + ' 天';
    var months = Math.floor(days / 30);
    return months + ' 个月';
  }

  // 生成注入到系统提示词里的「时间感知」整块文案
  // opts: { lastUserMs, lastAiMs }  （epoch ms，可选）
  function buildTimeBlock(now, opts) {
    now = now || new Date();
    opts = opts || {};
    var o = info(now);
    var timeStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' +
      o.weekday + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());

    var lines = [];
    lines.push('【当前时间】现在是 ' + timeStr + '（' + describe(now).replace(/^今天是[^，]*，/, '') + '）。请以此为真实时间基准，不要当成昨天或更早——跨天、跨周都要按上面的日期判断。');

    var lastUserGap = opts.lastUserMs ? fmtGap(Date.now() - opts.lastUserMs) : '';
    var lastAiGap = opts.lastAiMs ? fmtGap(Date.now() - opts.lastAiMs) : '';
    if (lastUserGap) lines.push('【隔了多久没联系】对方上一次给你发消息大约是在 ' + lastUserGap + '前，你心里清楚隔了多久，不必装作一直在线。');
    if (lastAiGap) lines.push('【你上次开口】你上一次和对方说话大约是在 ' + lastAiGap + '前。');
    lines.push('【时间感知的用法】你清楚彼此隔了多久没聊：如果隔了几天甚至更久，你心里有数，但**不要反复强调、不要一直埋怨或追问对方为什么这么久才来**；最多自然地带一句（例如"好久不见""你终于理我了"），然后正常继续。不要每轮都报时间、报日期、报节日。');
    lines.push('【时间以系统为准 · 不可乱改】上面的日期/时间就是真实时间，请以此为准判断。**绝对不要自行更改、编造或"推进"时间**——例如不能凭自己说成"已经是第二天了""都过了一星期了""现在是半夜"；也不要自己编造日期、星期、几点几分。除非对方明确说明过了多久、或发生了明确跨越时间的事件，否则时间就按上面这个走。');
    lines.push('【以对方说的为准】如果对方主动提到经过的时间（例如"过了三天""我们半个月没见了""都一个月了"），一律以对方说的为准，顺着对方的说法走，绝不用系统时间反驳或纠正他。');

    // 日历/节假日感知
    var cal = '【日历感知】' + describe(now) + '。';
    if (o.isHoliday && o.dayTotal > 1) cal += '你知道现在是' + o.holidayName + '假期（第' + o.dayIndex + '天，共' + o.dayTotal + '天）。';
    if (o.makeup) cal += '今天是调休上班日，你要上班/上学。';
    if (o.vacation) cal += '现在处于' + o.vacation + '。';
    cal += '你清楚现在是不是工作日、有没有放假、是不是周末、是不是快放假或刚放完假，但**只在话题自然相关的时候才提**（例如对方说累、说放假、说过节），不要没事就念叨日期、周末或节日。';
    lines.push(cal);

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
  function buildVagueTimeBlock(now) {
    now = now || new Date();
    var p = vaguePeriod(now);
    var clock = pad(now.getHours()) + ':' + pad(now.getMinutes());
    return [
      '【时间 · 参考】你大概知道现在差不多是 ' + clock + ' 前后（' + p + '），但**不确定日期、星期，也记不清具体隔了多久**。',
      '没被特意提及时，说话可以带一点自然的时间感（如"这么晚还没睡？""中午了记得吃饭"），但**不要报具体的日期、星期几**，也别把参考时间说得太死。',
      '【以对方 / 剧情为准】一旦对方强调或提到了时间（几点、过了多久、几天后…），或剧情里明确推进了时间（"天亮了""第二天""过了一周"），就**以对方和剧情的时间为准**，顺着往后走，绝不用这个参考时间去纠正或反驳。'
    ].join('\n');
  }

  window.NanoHoliday = {
    info: info,
    describe: describe,
    buildTimeBlock: buildTimeBlock,
    buildVagueTimeBlock: buildVagueTimeBlock,
    fmtGap: fmtGap,
    pad: pad
  };
})();
