/* bank-theme.js — 银行卡主题（颜色 / 名称），钱包与亲属卡共用
   用法：NanoBank.list / NanoBank.get(id) / NanoBank.css(id) -> {bg, chip, text} */
(function () {
    'use strict';

    var LIST = [
        { id: 'abc',   name: '农业银行',     bg: 'linear-gradient(135deg,#3aa76d,#1f7a4c)', chip: '#f2d06b', text: '#ffffff' },
        { id: 'cmb',   name: '招商银行',     bg: 'linear-gradient(135deg,#e8453c,#b0201a)', chip: '#f2d06b', text: '#ffffff' },
        { id: 'rural', name: '农村商业银行', bg: 'linear-gradient(135deg,#8e2b2b,#5a1414)', chip: '#f2d06b', text: '#ffffff' },
        { id: 'spd',   name: '浦发银行',     bg: 'linear-gradient(135deg,#2f6fd6,#1c4a9e)', chip: '#f2d06b', text: '#ffffff' },
        { id: 'ccb',   name: '建设银行',     bg: 'linear-gradient(135deg,#23578f,#123056)', chip: '#f2d06b', text: '#ffffff' },
        { id: 'boc',   name: '中国银行',     bg: 'linear-gradient(135deg,#c0392b,#8a1f18)', chip: '#f2d06b', text: '#ffffff' },
        { id: 'icbc',  name: '工商银行',     bg: 'linear-gradient(135deg,#d34b3f,#9c2820)', chip: '#f2d06b', text: '#ffffff' },
        { id: 'black', name: '黑卡',         bg: 'linear-gradient(135deg,#3b4046,#0a0c0f)', chip: '#c9a24a', text: '#eaeaec' },
        { id: 'gold',  name: '金卡',         bg: 'linear-gradient(135deg,#e7c86a,#ad8a2e)', chip: '#fff3c4', text: '#3a2f10' },
        { id: 'gray',  name: '储蓄卡',       bg: 'linear-gradient(135deg,#3d434a,#22262b)', chip: '#d9d9df', text: '#ffffff' }
    ];
    var MAP = {};
    LIST.forEach(function (b) { MAP[b.id] = b; });

    function get(id) { return MAP[id] || MAP.gray; }
    function css(id) { var b = get(id); return { bg: b.bg, chip: b.chip, text: b.text, name: b.name }; }

    window.NanoBank = { list: LIST, get: get, css: css, DEFAULT: 'gray' };
})();
