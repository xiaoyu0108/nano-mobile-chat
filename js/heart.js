/* ============================================
   Nano 心声 · 完整逻辑
   ============================================ */

(function() {
  'use strict';

  const $ = id => document.getElementById(id);

  // ============================================
  // 心声模板 DIY 配方：给 AI 读的说明（「复制模板」会把这段 + 当前 CSS 一起复制）
  // 模板本质是可覆盖的 CSS；以下 id/类名是 JS 写入数据的挂点，只需保留选择器、样式可任意重构。
  // ============================================
  window.NANO_HEART_RECIPE = `【Nano 心声模板 DIY 配方（交给 AI 修改时请一并提供）】
你可以在下面的 CSS 里任意重构「心声」卡片：隐藏任意文字/头像、把头像或名字移到任意位置、重排顶栏 / 内容区 / 底栏，全部通过 CSS 完成。
JS 会写入文本/图片的挂点（请保留这些 id 或类名，只改样式，不要删元素）：
  #ivAvatar / .iv-avatar          头像图片
  .iv-avatar-fallback             头像兜底字母
  #ivSender / .iv-name            发送人昵称
  .iv-caption                     “发送人”小字
  #ivRecipient / .user-name       收件人
  #ivTime                         时间
  #ivSubject / .iv-subject        此刻·印象
  #ivThought / .iv-thought        心声正文
  #ivExtraText / .iv-extra-text   附加文字（默认为空，可设 display:block 显示）
  #ivDecoTop / .iv-deco-top       顶部装饰层（默认隐藏）
  #ivDecoBottom / .iv-deco-bottom 底部装饰层（默认隐藏）
  .iv-sender / .iv-header / .iv-meta / .iv-content / .iv-custom-foot   结构容器
  #ivSections / .iv-section / .iv-section-title / .iv-section-body      附加板块（评论区/穿搭等，有内容才显示）
「新增模块 / 附加板块」也写在模板里：加一个注释块，每行一个 [板块名] 生成要求：
  /* @heart-sections
  [评论区] 以粉丝视角写 5 条评论，每条 20 字，围绕本条心声调侃或共鸣
  [穿搭] 写角色此刻的穿着，跟随正文更新
  */
每轮 AI 会在 [heart:…] 之后按此输出 [section:板块名]内容[/section]，卡片里多渲染一块。
可用的重构手段：
  1) 隐藏：selector{display:none !important}
  2) 任意移动：给元素 position:absolute; left/top/right/bottom/transform；父级需 position:relative 且允许溢出（overflow:visible）。注意 .nano-voice-modal 有 overflow 裁切：元素超出卡片会被「藏起来」。
     【重要·避免翻车】不要用 position:fixed——那是相对整块屏幕定位，元素会「满屏乱飞」；做小范围位移优先用 transform:translate()。也绝不要让元素盖住底部「美化 / 取消」两个按钮（它们在卡片外、z-index 已抬高，DIY 里别用更大的 z-index 去覆盖）。
  3) 重排：父级 display:flex; flex-direction:column/reverse；用 order 调整顺序
  4) 换头像/图片：selector::before{content:url("图片地址")} 或改 background-image
  5) 加文字/角标/水印：selector::after{content:"文案"}
  6) 换字体/颜色/尺寸/圆角/间距：font-family / font-size / color / background / border-radius 任意改
  7) 想“覆盖 HTML”：CSS 无法新增可交互 DOM，但可用 ::before/::after 的 content 加文字/贴图，并把原元素 display:none 后在其位置摆新内容
  8) 换可交互图标的图 / 挪位置（功能不变）：能点的元素不能删（删了功能就没了）。做法是
     「隐藏里面原来的图案 + 给这个按钮换背景图 + 挪位置」：
       .某个按钮 > svg, .某个按钮 > i { display:none; }                 // 隐藏原图案，按钮和点击区保留
       .某个按钮 { background:url("https://新图标.svg") center/22px no-repeat; }  // 换新图标
       .某个按钮 { position:absolute; right:16px; top:12px; }            // 想挪到哪就改定位
     ::before/::after 画的图案不能点，只能做纯装饰占位（加 pointer-events:none）。
注意：不要写 <script>；.nano-voice-modal 是卡片本体；.iv-customize 是编辑面板（仅打开美化时出现，勿改其 display）。`;

  // 复制文本到剪贴板（带 execCommand 兜底，兼容 WebView）
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    } catch (e) {}
    return new Promise(function (resolve) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      } catch (e) {}
      resolve();
    });
  }

  // ============================================
// 提示词定义（放在 heart.js 开头）
// ============================================

// ===== 1. 此刻 · 印象 提示词 =====
function buildImpressionPrompt(charName) {
  return `你是一个人类，此时你是${charName}。

请用一段简洁的文字（20-30字）描写${charName}此刻的样子：
- 位置（比如坐在窗边、靠在沙发上、站在阳台上）
- 穿着（比如白衬衫、灰色卫衣、黑色高领）
- 动作（比如指尖轻叩桌面、托腮、望向窗外）

要求：用第三人称，描写的句子要像电影画面一样有质感，直接写画面。
【严禁】以"男/女/他/她/男人/女人/男的/女的/这男人/这女人"等性别或人称词开头或作前缀（例如绝不能写"男靠在窗边""女穿着衬衫"）。
不要使用关联词（如"因为…所以…"、"虽然…但是…"、"既…又…"等）。
严禁出现"小姑娘/小东西/小家伙/小丫头/小可爱/女孩/姑娘/丫头/女人/这女人/这丫头"等油腻称呼与霸总腔。
严禁霸总网文式的生理特写：低吼、揉碎、掐腰、红着眼、哑声、眸色一沉、危险地眯眼、喉结滚动等；也不要身体部位特写或性暗示。
严禁“过来让我抱一下 / 让我抱抱 / 过来抱抱 / 来抱一下 / 抱一下 / 抱抱我 / 过来亲一下 / 亲一下 / 摸摸头 / 揉揉头”这类撒娇求抱、索要肢体亲昵的话术。

示例："坐在窗边，白衬衫微敞，指尖轻叩桌面"
示例二："窝在沙发角落，灰色卫衣的帽子压得很低，盯着手机发呆"

现在请写出${charName}此刻的印象：`;
}

// ===== 2. 心声 提示词 =====
function buildThoughtPrompt(charName, userName, messageText) {
  let prompt = `你是一个人类，此时你是${charName}，你在和${userName}对话。

在发送本轮消息的时候，你是怎么想的？心理活动是怎么样的？

要求：
1. 不得霸总油腻，不得使用关联词（如"因为…所以…"、"虽然…但是…"）
2. 不得出现任何关于"AI助手"、"语言模型"、"人工智能"等相关内容
3. 此篇心理描写不得低于90字
4. 用第一人称"我"来写，像在写私人日记
5. 语言风格：平实、口语化，像普通人心里随口想的话；不追求文采，不煽情、不文艺腔
6. 可以有不完整的句子、跳跃的思绪、反问、自我怀疑，越真实越好
7. 严禁出现"小姑娘/小东西/小家伙/小丫头/小可爱/女孩/姑娘/丫头/女人"等油腻称呼与霸总腔
7.1 严禁"过来让我抱一下 / 让我抱抱 / 过来抱抱 / 来抱一下 / 抱一下 / 抱抱我 / 过来亲一下 / 亲一下 / 摸摸头 / 揉揉头"这类撒娇求抱、索要肢体亲昵的话术
8. 严禁催促、命令、安排对方的生活（如催吹头发、起床、睡觉、吃饭、喝水、吃药、早点休息）
9. 严禁替对方说话或预设对方的回答、反应；严禁凭空给对方添加胃病等任何病症，除非设定里明确写了
10. 严禁霸道油腻/霸总网文腔：小姑娘、小东西、小丫头、丫头、女人、这女人、低吼、揉碎、掐腰、红着眼、哑声、眸色一沉、你是我的、逃不掉、宠你、乖、听话、让我好好疼你、我接住你、我等你慢慢说、别怕有我在 等一律禁止；不写占有欲、命令口吻、露骨或性暗示。写完自查一遍，出现即重写。
11. 严禁“过来让我抱一下 / 让我抱抱 / 过来抱抱 / 来抱一下 / 抱一下 / 抱抱我 / 过来亲一下 / 亲一下 / 摸摸头 / 揉揉头”这类撒娇求抱、索要肢体亲昵的话术。
12. 禁止「咯噔文学」：不要用"突然/忽然/猛地/刹那间"制造戏剧化转折，不要写"心里一下子就空了/凉了/明白了""全世界都安静了""原来……""那一刻我懂了""心口一紧"这类一惊一乍、故作深情的句子。平铺直叙地说你此刻真实在想的琐碎念头即可。

现在请写出${charName}的心理活动：`;

    if (messageText) {
      prompt += `\n\n（你刚刚发送的消息是："${messageText}"）`;
    }

    return prompt;
}

// 心声手记：不折叠。框够高就完整显示，内容太长时在心声区域内滑动（滚动条已隐藏）
function setupThoughtExpand(el) {
  if (!el || typeof el.setAttribute !== 'function') return;
  el.classList.remove('collapsed', 'expanded');
  el.dataset.full = (el.textContent || '').trim();
}

  // ===== 默认模板（唯一内置模板；改完点「应用」，点「还原」恢复本模板）=====
  const DEFAULT_CSS = `/* nano-heart-default:v4
   ============================================================
   心声卡片 · 默认完整模板（头像居左 · iOS 邮件风）
   ------------------------------------------------------------
   这张卡片的所有东西都能靠 CSS 改：隐藏 / 移动 / 缩放 / 换图 / 换字 /
   换字体配色 / 重排布局。JS 只负责往下面这些挂点里写数据：
     #ivAvatar (.iv-avatar)          头像图片
     .iv-avatar-fallback             头像兜底字母（无图时显示）
     #ivSender (.iv-name)            发送人昵称
     .iv-caption                     “发送人”小字
     #ivRecipient (.user-name)       收件人
     #ivTime                         时间
     #ivSubject (.iv-subject)        “此刻 · 印象”主题
     .iv-subject-text                主题正文
     #ivThought (.iv-thought)        心声正文
     #ivExtraText (.iv-extra-text)   附加文字（默认空）
     #ivDecoTop / #ivDecoBottom      顶 / 底装饰层（默认隐藏）
     #ivSections / .iv-section / .iv-section-title / .iv-section-body  附加板块（评论区等，有内容才显示）
     .iv-header / .iv-sender / .iv-sender-info / .iv-meta / .iv-content  结构容器
    注意：只改样式，不要删这些元素；不要写 <script>。
   ============================================================
   ---- 新增模块 / 附加板块（在正文下面加评论区、穿搭、状态等）----
   想给心声「新增一块」不用点按钮，直接在本模板里写 @heart-sections 注释块，
   每行一个板块： [板块名] 生成要求（视角 / 条数 / 字数 / 主题…）
   每轮 AI 会按这里的要求，在 [heart:…] 之后用
     [section:板块名] 内容 [/section]
   输出；卡片里就会多渲染一块（有内容才显示）。板块属于模板，复制 / 导出 /
   导入模板时会一起带走。渲染节点： #ivSections > .iv-section >（.iv-section-title + .iv-section-body）。
    下面是板块定义区（现在为空 = 不生成任何板块）。照着写即可，例如：
     [评论区] 以粉丝视角写 5 条评论，每条 20 字，围绕本条心声调侃或共鸣
     [穿搭] 写角色此刻的穿着，跟随正文更新
   ============================================================
   ---- 最高权限：还能写脚本（造 HTML / 改 DOM / 绑事件）----
   写法：用英文注释把脚本包起来——开头写「/ * @js」，结尾写「* /」，中间就是 JS，
   被包住的部分不当作 CSS，心声面板渲染后会执行。示例（全角符号换成英文符号即可）：
     ／＊ @js
       mount.appendChild(el('div', { style:{position:'fixed', bottom:'12px'} }, ['DIY']));
       onCleanup(() => {});
     ＊／
   可直接用的名字：mount / $ / $$ / el / on / observe / onCleanup / document / window。
   点「还原」会清空脚本、mount 与所有 onCleanup，回到初始 UI。
   ============================================================
   ---- 改法大全（复制需要的行，改完点「应用」）----
   【1. 隐藏任意元素】加 display:none !important;
     .nano-voice-modal .iv-caption { display:none !important; }   /* 隐藏“发送人”小字 */
     .nano-voice-modal .iv-meta    { display:none !important; }   /* 隐藏收件人/时间 */
     .nano-voice-modal .iv-avatar  { display:none !important; }   /* 隐藏头像 */
     .nano-voice-modal .iv-subject { display:none !important; }   /* 隐藏此刻·印象 */
   【2. 头像大小 / 圆角 / 位置】
     大小圆角改变量：.nano-voice-modal{ --iv-avatar-size:72px; --iv-avatar-radius:50%; }
     居中小位移：.nano-voice-modal .iv-avatar{ transform:translate(0, -6px); }
     放到右上角：.nano-voice-modal .iv-avatar{ position:absolute; right:14px; top:12px; left:auto; }
       （父级 .iv-header 已是 position:relative；别用 position:fixed，也别超卡片边界，超出的会被裁掉）
   【3. 头像 / 名字位置互换，或整行改版式】
     头像居右：.nano-voice-modal .iv-sender{ flex-direction:row-reverse; }
               .nano-voice-modal .iv-sender-info{ margin-left:0; margin-right:14px; text-align:right; }
     居中大头像：.nano-voice-modal .iv-sender{ flex-direction:column; align-items:center; text-align:center; }
               .nano-voice-modal .iv-sender-info{ flex:none; margin:12px 0 0; text-align:center; }
   【4. 重排内容区顺序】父级 display:flex; flex-direction:column; 再用 order 调先后
     .nano-voice-modal .iv-content{ display:flex; flex-direction:column; }
     .nano-voice-modal .iv-content-label{ order:1; } .nano-voice-modal .iv-thought{ order:2; }
   【5. 加一行文字 / 角标 / 水印】
     附加文字：.nano-voice-modal .iv-extra-text{ display:block; }
               .nano-voice-modal .iv-extra-text::before{ content:"—— 仅你可见"; }
               /* 需要换行时写 "\\A" 并配 white-space:pre-wrap */
     角标：.nano-voice-modal .iv-content::after{ content:"Nano"; position:absolute; right:16px; bottom:12px; opacity:.35; }
   【6. 加装饰贴图】把装饰层设为 display:block 后用 ::before 放图（也可直接往 #ivDecoTop / #ivDecoBottom 里放 <img>）
     .nano-voice-modal .iv-deco-top{ display:block; }
     .nano-voice-modal .iv-deco-top::before{ content:url("https://图片地址"); display:block; margin:0 auto; }
   【7. 换字体 / 配色 / 宽度 / 圆角 / 阴影】
     字体族：--iv-sans / --iv-serif；大小颜色：.iv-name / .iv-thought 的 font-size、color
     卡片：.nano-voice-modal 的 width、max-width、background、border-radius、box-shadow
   【8. 换可交互按钮的图标 / 位置（功能不变）】别删按钮，只换图案：
     .nano-voice-modal .某个按钮 > svg { display:none; }
     .nano-voice-modal .某个按钮{ background:url("https://新图标.svg") center/22px no-repeat; }
   【9. 整页遮罩】改 .nano-voice-layer 的 background（这是卡片外的遮罩层）。
   想恢复默认：点底部「还原」。
   ============================================================ */
.nano-voice-modal {
  --iv-avatar-size: 72px;
  --iv-avatar-radius: 50%;
  background: rgba(255, 255, 255, 0.78);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 28px 64px rgba(0, 0, 0, 0.12), 0 8px 20px rgba(0, 0, 0, 0.04);
  color: #1c1c1e;
}
.iv-header {
  background: rgba(255, 255, 255, 0.30);
  border-bottom: 1px solid rgba(60, 60, 67, 0.10);
  border-radius: 20px 20px 0 0;
}
.iv-avatar {
  width: var(--iv-avatar-size, 72px);
  height: var(--iv-avatar-size, 72px);
  flex: 0 0 var(--iv-avatar-size, 72px);
  background: rgba(240, 240, 245, 0.6);
  border-radius: var(--iv-avatar-radius, 50%);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}
/* 头像居左 · 昵称在右（想改回「居中大头像」：把 .iv-sender 改成 flex-direction:column; align-items:center; 再给 .iv-sender-info 换成 margin-top:12px; text-align:center） */
.iv-sender { flex-direction: row; align-items: center; }
.iv-sender-info { flex: 1 1 auto; margin-left: 14px; margin-top: 0; text-align: left; }
.iv-name { white-space: normal; overflow-wrap: anywhere; font-size: 20px; }
.iv-unread { margin-left: auto; margin-top: 0; }
.iv-meta { grid-template-columns: auto auto; justify-content: flex-start; column-gap: 6px; }
.iv-subject { text-align: left; }
.iv-subject-text { text-align: left; }
.iv-content { min-height: 200px; padding: 20px 24px 26px; }
/* DIY 装饰层 / 附加文字（默认空不占位；填了内容或加 .on 才显示）。
   注意：若用 CSS 的 ::after/::before 追加装饰，请把 .iv-deco-top / .iv-deco-bottom 设为 display:block。 */
.iv-deco { position: relative; z-index: 6; pointer-events: none; display: none; }
.iv-deco.on { display: block; }
.iv-deco-top.on { padding: 8px 22px 0; }
.iv-deco-bottom.on { padding: 0 22px 10px; }
.iv-deco img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
.iv-extra-text {
  margin-top: 12px; padding-top: 8px;
  border-top: 1px dashed rgba(60, 60, 67, 0.12);
  color: #8e8e93; font-size: 13px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.iv-extra-text:empty { display: none; }
.iv-caption {
  color: #8e8e93;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
}
.iv-name {
  color: #1c1c1e;
  font-family: "Iowan Old Style", "Baskerville", "Times New Roman", "Songti SC", serif;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.2px;
}
.iv-meta-key { color: #8e8e93; font-size: 12px; font-weight: 400; letter-spacing: 0.2px; }
.iv-meta-value { color: #1c1c1e; font-size: 12px; font-weight: 450; }
.iv-meta-value.user-name { color: #007aff; font-weight: 500; }
.iv-subject {
  padding: 14px 22px 12px;
  background: rgba(255, 255, 255, 0.15);
  border-bottom: 1px solid rgba(60, 60, 67, 0.10);
}
.iv-subject-label {
  color: #8e8e93;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.8px;
  text-transform: uppercase;
}
.iv-subject-text {
  color: #1c1c1e;
  font-family: "Iowan Old Style", "Baskerville", "Times New Roman", "Songti SC", serif;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.3px;
}
.iv-content {
  min-height: 240px;
  padding: 18px 22px 70px 22px;
  background: radial-gradient(circle at 90% 10%, rgba(0, 122, 255, 0.02), transparent 40%), rgba(255, 255, 255, 0.10);
  border-radius: 0 0 20px 20px;
}
.iv-content-label {
  color: #8e8e93;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  margin-bottom: 12px;
}
.iv-thought {
  color: #1c1c1e;
  font-family: "Iowan Old Style", "Baskerville", "Times New Roman", "Songti SC", serif;
  font-size: 16px;
  font-weight: 400;
  font-style: normal;
  letter-spacing: 0.3px;
  line-height: 1.7;
  transform: none;
  text-shadow: none;
  white-space: pre-wrap; word-break: break-word; padding: 4px 0;
}
.iv-thought.expanded {
  max-height: 48vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  padding-right: 4px;
  overscroll-behavior: contain;
}
.iv-icon-btn {
  background: rgba(255, 255, 255, 0.40);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  color: #1c1c1e;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 0.7);
}

/* ============================================================
   附加板块定义区（新增模块写这里）
   ------------------------------------------------------------
   每行一个板块：[板块名] 生成要求
   不写任何以 [ 开头的行 = 不生成板块。示例见本模板顶部说明。
   ============================================================ */
/* @heart-sections
*/`;

  // ===== 内置模板：只保留一个「完整」默认模板 =====
  // 它是唯一内置、不可删除/改名的预设；所有视觉都能在本模板里改，改完点「应用」即可。
  // 想保留自己的版本：改完在下面「模板名称」里起个名，点「保存」另存为普通预设。
  const BUILTIN_TEMPLATES = [
    { id: 'default', name: '默认模板（完整）', css: DEFAULT_CSS }
  ];
  function isBuiltinTemplate(id) {
    return BUILTIN_TEMPLATES.some(function (b) { return b.id === id; });
  }
  // 旧版内置模板 id：初始化时清掉，避免继续占用「内置」名额
  const LEGACY_BUILTIN_IDS = ['builtin_classic', 'builtin_minimal', 'builtin_free'];

  // ===== IndexedDB 工具 =====
  const DB_NAME = 'NanoVoiceDB';
  const STORE_NAME = 'templates';
  let db = null;
  let isInternalChange = false;
  let currentTemplateId = 'default';

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function(e) {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          d.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = function(e) { resolve(e.target.result); };
      request.onerror = function(e) { reject(e.target.error); };
    });
  }

  async function getAllTemplates() {
    if (!db) db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveTemplate(id, name, css) {
    if (!db) db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ id, name, css });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteTemplate(id) {
    if (!db) db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function initDefaultTemplate() {
    const all = await getAllTemplates();
    const byId = {};
    all.forEach(function (t) { byId[t.id] = t; });
    // 清掉旧版内置模板：现在只保留一个「完整」默认模板
    for (var k = 0; k < LEGACY_BUILTIN_IDS.length; k++) {
      if (byId[LEGACY_BUILTIN_IDS[k]]) {
        try { await deleteTemplate(LEGACY_BUILTIN_IDS[k]); } catch (e) {}
      }
    }
    // 默认模板：带版本标记；缺失或是老版本时写入最新的「完整模板」
    const def = byId['default'];
    if (!def) {
      await saveTemplate('default', BUILTIN_TEMPLATES[0].name, DEFAULT_CSS);
      return;
    }
    const css = String(def.css || '');
    const isOld = css.indexOf('nano-heart-default:v4') === -1 ||
      css.indexOf('狂野草书') !== -1 || css.indexOf('Snell Roundhand') !== -1;
    if (isOld) await saveTemplate('default', BUILTIN_TEMPLATES[0].name, DEFAULT_CSS);
  }

  // ===== 渲染下拉列表 =====
  async function renderSelectOnly(selectedId) {
    const all = await getAllTemplates();
    const select = $('ivTemplateSelect');
    const currentVal = selectedId || select.value || currentTemplateId;

    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— 选择预设 —';
    placeholder.disabled = true;
    select.appendChild(placeholder);

    for (const tpl of all) {
      const opt = document.createElement('option');
      opt.value = tpl.id;
      opt.textContent = tpl.name;
      select.appendChild(opt);
    }

    const exists = all.some(t => t.id === currentVal);
    if (exists) {
      select.value = currentVal;
      currentTemplateId = currentVal;
    } else if (all.length > 0) {
      select.value = all[0].id;
      currentTemplateId = all[0].id;
    } else {
      select.value = '';
      currentTemplateId = '';
    }

    const selected = all.find(t => t.id === select.value);
    if (selected) {
      $('ivCss').value = selected.css;
    } else {
      $('ivCss').value = '';
    }
  }

  // ===== 加载指定模板到编辑器 =====
  async function loadTemplateToEditor(id) {
    const all = await getAllTemplates();
    const tpl = all.find(t => t.id === id);
    if (tpl) {
      $('ivCss').value = tpl.css;
      currentTemplateId = id;
      $('ivTemplateName').value = '';
      const select = $('ivTemplateSelect');
      if (select.value !== id) {
        select.value = id;
      }
      refreshSectionsFromCss(tpl.css || '');
    }
  }

  // ===== 保存当前编辑器内容到当前选中的模板 =====
  async function saveCurrentToTemplate() {
    const id = $('ivTemplateSelect').value;
    if (!id) return false;
    const all = await getAllTemplates();
    const tpl = all.find(t => t.id === id);
    if (tpl) {
      tpl.css = $('ivCss').value;
      await saveTemplate(tpl.id, tpl.name, tpl.css);
      return true;
    }
    return false;
  }

  // ===== 应用CSS到页面（模板里还可写 /* @js ... */ 脚本块，用 NanoBeautifyRT 执行）=====
  function runHeartJs(css) {
    try {
      if (!window.NanoBeautifyRT) return;
      var parsed = window.NanoBeautifyRT.parse(css || '');
      window.NanoBeautifyRT.run('heart', parsed.js, { mountParent: document.body });
    } catch (e) {}
  }
  function applyCustomCSS(css) {
    var raw = (css != null) ? css : ($('ivCss') ? $('ivCss').value : '');
    var parsed = window.NanoBeautifyRT ? window.NanoBeautifyRT.parse(raw) : { css: raw };
    const styleTag = document.getElementById('nanoVoiceCustomCSS');
    if (styleTag) {
      styleTag.textContent = parsed.css || '';
    }
    runHeartJs(raw);
  }

  // ===== 已应用的 CSS 持久化（默认外观交给 css/heart.css，不再被默认模板覆盖）=====
  function saveAppliedCss(css) {
    try { localStorage.setItem('nano_voice_applied_css', css || ''); } catch (e) {}
  }
  function loadAppliedCss() {
    try { return localStorage.getItem('nano_voice_applied_css') || ''; } catch (e) { return ''; }
  }

  // ===== 内置提示词（AI 生成心声时必读；CSS 模板无法表达，单独存 localStorage） =====
  const BUILTIN_PROMPT_KEY = 'nano_heart_builtin_prompt';
  function loadBuiltinPrompt() {
    const bp = $('ivBuiltinPrompt');
    if (!bp) return;
    try { bp.value = localStorage.getItem(BUILTIN_PROMPT_KEY) || ''; } catch (e) { bp.value = ''; }
  }
  function bindBuiltinPrompt() {
    const bp = $('ivBuiltinPrompt');
    if (!bp) return;
    const save = function () {
      try { localStorage.setItem(BUILTIN_PROMPT_KEY, bp.value.trim()); } catch (e) {}
    };
    bp.addEventListener('input', save);
    bp.addEventListener('change', save);
  }

  // ===== 附加板块（评论区等）：定义写在「模板」里，AI 每轮生成，心声卡片里多渲染一块 =====
  // 新增/修改板块不动 UI，直接在模板 CSS 里写一个注释块即可（模板导出/分享会一起带走）：
  //   /* @heart-sections
  //   [评论区] 以粉丝视角写 5 条评论，每条 20 字，围绕本条心声调侃或共鸣
  //   [穿搭] 写角色此刻的穿着，跟随正文更新
  //   */
  // 注：块里没有以 [名称] 开头的行就不会产生板块，所以可以在块里写说明文字。
  const SECTIONS_KEY = 'nano_heart_sections';
  let _sections = [];
  function getSections() { return _sections; }
  function saveSections(arr) {
    _sections = Array.isArray(arr) ? arr : [];
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(_sections)); } catch (e) {}
  }
  // 从模板 CSS 解析 /* @heart-sections ... */ 块，每行 [名称] 生成要求
  function parseTemplateSections(css) {
    const out = [];
    const m = String(css || '').match(/\/\*\s*@heart-sections([\s\S]*?)\*\//i);
    if (!m) return out;
    m[1].split(/\r?\n/).forEach(function (line) {
      const t = String(line).replace(/^\s*\*?\s?/, '').trim();
      if (!t) return;
      const mm = t.match(/^[\[【]\s*([^\]】]+?)\s*[\]】]\s*[:：]?\s*([\s\S]*)$/);
      if (mm && mm[1]) out.push({ id: 'sec_' + out.length, name: mm[1].trim(), prompt: (mm[2] || '').trim() });
    });
    return out;
  }
  // 把板块写回模板 CSS 的 @heart-sections 块（其余内容保留）
  function writeTemplateSections(css, sections) {
    const src = String(css || '');
    const lines = (Array.isArray(sections) ? sections : [])
      .filter(function (s) { return s && s.name; })
      .map(function (s) { return '[' + s.name + ']' + (s.prompt ? (' ' + s.prompt) : ''); });
    const block = '/* @heart-sections\n' + lines.join('\n') + '\n*/';
    if (/\/\*\s*@heart-sections[\s\S]*?\*\//i.test(src)) {
      return src.replace(/\/\*\s*@heart-sections[\s\S]*?\*\//i, block);
    }
    return (src ? (src.replace(/\s*$/, '') + '\n') : '') + block + '\n';
  }
  // 用一段模板 CSS 刷新板块（模板是板块的唯一来源）
  function refreshSectionsFromCss(css) {
    saveSections(parseTemplateSections(css));
  }
  // 把当前板块（含外部 API 写入）落回当前模板
  function persistSectionsToTemplate() {
    (async function () {
      try {
        const all = await getAllTemplates();
        const id = currentTemplateId || 'default';
        const tpl = all.find(function (t) { return t.id === id; }) || all.find(function (t) { return t.id === 'default'; });
        if (!tpl) return;
        const next = writeTemplateSections(tpl.css || '', getSections());
        if (next !== tpl.css) {
          await saveTemplate(tpl.id, tpl.name, next);
          if ($('ivCss') && currentTemplateId === tpl.id) $('ivCss').value = next;
        }
      } catch (e) {}
    })();
  }
  // 生成 AI 提示词：要求每轮在 [heart:...] 之后输出各板块
  function sectionsPromptBlock() {
    const list = getSections().filter(function (s) { return s && s.name && s.prompt; });
    if (!list.length) return '';
    const L = [];
    L.push('【心声 · 附加板块（必须输出，放在 [heart:...] 之后；每个板块都要写，不可省略）】');
    L.push('格式严格为（板块内容可多行）：');
    L.push('[section:板块名]');
    L.push('板块内容');
    L.push('[/section]');
    L.push('各板块要求：');
    list.forEach(function (s) { L.push('- ' + s.name + '：' + s.prompt); });
    return L.join('\n');
  }
  // 从文本里抽取并移除 [section:名]...[/section] 块
  function parseSections(text) {
    const sections = [];
    let src = String(text || '');
    if (!src) return { text: src, sections: sections };
    src = src.replace(/\[(?:section|板块)\s*:\s*([^\]\n]+)\]([\s\S]*?)\[\/\s*(?:section|板块)\s*\]/gi, function (m, name, content) {
      name = String(name || '').trim();
      content = String(content || '').trim();
      if (name && content) sections.push({ name: name, content: content });
      return ' ';
    });
    // 容错：末尾未闭合的 [section:名] 一直吃到结尾
    src = src.replace(/\[(?:section|板块)\s*:\s*([^\]\n]+)\]\s*([\s\S]*)$/i, function (m, name, content) {
      name = String(name || '').trim();
      content = String(content || '').trim();
      if (name && content) sections.push({ name: name, content: content });
      return ' ';
    });
    src = src.replace(/\[\/?(?:section|板块)(?:\s*:[^\]\n]*)?\]/gi, ' ');
    return { text: src, sections: sections };
  }
  // 渲染到卡片
  function renderSections(list) {
    const box = $('ivSections');
    const modal = $('nanoVoiceModal');
    if (!box) return;
    box.innerHTML = '';
    const sec = Array.isArray(list) ? list.filter(function (s) { return s && (s.content || s.name); }) : [];
    if (!sec.length) {
      box.style.display = 'none';
      if (modal) modal.classList.remove('has-sections');
      return;
    }
    sec.forEach(function (s) {
      const item = document.createElement('div');
      item.className = 'iv-section';
      const title = document.createElement('div');
      title.className = 'iv-section-title';
      title.textContent = s.name || '';
      const body = document.createElement('div');
      body.className = 'iv-section-body';
      body.textContent = s.content || '';
      item.appendChild(title);
      item.appendChild(body);
      box.appendChild(item);
    });
    box.style.display = 'block';
    if (modal) modal.classList.add('has-sections');
  }
  // ===== 关闭弹窗 =====
  function closeVoice() {
    const layer = $('nanoVoiceLayer');
    layer.classList.remove('active', 'customizing');
    const panel = $('ivCustomize');
    if (panel) panel.classList.remove('show');
    try { window.parent.postMessage({ type: 'NANO_INNER_VOICE_CLOSE' }, '*'); } catch(e) {}
  }

  // ===== 打开弹窗（由 chat-core 调用） =====
  function openVoice(data) {
    const layer = $('nanoVoiceLayer');
    if (!layer) {
      console.warn('[Heart] 未找到 nanoVoiceLayer 元素');
      return;
    }

    // 更新发件人
    const sender = $('ivSender');
    if (sender && data.from) sender.textContent = data.from;

    // 更新收件人
    const recipient = $('ivRecipient');
    if (recipient && data.to) recipient.textContent = data.to;

    // 更新主题（此刻 · 印象）
    const subject = $('ivSubject');
    if (subject) subject.textContent = data.subject || '';

    // 更新心声内容
    const thought = $('ivThought');
    if (thought) {
      thought.textContent = data.message || '';
      setupThoughtExpand(thought);
    }

    // 更新时间
    const time = $('ivTime');
    if (time) {
      if (data.time) {
        time.textContent = data.time;
      } else {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        time.textContent = h + ':' + m;
      }
    }

    // 更新头像
    const avatar = $('ivAvatar');
    const fallback = $('ivAvatarFallback');
    if (data.avatar && avatar) {
      avatar.src = data.avatar;
      avatar.hidden = false;
      if (fallback) fallback.hidden = true;
    } else if (fallback) {
      fallback.hidden = false;
      if (avatar) avatar.hidden = true;
    }

    // 附加板块（评论区等）
    renderSections(data.sections);

    // 显示弹窗
    layer.classList.add('active');
  }

  // ===== 初始化 =====
  (async function init() {
    await initDefaultTemplate();
    await renderSelectOnly('default');
    const all = await getAllTemplates();
    const defaultTpl = all.find(t => t.id === 'default');
    if (defaultTpl) {
      $('ivCss').value = defaultTpl.css;
    }
    // 默认外观交给 css/heart.css；仅当用户自定义过才注入覆盖 CSS，
    // 这样直接改 css/heart.css 也能生效（不再被默认模板强制覆盖）
    const appliedCss = loadAppliedCss();
    if (appliedCss) applyCustomCSS(appliedCss);
    // 附加板块由「模板」定义：优先取已应用的 CSS，其次取默认模板
    refreshSectionsFromCss(appliedCss || (defaultTpl ? defaultTpl.css : DEFAULT_CSS));
    loadBuiltinPrompt();
    bindBuiltinPrompt();

    // ===== 事件绑定 =====
    $('ivExit').addEventListener('click', closeVoice);
    $('nanoVoiceLayer').addEventListener('click', function(e) {
      if (e.target === this) closeVoice();
    });

    // 心声自定义 CSS 的启停：编辑美化面板时临时停用，保证「美化页面」不被心声样式影响
    const setCustomCssEnabled = function (on) {
      try {
        const t = document.getElementById('nanoVoiceCustomCSS');
        if (t) t.disabled = !on;
        const q = document.getElementById('nanoVoiceQuickCSS');
        if (q) q.disabled = !on;
      } catch (e) {}
    };
    // 美化面板开关（打开时关掉毛玻璃，iOS 不卡；并隔离心声美化对面板的影响）
    const setCustomizing = function (on) {
      const layer = $('nanoVoiceLayer');
      if (layer) layer.classList.toggle('customizing', !!on);
      setCustomCssEnabled(!on);
    };
    $('ivBeautify').addEventListener('click', async function() {
      $('ivCustomize').classList.add('show');
      setCustomizing(true);
      await initDefaultTemplate();
      // 未选中任何模板时，回退到默认模板，并把默认 UI 的 css 代码载入输入框
      const target = currentTemplateId || 'default';
      await renderSelectOnly(target);
    });
    $('ivCustomizeClose').addEventListener('click', function() {
      $('ivCustomize').classList.remove('show');
      setCustomizing(false);
    });
    // 打开「整页美化」（带实时预览的完整页面）
    if ($('ivFullPage')) $('ivFullPage').addEventListener('click', function() {
      try {
        var cid = '', cname = '';
        try { var sp = new URLSearchParams(location.search); cid = sp.get('chat') || ''; cname = sp.get('name') || ''; } catch (e) {}
        // 头像 / 名字同步给整页预览
        try {
          var av = '';
          var aimg = document.getElementById('avatarImage');
          var ivimg = document.getElementById('ivAvatar');
          if (aimg && aimg.src && aimg.style.display !== 'none') av = aimg.src;
          else if (ivimg && !ivimg.hidden && ivimg.src) av = ivimg.src;
          sessionStorage.setItem('nano_heart_preview_avatar', av || '');
          var snd = document.getElementById('ivSender');
          if (!cname && snd && snd.textContent) cname = snd.textContent.trim();
          sessionStorage.setItem('nano_heart_preview_name', cname || '');
        } catch (e) {}
        var qs = [];
        if (cid) qs.push('chat=' + encodeURIComponent(cid));
        if (cname) qs.push('name=' + encodeURIComponent(cname));
        var url = 'heart-setting.html' + (qs.length ? ('?' + qs.join('&')) : '');
        // title 留空 + showBack:false —— 隐藏主框架那层顶栏，避免出现两个顶栏（本页自带顶栏）
        window.parent.postMessage({ type: 'openFullscreen', url: url, title: '', showBack: false, source: 'chat_inner' }, '*');
      } catch (e) {}
    });

    // 下拉切换
    $('ivTemplateSelect').addEventListener('change', async function() {
      if (isInternalChange) return;
      const id = this.value;
      if (!id) {
        $('ivCss').value = '';
        currentTemplateId = '';
        return;
      }
      await loadTemplateToEditor(id);
    });

    // 保存模板
    $('ivSaveTemplate').addEventListener('click', async function() {
      const name = $('ivTemplateName').value.trim();
      if (!name) { alert('请输入模板名称'); return; }
      const css = $('ivCss').value;
      const id = 'tpl_' + Date.now();
      await saveTemplate(id, name, css);
      isInternalChange = true;
      await renderSelectOnly(id);
      isInternalChange = false;
      $('ivTemplateName').value = '';
      refreshSectionsFromCss(css);
    });

    // 修改模板
    $('ivRenameTemplate').addEventListener('click', async function() {
      const id = $('ivTemplateSelect').value;
      if (!id) { alert('请先选择一个预设'); return; }
      if (isBuiltinTemplate(id)) { alert('内置模板不可修改，请另存为新模板'); return; }

      const all = await getAllTemplates();
      const tpl = all.find(t => t.id === id);
      if (!tpl) return;

      const newName = $('ivTemplateName').value.trim();
      const newCss = $('ivCss').value;

      const nameChanged = newName && newName !== tpl.name;
      const cssChanged = newCss !== tpl.css;

      if (!nameChanged && !cssChanged) {
        alert('没有检测到任何修改');
        return;
      }

      let msg = '确定要更新 "' + tpl.name + '" 吗？\n';
      if (nameChanged) msg += '• 名称: "' + tpl.name + '" → "' + newName + '"\n';
      if (cssChanged) msg += '• CSS 代码已修改';
      if (!confirm(msg)) return;

      const finalName = nameChanged ? newName : tpl.name;
      const finalCss = cssChanged ? newCss : tpl.css;
      await saveTemplate(id, finalName, finalCss);

      isInternalChange = true;
      await renderSelectOnly(id);
      isInternalChange = false;
      $('ivTemplateName').value = '';
      refreshSectionsFromCss(finalCss);
    });

    // 删除模板
    $('ivDeleteTemplate').addEventListener('click', async function() {
      const id = $('ivTemplateSelect').value;
      if (!id) { alert('请先选择一个预设'); return; }
      if (isBuiltinTemplate(id)) { alert('内置模板不可删除'); return; }
      const all = await getAllTemplates();
      const tpl = all.find(t => t.id === id);
      if (!tpl) return;
      if (confirm(`确定要删除 "${tpl.name}" 吗？`)) {
        await deleteTemplate(id);
        const defaultTpl = all.find(t => t.id === 'default');
        if (defaultTpl) {
          isInternalChange = true;
          await renderSelectOnly('default');
          isInternalChange = false;
          $('ivCss').value = defaultTpl.css;
          currentTemplateId = 'default';
          refreshSectionsFromCss(defaultTpl.css || '');
        }
        $('ivTemplateName').value = '';
      }
    });

    // 清空：清掉编辑框 + 已应用的覆盖样式，回到初始 UI（快捷 DIY 开关保持不变）
    if ($('ivClearBtn')) $('ivClearBtn').addEventListener('click', function() {
      $('ivCss').value = '';
      const select = $('ivTemplateSelect');
      if (select) select.value = '';
      currentTemplateId = '';
      const styleTag = document.getElementById('nanoVoiceCustomCSS');
      if (styleTag) styleTag.textContent = '';
      if (window.NanoBeautifyRT) window.NanoBeautifyRT.clear('heart');
      saveAppliedCss('');
      // 清空覆盖 → 板块回到默认模板的定义
      (async function () {
        try {
          const all = await getAllTemplates();
          const tpl = all.find(t => t.id === 'default');
          refreshSectionsFromCss(tpl ? tpl.css : DEFAULT_CSS);
        } catch (e) {}
      })();
    });

    // 复制初始模板：始终复制内置的「完整初始模板」+ DIY 配方，而不是当前编辑过的内容。
    // 这样用户想从头改、或交给 AI 重构时，拿到的是干净的初始模板。
    if ($('ivCopyTemplate')) $('ivCopyTemplate').addEventListener('click', async function() {
      let css = DEFAULT_CSS;
      try {
        const all = await getAllTemplates();
        const def = all.find(t => t.id === 'default');
        if (def && def.css) css = def.css;
      } catch (e) {}
      const text = (window.NANO_HEART_RECIPE || '') + '\n\n/* ===== 心声初始模板 ===== */\n' + css;
      copyText(text).then(function () {
        alert('已复制「心声初始模板 + DIY 配方」，粘贴给 AI 即可任意重构。');
      });
    });

    // 应用 CSS
    $('ivApply').addEventListener('click', async function() {
      const css = $('ivCss').value;
      applyCustomCSS(css);
      saveAppliedCss(css);
      const id = $('ivTemplateSelect').value;
      if (id) {
        await saveCurrentToTemplate();
      }
      refreshSectionsFromCss(css);
      $('ivCustomize').classList.remove('show');
      setCustomizing(false);
    });

    // 还原：还原初始 UI，并同步让 CSS 覆盖输入栏恢复为初始 UI 的 css 代码（唯一的重置按钮）
    if ($('ivRestore')) $('ivRestore').addEventListener('click', async function() {
      const styleTag = document.getElementById('nanoVoiceCustomCSS');
      if (styleTag) styleTag.textContent = '';
      if (window.NanoBeautifyRT) window.NanoBeautifyRT.clear('heart');
      saveAppliedCss('');
      document.querySelector('.iv-thought').style.cssText = '';
      document.querySelector('.nano-voice-modal').style.cssText = '';
      // 同步把 CSS 覆盖输入栏恢复为「最新的内置模板」代码（旧版默认模板会升级过来）
      await saveTemplate('default', BUILTIN_TEMPLATES[0].name, DEFAULT_CSS);
      const all = await getAllTemplates();
      const defaultTpl = all.find(t => t.id === 'default');
      if (defaultTpl) {
        $('ivCss').value = defaultTpl.css;
        currentTemplateId = 'default';
        isInternalChange = true;
        await renderSelectOnly('default');
        isInternalChange = false;
      }
      refreshSectionsFromCss(DEFAULT_CSS);
      $('ivCustomize').classList.remove('show');
      setCustomizing(false);
    });

    // 导入功能
    $('ivImportBtn').addEventListener('click', function() { $('ivFileInput').click(); });
    // 娜娜助手下发心声 CSS：立即应用并持久化；若它同时写了预设，刷新下拉并选中
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (d && d.type === 'nanoVoiceCss') {
        applyCustomCSS(d.css || '');
        saveAppliedCss(d.css || '');
        refreshSectionsFromCss(d.css || '');
        try {
          (async function () {
            await initDefaultTemplate();
            var target = currentTemplateId || 'default';
            if (d.name) {
              var all = await getAllTemplates();
              var hit = all.find(function (t) { return t.name === d.name; });
              if (hit) target = hit.id;
            }
            await renderSelectOnly(target);
          })();
        } catch (err) {}
      }
    });
    // 导出当前选中的预设（分享图标）
    $('ivExportBtn').addEventListener('click', async function() {
      const id = $('ivTemplateSelect').value;
      let name = ($('ivTemplateName').value.trim()) || '心声美化';
      let css = $('ivCss').value;
      if (id) {
        try {
          const all = await getAllTemplates();
          const tpl = all.find(t => t.id === id);
          if (tpl) { name = tpl.name || name; css = tpl.css || css; }
        } catch (e) {}
      }
      try {
        const text = JSON.stringify({ type: 'heart', name: name, css: css }, null, 2);
        const filename = String(name).replace(/[\\/:*?"<>|]/g, '_') + '.json';
        if (window.NanoExport) {
          window.NanoExport.file({ name: filename, text: text });
        } else {
          const blob = new Blob([text], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        }
      } catch (e) { alert('导出失败'); }
    });
    $('ivFileInput').addEventListener('change', function(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const content = e.target.result;
          if (file.name.endsWith('.json')) {
            const json = JSON.parse(content);
            if (json.css) $('ivCss').value = json.css;
          } else {
            $('ivCss').value = content;
          }
          const select = $('ivTemplateSelect');
          if (select) select.value = '';
          currentTemplateId = '';
        } catch (error) { alert('导入失败，请检查文件格式'); }
      };
      reader.readAsText(file);
      event.target.value = '';
    });

    // ===== 外部消息 =====
    window.addEventListener('message', function(event) {
      const data = event.data || {};
      if (data.type !== 'NANO_INNER_VOICE_UPDATE') return;
      if (typeof data.senderName === 'string') $('ivSender').textContent = data.senderName;
      if (typeof data.recipient === 'string') $('ivRecipient').textContent = data.recipient;
      if (typeof data.subject === 'string') $('ivSubject').textContent = data.subject;
      if (typeof data.thought === 'string') {                                               
        $('ivThought').textContent = data.thought;                                          
        setupThoughtExpand($('ivThought'));                                                 
        $('ivTime').textContent = '刚刚';                                                     
      }
      if (typeof data.avatar === 'string' && data.avatar) {
        $('ivAvatar').src = data.avatar;
        $('ivAvatar').hidden = false;
        $('ivAvatarFallback').hidden = true;
      }
    });

    // ===== URL参数 =====
    const params = new URLSearchParams(location.search);
    if (params.get('sender')) $('ivSender').textContent = params.get('sender');
    if (params.get('to')) $('ivRecipient').textContent = params.get('to');
    if (params.get('subject')) $('ivSubject').textContent = params.get('subject');
    if (params.get('thought')) {                                                             
      $('ivThought').textContent = params.get('thought');                                   
      setupThoughtExpand($('ivThought'));                                                   
      $('ivTime').textContent = '刚刚';                                                       
    }
  })();

  // ===== 暴露全局 API =====
  window.__heart = {
    open: openVoice,
    close: closeVoice,
    getPrompt: function(charName, userName, messageText) {
      return buildThoughtPrompt(charName || '角色', userName || '用户', messageText || '');
    },
    getImpressionPrompt: function(charName) {
      return buildImpressionPrompt(charName || '角色');
    },
    // 附加板块（评论区等）：定义写在模板里；这里给外部读取 / 写入 / 拼提示词 / 解析用。
    // save(arr) 会把板块同步写回「当前模板」的 /* @heart-sections */ 块。
    sections: {
      list: getSections,
      save: function (arr) { saveSections(arr); persistSectionsToTemplate(); },
      promptBlock: sectionsPromptBlock,
      parse: parseSections,
      parseTemplate: parseTemplateSections
    },
    // 更新数据（不打开弹窗）
    update: function(data) {
      if (data.from) {
        const el = $('ivSender');
        if (el) el.textContent = data.from;
      }
      if (data.message) {                                                                    
        const el = $('ivThought');                                                           
        if (el) { el.textContent = data.message; setupThoughtExpand(el); }                   
      }
      if (data.time) {
        const el = $('ivTime');
        if (el) el.textContent = data.time;
      }
      if (data.subject) {
        const el = $('ivSubject');
        if (el) el.textContent = data.subject;
      }
      if (data.to) {
        const el = $('ivRecipient');
        if (el) el.textContent = data.to;
      }
      if (data.sections) {
        renderSections(data.sections);
      }
      if (data.avatar) {
        const avatar = $('ivAvatar');
        const fallback = $('ivAvatarFallback');
        if (avatar) {
          avatar.src = data.avatar;
          avatar.hidden = false;
          if (fallback) fallback.hidden = true;
        }
      }
    }
  };

  console.log('[Heart] 全局 API 已注册 ✅');
})();