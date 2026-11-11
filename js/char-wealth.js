(function () {
    'use strict';

    // ============================================================
    // 角色财富 / 消费画像
    // ------------------------------------------------------------
    // 目的：让「随机刷新」和「API 生成」都围绕同一个人设来写钱。
    //   · 学生：生活费、兼职、奖学金、红包、退款；不会出现项目尾款 / 分红 / 股权。
    //   · 家境一般的学生：余额、单笔消费、收入上限都会再压低一档。
    //   · 穷困：日结、临时工、泡面、公交；不会出现奢侈品 / 高档餐厅。
    //   · 富裕 / 顶级富豪：收入与消费场所必须匹配身价，不能写成普通学生。
    // ============================================================

    var TIERS = {
        ultra: {
            label: '顶级富豪',
            balance: [100000000, 2000000000],
            income: [500000, 50000000],
            expense: [10000, 2000000],
            incomePool: ['集团分红', '股权收益', '投资项目回款', '信托收益', '品牌代言费', '基金赎回'],
            expensePool: ['私人会所', '高尔夫球场', '慈善晚宴', '奢侈品专柜', '拍卖会', '高级餐厅', '酒店套房', '包机出行'],
            note: '你是顶级富豪，收入来自集团分红、股权、投资和信托等，消费场所与金额要匹配这个身价；不能出现“没钱、吃不起饭、挤公交”这种和身份冲突的细节。'
        },
        rich: {
            label: '富裕阶层',
            balance: [5000000, 80000000],
            income: [50000, 2000000],
            expense: [1000, 100000],
            incomePool: ['公司分红', '项目结款', '投资盈利', '工资入账', '版税收入', '品牌合作'],
            expensePool: ['商务宴请', '奢侈品专柜', '五星酒店', '头等舱机票', '高端餐厅', '健身私教', '进口超市', '音乐会门票'],
            note: '你属于富裕阶层，收入与消费要体面、宽裕；可以有较高的单笔支出，但不要像普通学生一样只花几十块。'
        },
        upper: {
            label: '城市中产',
            balance: [300000, 3000000],
            income: [8000, 100000],
            expense: [100, 20000],
            incomePool: ['工资入账', '项目奖金', '年终奖', '理财收益', '报销到账', '稿费'],
            expensePool: ['餐厅', '商场购物', '健身年卡', '旅行机票', '咖啡', '超市采购', '电影票', '打车'],
            note: '你是城市中产，收入和花销稳定，偶尔有奖金或大额消费，但不会天天挥霍。'
        },
        ordinary: {
            label: '普通工薪',
            balance: [10000, 300000],
            income: [3000, 30000],
            expense: [20, 8000],
            incomePool: ['工资入账', '加班费', '报销到账', '红包收入', '退款到账', '兼职收入'],
            expensePool: ['外卖', '超市采购', '地铁出行', '房租', '水电费', '咖啡', '电影票', '话费充值'],
            note: '你是普通工薪阶层，收入和消费都贴近日常生活，会计算房租、水电和日常开销。'
        },
        student: {
            label: '学生',
            balance: [800, 12000],
            income: [100, 2000],
            expense: [5, 300],
            incomePool: ['生活费', '兼职收入', '奖学金', '红包收入', '退款到账', '家教收入', '勤工俭学'],
            expensePool: ['食堂', '奶茶', '文具', '公交', '网购', '电影票', '话费充值', '水果'],
            note: '你还是学生，收入只可能是生活费、兼职、奖学金、红包、退款、家教等；绝对不能出现项目尾款、公司分红、股权收益、投资回报、年终奖、公司报销这类收入。消费以食堂、公交、奶茶、文具、网购为主。'
        },
        poor: {
            label: '经济拮据',
            balance: [100, 4000],
            income: [50, 800],
            expense: [3, 100],
            incomePool: ['日结工资', '兼职收入', '红包收入', '退款到账', '临时补助'],
            expensePool: ['泡面', '便利店', '公交', '话费充值', '馒头', '二手物品', '榨菜', '矿泉水'],
            note: '你经济拮据，收入不稳定，消费非常节省；绝不能出现大额项目结款、分红、股权、投资、奢侈品或高档餐厅，否则会严重 OOC。'
        }
    };

    // 学生 + 家境普通/偏紧时，再收紧一档，避免“学生随手买几千块东西”。
    var STUDENT_LOW = {
        balance: [300, 3000],
        income: [100, 1500],
        expense: [5, 150],
        incomePool: ['生活费', '兼职收入', '红包收入', '退款到账', '勤工俭学', '奖学金'],
        expensePool: ['食堂', '泡面', '公交', '文具', '话费充值', '水果', '二手书', '便利店'],
        note: '你家里经济条件一般/偏紧，生活费有限，花钱会算着来；兼职收入一般在一两千以内，不能随手买几千块的东西，也不能出现项目尾款、分红、股权、投资回报、年终奖、公司报销。'
    };

    // 明确“破产 / 负债 / 吃不起饭”时，再压到真正的拮据状态。
    var POOR_LOW = {
        balance: [10, 800],
        income: [50, 500],
        expense: [3, 50],
        incomePool: ['日结工资', '兼职收入', '红包收入', '退款到账', '临时补助'],
        expensePool: ['泡面', '馒头', '公交', '便利店', '话费充值', '榨菜', '矿泉水'],
        note: '你已经到了手头非常紧的地步，余额很少，消费只够维持基本生活；不能出现任何大额消费、项目结款、分红、股权、投资或奢侈品。'
    };

    var LOW_FAMILY_RE = /家境(不好|一般|普通|差|困难|贫寒|拮据|不咋好|不太好)|家庭(条件|经济|情况|背景).{0,10}(不好|一般|普通|差|困难|拮据|贫寒|不咋好|不太好)|普通家庭|工薪家庭|农村|小县城|单亲|父母.{0,10}(下岗|务农|打工|生病|残疾|收入不高)|家里.{0,6}(没钱|不富裕|条件一般|管得严)/;
    var RICH_FAMILY_RE = /家里.{0,6}(很有钱|有钱|富裕|条件很好|条件不错|不缺钱)|家境(优渥|富裕|很好|不错)|富二代|豪门|财阀|富家/;

    function hash32(s) {
        var h = 2166136261 >>> 0;
        s = String(s || '');
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return h >>> 0;
    }

    function textOf(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        try { return JSON.stringify(v); } catch (e) { return String(v); }
    }

    function hits(s, re) {
        var m = String(s || '').match(re);
        return m ? m.length : 0;
    }

    // 用打分代替「先到先得」：避免“富二代大学生”被识别成普通学生，
    // 也避免“学生兼职”被识别成穷人。
    function pickTier(persona, name) {
        var s = textOf(persona) + ' ' + textOf(name);

        var ultra = hits(s, /首富|财阀|王室|皇室|顶级豪门|超级富豪|亿万|千亿|百亿|身价.{0,6}亿|资产.{0,6}亿|富可敌国|商业帝国|财团|集团总裁|董事长|国际超模|顶流|影帝|影后|天王|天后/g) * 6;
        var rich = hits(s, /富二代|富家|富豪|富翁|继承人|老板|企业家|创始人|投资人|投行|合伙人|高管|总监|律师|医生|教授|知名作家|明星|歌手|演员|模特|网红|主播|飞行员/g) * 3;
        if (RICH_FAMILY_RE.test(s)) rich += 3;

        var poor = hits(s, /落魄|破产|欠债|负债|穷困潦倒|家道中落|被扫地出门|低保|特困|拾荒|流浪|吃不起|揭不开锅|家徒四壁/g) * 6;
        poor += hits(s, /贫穷|贫困|拮据|没钱|打工|服务员|便利店|外卖员|快递员|工地|流水线|小时工|日结|临时工/g) * 2;
        if (LOW_FAMILY_RE.test(s)) poor += 2;

        var student = hits(s, /学生|高中生|大学生|初中生|研究生|硕士|博士|大一|大二|大三|大四|高三|高二|高一|初三|校园|奖学金|生活费|宿舍|住校/g) * 4;
        var upper = hits(s, /中产|白领|设计师|工程师|建筑师|教师|老师|公务员|护士|会计|销售|客服|文员|自由职业|普通上班族|工薪/g) * 2;

        var scores = {
            ultra: ultra,
            rich: rich,
            poor: poor,
            student: student,
            upper: upper,
            ordinary: 1
        };
        var order = ['ultra', 'rich', 'poor', 'student', 'upper', 'ordinary'];
        var best = 'ordinary', bestScore = -1;
        for (var i = 0; i < order.length; i++) {
            var k = order[i];
            if (scores[k] > bestScore) { best = k; bestScore = scores[k]; }
        }
        return best;
    }

    function round2(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    function between(range, seed) {
        var a = Number(range[0]) || 0, b = Number(range[1]) || 0;
        if (b < a) { var t = a; a = b; b = t; }
        var f = (hash32(seed) % 100000) / 100000;
        return a + (b - a) * f;
    }

    function pickFrom(list, seed) {
        if (!Array.isArray(list) || !list.length) return '';
        return list[hash32(seed) % list.length];
    }

    function clamp(n, a, b) {
        n = Number(n) || 0;
        if (n < a) return a;
        if (n > b) return b;
        return n;
    }

    function profileFor(persona, name) {
        var text = textOf(persona) + ' ' + textOf(name);
        var tier = pickTier(persona, name);
        var t = TIERS[tier] || TIERS.ordinary;
        var lowFamily = !!(tier === 'student' && LOW_FAMILY_RE.test(text) && !RICH_FAMILY_RE.test(text));
        var veryPoor = !!(tier === 'poor' && /落魄|破产|欠债|负债|穷困潦倒|吃不起|低保|特困|家徒四壁|流浪|拾荒|揭不开锅/.test(text));
        var ranges = t;
        var note = t.note;
        if (lowFamily) {
            ranges = STUDENT_LOW;
            note = STUDENT_LOW.note;
        }
        if (veryPoor) {
            ranges = POOR_LOW;
            note = POOR_LOW.note;
        }
        var seed = text + '|' + tier + '|' + (lowFamily ? 'low' : 'normal') + '|' + (veryPoor ? 'verypoor' : '');
        return {
            version: 2,
            tier: tier,
            label: t.label,
            lowFamily: lowFamily,
            veryPoor: veryPoor,
            balance: Math.round(between(ranges.balance, seed + '|balance') * 100) / 100,
            incomeRange: ranges.income.slice(),
            expenseRange: ranges.expense.slice(),
            incomePool: ranges.incomePool.slice(),
            expensePool: ranges.expensePool.slice(),
            note: note,
            seed: seed,
            personaHash: hash32(text)
        };
    }

    function profileKey(chatId) {
        return 'nano_char_wealth_' + (chatId || 'default');
    }

    function saveProfile(chatId, profile) {
        try { localStorage.setItem(profileKey(chatId), JSON.stringify(profile)); } catch (e) {}
    }

    function readProfile(chatId) {
        try {
            var p = JSON.parse(localStorage.getItem(profileKey(chatId)) || 'null');
            if (p && p.tier && TIERS[p.tier]) {
                if (p.version !== 2) {
                    var t = TIERS[p.tier];
                    p.incomeRange = Array.isArray(p.incomeRange) ? p.incomeRange : t.income.slice();
                    p.expenseRange = Array.isArray(p.expenseRange) ? p.expenseRange : t.expense.slice();
                    p.incomePool = Array.isArray(p.incomePool) && p.incomePool.length ? p.incomePool : t.incomePool.slice();
                    p.expensePool = Array.isArray(p.expensePool) && p.expensePool.length ? p.expensePool : t.expensePool.slice();
                    p.version = 2;
                }
                return p;
            }
        } catch (e) {}
        return null;
    }

    function promptBlock(profile) {
        if (!profile) return '';
        var p = profile;
        var extra = p.lowFamily ? '\n特别注意：角色家里经济条件一般/偏紧，消费必须克制，不能出现几千元的随手购物。' : '';
        if (p.veryPoor) extra += '\n特别注意：角色目前经济非常拮据，余额很少，只能维持基本生活，不能出现任何大额消费或投资类收入。';
        return '【财富与消费 · 必须符合身份】\n' +
            '你的财富阶层：' + p.label + '；银行卡余额约 ¥' + Number(p.balance || 0).toFixed(2) + '。\n' +
            p.note + extra + '\n' +
            '合理收入来源：' + (p.incomePool || []).join('、') + '。\n' +
            '合理消费场景：' + (p.expensePool || []).join('、') + '。\n' +
            '无论聊天、转账、亲属卡、查手机钱包还是商城消费，金额和收入类型都必须与这个身份一致，绝不能 OOC。';
    }

    var FORBIDDEN_INCOME = {
        ultra: /日结|生活费|泡面|助学金|低保/,
        rich: /日结|生活费|泡面|助学金|低保|临时补助/,
        upper: /项目尾款|股权收益|信托收益|品牌代言|私人飞机|游艇/,
        ordinary: /项目尾款|股权收益|信托收益|品牌代言|集团分红|私人飞机|游艇/,
        student: /项目结款|项目尾款|公司分红|分红|股权|投资回报|投资盈利|信托|代言|版税|年终奖|公司报销|融资|工资入账/,
        poor: /项目结款|项目尾款|公司分红|分红|股权|投资回报|投资盈利|信托|代言|版税|年终奖|公司报销|融资|工资入账|五险一金/
    };

    var FORBIDDEN_EXPENSE = {
        ultra: /泡面|食堂|公交|合租|二手/,
        rich: /泡面|食堂|公交|合租|二手/,
        upper: /私人飞机|游艇|慈善晚宴|拍卖会/,
        ordinary: /私人飞机|游艇|慈善晚宴|拍卖会|奢侈品专柜/,
        student: /私人飞机|游艇|慈善晚宴|拍卖会|奢侈品专柜|五星酒店|头等舱|高尔夫|高级餐厅|商务宴请|买房|买车|珠宝|名表|游艇/,
        poor: /私人飞机|游艇|慈善晚宴|拍卖会|奢侈品专柜|五星酒店|头等舱|高尔夫|高级餐厅|商务宴请|商场购物|健身年卡|旅行机票|买房|买车|珠宝|名表/
    };

    // 穷人/学生如果生成了明显不属于自己的高消费场所，直接换成合理场景。
    var EXPENSIVE_DESC_RE = /奢侈品|专柜|五星|酒店|头等舱|高尔夫|私人会所|拍卖|慈善晚宴|豪车|名表|珠宝|游艇|包机|高级餐厅|商务宴请/;
    var CHEAP_DESC_RE = /泡面|食堂|公交|地铁|便利店|馒头|二手|话费充值/;

    function moneyRound(v, tier) {
        v = Number(v) || 0;
        if (tier === 'ultra') return Math.max(1, Math.round(v / 1000) * 1000);
        if (tier === 'rich') return Math.max(1, Math.round(v / 100) * 100);
        if (tier === 'upper' || tier === 'ordinary') return Math.max(1, Math.round(v / 10) * 10);
        if (tier === 'student') return v < 100 ? round2(Math.round(v * 2) / 2) : Math.max(5, Math.round(v / 5) * 5);
        return v < 20 ? round2(Math.round(v * 2) / 2) : Math.max(1, Math.round(v));
    }

    function skewedAmount(range, tier) {
        var a = Number(range[0]) || 0, b = Number(range[1]) || 0;
        if (b < a) { var t = a; a = b; b = t; }
        var r = Math.random();
        var pow = (tier === 'poor' || tier === 'student') ? 2.2 : (tier === 'ordinary' || tier === 'upper') ? 1.7 : 1.3;
        return a + Math.pow(r, pow) * (b - a);
    }

    // 不同消费/收入名目有各自的常见价格区间。
    // 例如“食堂 135 元”“音乐会门票 8 万”这种一眼假的组合，会被拉回合理范围。
    var TYPICAL = {
        '房租': [400, 3000], '水电费': [30, 200], '话费充值': [10, 100], '超市采购': [30, 300],
        '商场购物': [100, 3000], '咖啡': [15, 60], '奶茶': [8, 30], '食堂': [6, 25],
        '泡面': [3, 15], '公交': [2, 8], '地铁': [3, 10], '打车': [10, 80],
        '电影票': [25, 80], '外卖': [12, 60], '文具': [3, 50], '水果': [8, 40],
        '二手书': [5, 40], '便利店': [5, 40], '馒头': [1, 8], '榨菜': [1, 6],
        '矿泉水': [1, 5], '二手物品': [10, 100], '健身年卡': [500, 3000],
        '旅行机票': [300, 3000], '进口超市': [100, 800], '音乐会门票': [200, 3000],
        '头等舱机票': [1000, 15000], '五星酒店': [800, 8000], '高端餐厅': [300, 5000],
        '商务宴请': [1000, 20000], '奢侈品专柜': [3000, 80000], '私人会所': [5000, 100000],
        '高尔夫球场': [2000, 50000], '慈善晚宴': [10000, 500000], '拍卖会': [10000, 1000000],
        '酒店套房': [2000, 50000], '包机出行': [50000, 1000000], '高级餐厅': [500, 10000],

        '工资入账': [3000, 30000], '加班费': [100, 1000], '报销到账': [50, 3000],
        '红包收入': [10, 500], '退款到账': [10, 500], '兼职收入': [100, 2000],
        '生活费': [500, 2000], '奖学金': [500, 5000], '家教收入': [100, 1500],
        '勤工俭学': [100, 1000], '日结工资': [50, 300], '临时补助': [50, 500],
        '项目奖金': [1000, 20000], '年终奖': [3000, 100000], '理财收益': [100, 20000],
        '稿费': [100, 5000], '公司分红': [10000, 500000], '项目结款': [10000, 500000],
        '投资盈利': [5000, 500000], '版税收入': [1000, 100000], '品牌合作': [5000, 500000],
        '集团分红': [1000000, 50000000], '股权收益': [1000000, 50000000],
        '投资项目回款': [1000000, 50000000], '信托收益': [1000000, 50000000],
        '品牌代言费': [1000000, 50000000], '基金赎回': [100000, 50000000]
    };

    function amountForDesc(desc, profile, type) {
        var tierRange = type === 'income' ? profile.incomeRange : profile.expenseRange;
        var range = TYPICAL[desc];
        if (!range) return skewedAmount(tierRange, profile.tier);
        var lo = Math.max(range[0], tierRange[0]);
        var hi = Math.min(range[1], tierRange[1]);
        if (hi <= lo) {
            // 名目的常见区间和阶层区间没有交集时（如富人工资），
            // 以阶层下限为基准给一个不超过 3 倍的合理区间。
            lo = tierRange[0];
            hi = Math.min(tierRange[1], Math.max(lo * 3, lo + 1));
        }
        return skewedAmount([lo, hi], profile.tier);
    }

    function pickUnique(pool, used, seed) {
        if (!Array.isArray(pool) || !pool.length) return '';
        for (var i = 0; i < pool.length * 3; i++) {
            var d = pickFrom(pool, seed + '|' + i + '|' + Math.random());
            if (!used[d]) { used[d] = 1; return d; }
        }
        return pickFrom(pool, seed + '|' + Math.random());
    }

    // 保证一批流水里的支出不会超过「当前余额 + 这批收入」，
    // 避免出现“卡里几百块，流水却花了三千”的假数据。
    function capExpenses(out, p, currentBalance) {
        var balance = Number(currentBalance);
        if (!Number.isFinite(balance)) return out;
        var incomeSum = 0, expenseSum = 0;
        out.forEach(function (t) {
            if (t.type === 'income') incomeSum += Number(t.amount) || 0;
            else expenseSum += Number(t.amount) || 0;
        });
        var spendable = Math.max(0, balance) + incomeSum;
        if (expenseSum <= spendable || expenseSum <= 0) return out;
        var factor = spendable <= 0 ? 0 : Math.max(0.05, Math.min(1, spendable / expenseSum));
        out.forEach(function (t) {
            if (t.type !== 'expense') return;
            var floor = p.tier === 'poor' ? 1 : (p.tier === 'student' ? 2 : 5);
            t.amount = round2(Math.max(floor, moneyRound(t.amount * factor, p.tier)));
        });
        return out;
    }

    function sanitizeTransactions(profile, txs, opts) {
        var p = profile || profileFor('', '');
        opts = opts || {};
        var fin = FORBIDDEN_INCOME[p.tier] || FORBIDDEN_INCOME.ordinary;
        var fex = FORBIDDEN_EXPENSE[p.tier] || FORBIDDEN_EXPENSE.ordinary;
        var out = [];
        var usedIn = {}, usedOut = {};
        (Array.isArray(txs) ? txs : []).forEach(function (t, i) {
            if (!t || typeof t !== 'object') return;
            var type = t.type === 'income' ? 'income' : 'expense';
            var desc = String(t.desc || t.name || '').trim();
            var amount = round2(t.amount);
            if (!(amount > 0)) return;
            var seed = p.seed + '|' + i + '|' + desc + '|' + amount + '|' + Math.random();
            var range = type === 'income' ? p.incomeRange : p.expenseRange;
            if (type === 'income' && fin.test(desc)) desc = pickUnique(p.incomePool, usedIn, seed);
            if (type === 'expense' && fex.test(desc)) desc = pickUnique(p.expensePool, usedOut, seed);
            if (type === 'expense' && (p.tier === 'student' || p.tier === 'poor') && EXPENSIVE_DESC_RE.test(desc)) {
                desc = pickUnique(p.expensePool, usedOut, seed);
            }
            if (type === 'expense' && (p.tier === 'rich' || p.tier === 'ultra') && CHEAP_DESC_RE.test(desc) && !/公交|地铁/.test(desc)) {
                desc = pickUnique(p.expensePool, usedOut, seed);
            }
            if (!desc) desc = pickUnique(type === 'income' ? p.incomePool : p.expensePool, type === 'income' ? usedIn : usedOut, seed);
            amount = round2(clamp(amount, range[0], range[1]));
            if (p.lowFamily && type === 'income') amount = Math.min(amount, 1500);
            if (p.tier === 'student' && type === 'income') amount = Math.min(amount, 2000);
            if (p.tier === 'poor' && type === 'income') amount = Math.min(amount, 800);
            out.push({
                id: t.id || ('ctx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
                type: type,
                amount: amount,
                desc: desc,
                time: t.time || t.date || new Date().toISOString()
            });
        });
        out.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
        capExpenses(out, p, opts.balance);
        return out;
    }

    // 随机刷新：不调用 API，但必须和 API 一样符合人设。
    // opts.balance 传入当前余额时，会保证这一批流水不会把余额刷成负数。
    function randomWalletTransactions(profile, count, charName, opts) {
        var p = profile || profileFor('', '');
        opts = opts || {};
        var n = Math.max(1, Math.min(30, Number(count) || 10));
        var currentBalance = Number(opts.balance);
        if (!Number.isFinite(currentBalance)) currentBalance = Number(p.balance) || 0;

        var incomeRatio = p.tier === 'poor' ? 0.2 : p.tier === 'student' ? 0.25 : 0.25;
        var incomeCount = Math.max(1, Math.round(n * incomeRatio));
        if (p.tier === 'rich' || p.tier === 'ultra') incomeCount = Math.max(1, Math.round(n * 0.2));
        var types = [];
        for (var i = 0; i < n; i++) types.push(i < incomeCount ? 'income' : 'expense');
        // 打散收支顺序，避免“前几条全是收入”这种一眼假
        for (var j = types.length - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1));
            var tmp = types[j]; types[j] = types[k]; types[k] = tmp;
        }

        var usedIn = {}, usedOut = {};
        var out = [];
        var now = Date.now();
        var incomeSum = 0, expenseSum = 0;

        for (var idx = 0; idx < n; idx++) {
            var type = types[idx];
            var seed = p.seed + '|tx|' + now + '|' + idx + '|' + Math.random();
            var pool = type === 'income' ? p.incomePool : p.expensePool;
            var range = type === 'income' ? p.incomeRange : p.expenseRange;
            var desc = pickUnique(pool, type === 'income' ? usedIn : usedOut, seed);
            var amount = moneyRound(amountForDesc(desc, p, type), p.tier);
            amount = round2(clamp(amount, range[0], range[1]));
            if (p.lowFamily && type === 'income') amount = Math.min(amount, 1500);
            if (p.tier === 'student' && type === 'income') amount = Math.min(amount, 2000);
            if (p.tier === 'poor' && type === 'income') amount = Math.min(amount, 800);

            // 时间落在最近 7 天，收入偏上午，消费偏中午/晚上。
            var dayAgo = Math.random() * 7;
            var hour = type === 'income' ? (8 + Math.random() * 4) : (9 + Math.random() * 13);
            var ts = now - dayAgo * 86400000;
            var d = new Date(ts);
            d.setHours(Math.floor(hour), Math.floor(Math.random() * 60), 0, 0);
            if (d.getTime() > now) d = new Date(now - Math.random() * 3600000);

            if (type === 'income') incomeSum += amount;
            else expenseSum += amount;
            out.push({
                id: 'ctx_' + now + '_' + Math.random().toString(36).slice(2, 7),
                type: type,
                amount: amount,
                desc: desc,
                time: d.toISOString()
            });
        }

        // 如果这批支出会超过「当前余额 + 这批收入」，按比例压到能承受的范围。
        // 尤其是学生 / 穷人，不能出现“卡里几百块，流水花了三千”的情况。
        capExpenses(out, p, currentBalance);

        out.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
        return out;
    }

    function seedChar(chatId, persona, name) {
        var profile = profileFor(persona, name);
        saveProfile(chatId, profile);
        return profile;
    }

    window.NanoCharWealth = {
        tiers: TIERS,
        profileFor: profileFor,
        promptBlock: promptBlock,
        sanitizeTransactions: sanitizeTransactions,
        randomWalletTransactions: randomWalletTransactions,
        saveProfile: saveProfile,
        readProfile: readProfile,
        seedChar: seedChar,
        profileKey: profileKey
    };
})();
