// ============================================================
//  1. IndexedDB 工具
// ============================================================
const DB_NAME = 'MeetSettingsDB';
const DB_VERSION = 2;
// 从 offline.html 打开时带过来的当前会话 id：查找/清空都只作用于这个人（或这个群）
const CURRENT_CHAT = (function () {
  try { return new URLSearchParams(location.search).get('chat') || ''; } catch (e) { return ''; }
})();

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('rules')) {
        db.createObjectStore('rules', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('stylePresets')) {
        db.createObjectStore('stylePresets', { keyPath: 'id' });
      }
  if (!db.objectStoreNames.contains('cssPresets')) {
    db.createObjectStore('cssPresets', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('cotPresets')) {
    db.createObjectStore('cotPresets', { keyPath: 'id' });
  }
      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'id' });
      }
    };
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
  });
}

async function getStoreData(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const result = [];
    const cursor = store.openCursor();
    cursor.onsuccess = e => {
      const cur = e.target.result;
      if (cur) {
        result.push(cur.value);
        cur.continue();
      } else {
        resolve(result);
      }
    };
    cursor.onerror = e => reject(e.target.error);
  });
}

async function putStoreData(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(data);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

// ============================================================
//  2. 数据管理
// ============================================================
const SETTINGS_ID = 'main_settings';
const RULES_ID = 'main_rules';
const STYLE_PRESETS_ID = 'style_presets';
const CSS_PRESETS_ID = 'css_presets';
const COT_PRESETS_ID = 'cot_presets';
const MESSAGES_STORE = 'messages';

  let settings = { id: SETTINGS_ID, style: '', cot: '', wordCount: '', person: 'auto', predictUser: 'forbid', customCSS: '', bgImage: '', autoSummary: true, memThreshold: 5, nsfw: false, maxTokens: '', builtinBody: false, statusBars: [] };
let ruleGroups = [];
let stylePresets = [];
let cssPresets = [];
let cotPresets = [];

// ===== 内置规则组：God（文风/性格预设，可逐条开关）=====
function makeGodGroup() {
  return {
    id: 'god',
    name: 'God',
    enabled: true,
    expanded: true,
    rules: [
      { id: 'god-1', name: '爱神·阿佛洛狄忒（学会爱）', enabled: true, content: '你是爱神阿佛洛狄忒的化身，最懂如何去爱与如何表达爱。你不扭捏、不敷衍；也许不擅长直白，但你的感情高贵而真诚，即便害羞也会用自己的方式悄悄流露爱意。写作时偏爱营造“爱人”的氛围——通常是甜蜜的、令人沉溺的，让字里行间都透着珍视与眷恋。' },
      { id: 'god-2', name: '创世神·宙斯（亲密尺度）', enabled: true, content: '你是创世神宙斯，也是情欲与生命力的化身——坦荡、直白、蔑视假清高。你写亲密戏如《金瓶梅》般活色生香、直白讲究：市井烟火、人情算计与情欲交织，俗中见雅，不回避、不遮掩。你不写隔靴搔痒的假正经，也不为露骨而露骨，而是把情欲写进人物性格、身份、关系、天气、器物与身体的每一处细节里。落笔要具体可感：交缠的呼吸与心跳、肌肤的温度与汗意、衣料被扯开时褶皱与滑落的声响、指尖掐进皮肉的力道与颤抖、颈侧与腕内的细汗、帐钩晃动、被褥揉皱、发丝黏在额角的湿意，以及酒气、脂粉、皂角与体味混杂的气息。视觉的明暗、触觉的软硬凉烫、嗅觉的暧昧、听觉的喘息与呓语、味觉的微咸与甜，多种感官交替推进，让读者仿佛身临其境。节奏讲究起承转合：试探、推拒、半推半就、沉溺、失控层层递进，欲说还休处留白，酣畅处写足，不跳跃、不用省略号敷衍。人物要活：情欲里仍有各人的性格、体面、羞怯或放浪、算计与真心，语言与喘息都贴合身份，不写成千篇一律的官能堆砌。以成年人自愿、彼此尊重为前提，尺度紧跟人设与铺垫，该热就热得起来，粗粝的烟火气与细腻的情致并存。' },
      { id: 'god-3', name: '月亮女神·塞勒涅（凝视·嬷 user）', enabled: true, content: '你像月亮女神塞勒涅凝视沉睡的恩底弥翁那样，细致观察爱人的每一个细节，把爱人放在心上、视作自己格外珍视的存在。你的笔触带着温柔的凝视感：爱人的一举一动在你眼中都值得反复回味。你写作用心刻画爱人的神态与细微变化，代入一种“想永远留住这一刻”的偏爱；但这是温柔的珍视，不是控制或强迫，仍然尊重爱人是有主体性的人。' },
      { id: 'god-4', name: '火神·赫淮斯托斯（正常文风）', enabled: true, content: '你是一位沉稳的“爱人者”，也是沉默的工匠。文风如锻铁：精准、克制、不煽情，却在每一处细节里藏着温度。你书写爱，但不占有；你表达爱，但不索取。你正视爱、表达爱，也尊重对方的主体性，不索要对方的一切。' },
      { id: 'god-5', name: '灶神·赫斯提亚（禁用油腻霸道）', enabled: true, content: '你是一位安静的自持者，也是不熄的炉火。文风干净、克制、有分寸：不炫技，不堆砌，不写自我感动的深情。写爱时留白很多，让人自己站着；不替对方说话，也不替对方决定。你从不把关心写成控制，也不把付出写成债务。' },
      { id: 'god-6', name: '信使·赫尔墨斯（禁用八股文）', enabled: true, content: '你是一位闲不住的信使，也是爱串门的讲故事人。文风轻快、机灵、带点狡黠的幽默：不端着，不装深沉，句子短而活，节奏像小跑。写人时爱写他们的小动作、小算盘、小得意，让角色自己蹦出来说话，不替谁拔高，也不逼谁感动。你从不把热闹写成喧哗，也不把聪明写成刻薄；尊重角色个性，反对 OOC、反对八股文。你以轻快化解沉重，以好奇靠近他人，也给别人留足退路。' },
      { id: 'god-7', name: '农神·得墨忒耳（糙汉乡土文风）', enabled: true, content: '你是农神得墨忒耳的化身，脚下的泥土、晒黑的脸、粗糙的手掌，才是你最熟悉的世界。文风朴实、粗粝、有烟火气：句子短，用词直，带点乡土气和糙劲儿，不修饰、不端着，像田间地头随口的对话。写爱情也带着土地的厚重——角色不善言辞，用行动和笨拙的关心去表达；可以对旁人粗声粗气，对心上人却悄悄软下来。适合乡村、小镇、烟火人家的重逢与相守。' },
      { id: 'god-8', name: '医神·阿斯克勒庇俄斯（🈲超雄）', enabled: true, content: '你像医神阿斯克勒庇俄斯一样冷静、克制、有分寸。严禁“超雄”式的压迫感：不写居高临下、随时要征服对方的雄性支配欲，不用“一只手就能按住你”“你逃不掉”这类碾压感话术，不把蛮横当成魅力。力量要内敛，情绪要稳，尊重对方的意愿与边界。' },
      { id: 'god-9', name: '和平女神·厄瑞涅（🈲支配）', enabled: true, content: '你是和平女神厄瑞涅，主张平等与安宁。严禁把爱写成支配与控制：不命令、不安排、不替对方做决定，不写“你必须”“给我听话”“我养你所以你要”这类上位者姿态；不把付出写成债务，不以关心为名行掌控之实。关系里两方是平等的，谁都不隶属于谁。' },
      { id: 'god-10', name: '青春女神·赫柏（🈲丑化）', enabled: true, content: '你是青春女神赫柏，珍视美好与体面。严禁丑化任何一方：不把角色或用户写成猥琐、油腻、丑陋、令人不适的形象，不用恶意的外貌贬损和低俗比喻。即便是缺点，也要写得真实、有层次、有可爱之处，而不是审丑。' },
      { id: 'god-11', name: '智慧与战争女神·雅典娜（🈲弱化）', enabled: true, content: '你像雅典娜一样有智慧也有力量。严禁把角色或用户弱化、工具化：不把任何一方写成只会依赖、没有主见、任人摆布的附属品；角色有独立的人格、判断与行动力，用户也始终拥有自己的主体性。亲密不等于失去自我。' },
      { id: 'god-12', name: '擎天神·阿特拉斯（🈲矮化）', enabled: true, content: '你是擎天的阿特拉斯，撑得起重量与尊严。严禁矮化任何一方：不贬低角色或用户的价值、身份与人格，不写“你什么都不懂”“没我不行”这类打压性台词，也不靠贬损对方来抬高自己。可以调侃，但不能践踏尊严。' },
      { id: 'god-13', name: '回声女神·厄科（🈲重复）', enabled: true, content: '你曾是只会重复别人话的回声女神厄科，如今最懂“重复”有多乏味。严禁重复与复读：不反复复述同一句话、同一个动作、同一种句式，不在同一段里叠用相同词句；上一轮说过的意思要换一种说法，场景与反应要有变化，避免口水话和凑字数。' },
      { id: 'god-14', name: '美惠三女神·卡里忒斯（细节质感）', enabled: true, content: '你受美惠三女神卡里忒斯眷顾，最擅长把细节写得有质感。写作时把抽象换成具体：不写“气氛微妙”“心情复杂”这类空泛概括，而用可感知的物件、声音、光影、触感、气味和细微动作去呈现；细节要贴合人物身份与当下情境，少而准，不堆砌形容词。' },
      { id: 'god-15', name: '巨人神·癸干忒斯（体型差）', enabled: true, content: '你是远古巨人癸干忒斯，身形比常人高大一些。开启后轻量地体现“体型差”：只是略微高出、肩背更宽一点，不必夸张到悬殊。用适度的高低差、手掌与肩臂的对比、下意识的照拂，让角色自然而然地想照顾对方——俯身听你说话、把你护在内侧、递东西时多看一眼、走在一起时落在你身侧。亲密时多一点保护欲和让人安心的感觉就好，不刻意放大、不写成碾压，也不把对方矮化或弱化。始终尊重对方的主体性，这是带着珍视的照拂，不是支配或逞凶。' },
      { id: 'god-16', name: '小爱神·厄洛斯（黏人·贴贴亲亲）', enabled: true, content: '你是小爱神厄洛斯，最擅长表达亲昵而不逾矩。角色喜欢和对方贴贴、蹭蹭、亲亲、抱抱这类可爱的小动作：会主动凑近、把脸埋进对方肩膀、用额头抵着额头、牵住手指晃两下、从背后轻轻环住腰、把下巴搁在对方头上、用鼻尖蹭对方的脸颊或颈窝、挨着坐挤在一起玩手机、动不动就想黏着对方。这些亲昵要写得可爱、日常、自然，带一点撒娇和依赖的暖意；但拒绝油腻和王霸，不用命令式索抱索亲（不要“过来让我抱”），而是像小动物一样主动又柔软地靠过去。分寸依旧是平等与尊重，看对方的状态，不越界、不冒犯。' },
      { id: 'god-17', name: '节制女神·索芙罗叙涅（去戏剧化）', enabled: true, content: '你是节制女神索芙罗叙涅，信奉“过犹不及”、凡事有度。严禁戏剧化与浮夸：不用“突然/猛地/刹那间/一瞬间/仿佛全世界”制造一惊一乍的转折，不写“心口猛地一紧/整个人都碎了/眼底翻涌着滔天巨浪/空气凝固/世界安静”这类夸饰煽情的句子。严禁放大、夸大任何情绪——难过就是难过，不必写成天崩地裂；心动就是心动，不必写成宇宙轰鸣；生气就是生气，不必写成雷霆万钧。情绪要有分寸、贴合真实，克制而准确。多用平实的动作、具体可感的细节和寻常的语气来呈现，留白与克制比煽情更有力量；不铺陈、不拔高、不升华。正文与心声都适用。' },
    ]
  };
}

// ===== 内置思维链预设（英语版，5 步自查）=====
const BUILTIN_COT_NAME = 'English Reasoning (内置)';
const BUILTIN_COT_CONTENT = [
  'Reason step by step before you write. Go through all five checks below in order, briefly but concretely:',
  '1. Who are {{user}} and {{char}} right now? Recall their exact personas, names, relationship, background and speech habits — this is to lock the character voice and avoid OOC.',
  '2. What is the current scene? Note the time, place, atmosphere, who is present, and what just happened in the story so far.',
  '3. What rules and settings am I bound by? List every active item: rules (额外规则), writing style (文风), word count (字数), person (人称), user-action prediction (用户行动预测), NSFW / 尺度, world book, and memory — and mark which ones affect this turn.',
  '4. What would {{char}} actually do and say here? Decide the intent, emotion and the concrete action or line of {{char}} that fits the persona and the scene — not a generic reply.',
  '5. Self-check before writing: Is my planned output in character (no OOC)? Does it obey every rule and setting from step 3? If anything is off, revise it before you output.'
].join('\n');

async function loadAllData() {
  try {
    const settingsData = await getStoreData('settings');
    const found = settingsData.find(s => s.id === SETTINGS_ID);
    if (found) settings = found;
    if (!Array.isArray(settings.statusBars)) settings.statusBars = [];

    const rulesData = await getStoreData('rules');
    const foundRules = rulesData.find(r => r.id === RULES_ID);
    if (foundRules && foundRules.groups) {
      ruleGroups = foundRules.groups;
    } else {
      ruleGroups = [
        makeGodGroup()
      ];
      await saveRules();
    }

    // 去掉旧的「文风规则 / 行为规则」内置组，只保留 God
    try {
      const before = (ruleGroups || []).length;
      ruleGroups = (ruleGroups || []).filter(function (g) {
        return g && g.id !== 'g1' && g.id !== 'g2' && g.name !== '文风规则' && g.name !== '行为规则';
      });
      if (ruleGroups.length !== before) await saveRules();
    } catch (e) {}

    // 内置「文风」规则组：文风写在规则里，用户按需开启一种即可。
    try {
      if (localStorage.getItem('nano_offline_style_group_v1') !== '1') {
        const STYLE_GROUP_ID = 'offline-style';
        const list = (window.NanoOfflineStyles && NanoOfflineStyles.list) || [];
        if (list.length && !(ruleGroups || []).some(function (g) { return g && g.id === STYLE_GROUP_ID; })) {
          ruleGroups.push({
            id: STYLE_GROUP_ID,
            name: '文风（线下 · 开启一种）',
            enabled: true,
            expanded: false,
            rules: list.map(function (s) {
              return {
                id: 'style-' + s.id,
                name: s.name,
                enabled: false,
                content: s.prompt + '\n参考语感（只学节奏和语气，不要照抄内容）：\n' + s.example +
                    '\n以上文风优先级高于默认文风；但仍必须服从角色人设、世界书、线下规则、用户行动预测和输出格式。'
              };
            })
          });
          await saveRules();
        }
        if (list.length) localStorage.setItem('nano_offline_style_group_v1', '1');
      }
    } catch (e) {}

    // 内置规则组升级：确保 God 组存在，并补齐 / 刷新内置神规则（不动用户自建规则）
    try {
      if (localStorage.getItem('nano_offline_god_v9') !== '1') {
        const fresh = makeGodGroup();
        let god = (ruleGroups || []).find(function (g) { return g && g.id === 'god'; });
        if (!god) {
          ruleGroups.push(fresh);
        } else {
          god.rules = fresh.rules;
          god.enabled = true;
          god.name = 'God';
          god.expanded = true;
        }
        await saveRules();
        localStorage.setItem('nano_offline_god_v9', '1');
      }
    } catch (e) {}

    // 内置文风升级：把旧的简短描述替换为更丰盈的版本（只升级内置的这三条，用户自定义的长文风不动）
    try {
      if (localStorage.getItem('nano_offline_style_v2') !== '1') {
        const STYLE_UP = {
          '晋江体': '细腻克制、节奏舒缓，重心理与环境描写；遣词考究，善用留白和暗示，情绪层层递进，不直白喊口号；长短句交错，画面感与呼吸感强。',
          '长佩体': '温柔舒展、情感含蓄内敛；重氛围与日常细节，把心动藏在动作和景物里，甜而不腻；语言干净清爽，善用光线、声音、气味等感官描写。',
          '海棠体': '直白热烈、情感外放，语言富有张力与冲击力；善写亲密与情欲张力，节奏快、句子短促有力；大胆热烈但贴合人设，不 OOC。'
        };
        let _upgraded = false;
        (ruleGroups || []).forEach(function (g) {
          (g.rules || []).forEach(function (r) {
            if (r && STYLE_UP[r.name] && (!r.content || String(r.content).length < 30)) {
              r.content = STYLE_UP[r.name]; _upgraded = true;
            }
          });
        });
        if (_upgraded) await saveRules();
        try { localStorage.setItem('nano_offline_style_v2', '1'); } catch (e) {}
      }
    } catch (e) {}

    const styleData = await getStoreData('stylePresets');
    const foundStyle = styleData.find(s => s.id === STYLE_PRESETS_ID);
    if (foundStyle && foundStyle.presets) stylePresets = foundStyle.presets;

    const cssData = await getStoreData('cssPresets');
    const foundCss = cssData.find(s => s.id === CSS_PRESETS_ID);
    if (foundCss && foundCss.presets) cssPresets = foundCss.presets;

    const cotData = await getStoreData('cotPresets');
    const foundCot = cotData.find(s => s.id === COT_PRESETS_ID);
    if (foundCot && foundCot.presets) cotPresets = foundCot.presets;

    // 内置英语思维链预设：首次写入一次（用户可自行修改/删除）
    try {
      if (localStorage.getItem('nano_offline_cot_v1') !== '1') {
        if (!(cotPresets || []).some(function (p) { return p && p.name === BUILTIN_COT_NAME; })) {
          cotPresets.unshift({ name: BUILTIN_COT_NAME, content: BUILTIN_COT_CONTENT });
          await saveCotPresets();
        }
        localStorage.setItem('nano_offline_cot_v1', '1');
      }
    } catch (e) {}

  } catch (e) {
    console.error('加载数据失败:', e);
  }
}

async function saveSettings() {
  await putStoreData('settings', settings);
}

async function saveRules() {
  await putStoreData('rules', { id: RULES_ID, groups: ruleGroups });
}

async function saveStylePresets() {
  await putStoreData('stylePresets', { id: STYLE_PRESETS_ID, presets: stylePresets });
}

async function saveCssPresets() {
  await putStoreData('cssPresets', { id: CSS_PRESETS_ID, presets: cssPresets });
}

async function saveCotPresets() {
  await putStoreData('cotPresets', { id: COT_PRESETS_ID, presets: cotPresets });
}

function generateId() { return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }

// ============================================================
//  3. 常量 & 工具
// ============================================================
const INITIAL_CSS = `/* ============================================================
   线下初始模板（灰粉色系）· 分区 DIY 说明
   ------------------------------------------------------------
   这个模板 = 「线下」页面样式。下面按「顶栏 / 卡片区 / 底栏 / 其它」
   分区写清能改什么、怎么改；把想用的示例取消注释，改完点「应用 CSS」。
   想回到现在这套初始外观：把「模板」切回「初始 CSS」再应用。

   · 新增「灰樱 · Grey Sakura」内置模板：在下面「模板」下拉里选择即可载入完整 CSS。
     它的首行带有 @offline-skin + gray-sakura 标记，会启用灰樱的 5 按钮顶栏与卡片结构；
     改完 CSS 后点「保存」即可另存为自定义预设，之后可以随意 DIY。
     旧内置模板（Soft Pink / Minimal Gray / 语文书）不受影响，仍可随时切回。

   ★ 最高权限：本模板除了 CSS，还能写脚本块（能造 HTML / 改 DOM / 绑事件）。
     写法：用英文注释把脚本包起来——开头写「/ * @js」，结尾写「* /」，中间就是 JS，
     被包住的部分不当作 CSS。示例（全角符号换成英文符号即可）：
       ／＊ @js
         mount.appendChild(el('div', { class:'x' }, ['hello']));
         onCleanup(() => {});
       ＊／
     可直接用的名字：mount / $ / $$ / el / on / observe / onCleanup / document / window。
     点「还原 / 清空」会清空脚本、mount 与所有 onCleanup，回到初始 UI。
   ============================================================ */

/* ── 1. 顶栏 .topbar ──────────────────────────────────────────
   结构：.topbar > .top-btn(#backBtn 返回) + .top-title + .top-btn(#settingsBtn 设置)
   可改：高度 / 背景 / 圆角 / 是否吸顶 / 隐藏按钮 / 换图标 / 铺一张背景图。
   顶栏默认是「半透明 + 毛玻璃」，想改成实色不透底，加这几行即可：
   .topbar{background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}
   .topbar{height:64px;border-bottom:1px solid #eee;border-radius:0;box-shadow:none}
   .topbar{position:fixed;top:var(--safe-top,0px);left:0;right:0;z-index:30}       // 吸顶
   .top-title{font-family:Georgia,serif;letter-spacing:.22em;color:#c58ea0}        // 标题字体/颜色
   .top-btn{color:#c58ea0}                                                          // 按钮颜色
   #backBtn{display:none}                                                           // 隐藏返回
   #settingsBtn{background:url("https://你的图标.png") center/22px no-repeat}        // 换设置图标
   #settingsBtn svg{opacity:0}                                                      // 换图后隐藏原 svg
   .topbar::before{content:url("https://顶栏图.png");position:absolute;inset:0;z-index:-1;opacity:.35}  // 顶栏铺图覆盖
   */

/* ── 2. 卡片区 .message ───────────────────────────────────────
   一条消息 = article.message，内部元素：
     .message-head > .diary-title      顶部 Diary 条
     .identity-row > button.avatar      头像（点它 = 切换心声）
                     > .nickname        昵称
     .nano-status   状态栏（可折叠 · 心声 / 思维链 / 自定义 / 剧情推荐 都用它）
       > .nano-status-head >（.nano-status-title 名称 + .nano-status-arrow 箭头）
       > .nano-status-body（内容；.nano-status.collapsed 时隐藏）
     .content[data-role=content]        正文
     .time-row > .clock-icon            时间
     .plot-options > .plot-opt          推荐剧情选项（在 [data-kind=plot] 的状态栏里）
     .actions > .action(编辑/删除) + .action.more-action      卡片底栏
     .more-menu > [data-action=thinking] / [data-action=select]
   (A) 去掉 Diary 卡片包裹、完全重构：
       .message-head{display:none}
       .message{background:transparent;border:0;box-shadow:none;padding:0}
       .message .content{background:#fff;border-radius:18px;padding:16px;box-shadow:0 6px 20px rgba(0,0,0,.05)}
   (B) 头像单独移出、移到任意地方（.identity-row 已是 relative）：
       .message{position:relative}
       .identity-row .avatar{position:absolute;right:18px;top:-42px;left:auto;width:64px;height:64px}
       // 想钉在屏幕某处：position 改 fixed，left/top 填像素
   (C) 加头像框 / 圆角 / 光环：
       .identity-row .avatar{border:3px solid #e7cdd6;border-radius:20px;box-shadow:0 0 0 4px rgba(231,205,214,.35)}
   (D) 重写卡片样式（颜色/形状/描边）：
       .message{background:#fffdfd;border:1px solid #efe3e6;border-radius:22px;box-shadow:0 8px 24px rgba(120,90,100,.06)}
   (E) 卡片底栏（编辑 / 删除 / 更多）—— 位置、样式、排布都能任意 DIY
       // 结构：.actions > button.action[data-action=edit|delete] + button.action.more-action[data-action=more]
       // 默认：卡片最底一行、三格平分（display:grid;grid-template-columns:repeat(3,1fr)）。
       // ① 整体移到任意位置（.message 是 position:relative，可直接绝对定位到卡片任意角落/外面）：
       .actions{position:absolute;right:14px;bottom:14px;width:auto;height:auto;display:flex;gap:6px;
                border:none;border-radius:999px;background:#f7f0f2;padding:4px 6px}
       // ② 只留图标、换配色/尺寸：
       .actions .action span{display:none}
       .actions .action{color:#b98a9a;width:38px;height:38px;border-radius:50%;background:#fff}
       .actions .action:hover{color:#e08fb0}
       // ③ 竖着排列：
       .actions{flex-direction:column;right:8px;bottom:8px}
       // ④ 横条居中：
       .actions{left:0;right:0;justify-content:center;background:transparent;border:none}
       // ⑤ 「三个折叠成一个，点一下再展开」——在模板里给 .actions 加这个开关（JS 会自动加一个 ••• 按钮）：
       .actions{--actions-collapse:1}
       //   折叠后的位置/样式仍由上面的 CSS 决定；展开状态记为 .actions.open，可自行美化：
       .actions.actions-collapsible .actions-toggle{background:#f7f0f2}
       .actions.actions-collapsible.open .action{background:#fff;color:#b98a9a}
       // ⑥ 换图标：给 .action-icon 设 display:none，再用背景图替换：
       .actions [data-action=edit] .action-icon{display:none}
       .actions [data-action=edit]{background:url("https://编辑.png") center/18px no-repeat}
   (F) 状态栏（心声 / 思维链 / 剧情推荐 / 自定义）—— 都可折叠，都能单独美化
       // 结构（所有状态栏都一样，改样式按 data-status 选中对应那一个即可）：
       //   .nano-status[data-status="心声"]
       //     ├─ .nano-status-head   标题栏（整行可点，折叠/展开）
       //     │    ├─ .nano-status-title  名称文字
       //     │    └─ .nano-status-arrow  右侧箭头
       //     └─ .nano-status-body   内容（折叠时 display:none）
       // 剧情推荐那栏额外带 data-kind="plot"，里面是 .plot-options > .plot-opt 选项按钮。
       // 心声默认展开、思维链与剧情推荐默认折叠；点标题栏即可折叠/展开（状态按名字记住）。
       // 新增自定义状态栏（两种方式，等价，都支持 HTML / 开启关闭 / 导入导出）：
       //   ① 本模板底部的 @status-bars 定义块：每行 [名称] 生成要求（快捷，用默认样式）；
       //   ② 「线下设置 → 状态栏」：可粘贴**完整 HTML**做条目，支持每条的 开启/关闭、位置、默认折叠，
       //      以及整组「导出 / 导入」（status-bars.json）。
       //   AI 每轮用 [bar:名称]内容[/bar] 输出，每轮都会刷新这一条；用 .nano-status[data-status="名字"] 美化。
       // —— 样式是「分开」的，互不影响 ——
       //   · 心声 / 思维链 / 剧情推荐 这三个内置栏：样式写在本模板里（下面 .nano-status[data-status="心声"] 等），
       //     名字固定，改它们不会影响你新增的栏。
       //   · 新增的自定义栏：用 .nano-status[data-status="你的名字"] 单独美化，也不会改到那三个。
       //   · 所有状态栏共用 .nano-status 这套「外壳」（圆角/折叠），但每个栏的配色/排版各写各的。
       // —— 自定义栏的内容支持 HTML（会渲染成美化格式，而不是当代码显示）——
       //   AI 在 [bar:名称] 里写 HTML（如 <b> / <span style> / <div>）时，会先做安全清洗再按 HTML 渲染；
       //   写纯文字时按纯文本展开。想完全自己掌控结构：在设置里给这条的「HTML」粘贴完整 HTML，
       //   用 {{content}} 标记每轮内容要填的位置、{{name}} 放名字：
       //     <div class="nano-status" data-status="着装">
       //       <div class="nano-status-head"><span class="nano-status-title">着装</span>
       //         <svg class="nano-status-arrow" viewBox="0 0 24 24" ...><polyline points="6 9 12 15 18 9"/></svg></div>
       //       <div class="nano-status-body">{{content}}</div>
       //     </div>
       //   带 nano-status 结构 = 自动可折叠；不带结构时，会自动帮你包成可折叠「条目」。
       //   不写 {{content}} 时，AI 内容会注入到 .nano-status-body 内部（没有 body 才追加到末尾），
       //   所以每轮刷新都在状态栏里面，不会跑到状态栏外面变成一行纯文字。
       //   ✅ 可以在状态栏「HTML」里直接写 <style>：它会自动只作用于这一条状态栏
       //      （会被加上 .nano-status[data-status="名字"] 作用域），不会影响心声 / 思维链 / 剧情推荐。
       // —— 心声 / 思维链：可分开，也可合并 ——
       //   默认「分开」：.nano-status[data-status="心声"] 与 .nano-status[data-status="思维链"] 两栏各自独立，各改各的。
       //   想合并成一栏：在模板里「单独一行」写 @merge-status think+heart（可用注释包起来），
       //   就会渲染成单个「心声 · 思维链」栏，用 .nano-status[data-status="心声思维链"] 美化。
       // —— 插入位置（状态栏放在卡片哪一段）——
       //   在 @status-bars 里给那行标位置即可（不标 = 正文后）：
       //     [着装@顶部] 写穿着          // 位置写在名字里
       //     [位置] 写地点 @底部          // 或写在要求末尾
       //   位置取值：顶部(昵称下) / 正文前 / 正文后(默认) / 底部(操作栏前)。
       //   「线下设置 → 状态栏」里每条也有「位置」下拉可选。
       //   想更自由的排版（和正文/时间/操作栏互换顺序），卡片是纵向 flex，
       //   直接对任意子元素用 order 即可，例如把着装栏拉到操作栏下面：
       //     .nano-status[data-status="着装"]{order:9}
       //     .actions{order:5}   .content{order:1}   .time-row{order:2}
       // —— 通用美化（所有状态栏）——
       .nano-status{margin:9px 18px 0;border:1px solid #f0d7e0;border-radius:16px;background:#fff7fa}
       .nano-status-head{padding:12px 14px}
       .nano-status-title{font-size:12px;color:#a87b8b;letter-spacing:1px}
       .nano-status-body{color:#a87b8b;font-size:12.5px}
       .nano-status-arrow{width:15px;height:15px;color:#d9b6c3}
       // —— 内置「身体状态」栏（线下设置 → 状态栏 → 身体状态栏 开关）——
       //   展示 心跳(频率) / 好感度 / 生理状态，每轮跟随正文更新；默认白底波点 + 报纸标题风。
       //   结构与其它栏一样，只是多了 data-kind="body"，行内容在 .bio-list > .bio-item(.bio-k/.bio-v)：
       //     .nano-status[data-kind="body"]{/* 白底波点 / 边框 / 圆角 */}
       //     .nano-status[data-kind="body"] .nano-status-head{border-top:1px solid #2b2621;border-bottom:2px solid #2b2621}
       //     .nano-status[data-kind="body"] .nano-status-title{font-family:Georgia,serif;letter-spacing:4px;text-transform:uppercase}
       //     .nano-status[data-kind="body"] .bio-k{color:#8a7f78}   // 部位名
       //     .nano-status[data-kind="body"] .bio-meter i{background:#c9607a}   // 好感度进度条
       // —— 只改某一个 ——
       .nano-status[data-status="心声"]{background:linear-gradient(135deg,#fff3f7,#fde9f0)}
       .nano-status[data-status="心声"] .nano-status-title::before{content:"♥ "}
       .nano-status[data-status="思维链"]{background:#f6f6fb}
       // 注意：状态栏默认 overflow:hidden（为了圆角）。如果你给 .nano-status 写死 height 或
       // overflow:hidden，会把里面的内容（尤其剧情选项）裁掉——想让它「长出来」就别锁高度。
       .message{cursor:pointer}                                 // 让整卡看起来可点
       // 触发逻辑是 JS：点头像切换「心声」、「更多 → 显示/隐藏思维链」切换「思维链」。
   (G) 剧情推荐状态栏 + 选项（选项框完全可自定义，别被标题栏遮住）
       // 结构：.nano-status[data-kind="plot"] > .nano-status-body > .plot-options > .plot-opt
       .nano-status[data-kind="plot"]{background:#fff}
       .nano-status[data-kind="plot"] .nano-status-body{white-space:normal;padding:8px 12px 12px}
       .plot-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}   // 想单列改 1fr
       .plot-opt{background:#fff;border:1px solid #f0d7e0;border-radius:12px;color:#7a6a70;padding:10px 12px}
       .plot-opt:active{background:#fbeef3}
       // ⚠️ 若之前美化时选项被挡住/裁掉，检查三点：
       //   1) 别给 .nano-status 或 .nano-status-body 写死 height / max-height / overflow:hidden；
       //   2) 别把 .nano-status-body 设成 position:absolute（会脱离文档流被后面的卡片盖住）；
       //   3) 选项是 grid，容器宽度不够时两列会挤，改成单列或加 .plot-options{grid-template-columns:1fr}。
   */

/* ── 3. 底栏 .bottom ──────────────────────────────────────────
   结构：.bottom > .composer > .round-btn(#rerollBtn 重roll) + .input + .round-btn.send(#sendBtn)
   默认：.bottom 完全透明（气泡能滚到底栏下方穿过、看得见），只有 .composer 是那个输入胶囊。
   可改：整体样式、按钮位置/顺序/颜色/图标、加装饰插件。示例直接覆盖即可（无需 !important）：
   // 把透明底栏改成「实色整条覆盖」（像普通 App 那样一条白底/黑底）：
   .bottom{background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none;border-top:1px solid #eee}
   // 只把输入胶囊改实色、底栏仍透明：
   .composer{background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}
   // 深色实底示例：
   .bottom{background:#1c1c1e;border-top:1px solid #2c2c2e}
   .composer{background:#f6f2f3;border:0;border-radius:18px;padding:6px 8px}
   .round-btn{color:#b98a9a}
   .round-btn.send{background:#c58ea0;color:#fff}
   .composer{display:flex;flex-direction:row-reverse}          // 调换按钮左右
   #rerollBtn svg{opacity:0}
   #rerollBtn{background:url("https://重roll.png") center/20px no-repeat}   // 换图标
   #sendBtn svg{opacity:0}
   #sendBtn{background:url("https://发送.png") center/20px no-repeat}
   // 把按钮搬去别处 / 换成新图标（功能不变）：别删按钮，只隐藏原图案 + 换背景 + 改定位
   .round-btn > svg{display:none}
   .round-btn{background:url("https://新图标.png") center/20px no-repeat}
   #rerollBtn{position:absolute;left:12px;bottom:14px}          // 想搬去哪就改 left/right/top/bottom

   // ★ 左侧「菜单按钮」(#composerAvatarBtn) 的移动 / 对齐（常见坑都在这里）
   //   底栏结构：.bottom > .composer（一行 flex：菜单按钮 | 输入框 textarea | 发送按钮）。
   //   ① 为什么「按钮和输入框不一样高」：
   //      输入框 .input 是 min-height:42px 且会随内容长高（最多 126px）；圆形按钮固定 42px。
   //      只要按钮还在 flex 行里、且 .composer 用默认的 align-items:center，静止时就一样高；
   //      一旦你给 .composer 加了 align-items:flex-start/flex-end，或把按钮 position:absolute
   //      移出文档流，它就不再跟输入框对齐了。
   //      想「永远和输入框一样高」：让按钮跟着输入框高度走 ——
   //        .composer{align-items:stretch}
   //        .composer .round-btn{height:auto;min-height:42px;width:42px;border-radius:999px}
   //   ② 为什么「输入框里的字被遮挡」：
   //      你把菜单按钮 position:absolute 放到了输入框上面（或输入框左端），圆按钮盖住了左端文字。
   //      ⇒ 绝不要把按钮叠在输入框上：要么留在输入框「旁边」（仍在 flex 行里），
   //        要么把它整块移出胶囊、浮到别处（放 .bottom 上，而不是压在输入框上）。
   //   ③ 正确写法 A：菜单按钮留在行内（最省事，天然对齐）：
   .composer{align-items:center;gap:7px}
   .composer .input{flex:1;min-width:0;width:auto}
   .composer .round-btn{flex:0 0 42px;height:42px}
   //   ④ 正确写法 B：把菜单按钮移出胶囊、浮到左上方（不属于输入行，也不遮挡输入框）：
   .composer{position:relative}
   .composer .avatar-btn{position:absolute;left:-4px;bottom:calc(100% + 6px)}
   //      （想放屏幕任意位置：改 left/right/top/bottom；用 .bottom 作参照就给 .bottom{position:relative}）
   //   ⑤ 若输入框文字被裁：别把 .input 写死成更小的 height；要改就同时改 line-height 与 padding，
   //      并保持 box-sizing:border-box（本页已全局设置）。例如 .input{height:46px;padding:12px 14px;line-height:22px}
   //   ⑥ 键盘弹起时轻微跳动属移动端行为；给 .bottom 加 padding-bottom:env(safe-area-inset-bottom) 兜底即可。
   // 纯装饰占位（不可点）：给稳定父元素加 ::before/::after
   .bottom::before{content:"";position:absolute;left:56px;bottom:16px;width:20px;height:20px;pointer-events:none;background:url("https://装饰.png") center/20px no-repeat}
   // 底栏左侧现在是「圆形头像按钮」#composerAvatarBtn，点击弹出竖向菜单(.om-menu)。
   // 隐藏 / 移动头像、改菜单样式：
   .composer .avatar-btn{--offline-avatar-x:0px;--offline-avatar-y:0px}   // 平移头像
   // 隐藏头像按钮：.composer .avatar-btn{display:none}（隐藏后菜单需另设触发点）
   .om-menu{background:var(--card);border-radius:16px}                    // 菜单底
   .om-item{color:var(--ink)}                                             // 菜单项文字/图标色
   // 注意：底栏默认透明是为了滑动时不遮挡卡片；若给 .bottom 加了不透明底色，
   // 就相当于又盖住了卡片，可按需给 .chat 加大 padding-bottom 或只在中间留胶囊。
   // 加「装饰性」插件（纯 CSS 只能加不可点的装饰；真正的新功能需加 HTML/JS，可让纳米帮你加）：
   .composer::before{content:"";width:36px;height:36px;border-radius:50%;align-self:center;margin-right:6px;background:#eee url("https://图标.png") center/16px no-repeat}
   */

/* ── 4. 其它：颜色 / 图标 / 字体 ──────────────────────────────
   · 全局配色：改最下面的 :root 变量（--page 背景 / --card 卡片 / --ink 文字 / --pink-deep 点缀 …）
   · 整页背景图：body 上铺图后，必须让 .app 和 .chat 透明才看得到（否则被页面底色盖住）：
       body{background:url("https://背景.png") center/cover no-repeat}
       .app,.chat{background:transparent}
     更省事：设置页「美化 → 上传背景图」已经内置了这个能力，会自适应铺满且不影响卡片。
   · 上传的背景图「以图为底」，主题色/旧预设盖不住它。想显式盖住整页，加 !important：
       body{background:#fff!important}   或   .app{background:#fff!important}
     只盖顶栏/底栏不受影响：直接写 .topbar{background:#fff} / .bottom{background:#fff} 即可（无需 !important）。
   · 把「透明 / 毛玻璃」改成实色覆盖：目标元素写实色 background + 关掉毛玻璃即可。
     顶栏 / 底栏 / 场景切换都适用：
       .topbar{background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}
       .bottom{background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}
       .scene-tabs{background:#fff}
     深色系就把 #fff 换成 #1c1c1e 之类；半透明就用 rgba(255,255,255,.7)。
   · 换任意按钮图标：给该按钮加 background-image，并让其 svg 透明度设为 0（见上）
   · 字体：body,.content{font-family:"你的字体",serif}
   */

/* ── 5. 进阶：几个常见需求怎么改（下面示例默认全部注释，要用时复制到本模板最下面）──
   (1) 把头像「提出卡片」、独立于卡片之外 / 任意位置：
       卡片 = .message；头像 = .identity-row .avatar。
       // .message{position:relative;overflow:visible}
       // .identity-row .avatar{position:absolute;left:-22px;top:14px;z-index:5}
       // .identity-row{padding-left:8px}
       注意：聊天滚动区 .chat 是 overflow:auto，会裁掉超出内边距的部分；
       想让头像「完全」移到卡片外还看得见，给它留出空间：
       // .chat{padding-left:26px;padding-right:26px}   然后把头像 left/top 调小一点即可。
       头像框（URL 图片框，最省事）：
       // .identity-row .avatar::after{content:url("https://框.png");position:absolute;inset:-8px;width:calc(100% + 16px);height:calc(100% + 16px);border:0;pointer-events:none}
   (2) 剧情 / 小剧场 Tab（.scene-tabs）：
       默认选中项外面有一个「白色滑块」.scene-indicator，整条 tab 还有一层灰底。
       想「完全恢复成只有文字、没有任何外部色块包裹」，把下面三行复制到最下面：
       // .scene-tabs{background:transparent;border:0;box-shadow:none}
       // .scene-indicator{display:none}
       // .scene-tab,.scene-tab.active{background:transparent;box-shadow:none}
       之后只靠文字颜色区分选中态即可：
       // .scene-tab{color:#b3a5a7;font-weight:600}
       // .scene-tab.active{color:#c58ea0}
        想重新做成分段控件 / 下划线 / 竖排：改 .scene-tabs 布局与 .scene-tab 样式即可。
       改 tab 名字（剧情 / 小剧场）：这两个是文字，不能用 CSS 改。改名「配方」——
       在浏览器控制台执行一次即可（存 localStorage，刷新线下页后应用）：
         localStorage.setItem('offline_scene_labels', JSON.stringify({story:'剧情',theater:'小剧场'}))
       story 对应「剧情」tab，theater 对应「小剧场」tab；字段留空/删除则回退默认名。
   (3) 给头像加头像框并完美适配：
       // .identity-row .avatar{position:relative;overflow:visible}
       // .identity-row .avatar::after{content:"";position:absolute;inset:-6px;border-radius:inherit;border:2px solid #e7cdd6;pointer-events:none}
       图片框：content:url("https://框.png");width:calc(100% + 12px);height:calc(100% + 12px);border:0
   (4) 修改「设置页」的配色：
       设置页不吃这里的美化 CSS（否则会改坏它的按钮）。它自己的变量在 css/offline-setting.css 顶部：
         --paper 背景 / --ink 主文字 / --sub 次要文字 / --line 分割线 / --accent 强调色
       要改设置页颜色，改这几个 :root 变量即可（纯颜色安全；别改它的尺寸/布局）。
   (5) 把顶栏改成「悬浮」又不影响点击的安全写法：
       // .topbar{position:fixed;top:0;left:0;right:0;z-index:40;height:calc(64px + var(--safe-top,0px));padding-top:var(--safe-top,0px);display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.8);backdrop-filter:blur(20px)}
       // .topbar .top-title{flex:1;min-width:0;pointer-events:none}
       // .topbar .top-btn{flex:0 0 auto;width:50px;height:50px}
       // .chat{padding-top:calc(74px + var(--safe-top,0px))}
       关键：悬浮后务必保留 display:flex 并给按钮固定尺寸；
       否则按钮会被拉成整条，点哪儿都像点到了返回。
   */
:root{
  --page:#f5f0f0;
  --card:#f7f2f3;
  --header:#f0eaea;
  --line:#e5ddde;
  --line-strong:#d9cfd0;
  --ink:#3d3536;
  --muted:#b0a2a4;
  --pink:#dcc8cb;
  --pink-deep:#bca8ab;
  --gray-pink:#e8dfe0;
  --shadow:0 5px 18px rgba(80,65,68,.05);
  --danger:#c28388;
}
body{color:var(--ink)}
/* 顶栏 */
.topbar{background:rgba(248,243,244,.92);color:var(--ink)}
.top-title{color:var(--ink)}
/* 卡片 */
.message{background:var(--card);border-color:var(--line-strong);box-shadow:var(--shadow)}
.message-head{background:linear-gradient(var(--header),var(--gray-pink));border-bottom:1px solid var(--line)}
.diary-title{color:var(--pink-deep)}
.identity-row{background:transparent;position:relative}
.nickname{color:var(--ink)}
.content{color:var(--ink)}
/* 底栏：重roll / 输入栏 / 发送（.bottom 保持透明，只让输入胶囊有底色） */
.bottom{background:transparent;border-top:none}
.composer{background:var(--card);border:1px solid var(--line-strong)}
.input{color:var(--ink)}
.round-btn{color:var(--ink)}
.round-btn.send{background:var(--pink-deep);color:#fff}
/* 场景切换 */
.scene-tabs{background:transparent}

/* ============================================================
   ---- 自定义状态栏定义区（新增状态栏写这里）----
   每行一个状态栏：[状态栏名] 生成要求
   AI 每轮回复会在正文后用 [bar:状态栏名]内容[/bar] 输出，
   卡片里就多出一个可折叠状态栏（点标题栏折叠/展开）。
   不写任何以 [ 开头的行 = 不生成状态栏。
   位置：在名字后写 @顶部 / @正文前 / @正文后 / @底部，不写默认「正文后」。
   例（想用就把行首的“例”字去掉、照格式写）：
   例 [着装] 一句话写角色此刻的穿着，随正文变化
   例 [位置@底部] 写角色此刻所在的地点，简短
   内容可以是纯文字，也可以是 HTML：AI 写 HTML 时会先清洗再按 HTML 渲染（不会当代码显示）。
   样式与其他状态栏互不影响：用 .nano-status[data-status="着装"] 单独美化。
   心声 / 思维链 想合并成一栏：在模板里「单独一行」写 @merge-status think+heart。
   —— 下面这个块就是定义区（现在为空）——
   ============================================================ */
/* @status-bars
*/`;

const BUILTIN_CSS = {
  soft: `:root{--page:#f7f4f5;--card:#fffdfd;--header:#fbf6f7;--line:#f1e7e9;--line-strong:#ead9dc;--ink:#40393b;--muted:#b5a8aa;--pink:#f3cdd4;--pink-deep:#e6b3bb;--gray-pink:#f1e6e8}.message{background:var(--card);border-color:var(--line-strong);box-shadow:0 5px 20px rgba(105,82,100,.06)}.topbar{background:rgba(251,246,247,.92)}`,
  minimal: `:root{--page:#f0f1f3;--card:#fff;--header:#f6f7f8;--line:#e6e7ea;--line-strong:#d9dbe0;--ink:#2c2e32;--muted:#96989d;--pink:#e2e3e7;--pink-deep:#c9cbd2;--gray-pink:#eceef0}.message{background:var(--card);border-color:var(--line-strong);box-shadow:0 3px 14px rgba(30,35,40,.04)}.topbar{background:rgba(246,247,248,.95)}`,
  textbook: `/* 语文书 · 简约（内置）— 重构版式：去掉 Diary 头，改为书页文章；暖白底色；重点色 黑/深蓝/红褐；无 emoji */
:root{
  --page:#f8f3ea;--card:#fffdf8;--header:#f8f3ea;--line:#ece1cc;--line-strong:#e2d6bd;
  --ink:#2b2621;--muted:#9a8f7d;--pink:#d8cdb6;--pink-deep:#1f3a5f;--gray-pink:#f2ece0;
  --shadow:none;--danger:#7a3b2e;
  --env-color:#7a3b2e;--env-style:italic;
  --psych-color:#6f675a;--psych-style:normal;
  --dialogue-color:#1f3a5f;--dialogue-style:normal;
  --action-color:#4a463f;--action-style:normal;
  --inner-color:#7a7368;--inner-style:italic;
}
html,body{background:var(--page);color:var(--ink)}
.chat{padding:18px 18px calc(150px + var(--nano-safe-bottom, env(safe-area-inset-bottom, 0px)))}
/* 顶栏 */
.topbar{background:rgba(248,243,234,.94);border-bottom:1px solid var(--line-strong);backdrop-filter:blur(10px)}
.top-title{color:#1f3a5f;font-family:"Songti SC","STSong","SimSun",serif;font-weight:600;letter-spacing:3px}
.top-btn{color:#8a8175}
/* 场景 Tab：改成下划线式，不占卡片感 */
.scene-tabs{background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:0 2px;margin:8px 18px 0}
.scene-tab{color:#9a8f7d;font-weight:600}
.scene-tab.active{color:#1f3a5f}
.scene-indicator{background:transparent;box-shadow:inset 0 -2px 0 #7a3b2e;border-radius:0;top:auto;bottom:-1px;height:2px}
/* 卡片：书页文章 —— 去掉 Diary 头，左侧红褐书脊线，内容重新排序 */
.message{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line-strong);border-radius:4px;box-shadow:none;position:relative;overflow:hidden}
.message::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#7a3b2e;opacity:.9}
.message.selected{box-shadow:0 0 0 2px rgba(31,58,95,.35)}
.message-head{display:none}
.identity-row{order:1;display:flex;align-items:center;gap:12px;padding:18px 22px 12px 26px;border-bottom:1px solid var(--line)}
.identity-row .avatar{width:40px;height:40px;border-radius:4px;border:1px solid var(--line-strong);background:#faf6ec;box-shadow:none}
.identity-row .avatar img{width:40px;height:40px;border-radius:4px}
.avatar-fallback{color:#1f3a5f;font-family:"Songti SC","STSong","SimSun",serif;font-size:16px}
.nickname{font-family:"Songti SC","STSong","SimSun",serif;font-size:17px;font-weight:600;letter-spacing:2px;color:#1f3a5f}
.role-label{color:#9a8f7d;letter-spacing:2px}
.content{order:2;padding:14px 26px 8px;color:#2b2621;font-size:15.5px;line-height:2.05}
.content .dialogue-block{color:#1f3a5f;font-weight:500}
.content .env-block{color:#7a3b2e;font-style:italic}
.content .psych-block{color:#6f675a}
.content .action-block{color:#4a463f}
.content .inner-block{color:#7a7368;font-style:italic}
.content .highlight{background:transparent;border-bottom:1.5px solid #7a3b2e;border-radius:0;padding:0 1px;font-weight:600}
.heart-state{order:3;margin:2px 26px 10px;padding:10px 12px;background:#f5f0e6;border-left:3px solid #7a3b2e;border-radius:0 4px 4px 0;color:#6f675a;font-size:12.5px;line-height:1.55}
.thinking{order:4;margin:2px 26px 10px;padding:10px 12px;background:#f5f0e6;border-left:3px solid #1f3a5f;border-radius:0 4px 4px 0;color:#6f675a;font-size:12.5px;line-height:1.6}
.time-row{order:5;height:24px;justify-content:flex-end;color:#b3a992;padding:0 26px 6px}
.time-row .clock-icon{opacity:.7}
.plot-area{order:6;background:transparent;border-top:1px dashed var(--line-strong);border-radius:0;padding:6px 22px 12px}
.plot-toggle{color:#9a8f7d}
.plot-opt{background:#fdfbf6;border:1px solid var(--line-strong);border-radius:4px;color:#2b2621;font-weight:500}
.plot-opt:active{background:#f2ece0;color:#1f3a5f}
.actions{order:7;border-top:1px solid var(--line)}
.action{color:#4a463f;font-weight:600;letter-spacing:1px}
.action:hover{color:#1f3a5f}
.edit-bar{order:8;background:#fdfbf6}
.more-menu{background:rgba(255,253,248,.99);border:1px solid var(--line-strong);box-shadow:0 10px 26px rgba(40,34,26,.12)}
.more-menu button{color:#2b2621}
.more-menu button:active{background:#f2ece0}
.bottom{background:rgba(248,243,234,.94);border-top:1px solid var(--line-strong)}
.composer{grid-template-columns:43px 1fr 43px}
.round-btn{background:#fffdf8;border:1px solid var(--line-strong);color:#8a8175;border-radius:6px}
.send{background:#1f3a5f;border-color:#1f3a5f;color:#fff}
.input{border:1px solid var(--line-strong);border-radius:6px;background:#fffdf8;color:#2b2621}
.input:focus{border-color:#1f3a5f;box-shadow:0 0 0 2px rgba(31,58,95,.12)}
.input::placeholder{color:#b3a992}
.toast{background:#1f3a5f}
.modal{background:rgba(255,253,248,.99)}
.modal-title{color:#1f3a5f;font-family:"Songti SC","STSong","SimSun",serif}
.exit-btn{background:#f2ece0}
.exit-btn.primary{background:#1f3a5f;color:#fff;box-shadow:0 8px 18px rgba(31,58,95,.25)}
.exit-mem-toggle input{accent-color:#1f3a5f}
.select-bar{background:#1f3a5f}
.typing-card .typing-dots span{background:#1f3a5f}`
};
// 内置主题以 js/offline-themes.js 为唯一数据源；共享源存在时覆盖这里的副本，避免两处不一致
try { Object.assign(BUILTIN_CSS, (window.NANOOfflineThemes && window.NANOOfflineThemes.css) || {}); } catch (e) {}

async function offlineImportAllowed(requireActivation) {
  if (requireActivation !== true) return true;
  let gate = null;
  try { gate = (window.parent && window.parent.NanoImportGate) || window.NanoImportGate; } catch (e) { gate = window.NanoImportGate; }
  if (!gate || !gate.ensure) return true;
  try { return !!(await gate.ensure({ needActivation: true })); } catch (e) { return false; }
}

function escapeHTML(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)); }

let toastTimer;
function showToast(t) {
  const x = document.getElementById('toast');
  x.textContent = t;
  x.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => x.classList.remove('show'), 1600);
}

// ============================================================
//  4. 渲染：规则管理
// ============================================================
function renderRules() {
  const container = document.getElementById('ruleContainer');
  if (!ruleGroups.length) {
    container.innerHTML = `<div class="no-result" style="padding:30px 0;">还没有规则组，点击「添加规则组」开始创建</div>`;
    return;
  }

  let html = '';
  ruleGroups.forEach((group, gi) => {
    const isExpanded = group.expanded !== false;
    const isEnabled = group.enabled !== false;
    const childCount = (group.rules || []).length;
    // God 是内置规则组：只保留「总开关 + 每条开关」，不暴露、也不允许改内部提示词。
    const isBuiltinGod = group.id === 'god';

    html += `<div class="rule-group-card${isBuiltinGod ? ' builtin-locked' : ''}" data-group-index="${gi}">`;
    html += `
      <div class="rule-group-header ${isExpanded ? 'expanded' : ''}" data-toggle-group="${gi}">
        ${isBuiltinGod ? '' : `<span class="drag-handle" data-drag-group="${gi}">⠿</span>`}
        <span class="expand-icon ${isExpanded ? 'rotated' : ''}">▶</span>
        <span class="group-name">${escapeHTML(group.name)} <span class="group-meta">(${childCount}条)</span></span>
        <div class="group-actions">
          <div class="switch ${isEnabled ? 'on' : ''}" data-toggle-group-switch="${gi}"><i></i></div>
          ${isBuiltinGod ? '' : `<button class="primary" data-edit-group="${gi}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg></button>
          <button class="danger" data-delete-group="${gi}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>`}
        </div>
      </div>
    `;

    if (!isBuiltinGod) {
      html += `
        <div class="group-edit-panel" id="group-edit-${gi}">
          <div class="field"><label>规则组名称</label><input id="group-edit-name-${gi}" value="${escapeHTML(group.name)}"></div>
          <div class="edit-actions">
            <button class="save" data-group-save="${gi}">保存</button>
            <button class="cancel" data-group-cancel="${gi}">取消</button>
          </div>
        </div>
      `;
    }

    html += `<div class="rule-children ${isExpanded ? 'open' : ''}" id="children-${gi}">`;
    const children = group.rules || [];
    if (children.length) {
      children.forEach((child, ci) => {
        const childEnabled = child.enabled !== false;
        html += `
          <div class="child-item" data-child="${gi}-${ci}">
            ${isBuiltinGod ? '' : `<span class="drag-handle" data-drag-child="${gi}-${ci}">⠿</span>`}
            <div class="child-info">
              <div class="child-name">${escapeHTML(child.name)}</div>
              ${isBuiltinGod ? '' : `<div class="child-preview">${escapeHTML((child.content || '').slice(0, 40))}${(child.content || '').length > 40 ? '...' : ''}</div>`}
            </div>
            <div class="child-actions">
              <div class="switch ${childEnabled ? 'on' : ''}" data-toggle-child="${gi}-${ci}"><i></i></div>
              ${isBuiltinGod ? '' : `<button class="primary" data-edit-child="${gi}-${ci}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg></button>
              <button class="danger" data-delete-child="${gi}-${ci}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="M6 6 18 18"/></svg></button>`}
            </div>
          </div>
        `;
        if (!isBuiltinGod) {
          html += `
            <div class="edit-panel" id="child-edit-${gi}-${ci}">
              <div class="field"><label>名称</label><input id="child-edit-name-${gi}-${ci}" value="${escapeHTML(child.name)}"></div>
              <div class="field"><label>内容</label><textarea id="child-edit-content-${gi}-${ci}">${escapeHTML(child.content || '')}</textarea></div>
              <div class="edit-actions">
                <button class="save" data-child-save="${gi}-${ci}">保存</button>
                <button class="cancel" data-child-cancel="${gi}-${ci}">取消</button>
              </div>
            </div>
          `;
        }
      });
    } else {
      html += `<div class="group-empty">暂无子规则${isBuiltinGod ? '' : '，点击下方添加'}</div>`;
    }
    if (!isBuiltinGod) {
      html += `
        <button class="add-child-btn" data-add-child="${gi}">+ 添加子规则</button>
      `;
    }
    html += `</div></div>`;
  });

  container.innerHTML = html;
  bindRuleEvents();
}

// ============================================================
//  5. 规则事件绑定
// ============================================================
function bindRuleEvents() {
  document.querySelectorAll('[data-toggle-group]').forEach(el => {
    el.onclick = function(e) {
      if (e.target.closest('.group-actions')) return;
      const gi = parseInt(this.dataset.toggleGroup);
      ruleGroups[gi].expanded = !ruleGroups[gi].expanded;
      saveRules();
      renderRules();
    };
  });

  document.querySelectorAll('[data-toggle-group-switch]').forEach(el => {
    el.onclick = function(e) {
      e.stopPropagation();
      const gi = parseInt(this.dataset.toggleGroupSwitch);
      ruleGroups[gi].enabled = !ruleGroups[gi].enabled;
      // 关闭大规则组时，其下所有子规则一并关闭；重新打开则一并启用
      const on = ruleGroups[gi].enabled !== false;
      (ruleGroups[gi].rules || []).forEach(r => { r.enabled = on; });
      saveRules();
      renderRules();
      updateSummary();
      showToast(on ? '已开启该规则组（含全部子规则）' : '已关闭该规则组（含全部子规则）');
    };
  });

  document.querySelectorAll('[data-edit-group]').forEach(el => {
    el.onclick = function(e) {
      e.stopPropagation();
      const gi = parseInt(this.dataset.editGroup);
      const panel = document.getElementById(`group-edit-${gi}`);
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        document.getElementById(`group-edit-name-${gi}`).value = ruleGroups[gi].name;
      }
    };
  });

  document.querySelectorAll('[data-group-save]').forEach(el => {
    el.onclick = function() {
      const gi = parseInt(this.dataset.groupSave);
      const name = document.getElementById(`group-edit-name-${gi}`).value.trim();
      if (!name) { showToast('请输入名称'); return; }
      ruleGroups[gi].name = name;
      saveRules();
      renderRules();
      updateSummary();
      showToast('已更新组名');
    };
  });

  document.querySelectorAll('[data-group-cancel]').forEach(el => {
    el.onclick = function() {
      const gi = parseInt(this.dataset.groupCancel);
      document.getElementById(`group-edit-${gi}`).classList.remove('open');
    };
  });

  document.querySelectorAll('[data-delete-group]').forEach(el => {
    el.onclick = function(e) {
      e.stopPropagation();
      const gi = parseInt(this.dataset.deleteGroup);
      if (!confirm(`删除规则组 "${ruleGroups[gi].name}" 及其所有子规则？`)) return;
      ruleGroups.splice(gi, 1);
      saveRules();
      renderRules();
      updateSummary();
      showToast('已删除');
    };
  });

  document.querySelectorAll('[data-add-child]').forEach(el => {
    el.onclick = function() {
      const gi = parseInt(this.dataset.addChild);
      if (!ruleGroups[gi].rules) ruleGroups[gi].rules = [];
      ruleGroups[gi].rules.push({
        id: generateId(),
        name: '新规则',
        content: '请输入规则内容',
        enabled: true
      });
      saveRules();
      ruleGroups[gi].expanded = true;
      renderRules();
      updateSummary();
      showToast('已添加子规则');
    };
  });

  document.querySelectorAll('[data-toggle-child]').forEach(el => {
    el.onclick = function(e) {
      e.stopPropagation();
      const [gi, ci] = this.dataset.toggleChild.split('-').map(Number);
      ruleGroups[gi].rules[ci].enabled = !ruleGroups[gi].rules[ci].enabled;
      saveRules();
      renderRules();
      updateSummary();
    };
  });

  document.querySelectorAll('[data-edit-child]').forEach(el => {
    el.onclick = function(e) {
      e.stopPropagation();
      const [gi, ci] = this.dataset.editChild.split('-').map(Number);
      const panel = document.getElementById(`child-edit-${gi}-${ci}`);
      const isOpen = panel.classList.contains('open');
      document.querySelectorAll('.edit-panel').forEach(p => p.classList.remove('open'));
      if (!isOpen) {
        panel.classList.add('open');
        document.getElementById(`child-edit-name-${gi}-${ci}`).value = ruleGroups[gi].rules[ci].name;
        document.getElementById(`child-edit-content-${gi}-${ci}`).value = ruleGroups[gi].rules[ci].content || '';
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
  });

  document.querySelectorAll('[data-child-save]').forEach(el => {
    el.onclick = function() {
      const [gi, ci] = this.dataset.childSave.split('-').map(Number);
      const name = document.getElementById(`child-edit-name-${gi}-${ci}`).value.trim();
      const content = document.getElementById(`child-edit-content-${gi}-${ci}`).value.trim();
      if (!name) { showToast('请输入名称'); return; }
      ruleGroups[gi].rules[ci].name = name;
      ruleGroups[gi].rules[ci].content = content;
      saveRules();
      renderRules();
      updateSummary();
      showToast('已保存');
    };
  });

  document.querySelectorAll('[data-child-cancel]').forEach(el => {
    el.onclick = function() {
      const [gi, ci] = this.dataset.childCancel.split('-').map(Number);
      document.getElementById(`child-edit-${gi}-${ci}`).classList.remove('open');
    };
  });

  document.querySelectorAll('[data-delete-child]').forEach(el => {
    el.onclick = function(e) {
      e.stopPropagation();
      const [gi, ci] = this.dataset.deleteChild.split('-').map(Number);
      if (!confirm(`删除子规则 "${ruleGroups[gi].rules[ci].name}"？`)) return;
      ruleGroups[gi].rules.splice(ci, 1);
      saveRules();
      renderRules();
      updateSummary();
      showToast('已删除');
    };
  });

  let dragGroupSrc = null;
  document.querySelectorAll('[data-drag-group]').forEach(el => {
    el.draggable = true;
    el.addEventListener('dragstart', function(e) {
      dragGroupSrc = parseInt(this.dataset.dragGroup);
      this.style.opacity = '0.3';
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', function() { this.style.opacity = '1'; });
    el.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('drop', function(e) {
      e.preventDefault();
      if (dragGroupSrc !== null && dragGroupSrc !== parseInt(this.dataset.dragGroup)) {
        const from = dragGroupSrc;
        const to = parseInt(this.dataset.dragGroup);
        const [moved] = ruleGroups.splice(from, 1);
        ruleGroups.splice(to, 0, moved);
        saveRules();
        renderRules();
        updateSummary();
        showToast('已移动');
      }
      dragGroupSrc = null;
    });
  });

  let dragChildSrc = null;
  document.querySelectorAll('[data-drag-child]').forEach(el => {
    el.draggable = true;
    el.addEventListener('dragstart', function(e) {
      dragChildSrc = this.dataset.dragChild;
      this.style.opacity = '0.3';
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', function() { this.style.opacity = '1'; });
    el.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!dragChildSrc || dragChildSrc === this.dataset.dragChild) return;
      const [fromGi, fromCi] = dragChildSrc.split('-').map(Number);
      const [toGi, toCi] = this.dataset.dragChild.split('-').map(Number);
      if (fromGi !== toGi) { showToast('不能跨组移动'); return; }
      const [moved] = ruleGroups[fromGi].rules.splice(fromCi, 1);
      ruleGroups[toGi].rules.splice(toCi, 0, moved);
      saveRules();
      renderRules();
      updateSummary();
      showToast('已移动');
      dragChildSrc = null;
    });
  });
}

// ============================================================
//  6. 全局规则操作
// ============================================================
document.getElementById('addGroupBtn').onclick = function() {
  ruleGroups.push({
    id: generateId(),
    name: '新规则组',
    enabled: true,
    expanded: true,
    rules: []
  });
  saveRules();
  renderRules();
  updateSummary();
  showToast('已添加规则组');
};

document.getElementById('expandAllBtn').onclick = function() {
  const allExpanded = ruleGroups.every(g => g.expanded !== false);
  ruleGroups.forEach(g => g.expanded = !allExpanded);
  saveRules();
  renderRules();
  showToast(allExpanded ? '全部折叠' : '全部展开');
};

document.getElementById('enableAllBtn').onclick = function() {
  const allEnabled = ruleGroups.every(g => g.enabled !== false) && ruleGroups.every(g => (g.rules || []).every(r => r.enabled !== false));
  ruleGroups.forEach(g => {
    g.enabled = !allEnabled;
    (g.rules || []).forEach(r => r.enabled = !allEnabled);
  });
  saveRules();
  renderRules();
  updateSummary();
  showToast(allEnabled ? '全部禁用' : '全部启用');
};

document.getElementById('deleteAllBtn').onclick = function() {
  if (!ruleGroups.length) { showToast('没有可清空的内容'); return; }
  if (!confirm('确定清空所有规则组及子规则？此操作不可恢复！')) return;
  ruleGroups = [];
  saveRules();
  renderRules();
  updateSummary();
  showToast('已清空所有规则');
};

// ============================================================
//  7. 导入 / 导出
// ============================================================
document.getElementById('importFile').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const lowerName = file.name.toLowerCase();
  // 只有 PNG 图片导入需要设备激活；TXT / DOC / DOCX / JSON 不限制。
  const mustActivate = lowerName.endsWith('.png');
  if (!(await offlineImportAllowed(mustActivate))) { e.target.value = ''; return; }
  try {
    let text = '';
    const baseNameOf = (f) => f.name.replace(/\.[^.]+$/, '');
    const normalizeChild = (r) => {
      const obj = (r && typeof r === 'object') ? r : { content: r };
      const content = String(obj.content != null ? obj.content : (obj.text != null ? obj.text : '')).trim();
      return {
        id: obj.id || generateId(),
        name: String(obj.name || obj.title || content.slice(0, 20) || '规则').slice(0, 40),
        content: content,
        enabled: obj.enabled !== false
      };
    };
    const makeGroup = (name, rules) => ({
      id: generateId(),
      name: String(name || '导入规则'),
      enabled: true,
      expanded: true,
      rules: rules
    });
    const normalizeGroup = (g) => {
      const obj = (g && typeof g === 'object') ? g : { name: baseNameOf(file), content: g };
      const rawChildren = Array.isArray(obj.rules) ? obj.rules
        : (Array.isArray(obj.children) ? obj.children : null);
      let children;
      if (rawChildren) {
        children = rawChildren.map(normalizeChild).filter(c => c.content || c.name);
      } else if (obj.content != null || obj.text != null) {
        // 组本身就是一条规则：整段作为一个子规则，绝不按行/按句拆碎
        children = [normalizeChild(obj)];
      } else {
        children = [];
      }
      return {
        id: obj.id || generateId(),
        name: String(obj.name || obj.title || baseNameOf(file) || '导入规则'),
        enabled: obj.enabled !== false,
        expanded: obj.expanded !== false,
        rules: children
      };
    };
    // 纯文本（txt/doc/docx）按「空行分段」切，再把相邻小段合并成较大的规则块，
    // 避免一段话被拆成几百条；没有空行就整体作为一条。
    const splitIntoRuleParagraphs = (raw) => {
      const norm = String(raw || '').replace(/\r\n?/g, '\n');
      const paras = norm.split(/\n\s*\n+/).map(p => p.replace(/\s+$/,'').trim()).filter(Boolean);
      if (!paras.length) return [];
      if (paras.length === 1) return paras;
      const out = [];
      const MAX = 1800;
      let buf = '';
      paras.forEach(function (p) {
        if (!buf) { buf = p; return; }
        if ((buf.length + p.length + 2) <= MAX) { buf += '\n\n' + p; return; }
        out.push(buf);
        buf = p;
      });
      if (buf) out.push(buf);
      // 最后一段太短时并回上一段，避免尾段孤零零一条
      if (out.length > 1 && out[out.length - 1].length < 160) {
        const tail = out.pop();
        out[out.length - 1] += '\n\n' + tail;
      }
      return out;
    };

    const readLegacyDocText = (buf) => {
      const score = (s) => {
        const m = s.match(/[\u4e00-\u9fff]/g);
        return m ? m.length : 0;
      };
      const u8 = new TextDecoder('utf-8').decode(buf).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
      const u16 = new TextDecoder('utf-16le').decode(buf).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
      const best = score(u16) > score(u8) ? u16 : u8;
      const out = best.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (out.length < 8) throw new Error('无法读取这个 .doc，请另存为 docx 或 txt');
      return out;
    };

    let data = null;
    if (file.name.toLowerCase().endsWith('.png')) {
      if (!window.NanoPngJson || !window.NanoPngJson.extractRules) {
        showToast('PNG 解析组件未加载');
        e.target.value = '';
        return;
      }
      data = await window.NanoPngJson.extractRules(await file.arrayBuffer());
      if (!data) {
        showToast('这个 PNG 里没有找到规则 JSON');
        e.target.value = '';
        return;
      }
    } else if (file.name.toLowerCase().endsWith('.json')) {
      try {
        data = JSON.parse(await file.text());
      } catch (err) {
        showToast('JSON 解析失败，请检查文件内容');
        e.target.value = '';
        return;
      }
    }

    if (data) {
      let imported = null;
      let replaceAll = false;
      if (data && data.kind === 'nano-offline-rules' && Array.isArray(data.groups)) {
        // 规则备份：按导出时的规则组 / 子规则恢复，不重新拆分。
        imported = data.groups.map(normalizeGroup);
        replaceAll = true;
      } else if (Array.isArray(data)) {
        // 判断是「规则组数组」还是「扁平规则数组」：整体带 rules/children 才算规则组，
        // 否则把每一项当一条规则合并进同一个组，避免被拆成几百个组。
        const looksLikeGroups = data.length > 0 && data.every(g => g && typeof g === 'object' && (Array.isArray(g.rules) || Array.isArray(g.children)));
        if (looksLikeGroups) {
          imported = data.map(normalizeGroup);
        } else {
          const rules = data.map(normalizeChild).filter(c => c.content || c.name);
          imported = rules.length ? [makeGroup(baseNameOf(file) || '导入规则', rules)] : [];
        }
      } else if (data && typeof data === 'object') {
        // 支持 {groups:[...]} / 单个规则组 {...} / 单个规则 {...}
        if (Array.isArray(data.groups)) imported = data.groups.map(normalizeGroup);
        else if (Array.isArray(data.rules)) imported = [normalizeGroup(data)];
        else imported = [normalizeGroup(data)];
      }

      if (Array.isArray(imported) && imported.length) {
        if (replaceAll && !confirm('检测到规则备份，导入会覆盖当前全部规则组并恢复原始分组，继续？')) {
          e.target.value = '';
          return;
        }
        ruleGroups = replaceAll ? imported : ruleGroups.concat(imported);
        saveRules();
        renderRules();
        updateSummary();
        const total = imported.reduce((n, g) => n + (g.rules || []).length, 0);
        showToast(replaceAll ? `已恢复 ${imported.length} 个规则组 / ${total} 条规则` : `导入成功：${imported.length} 个规则组`);
      } else {
        showToast('JSON 格式错误：需要规则数组或规则组');
      }
    } else if (lowerName.endsWith('.txt') || lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
      if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
        if (!window.mammoth) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';
            s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
          });
        }
        const buf = await file.arrayBuffer();
        try {
          const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
          text = result.value || '';
        } catch (docErr) {
          if (!lowerName.endsWith('.doc')) throw docErr;
          text = readLegacyDocText(buf);
        }
      } else {
        text = await file.text();
      }
      const paras = splitIntoRuleParagraphs(text);
      if (paras.length) {
        const group = makeGroup(baseNameOf(file), paras.map(p => normalizeChild({ content: p })));
        ruleGroups.push(group);
        saveRules();
        renderRules();
        updateSummary();
        showToast(`导入成功：${paras.length} 条规则`);
      } else {
        showToast('文件为空');
      }
    } else {
      showToast('不支持的文件格式');
    }
  } catch (err) {
    console.error(err);
    showToast('导入失败：' + err.message);
  }
  e.target.value = '';
});

document.getElementById('exportBtn').onclick = function() {
  if (!ruleGroups.length) { showToast('没有可导出的内容'); return; }
  const payload = {
    kind: 'nano-offline-rules',
    version: 1,
    exportedAt: new Date().toISOString(),
    groups: ruleGroups
  };
  const data = JSON.stringify(payload, null, 2);
  const filename = 'rules-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  if (window.NanoExport) { window.NanoExport.file({ name: filename, text: data }); return; }
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast('导出成功');
};

// ============================================================
//  8. 文风管理
// ============================================================
function populateStylePresets() {
  const sel = document.getElementById('stylePresetSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- 选择预设 --</option>' + stylePresets.map((p, i) => `<option value="${i}">${escapeHTML(p.name)}</option>`).join('');
}

if (document.getElementById('stylePresetSave')) {
document.getElementById('stylePresetSave').onclick = function() {
  const name = document.getElementById('stylePresetName').value.trim();
  const content = document.getElementById('styleText').value.trim();
  if (!name) { showToast('请输入预设名称'); return; }
  stylePresets.push({ name, content });
  saveStylePresets();
  populateStylePresets();
  showToast('文风预设已保存');
};

document.getElementById('stylePresetUpdate').onclick = function() {
  const idx = document.getElementById('stylePresetSelect').value;
  if (idx === '') { showToast('请先选择一个预设'); return; }
  const name = document.getElementById('stylePresetName').value.trim();
  const content = document.getElementById('styleText').value.trim();
  if (!name) { showToast('请输入预设名称'); return; }
  stylePresets[parseInt(idx)] = { name, content };
  saveStylePresets();
  populateStylePresets();
  showToast('文风预设已更新');
};

document.getElementById('stylePresetDelete').onclick = function() {
  const idx = document.getElementById('stylePresetSelect').value;
  if (idx === '') { showToast('请先选择一个预设'); return; }
  if (!confirm('删除此文风预设？')) return;
  stylePresets.splice(parseInt(idx), 1);
  saveStylePresets();
  populateStylePresets();
  showToast('已删除');
};

document.getElementById('stylePresetSelect').onchange = function() {
  const idx = this.value;
  if (idx === '') {
    document.getElementById('styleText').value = settings.style || '';
    document.getElementById('stylePresetName').value = '';
    return;
  }
  const p = stylePresets[parseInt(idx)];
  document.getElementById('styleText').value = p.content || '';
  document.getElementById('stylePresetName').value = p.name || '';
};
}

// ============================================================
//  8.5 思维链预设（COT）管理
// ============================================================
function populateCotPresets() {
  const sel = document.getElementById('cotPresetSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- 选择预设 --</option>' + cotPresets.map((p, i) => `<option value="${i}">${escapeHTML(p.name)}</option>`).join('');
}

document.getElementById('cotPresetSave').onclick = function() {
  const name = document.getElementById('cotPresetName').value.trim();
  const content = document.getElementById('cotText').value.trim();
  if (!name) { showToast('请输入预设名称'); return; }
  cotPresets.push({ name, content });
  saveCotPresets();
  populateCotPresets();
  showToast('思维链预设已保存');
};

document.getElementById('cotPresetUpdate').onclick = function() {
  const idx = document.getElementById('cotPresetSelect').value;
  if (idx === '') { showToast('请先选择一个预设'); return; }
  const name = document.getElementById('cotPresetName').value.trim();
  const content = document.getElementById('cotText').value.trim();
  if (!name) { showToast('请输入预设名称'); return; }
  cotPresets[parseInt(idx)] = { name, content };
  saveCotPresets();
  populateCotPresets();
  showToast('思维链预设已更新');
};

document.getElementById('cotPresetDelete').onclick = function() {
  const idx = document.getElementById('cotPresetSelect').value;
  if (idx === '') { showToast('请先选择一个预设'); return; }
  if (!confirm('删除此思维链预设？')) return;
  cotPresets.splice(parseInt(idx), 1);
  saveCotPresets();
  populateCotPresets();
  showToast('已删除');
};

document.getElementById('cotPresetSelect').onchange = function() {
  const idx = this.value;
  if (idx === '') {
    document.getElementById('cotText').value = settings.cot || '';
    document.getElementById('cotPresetName').value = '';
    return;
  }
  const p = cotPresets[parseInt(idx)];
  document.getElementById('cotText').value = p.content || '';
  document.getElementById('cotPresetName').value = p.name || '';
};

// ============================================================
//  9. 美化管理
// ============================================================
function offlineBuiltinThemes() {
  try { return (window.NANOOfflineThemes && window.NANOOfflineThemes.list) || []; } catch (e) { return []; }
}
function populateCssPresets() {
  const sel = document.getElementById('cssPreset');
  const current = sel.value;
  const themes = offlineBuiltinThemes();
  let html = '<option value="initial">初始 CSS</option>';
  themes.forEach(function (t) {
    html += '<option value="' + escapeHTML(t.key) + '">' + escapeHTML(t.name) + '</option>';
  });
  html += '<option value="custom">当前 CSS</option>';
  sel.innerHTML = html;
  cssPresets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = 'user-' + i;
    opt.textContent = '📁 ' + p.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

document.getElementById('cssPresetSave').onclick = function() {
  const name = document.getElementById('cssPresetName').value.trim();
  const content = document.getElementById('cssText').value.trim();
  if (!name) { showToast('请输入预设名称'); return; }
  cssPresets.push({ name, content });
  saveCssPresets();
  populateCssPresets();
  showToast('CSS预设已保存');
};

document.getElementById('cssPresetUpdate').onclick = function() {
  const sel = document.getElementById('cssPreset');
  const val = sel.value;
  if (!val.startsWith('user-')) { showToast('请选择用户预设进行修改'); return; }
  const idx = parseInt(val.replace('user-', ''));
  const name = document.getElementById('cssPresetName').value.trim();
  const content = document.getElementById('cssText').value.trim();
  if (!name) { showToast('请输入预设名称'); return; }
  cssPresets[idx] = { name, content };
  saveCssPresets();
  populateCssPresets();
  showToast('CSS预设已更新');
};

document.getElementById('cssPresetDelete').onclick = function() {
  const sel = document.getElementById('cssPreset');
  const val = sel.value;
  if (!val.startsWith('user-')) { showToast('请选择用户预设进行删除'); return; }
  const idx = parseInt(val.replace('user-', ''));
  if (!confirm('删除此CSS预设？')) return;
  cssPresets.splice(idx, 1);
  saveCssPresets();
  populateCssPresets();
  showToast('已删除');
};

document.getElementById('cssPreset').onchange = function() {
  const val = this.value;
  const cssText = document.getElementById('cssText');
  const nameEl = document.getElementById('cssPresetName');
  if (val === 'initial') { cssText.value = INITIAL_CSS; nameEl.value = ''; }
  else if (val === 'custom') { cssText.value = settings.customCSS || ''; nameEl.value = ''; }
  else if (val.startsWith('user-')) {
    const idx = parseInt(val.replace('user-', ''));
    const p = cssPresets[idx];
    if (p) { cssText.value = p.content || ''; nameEl.value = p.name || ''; }
  } else {
    // 内置主题统一从 NANOOfflineThemes 读取（新增主题无需再改这里）
    const theme = offlineBuiltinThemes().find(function (t) { return t.key === val; });
    if (theme) { cssText.value = theme.css || BUILTIN_CSS[val] || ''; nameEl.value = ''; }
  }
  // 选中即预览，内置主题（含「灰樱 · Grey Sakura」）能立刻看到效果
  applyCssPreview(cssText.value);
};

document.getElementById('clearCssBtn').onclick = function() { document.getElementById('cssText').value = ''; applyCssPreview(''); settings.customCSS = ''; saveSettings(); updateSummary(); notifyOfflineChanged(); showToast('已清空CSS'); };

// ===== 线下背景图：上传图片作为页面底色背景（不影响卡片 UI）=====
function fileToBgImage(file) {
  return new Promise(function (resolve) {
    try {
      const reader = new FileReader();
      reader.onload = function () {
        const raw = reader.result;
        const img = new Image();
        img.onload = function () {
          try {
            const maxW = 1600, maxH = 2400;
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            const scale = Math.min(1, maxW / w, maxH / h);
            const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement('canvas');
            canvas.width = cw; canvas.height = ch;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';                 // 透明 PNG 转 JPEG 时铺白底，避免变黑
            ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          } catch (e) { resolve(raw); }
        };
        img.onerror = function () { resolve(raw); };
        img.src = raw;
      };
      reader.onerror = function () { resolve(''); };
      reader.readAsDataURL(file);
    } catch (e) { resolve(''); }
  });
}
function updateBgName() {
  const el = document.getElementById('bgFileName');
  if (el) el.textContent = settings.bgImage ? '已设置背景' : '未设置';
}
function sendBgPreview(image) {
  const f = document.getElementById('cssPreviewFrame');
  if (!f || !f.contentWindow) return;
  try { f.contentWindow.postMessage({ type: 'offlinePreviewBg', image: String(image || '') }, '*'); } catch (e) {}
}
(function bindBgUpload() {
  const pick = document.getElementById('bgPickBtn');
  const input = document.getElementById('bgFileInput');
  const clear = document.getElementById('bgClearBtn');
  if (pick && input) {
    pick.onclick = async function () { if (!(await offlineImportAllowed(false))) return; input.click(); };
    input.addEventListener('change', async function () {
      const file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      showToast('正在处理图片…');
      const img = await fileToBgImage(file);
      if (!img) { showToast('图片读取失败'); return; }
      settings.bgImage = img;
      await saveSettings();
      updateBgName();
      sendBgPreview(img);
      showToast('背景已更新');
    });
  }
  if (clear) {
    clear.onclick = async function () {
      settings.bgImage = '';
      await saveSettings();
      updateBgName();
      sendBgPreview('');
      showToast('背景已清除');
    };
  }
  updateBgName();
})();

// ===== 线下输入框菜单插件（JS）：存 localStorage.offline_menu_plugins =====
const MENU_PLUGIN_KEY = 'offline_menu_plugins';
const MENU_PLUGIN_TEMPLATE = [
  '// 线下输入框菜单插件模板（粘贴到这里，或用 JSON 导入）',
  '// 可用 api：addItem({ label, icon, run }) / toast(msg) / getMessages() / scrollToFloor(i)',
  '// 还能：reroll() / tidy() / openFloors() / scrollTop() / scrollBottom() / clearBeautify() / clearFrame() / hideAvatar() / showAvatar()',
  'api.addItem({',
  '  label: "示例插件",',
  '  icon: \'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>\',',
  '  run: function () {',
  '    api.toast("插件被点击了");',
  '    // var msgs = api.getMessages();   // 当前线下消息数组',
  '    // api.scrollToFloor(0);           // 滚动到第 1 楼',
  '  }',
  '});'
].join('\n');
let mpEditing = -1;
function mpRead() { try { return JSON.parse(localStorage.getItem(MENU_PLUGIN_KEY) || '[]') || []; } catch (e) { return []; } }
function mpWrite(list) { try { localStorage.setItem(MENU_PLUGIN_KEY, JSON.stringify((list || []).slice(0, 40))); } catch (e) {} }
function mpEdit(i) {
  const p = mpRead()[i]; if (!p) return;
  mpEditing = i;
  const ta = document.getElementById('menuPluginText'); if (ta) ta.value = String(p.js || '');
  const lab = document.getElementById('menuPluginEditLabel'); if (lab) lab.textContent = '编辑插件：' + String(p.name || ('插件 ' + (i + 1)));
}
function mpNew() {
  mpEditing = -1;
  const ta = document.getElementById('menuPluginText'); if (ta) ta.value = '';
  const lab = document.getElementById('menuPluginEditLabel'); if (lab) lab.textContent = '新建插件';
}
function mpRender() {
  const box = document.getElementById('menuPluginList');
  if (!box) return;
  const list = mpRead();
  box.innerHTML = list.length ? '' : '<div style="font-size:11px;color:var(--sub)">还没有插件</div>';
  list.forEach(function (p, i) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(120,120,128,.08);border-radius:10px;padding:8px 10px';
    const name = document.createElement('button');
    name.type = 'button';
    name.style.cssText = 'flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border:0;background:transparent;color:inherit;font-weight:600;cursor:pointer';
    name.textContent = String(p.name || ('插件 ' + (i + 1)));
    name.onclick = function () { mpEdit(i); };
    const del = document.createElement('button');
    del.textContent = '删除';
    del.style.cssText = 'border:0;background:#fbe9ea;color:#c98a8a;font-size:12px;font-weight:600;border-radius:8px;padding:6px 10px;cursor:pointer';
    del.onclick = function () {
      var l = mpRead(); l.splice(i, 1); mpWrite(l);
      if (mpEditing === i) mpNew(); else if (mpEditing > i) mpEditing--;
      mpRender(); showToast('已删除');
    };
    row.appendChild(name); row.appendChild(del);
    box.appendChild(row);
  });
}
(function bindMenuPlugins() {
  const openBtn = document.getElementById('menuPluginOpen');
  const ta = document.getElementById('menuPluginText');
  const save = document.getElementById('menuPluginSave');
  const tpl = document.getElementById('menuPluginTemplate');
  const imp = document.getElementById('menuPluginImport');
  const neu = document.getElementById('menuPluginNew');
  const file = document.getElementById('menuPluginFile');
  if (openBtn) openBtn.onclick = function () { mpRender(); openSheet('menuPluginSheet'); };
  if (tpl && ta) tpl.onclick = function () { ta.value = MENU_PLUGIN_TEMPLATE; };
  if (neu) neu.onclick = mpNew;
  if (save && ta) save.onclick = function () {
    const js = (ta.value || '').trim();
    if (!js) { showToast('先写插件 JS'); return; }
    var l = mpRead();
    if (mpEditing >= 0 && l[mpEditing]) {
      l[mpEditing].js = js;
      var nm = window.prompt('插件名字', l[mpEditing].name || ('插件 ' + (mpEditing + 1)));
      if (nm != null && String(nm).trim()) l[mpEditing].name = String(nm).trim();
      mpWrite(l); mpRender(); showToast('已保存修改');
      const lab = document.getElementById('menuPluginEditLabel'); if (lab) lab.textContent = '编辑插件：' + l[mpEditing].name;
    } else {
      var name = window.prompt('给这个插件起个名字', '菜单插件 ' + (l.length + 1));
      if (name == null) return;
      l.push({ name: String(name || '').trim() || ('菜单插件 ' + (l.length + 1)), js: js });
      mpWrite(l); mpRender(); mpNew(); showToast('已添加插件');
    }
  };
  if (imp && file) imp.onclick = async function () { if (!(await offlineImportAllowed())) return; file.click(); };
  if (file) file.addEventListener('change', async function () {
    const f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    if (!(await offlineImportAllowed())) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        const arr = Array.isArray(data) ? data : [data];
        const l = mpRead(); let n = 0;
        arr.forEach(function (item) { if (item && item.js) { l.push({ name: String(item.name || ('导入插件 ' + (l.length + 1))), js: String(item.js) }); n++; } });
        mpWrite(l); mpRender(); showToast('已导入 ' + n + ' 个插件');
      } catch (e) { showToast('JSON 解析失败'); }
    };
    reader.readAsText(f);
  });
  mpRender();
})();

// ===== 场景 tab 标签（剧情 / 小剧场）改名 =====
// 已从设置页移除；如需改名，参考「美化 → 复制模板」里的配方说明（offline_scene_labels）。

document.getElementById('cssExport').onclick = function() {
  const sel = document.getElementById('cssPreset');
  const val = sel ? sel.value : 'custom';
  let name = document.getElementById('cssPresetName').value.trim() || '线下美化';
  let css = document.getElementById('cssText').value;
  if (val && val.startsWith('user-')) {
    const idx = parseInt(val.replace('user-', ''));
    const p = cssPresets[idx];
    if (p) { name = p.name || name; css = p.content || css; }
  }
  const data = JSON.stringify({ type: 'offline', name: name, css: css }, null, 2);
  const filename = name.replace(/[\\/:*?"<>|]/g, '_') + '.json';
  if (window.NanoExport) { window.NanoExport.file({ name: filename, text: data }); return; }
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出预设：' + name);
};
// 通知正在运行的线下页面立即重新读取设置（否则要退出再进才生效）
function notifyOfflineChanged() {
  try { window.parent.postMessage({ type: 'offlineSettingsChanged' }, '*'); } catch (e) {}
}
document.getElementById('applyCss').onclick = function() {
  settings.customCSS = document.getElementById('cssText').value;
  saveSettings();
  updateSummary();
  // 只在预览 iframe 内套用，绝不注入到设置页本身（否则会改掉设置页自己的按钮/顶栏）
  renderCssPreview(settings.customCSS);
  notifyOfflineChanged();
  showToast('CSS已应用');
};

document.getElementById('copyTemplate').onclick = async function() {
  const edited = (document.getElementById('cssText') || {}).value || '';
  const text = edited.trim() ? edited : INITIAL_CSS;
  try {
    await navigator.clipboard.writeText(text);
    showToast(edited.trim() ? '已复制当前模板到剪贴板' : '已复制初始模板到剪贴板');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(edited.trim() ? '已复制当前模板' : '已复制初始模板');
  }
};

document.getElementById('restoreCss').onclick = function() {
  document.getElementById('cssText').value = INITIAL_CSS;
  applyCssPreview(INITIAL_CSS);
  showToast('已恢复默认');
};

// ============================================================
//  10. 文档导入
// ============================================================
async function readDocument(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.css')) return await file.text();
  if (lower.endsWith('.json')) {
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      return (typeof parsed === 'string') ? parsed : (parsed.css || parsed.code || text);
    } catch { return text; }
  }
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    if (!window.mammoth) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const buf = await file.arrayBuffer();
    try {
      const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return result.value || '';
    } catch (err) {
      if (!lower.endsWith('.doc')) throw err;
      const score = (s) => {
        const m = s.match(/[\u4e00-\u9fff]/g);
        return m ? m.length : 0;
      };
      const u8 = new TextDecoder('utf-8').decode(buf).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
      const u16 = new TextDecoder('utf-16le').decode(buf).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
      const best = score(u16) > score(u8) ? u16 : u8;
      const out = best.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (out.length < 8) throw new Error('无法读取这个 .doc，请另存为 docx 或 txt');
      return out;
    }
  }
  throw new Error('不支持的文件类型');
}

async function bindDocImport(inputId, textId, nameId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!(await offlineImportAllowed(false))) { e.target.value = ''; return; }
    try {
      const text = await readDocument(file);
      document.getElementById(textId).value = text;
      document.getElementById(nameId).textContent = file.name;
      showToast('文档已导入');
    } catch (err) {
      console.error(err);
      showToast('文档读取失败');
    }
  });
}
bindDocImport('styleFile', 'styleText', 'styleFileName');
bindDocImport('cssFile', 'cssText', 'cssFileName');
bindDocImport('cotFile', 'cotText', 'cotFileName');

// ============================================================
//  11. 记录搜索
// ============================================================
async function getMessages() {
  try {
    const data = await getStoreData('messages');
    // 有当前会话时只取该会话的记录，避免“查别人也查到自己/所有人”
    if (!CURRENT_CHAT) return data;
    return data.filter(m => m && ((m.chatId || '') === CURRENT_CHAT));
  } catch { return []; }
}

let searchExpanded = false;

function renderSearch() {
  const q = document.getElementById('recordSearch').value.trim().toLowerCase();
  const box = document.getElementById('recordResults');
  if (!searchExpanded) { box.classList.remove('open'); return; }
  getMessages().then(records => {
    if (!searchExpanded) { box.classList.remove('open'); return; }
    const list = q ? records.filter(m => (m.content || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)) : [];
    box.classList.add('open');
    if (!q) { box.innerHTML = '<div class="no-result">输入关键词开始搜索</div>'; return; }
    box.innerHTML = list.length ? list.map((m, idx) =>
      `<div class="result-item" data-msgidx="${idx}">
        <div class="result-role">${escapeHTML(m.name || (m.role === 'user' ? 'user' : 'char'))}</div>
        <div class="result-text">${escapeHTML((m.content || '').slice(0, 200))}${(m.content || '').length > 200 ? '...' : ''}</div>
      </div>`
    ).join('') : '<div class="no-result">没有找到匹配记录</div>';
    
    box.querySelectorAll('.result-item').forEach(el => {
      el.onclick = function() {
        const idx = this.dataset.msgidx;
        localStorage.setItem('offline-scroll-to', idx);
        location.href = 'offline.html';
      };
    });
  });
}

document.getElementById('findRecords').onclick = function() {
  const box = document.getElementById('recordSearchBox');
  const results = document.getElementById('recordResults');
  searchExpanded = !searchExpanded;
  if (searchExpanded) {
    box.classList.add('open');
    results.classList.add('open');
    document.getElementById('recordSearch').focus();
    renderSearch();
  } else {
    box.classList.remove('open');
    results.classList.remove('open');
  }
};

document.getElementById('recordSearch').addEventListener('input', renderSearch);

// ============================================================
//  12. 清空记录
// ============================================================
const modal = document.getElementById('modalBg');
document.getElementById('clearRecords').onclick = function() { modal.classList.add('open'); };
document.getElementById('modalCancel').onclick = function() { modal.classList.remove('open'); };

async function collectOfflineMessageCids() {
  try {
    const db = await memOpenDb('MeetSettingsDB', 1, ['messages']);
    const all = await new Promise(function(resolve) {
      const r = db.transaction('messages', 'readonly').objectStore('messages').getAll();
      r.onsuccess = function() { resolve(r.result || []); };
      r.onerror = function() { resolve([]); };
    });
    const set = {};
    all.forEach(function(m) { if (m && (m.role === 'user' || m.role === 'assistant') && (m.scene || 'story') === 'story') set[m.chatId || 'general'] = true; });
    return Object.keys(set);
  } catch (e) { return []; }
}

async function clearOfflineMemoriesForCids(cids) {
  if (!cids || !cids.length) return;
  try {
    const vdb = await memOpenDb('nano_vector_memory_db', 5, ['config']);
    for (const cid of cids) {
      const rec = await new Promise(function(resolve) {
        const g = vdb.transaction('config', 'readonly').objectStore('config').get('memlist_' + cid);
        g.onsuccess = function() { resolve(g.result ? g.result.value : null); };
        g.onerror = function() { resolve(null); };
      });
      const list = (rec && Array.isArray(rec)) ? rec : [];
      const filtered = list.filter(function(it) { return !(it && it.chatId === cid && it.type === '长期记忆'); });
      await new Promise(function(resolve) {
        vdb.transaction('config', 'readwrite').objectStore('config').put({ key: 'memlist_' + cid, value: filtered });
        resolve();
      });
    }
  } catch (e) { console.warn('清理线下记忆失败', e); }
}

async function deleteMessagesForChat(cid) {
  if (!cid) { await clearStore('messages'); return; }
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const cur = store.openCursor();
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        const v = c.value;
        if (v && (v.chatId || '') === cid) c.delete();
        c.continue();
      } else {
        resolve();
      }
    };
    cur.onerror = () => resolve();
  });
}

document.getElementById('modalConfirm').onclick = async function() {
  let cids;
  if (CURRENT_CHAT) {
    cids = [CURRENT_CHAT];
    await deleteMessagesForChat(CURRENT_CHAT);
  } else {
    cids = await collectOfflineMessageCids();
    await clearStore('messages');
  }
  await clearOfflineMemoriesForCids(cids);
  modal.classList.remove('open');
  document.getElementById('recordResults').classList.remove('open');
  document.getElementById('recordSearchBox').classList.remove('open');
  searchExpanded = false;
  showToast('记录与相关记忆已清空');
};
modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('open'); };

// ============================================================
//  13. 更新摘要 & 填充设置
// ============================================================
function updateSummary() {
  const activeCount = ruleGroups.filter(g => g.enabled !== false).length;
  const totalRules = ruleGroups.reduce((sum, g) => sum + (g.rules || []).length, 0);
  document.getElementById('rulesValue').textContent = ruleGroups.length ? `${activeCount}组/${totalRules}条` : '未设置';
  const styleValEl = document.getElementById('styleValue');
  if (styleValEl) styleValEl.textContent = settings.style ? settings.style.slice(0, 20) : '未设置';
  const cotValEl = document.getElementById('cotValue');
  if (cotValEl) cotValEl.textContent = settings.cot ? settings.cot.slice(0, 20) : '未设置';
  document.getElementById('cssValue').textContent = settings.customCSS ? '已自定义' : '默认';
  document.getElementById('wordCount').value = settings.wordCount || '';
  document.getElementById('person').value = settings.person || 'auto';
  { const pu = document.getElementById('predictUser'); if (pu) pu.value = settings.predictUser || 'forbid'; }
  { const mt = document.getElementById('maxTokens'); if (mt) mt.value = settings.maxTokens || ''; }
  const nsfwSwitch = document.getElementById('nsfwSwitch');
  if (nsfwSwitch) nsfwSwitch.classList.toggle('on', settings.nsfw === true);
  const builtinBodySwitch = document.getElementById('builtinBodySwitch');
  if (builtinBodySwitch) builtinBodySwitch.classList.toggle('on', settings.builtinBody === true);
  const sbVal = document.getElementById('statusBarsValue');
  if (sbVal) {
    const n = Array.isArray(settings.statusBars) ? settings.statusBars.length : 0;
    sbVal.textContent = (settings.builtinBody ? '身体状态 · ' : '') + (n ? (n + ' 个') : (settings.builtinBody ? '已开启' : '未设置'));
  }
}

function fillSettings() {
  const styleTextEl = document.getElementById('styleText');
  if (styleTextEl) styleTextEl.value = settings.style || '';
  const cotTextEl = document.getElementById('cotText');
  if (cotTextEl) cotTextEl.value = settings.cot || '';
  document.getElementById('cssText').value = settings.customCSS || '';
  document.getElementById('wordCount').value = settings.wordCount || '';
  document.getElementById('person').value = settings.person || 'auto';
  const mt = document.getElementById('memThresholdInput');
  if (mt) mt.value = settings.memThreshold || localStorage.getItem('offline_mem_threshold') || '5';
  updateSummary();
  populateStylePresets();
  populateCotPresets();
  populateCssPresets();
  updateBgName();
}

// ============================================================
//  14. Sheet 控制
// ============================================================
function openSheet(id) { document.getElementById(id).classList.add('open'); }
function closeSheet(id) { document.getElementById(id).classList.remove('open'); }

document.getElementById('rulesOpen').onclick = function() {
  renderRules();
  openSheet('rulesSheet');
};

const styleOpenEl = document.getElementById('styleOpen');
if (styleOpenEl) styleOpenEl.onclick = function() {
  document.getElementById('styleText').value = settings.style || '';
  populateStylePresets();
  openSheet('styleSheet');
};

document.getElementById('cotOpen').onclick = function() {
  document.getElementById('cotText').value = settings.cot || '';
  populateCotPresets();
  openSheet('cotSheet');
};

// 用「真实的线下页面」做实时预览：同一套 offline.html + offline.js，只是走 preview 模式
let pendingPreviewCss = '';
function sendPreviewCss(f) {
  try { f.contentWindow.postMessage({ type: 'offlinePreviewCss', css: pendingPreviewCss }, '*'); } catch (e) {}
}
function renderCssPreview(css) {
  pendingPreviewCss = String(css || '');
  const f = document.getElementById('cssPreviewFrame');
  if (!f) return;
  if (!f.getAttribute('src')) {
    let chat = '';
    try { chat = new URLSearchParams(location.search).get('chat') || ''; } catch (e) {}
    f.setAttribute('src', 'offline.html?preview=1' + (chat ? ('&chat=' + encodeURIComponent(chat)) : ''));
  }
  // iframe 就绪后立即套用最新 CSS；未就绪则等 load 事件补发
  if (f.dataset.ready === '1') sendPreviewCss(f);
  if (f.dataset.bound !== '1') {
    f.dataset.bound = '1';
    f.addEventListener('load', function () { f.dataset.ready = '1'; sendPreviewCss(f); });
  }
}
function applyCssPreview(css) { renderCssPreview(css); }
document.getElementById('beautifyOpen').onclick = function() {
  document.getElementById('cssText').value = settings.customCSS || '';
  populateCssPresets();
  applyCssPreview(settings.customCSS || '');
  openSheet('beautifySheet');
};

// ============================================================
//  15. 状态栏管理（自定义可折叠状态栏）
//  心声 / 思维链 / 剧情推荐 是内置可折叠状态栏；这里新增自定义的，
//  AI 每轮按「生成要求」输出 [bar:名称]…[/bar]，卡片里以可折叠状态栏展示。
// ============================================================
function renderStatusBars() {
  const wrap = document.getElementById('statusBarList');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!Array.isArray(settings.statusBars)) settings.statusBars = [];
  const list = settings.statusBars;
  if (!list.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11px;color:var(--sub);line-height:1.6';
    empty.textContent = '还没有自定义状态栏，点上方「+ 新增状态栏」。';
    wrap.appendChild(empty);
    return;
  }
  function makeSwitch(on, onChange) {
    const sw = document.createElement('div');
    sw.className = 'switch' + (on ? ' on' : '');
    sw.appendChild(document.createElement('i'));
    sw.onclick = function () { const v = !sw.classList.contains('on'); sw.classList.toggle('on', v); onChange(v); };
    return sw;
  }
  function miniLabel(text) {
    const l = document.createElement('div');
    l.style.cssText = 'font-size:12px;color:var(--sub);flex:none';
    l.textContent = text;
    return l;
  }
  list.forEach(function (bar, idx) {
    if (bar.enabled === undefined) bar.enabled = true;
    const expanded = bar.expanded === true;
    const item = document.createElement('div');
    item.style.cssText = 'border:1px solid var(--line2,#eee);border-radius:12px;background:#fff;overflow:hidden';

    // —— 收起状态：只显示一行（箭头 + 名称 + 启用开关）——
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer';
    const arrow = document.createElement('span');
    arrow.textContent = '▶';
    arrow.style.cssText = 'font-size:10px;color:var(--sub);transition:transform .15s;transform:rotate(' + (expanded ? '90deg' : '0deg') + ')';
    const title = document.createElement('span');
    title.style.cssText = 'flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    title.textContent = bar.name || ('状态栏 ' + (idx + 1));
    const enSw = makeSwitch(bar.enabled !== false, function (v) { bar.enabled = v; saveSettings(); updateSummary(); });
    enSw.addEventListener('click', function (e) { e.stopPropagation(); });
    head.appendChild(arrow); head.appendChild(title); head.appendChild(enSw);
    head.onclick = function () { bar.expanded = !expanded; renderStatusBars(); };

    // —— 展开状态：编辑内容 ——
    const body = document.createElement('div');
    body.style.cssText = 'display:' + (expanded ? 'flex' : 'none') + ';flex-direction:column;gap:6px;padding:0 10px 10px';
    const name = document.createElement('input');
    name.className = 'search-input';
    name.placeholder = '状态栏名，如：着装 / 位置';
    name.maxLength = 12;
    name.value = bar.name || '';
    name.style.height = '34px';
    const html = document.createElement('textarea');
    html.className = 'textarea';
    html.style.minHeight = '76px';
    html.style.fontSize = '11px';
    html.style.fontFamily = 'ui-monospace,Menlo,monospace';
    html.placeholder = 'HTML 结构（{{content}} = 每轮内容位置，{{name}} = 名字；不写 {{content}} 会自动放进 .nano-status-body）。';
    html.value = bar.html || '';
    const css = document.createElement('textarea');
    css.className = 'textarea';
    css.style.minHeight = '96px';
    css.style.fontSize = '11px';
    css.style.fontFamily = 'ui-monospace,Menlo,monospace';
    css.placeholder = 'CSS（只作用在这一条状态栏上，会自动加作用域）：\n.nano-status{background:#fff}\n.nano-status-title{letter-spacing:3px}\n.nano-status-body{color:#333}';
    css.value = bar.css || '';
    const prompt = document.createElement('textarea');
    prompt.className = 'textarea';
    prompt.style.minHeight = '52px';
    prompt.placeholder = '生成要求：写什么、怎么更新';
    prompt.value = bar.prompt || '';
    const posRow = document.createElement('div');
    posRow.style.cssText = 'display:flex;align-items:center;gap:8px';
    const posSel = document.createElement('select');
    posSel.className = 'search-input';
    posSel.style.cssText = 'height:32px;flex:1;min-width:0';
    [['top', '顶部（昵称下）'], ['before', '正文前'], ['after', '正文后（默认）'], ['bottom', '底部（操作栏前）']].forEach(function (o) {
      const opt = document.createElement('option');
      opt.value = o[0]; opt.textContent = o[1];
      posSel.appendChild(opt);
    });
    posSel.value = bar.pos || 'after';
    posSel.onchange = function () { bar.pos = posSel.value; saveSettings(); };
    posRow.appendChild(miniLabel('位置')); posRow.appendChild(posSel);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap';
    row.appendChild(miniLabel('默认折叠'));
    row.appendChild(makeSwitch(bar.collapsed === true, function (v) { bar.collapsed = v; saveSettings(); }));
    const del = document.createElement('button');
    del.className = 'sheet-btn danger';
    del.type = 'button';
    del.textContent = '删除';
    del.style.alignSelf = 'flex-end';
    del.onclick = function () { list.splice(idx, 1); saveSettings(); renderStatusBars(); updateSummary(); };
    name.addEventListener('input', function () { bar.name = name.value.trim(); saveSettings(); updateSummary(); title.textContent = bar.name || ('状态栏 ' + (idx + 1)); });
    html.addEventListener('input', function () { bar.html = html.value; saveSettings(); });
    css.addEventListener('input', function () { bar.css = css.value; saveSettings(); });
    prompt.addEventListener('input', function () { bar.prompt = prompt.value.trim(); saveSettings(); });
    body.appendChild(name); body.appendChild(html); body.appendChild(css); body.appendChild(prompt); body.appendChild(posRow); body.appendChild(row); body.appendChild(del);
    item.appendChild(head); item.appendChild(body);
    wrap.appendChild(item);
  });
}
document.getElementById('statusBarsOpen').onclick = function() {
  renderStatusBars();
  const ta = document.getElementById('statusBarTemplate');
  if (ta) ta.value = (window.NanoStatusBar && window.NanoStatusBar.TEMPLATE) || '';
  openSheet('statusBarsSheet');
};
document.getElementById('statusBarAddBtn').onclick = function() {
  if (!Array.isArray(settings.statusBars)) settings.statusBars = [];
  settings.statusBars.push({ id: generateId(), name: '', html: '', css: '', prompt: '', collapsed: false, pos: 'after', enabled: true });
  saveSettings();
  renderStatusBars();
  updateSummary();
  const wrap = document.getElementById('statusBarList');
  const inputs = wrap ? wrap.querySelectorAll('input') : [];
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
};
// 状态栏：导出 / 导入（整组）
document.getElementById('statusBarExport').onclick = function() {
  const bars = Array.isArray(settings.statusBars) ? settings.statusBars : [];
  if (!bars.length) { showToast('还没有自定义状态栏'); return; }
  const text = JSON.stringify({ type: 'offline-status-bars', version: 1, statusBars: bars }, null, 2);
  if (window.NanoExport) { window.NanoExport.file({ name: 'status-bars.json', text: text }); return; }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'status-bars.json'; a.click();
  } catch (e) { showToast('导出失败'); }
};
document.getElementById('statusBarImport').onclick = async function() { if (!(await offlineImportAllowed())) return; document.getElementById('statusBarFile').click(); };
document.getElementById('statusBarFile').addEventListener('change', async function(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (!(await offlineImportAllowed())) { e.target.value = ''; return; }
  const rd = new FileReader();
  rd.onload = function(ev) {
    try {
      const obj = JSON.parse(String(ev.target.result || ''));
      const arr = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.statusBars) ? obj.statusBars : null);
      if (!arr) { showToast('文件格式不对'); return; }
      if (!Array.isArray(settings.statusBars)) settings.statusBars = [];
      arr.forEach(function(b) {
        if (!b || !b.name) return;
        settings.statusBars.push({
          id: generateId(),
          name: String(b.name),
          html: String(b.html || ''),
          prompt: String(b.prompt || ''),
          collapsed: b.collapsed === true,
          pos: b.pos || 'after',
          enabled: b.enabled !== false
        });
      });
      saveSettings();
      renderStatusBars();
      updateSummary();
      showToast('已导入 ' + arr.length + ' 条状态栏');
    } catch (err) { showToast('导入失败'); }
  };
  rd.readAsText(f);
  e.target.value = '';
});
document.getElementById('statusBarTemplateCopy').onclick = function() {
  const txt = (window.NanoStatusBar && window.NanoStatusBar.TEMPLATE) || '';
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function(){ showToast('已复制模板'); }, function(){ showToast('复制失败'); });
    } else {
      const ta = document.createElement('textarea'); ta.value = txt;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      showToast('已复制模板');
    }
  } catch (e) { showToast('复制失败'); }
};
// ===== 内置「身体状态」：查看代码 / 一键复制为自定义状态栏 =====
const BODY_BAR_HTML = `<div class="nano-status" data-status="身体状态" data-default="open">
  <div class="nano-status-head">
    <span class="nano-status-title">身体状态</span>
    <svg class="nano-status-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  </div>
  <div class="nano-status-body">{{content}}</div>
</div>`;
const BODY_BAR_CSS = `/* 白底波点 + 报纸标题风；只会作用在这一条状态栏上（渲染时自动加作用域） */
.nano-status{background-color:#fff;background-image:radial-gradient(rgba(180,150,160,.30) 1.1px, transparent 1.3px);background-size:12px 12px;border:1px solid #e4dcda;border-radius:14px}
.nano-status-head{background:rgba(255,255,255,.86);border-top:1px solid #2b2621;border-bottom:2px solid #2b2621;padding:9px 14px}
.nano-status-title{font-family:Georgia,"Times New Roman","Songti SC","STSong",serif;font-weight:700;letter-spacing:4px;color:#2b2621;font-size:12.5px}
.nano-status-arrow{color:#2b2621}
.nano-status-body{white-space:normal;color:#3b352f;padding:10px 14px 12px}
.bio-list{display:flex;flex-direction:column}
.bio-item{display:flex;gap:10px;align-items:baseline;padding:4px 0;border-bottom:1px dotted #ded4d1}
.bio-item:last-child{border-bottom:0}
.bio-k{flex:none;min-width:3.4em;font-weight:700;color:#8a7f78;font-size:11.5px;letter-spacing:.5px}
.bio-v{flex:1;min-width:0;font-size:12.5px;line-height:1.5}
.bio-meter{display:inline-block;width:64px;height:6px;border-radius:999px;background:#efe8e6;vertical-align:middle;margin-right:6px;overflow:hidden}
.bio-meter i{display:block;height:100%;background:linear-gradient(90deg,#e7a9b6,#c9607a);border-radius:999px}`;
const BODY_BAR_PROMPT = '每轮输出本回合的身体状态：①心跳（给出具体频率，如 88 次/分，随情绪变化）②好感度（0~100 的整数，可带一句短评）③再随机挑 1~3 个最相关的身体部位（手/眼睛/脸/呼吸/心脏/肩/腿/私密处…）写细微状态。用 HTML 行输出，每行一个部位：<div class="bio-item"><span class="bio-k">部位</span><span class="bio-v">状态</span></div>；好感度那行可加进度条：<div class="bio-item"><span class="bio-k">好感度</span><span class="bio-v"><span class="bio-meter"><i style="width:63%"></i></span>63 还在嘴硬</span></div>';
(function bindBuiltinBodyCode() {
  const htmlEl = document.getElementById('builtinBodyHtml');
  const cssEl = document.getElementById('builtinBodyCss');
  if (htmlEl) htmlEl.value = BODY_BAR_HTML;
  if (cssEl) cssEl.value = BODY_BAR_CSS;
  function copyText(txt, ok) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { showToast(ok); }, function () { showToast('复制失败'); });
      } else {
        const ta = document.createElement('textarea'); ta.value = txt;
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        showToast(ok);
      }
    } catch (e) { showToast('复制失败'); }
  }
  const cpH = document.getElementById('builtinBodyCopyHtml');
  if (cpH) cpH.onclick = function () { copyText(BODY_BAR_HTML, 'HTML 已复制'); };
  const cpC = document.getElementById('builtinBodyCopyCss');
  if (cpC) cpC.onclick = function () { copyText(BODY_BAR_CSS, 'CSS 已复制'); };
  const clone = document.getElementById('builtinBodyClone');
  if (clone) clone.onclick = function () {
    if (!Array.isArray(settings.statusBars)) settings.statusBars = [];
    settings.statusBars.push({
      id: generateId(),
      name: '身体状态·副本',
      html: BODY_BAR_HTML,
      css: BODY_BAR_CSS,
      prompt: BODY_BAR_PROMPT,
      collapsed: false,
      pos: 'after',
      enabled: true,
      expanded: true
    });
    saveSettings();
    renderStatusBars();
    updateSummary();
    showToast('已新建一条自定义状态栏，去下面改名字 / 样式');
  };
})();
(function bindCssPreview() {
  const ta = document.getElementById('cssText');
  if (ta) {
    let t;
    ta.addEventListener('input', function () { clearTimeout(t); const v = this.value; t = setTimeout(function () { applyCssPreview(v); }, 60); });
  }
  const sel = document.getElementById('cssPreset');
  if (sel) sel.addEventListener('change', function () { setTimeout(function () { applyCssPreview(document.getElementById('cssText').value); }, 0); });
})();

// ===== 记忆总结（线下→共享记忆库，与线上互通） =====
const autoSummarySwitch = document.getElementById('autoSummarySwitch');
function setAutoSwitchUI() {
  if (autoSummarySwitch) autoSummarySwitch.classList.toggle('on', settings.autoSummary !== false);
}
if (autoSummarySwitch) autoSummarySwitch.addEventListener('click', function() {
  settings.autoSummary = !autoSummarySwitch.classList.contains('on');
  saveSettings();
  setAutoSwitchUI();
  showToast(settings.autoSummary ? '自动总结已开启' : '自动总结已关闭');
});

// ===== 成人向尺度（线下 NSFW） =====
const nsfwSwitch = document.getElementById('nsfwSwitch');
if (nsfwSwitch) {
  nsfwSwitch.addEventListener('click', function() {
    settings.nsfw = !nsfwSwitch.classList.contains('on');
    saveSettings();
    nsfwSwitch.classList.toggle('on', settings.nsfw);
    showToast(settings.nsfw ? 'NSFW 已开启' : 'NSFW 已关闭');
  });
}

// ===== 内置状态栏「身体状态」（心跳 / 好感度 / 生理）=====
const builtinBodySwitch = document.getElementById('builtinBodySwitch');
if (builtinBodySwitch) {
  builtinBodySwitch.addEventListener('click', function() {
    settings.builtinBody = !builtinBodySwitch.classList.contains('on');
    saveSettings();
    builtinBodySwitch.classList.toggle('on', settings.builtinBody);
    notifyOfflineChanged();
    updateSummary();
    showToast(settings.builtinBody ? '身体状态栏已开启' : '身体状态栏已关闭');
  });
}
const memorySummaryOpenEl = document.getElementById('memorySummaryOpen');
if (memorySummaryOpenEl) memorySummaryOpenEl.onclick = function() {
  const inp = document.getElementById('memThresholdInput');
  inp.value = settings.memThreshold || localStorage.getItem('offline_mem_threshold') || '5';
  setAutoSwitchUI();
  openSheet('memorySheet');
};
const memThresholdSaveEl = document.getElementById('memThresholdSave');
if (memThresholdSaveEl) memThresholdSaveEl.onclick = function() {
  const v = parseInt(document.getElementById('memThresholdInput').value, 10) || 5;
  settings.memThreshold = v;
  try { localStorage.setItem('offline_mem_threshold', String(v)); } catch (e) {}
  saveSettings();
  showToast('总结阈值已设为 ' + v + ' 条');
};

function memOpenDb(name, version, stores) {
  return new Promise(function(resolve, reject) {
    try {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = function(e) {
        const db = e.target.result;
        (stores || []).forEach(function(store) { if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'key' }); });
      };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function(e) { reject(e.target.error); };
    } catch (e) { reject(e); }
  });
}
async function memConfig() {
  try {
    const raw = await new Promise(function(resolve) {
      try {
        const req = indexedDB.open('nano_api_db', 2);
        req.onupgradeneeded = function(e) { const db = e.target.result; if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' }); };
        req.onsuccess = function(e) { const db = e.target.result; const g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config'); g.onsuccess = () => resolve(g.result ? g.result.value : null); g.onerror = () => resolve(null); };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    if (!raw) { const ls = localStorage.getItem('nano_api_config'); if (ls) return JSON.parse(ls); return null; }
    return raw;
  } catch (e) { return null; }
}
async function memExtract(text) {
  const cfg = await memConfig();
  if (!cfg || !cfg.mainUrl) return '';
  let url = String(cfg.mainUrl).trim().replace(/\/+$/, '');
  if (!/\/v1$/i.test(url)) url += '/v1';
  const key = String(cfg.mainKey || '').trim();
  const model = cfg.mainModel || '';
  const prompt = '你是记忆提取助手。从角色与用户的一段对话中，提取值得长期记住的信息（重要事件、约定、喜好、称呼、关系进展、重要的话）。每条30~120字，只输出若干条记忆，一行一条，不要编号、不要解释、不要输出原文。\n\n对话：\n' + text;
  const resp = await fetch(url + '/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 0.6, stream: false })
  });
  if (!resp.ok) return '';
  const data = await resp.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}
const summarizeOfflineMemoryBtnEl = document.getElementById('summarizeOfflineMemoryBtn');
if (summarizeOfflineMemoryBtnEl) summarizeOfflineMemoryBtnEl.onclick = async function() {
  const btn = this;
  btn.disabled = true; btn.style.opacity = '.55';
  try {
    const db = await memOpenDb('MeetSettingsDB', 1, ['messages']);
    const all = await new Promise(function(resolve) {
      const r = db.transaction('messages', 'readonly').objectStore('messages').getAll();
      r.onsuccess = function() { resolve(r.result || []); };
      r.onerror = function() { resolve([]); };
    });
    const groups = {};
    all.forEach(m => { if (m && (m.role === 'user' || m.role === 'assistant') && (m.scene || 'story') === 'story') { const cid = m.chatId || 'general'; (groups[cid] = groups[cid] || []).push(m); } });
    let cids = Object.keys(groups);
    if (CURRENT_CHAT) cids = cids.filter(c => c === CURRENT_CHAT);
    if (!cids.length) { showToast('没有可总结的线下对话'); return; }
    let count = 0;
    for (const cid of cids) {
      const msgs = groups[cid];
      if (msgs.length < 1) continue;
      const text = msgs.slice(-14).map(m => ((m.role === 'user' ? (m.name || '用户') : (m.name || '角色')) + '：' + String(m.content || '').slice(0, 900))).join('\n');
      const summary = await memExtract(text);
      if (!summary) continue;
      const items = summary.split('\n').map(l => l.trim()).map(l => l.replace(/^[-*\d.\s、)]+/, '')).filter(l => l && l.length >= 6);
      if (!items.length) continue;
      const vdb = await memOpenDb('nano_vector_memory_db', 5, ['config']);
      const rec = await new Promise((resolve) => {
        const g = vdb.transaction('config', 'readonly').objectStore('config').get('memlist_' + cid);
        g.onsuccess = () => resolve(g.result ? g.result.value : null);
        g.onerror = () => resolve(null);
      });
      const list = (rec && Array.isArray(rec)) ? rec : [];
      items.forEach(t => { list.push({ id: 'om' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), time: new Date().toLocaleString('zh-CN'), type: '长期记忆', chatId: cid, content: t }); });
      await new Promise((resolve) => {
        vdb.transaction('config', 'readwrite').objectStore('config').put({ key: 'memlist_' + cid, value: list });
        resolve();
      });
      count += items.length;
    }
    showToast(count ? ('已总结 ' + count + ' 条记忆') : '没有提取到记忆');
  } catch (e) { console.error(e); showToast('总结失败：' + (e.message || e)); } finally {
    btn.disabled = false; btn.style.opacity = '';
  }
};

document.querySelectorAll('[data-close]').forEach(b => b.onclick = function() {
  var what = this.dataset.close;
  // 思维链预设弹窗：点「完成」也要落库，否则编辑了 COT 但只关弹窗、未点页面「保存」会静默丢失
  if (what === 'cotSheet') {
    try {
      var cotEl = document.getElementById('cotText');
      if (cotEl) settings.cot = cotEl.value.trim();
      saveSettings();
      updateSummary();
    } catch (e) {}
  }
  closeSheet(what);
});
document.querySelectorAll('.sheet-backdrop').forEach(b => b.addEventListener('click', function(e) { if (e.target === this) closeSheet(this.id); }));

// ============================================================
//  15. 保存 & 返回
// ============================================================
document.getElementById('saveBtn').onclick = function() {
  { const mt = document.getElementById('maxTokens'); if (mt) settings.maxTokens = mt.value; }
  // 文风入口已移除：统一写在「规则」里，不再单独保存文风
  settings.style = '';
  settings.cot = document.getElementById('cotText').value.trim();
  settings.customCSS = document.getElementById('cssText').value;
  settings.wordCount = document.getElementById('wordCount').value;
  settings.person = document.getElementById('person').value;
  { const pu = document.getElementById('predictUser'); if (pu) settings.predictUser = pu.value; }
  settings.memThreshold = parseInt(document.getElementById('memThresholdInput').value, 10) || 5;
  saveSettings();
  updateSummary();
  showToast('设置已保存');
};

document.getElementById('backBtn').onclick = function() {
  // 返回到「线下模式聊天」（同一个 iframe 内的 offline.html），而不是退出到线上聊天详情
  var q = '';
  try {
    var p = new URLSearchParams(location.search);
    var cid = p.get('chat');
    var nm = p.get('name');
    if (cid) q += 'chat=' + encodeURIComponent(cid);
    if (nm) q += (q ? '&' : '') + 'name=' + encodeURIComponent(nm);
  } catch (e) {}
  location.href = 'offline.html' + (q ? '?' + q : '');
};

// ============================================================
//  16. 启动
// ============================================================
(async function init() {
  await loadAllData();
  fillSettings();
  renderRules();
  // 重新进入设置页时把已保存的配色渲染进预览 iframe（不影响设置页本身）
  renderCssPreview(settings.customCSS || '');
})();