/* ============================================================
   js/nano-chat-template.js
   Nano「聊天美化」初始模板（高自由度 DIY 版）
   ------------------------------------------------------------
   本文件把初始模板字符串挂到 window.NANO_CHAT_TEMPLATE，
   供 js/beautify.js 作为「聊天」初始代码使用（还原 / 复制初始 / 首次进入）。

    ★ 最高权限：本模板除了 CSS，还能写脚本块（能造 HTML / 改 DOM / 绑事件）。
      写法：用英文注释把脚本包起来——开头写「/ * @js」，结尾写「* /」，
      中间就是 JS，被包住的部分不当作 CSS。示例（全角符号换成英文符号即可）：
        ／＊ @js
          mount.appendChild(el('div', { class:'x' }, ['hello']));
          onCleanup(() => {});
        ＊／
      可直接用的名字：mount / $ / $$ / el / on / observe / onCleanup / document / window。
      点「还原 / 清空」会清空脚本、mount 与所有 onCleanup，回到初始 UI。

    作用范围（js/appearance.js）：私聊内页 chat_inner.html、群聊内页 groups.html。
    注入方式：<style id="nano-beautify-chat">，晚于页面自带 CSS；全局 CSS 最后注入。

   页面作用域（为了不互相覆盖，模板按 body 类名分区）：
     chat_inner.html -> body.nano-chat-inner   （下面写作 .nano-chat-inner）
     groups.html     -> body.nano-groups       （下面写作 .nano-groups）
   公共结构（两页同名同值）不分区，直接生效。

   HTML / JS 不能被 CSS 注入。要新增 HTML 或改 JS 请改对应页面文件；
   纯 CSS 可以用 ::before / ::after 的 content 加文字/图标/URL 图片。

   速查：
   - URL 图片覆盖图标：`.xxx i,.xxx svg{display:none} .xxx::before{content:url("图片")}`
   - 去透明外包裹/玻璃：background / backdrop-filter / border / box-shadow 清零
   - 顶/底栏加底：直接写 .topbar{background:#fff} / .bottom-bar{background:#fff} 即可；
     渐变遮罩用变量 --chat-topbar-mask / --chat-bottom-mask（见配方 K2）
   - 底部 dock 图标重排 / 把功能挪到新图标位置：见「配方 N」
     （真按钮换外衣+挪位，千万别删按钮；::before/::after 画的图标不能点）
   - 卡片（转账/红包/一起听/文件等）完全重构：可换行 / 换图标 / 换底色 → 见「配方 O」
   - 隐藏但保留功能：visibility:hidden（点击区还在；display:none 会移除点击区）
   - 移动：order / position / transform / margin
   ============================================================ */

window.NANO_CHAT_TEMPLATE = `/* ============================================================
   Nano 聊天美化模板（初始模板 · 高自由度 DIY）
   目录：
   0. 主题变量
   1. 公共结构（两页通用）：容器 / 日期 / 时间分隔 / 引用块 / 翻译 / 撤回 / 思维链
   2. 私聊 chat_inner（.nano-chat-inner）：顶栏 / 消息区 / 头像 / 气泡 / 语音 /
      图片 / 卡片 / 底部 dock / 输入中 / 表情推荐
   3. 群聊 groups（.nano-groups）：顶栏 / 群公告 / 昵称行 / 气泡 / @提及 /
      语音 / 卡片(红包/通知/接龙) / 底部 dock / @下拉
   4. DIY 参考配方（大量示例，按需取消注释）
   5. 弹层速查（结构说明，不覆盖默认样式）
   ============================================================ */

/* ============================================================
   0. 主题变量
   ============================================================ */
:root {
  --chat-bg: #ffffff;
  --chat-text: #1c1c1e;
  --chat-sub: #8e8e93;
  --chat-accent: #2c2c2e;
  --chat-glass-bg: rgba(255, 255, 255, 0.65);
  --chat-glass-line: rgba(255, 255, 255, 0.5);
  --bubble-me: #2c2c2e;
  --bubble-me-text: #ffffff;
  --bubble-other: #dedede;
  --bubble-other-text: #111111;
  --chat-safe-top: var(--safe-top, 0px);
  /* 悬浮顶栏 / 底栏的底色（默认透明，气泡从下方穿过仍可见）。
     想加实色：直接写 .topbar{background:#fff} / .bottom-bar{background:#fff} 即可；
     想要渐隐遮罩（交界更自然）就改这两个变量，详见「配方 K2」。 */
  --chat-topbar-mask: transparent;
  --chat-bottom-mask: transparent;
}

/* ============================================================
   1. 公共结构（私聊 / 群聊 通用）
   ============================================================ */
.chat-container {
  width: 100%; height: 100%; max-width: 430px; margin: 0 auto;
  background: var(--chat-bg); display: flex; flex-direction: column;
  overflow: hidden; position: relative;
}
.date-label { text-align: center; color: var(--chat-sub); font-size: 12px; margin: 0 0 16px 0; padding: 4px 0; }
.chat-time-divider { text-align: center; font-size: 11px; color: var(--chat-sub); margin: 10px 0 6px; user-select: none; }
.collapse-btn {
  display: flex; justify-content: center; align-items: center; width: 100%;
  margin: 8px 0 10px 0; padding: 6px 0; cursor: pointer; font-size: 13px;
  color: var(--chat-sub); -webkit-user-select: none; user-select: none;
}

/* 引用块（发送后，气泡下方内嵌）
   HTML：<div class="quote-block left|right">
           <span class="quote-fold"><svg/></span>   <-- 昵称前小拐角，可去掉
           <span class="quote-name">昵称</span>
           <span class="quote-text">被引用内容</span>
         </div> */
.quote-block {
  position: relative; display: flex; align-items: flex-start; gap: 6px;
  border-radius: 10px; padding: 6px 10px; margin-top: 5px; font-size: 12.5px;
  line-height: 1.4; overflow: hidden; background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08); color: var(--chat-sub); max-width: 100%;
}
.quote-block.right { align-self: flex-end; }
.quote-block.left { align-self: flex-start; }
.quote-block .quote-fold { width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px; opacity: 0.55; display: flex; }
.quote-block .quote-fold svg { width: 15px; height: 15px; }
.quote-block .quote-name { font-weight: 600; opacity: 0.75; margin-right: 3px; font-size: 12px; flex-shrink: 0; color: #6e6e73; }
.quote-block .quote-text { opacity: 0.9; color: #6e6e73; word-break: break-word; white-space: pre-wrap; }

/* 翻译文字：默认已拆成独立气泡，位于原文气泡上方（见 .translation-bubble） */
.bubble .translation-text {
  display: block; margin-top: 4px; padding-top: 4px;
  border-top: 0.5px solid rgba(128, 128, 128, 0.2);
  font-size: 14px; opacity: 0.8; color: inherit;
}
.bubble.me .translation-text { border-top-color: rgba(255, 255, 255, 0.2); }
.translation-text { display: block; margin-top: 4px; color: #6c6c70; font-size: 14px; }
/* 译文独立气泡（在原文上方） */
.translation-bubble {
  display: block; align-self: flex-start;
  margin: 0 0 4px 0; padding: 6px 10px;
  border-radius: 12px; background: rgba(0, 0, 0, 0.05);
  color: #6c6c70; font-size: 13px; line-height: 1.4;
  max-width: 100%; overflow-wrap: anywhere; word-break: break-word;
}
.translation-bubble.me { align-self: flex-end; background: rgba(0, 122, 255, 0.12); color: #0060df; }

/* 撤回 / 居中系统框
   HTML：<div class="message-row recalled|sys-notice"><div class="recall-notice [expand]">…</div></div> */
.message-row.recalled, .message-row.sys-notice { display: flex; justify-content: center; padding: 3px 0; }
.message-row.recalled .message-avatar, .message-row.sys-notice .message-avatar { display: none; }
.message-row.sys-notice .message-content { max-width: 88%; align-items: center; }
.message-row.sys-notice .recall-notice, .message-row.recalled .recall-notice {
  max-width: 82%; background: rgba(0, 0, 0, 0.05); color: var(--chat-sub);
  font-size: 12px; line-height: 1.5; padding: 6px 14px; border-radius: 16px;
  text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.message-row.recalled .recall-notice.expand { white-space: normal; overflow: visible; text-overflow: clip; max-width: 90%; word-break: break-all; }
.message-row.recalled .bubble { background: transparent !important; color: var(--chat-sub) !important; font-style: italic; padding: 4px 8px; border-radius: 0; font-size: 13px; }
.message-row.recalled .bubble::before, .message-row.recalled .bubble::after { display: none !important; }

/* 思维链
   HTML：<div class="msg-think [open]"><button class="msg-think-toggle"></button><div class="msg-think-body"></div></div> */
.msg-think { max-width: 100%; margin: 0 0 4px 0; align-self: flex-start; }
.message-row.right .msg-think { align-self: flex-end; }
.msg-think-toggle { font-family: inherit; font-size: 10px; line-height: 1; color: var(--chat-sub); background: rgba(0, 0, 0, 0.05); border: none; border-radius: 10px; padding: 4px 8px; cursor: pointer; }
.msg-think-body { display: none; margin-top: 4px; font-size: 11px; line-height: 1.5; color: var(--chat-sub); background: rgba(0, 0, 0, 0.035); border-radius: 10px; padding: 6px 8px; white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow-y: auto; }
.msg-think.open .msg-think-body { display: block; }

/* 跳转高亮 */
.message-row.jump-highlight .bubble,
.message-row.jump-highlight .bubble-card,
.message-row.jump-highlight .voice-bubble,
.message-row.jump-highlight .image-bubble { animation: chatJumpFlash 2.5s ease; }
@keyframes chatJumpFlash {
  0% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0.35); }
  40% { box-shadow: 0 0 0 8px rgba(0, 122, 255, 0.2); }
  100% { box-shadow: 0 0 0 0 rgba(0, 122, 255, 0); }
}

/* ============================================================
   2. 私聊 chat_inner（.nano-chat-inner）
   ------------------------------------------------------------
   2.1 顶栏
   HTML：<header class="topbar">
           <button class="back-btn" id="backBtn"><i class="fas fa-chevron-left"></i></button>
           <span class="topbar-title" id="chatTitle">聊天</span>
           <div class="topbar-avatar" id="topbarAvatar">   <-- 这是「设置」按钮
             <span id="avatarPlaceholder">L</span><img id="avatarImage">
           </div>
         </header>
   JS： #backBtn 返回；#topbarAvatar 打开聊天设置；#chatTitle 显示昵称。
   顶栏高度由 --chat-topbar-pad 控制（默认贴着灵动岛安全区，不留空隙）。
   ============================================================ */
.nano-chat-inner .topbar {
  position: relative; z-index: 30; width: 100%; flex-shrink: 0;
  padding: var(--chat-topbar-pad, var(--chat-safe-top)) 12px 6px;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
/* 2.1 顶栏 —— 单聊/群聊共享同一套（改这里两边一起变；玻璃色见 :root 的 --chat-glass-*） */
.nano-chat-inner .back-btn, .nano-groups .back-btn {
  width: 44px; height: 44px; border: none; border-radius: 50%;
  background: var(--chat-glass-bg); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
  border: 0.5px solid var(--chat-glass-line);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.nano-chat-inner .back-btn:active, .nano-groups .back-btn:active { transform: scale(0.88); background: rgba(200, 200, 210, 0.15); }
.nano-chat-inner .back-btn i, .nano-groups .back-btn i { font-size: 18px; color: var(--chat-text); }
.nano-chat-inner .topbar-title, .nano-groups .topbar-title {
  font-size: 17px; font-weight: 600; color: var(--chat-text); letter-spacing: -0.3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;
  padding: 6px 20px; background: var(--chat-glass-bg);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-radius: 30px; border: 0.5px solid var(--chat-glass-line);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.6);
  text-align: center;
}
/* 群聊标题多一行人数，宽度放宽一点；顶栏胶囊透明底可被美化覆盖/去掉 */
.nano-groups .topbar-title { max-width: 200px; flex: 0 1 auto; }
.nano-groups .topbar-title .g-meta { display: block; font-size: 11px; color: var(--chat-sub); font-weight: 400; margin-top: 2px; }
.nano-chat-inner .topbar-avatar, .nano-groups .topbar-avatar {
  position: relative; width: 44px; height: 44px; border-radius: 50%; overflow: hidden;
  background: var(--chat-glass-bg); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 0.5px solid var(--chat-glass-line); cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 17px;
  font-weight: 500; color: var(--chat-sub); transition: transform 0.15s;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.nano-chat-inner .topbar-avatar:active, .nano-groups .topbar-avatar:active { transform: scale(0.92); }
.nano-chat-inner .topbar-avatar img, .nano-groups .topbar-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 多选栏：单聊/群聊共享（群聊按钮用 id 选择器） */
.nano-chat-inner .multi-select-bar, .nano-groups .multi-select-bar {
  display: none; position: absolute; z-index: 31; left: 12px; right: 12px;
  top: var(--chat-safe-top); height: 48px; background: var(--chat-glass-bg);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-radius: 28px; border: 0.5px solid var(--chat-glass-line);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.6);
  align-items: center; padding: 0 16px; justify-content: space-between;
}
.nano-chat-inner .multi-select-bar.active, .nano-groups .multi-select-bar.active,
.nano-groups .multi-select-bar.show { display: flex; }
.nano-chat-inner .multi-select-bar .ms-count, .nano-chat-inner .multi-select-bar #msCount,
.nano-groups .multi-select-bar #msCount { font-size: 15px; font-weight: 600; color: var(--chat-text); }
.nano-chat-inner .multi-select-bar .ms-right, .nano-groups .multi-select-bar .ms-actions { display: flex; gap: 12px; }
.nano-chat-inner .multi-select-bar .ms-right button, .nano-groups .multi-select-bar .ms-actions button { background: none; border: none; font-size: 15px; font-weight: 500; cursor: pointer; padding: 4px 10px; border-radius: 8px; }
.nano-chat-inner .multi-select-bar .ms-cancel, .nano-groups .multi-select-bar #msCancel { color: var(--chat-sub); }
.nano-chat-inner .multi-select-bar .ms-delete, .nano-groups .multi-select-bar #msDelete { color: #ff3b30; }

/* 2.2 消息区 / 行 / 头像 / 气泡 */
.nano-chat-inner .message-scroll { flex: 1; overflow-y: auto; padding: 8px 14px 14px 14px; background: transparent; -webkit-overflow-scrolling: touch; position: relative; }
.nano-chat-inner .message-scroll::-webkit-scrollbar { width: 0; }
.nano-chat-inner .message-row {
  display: flex; align-items: flex-start; margin-bottom: 6px; width: 100%;
  position: relative; padding: 2px 0; -webkit-user-select: none; user-select: none; cursor: default;
}
.nano-chat-inner .message-row.left { justify-content: flex-start; }
.nano-chat-inner .message-row.right { justify-content: flex-end; }
/* 居中类必须在 .left/.right 之后：撤回 / 系统提示 / 居中卡片一律居中 */
.nano-chat-inner .message-row.centered { justify-content: center; }
.nano-chat-inner .message-row.centered .message-avatar { display: none; }
.nano-chat-inner .message-row.centered .message-content { max-width: 88%; align-items: center; }
.nano-chat-inner .message-row.tip-row-wrap,
.nano-chat-inner .message-row.recalled,
.nano-chat-inner .message-row.sys-notice { justify-content: center; }
.nano-chat-inner .message-row.recalled .message-avatar,
.nano-chat-inner .message-row.sys-notice .message-avatar { display: none; }
.nano-chat-inner .message-row.sys-notice .message-content { max-width: 88%; align-items: center; }
.nano-chat-inner .message-avatar {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; overflow: hidden;
  background: #e8e8ec; border: 0.5px solid rgba(0, 0, 0, 0.04); display: flex;
  align-items: center; justify-content: center; font-size: 14px; font-weight: 500;
  color: var(--chat-sub); margin-top: 2px; cursor: pointer; transition: transform 0.15s;
  position: relative; z-index: 5;
}
.nano-chat-inner .message-avatar:active { transform: scale(0.92); }
.nano-chat-inner .message-row.left .message-avatar { margin-right: 8px; }
.nano-chat-inner .message-row.right .message-avatar { margin-left: 8px; order: 2; }
.nano-chat-inner .message-avatar img { width: 100%; height: 100%; object-fit: cover; }
.nano-chat-inner .message-content { max-width: 64%; min-width: 0; display: flex; flex-direction: column; position: relative; }
.nano-chat-inner .message-row.right .message-content { align-items: flex-end; }
.nano-chat-inner .bubble {
  position: relative; width: max-content; padding: 6px 11px; border-radius: 15px;
  font-size: 14px; line-height: 1.3; overflow-wrap: break-word; word-wrap: break-word;
  word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap;
}
.nano-chat-inner .bubble.other { background: var(--bubble-other); color: var(--bubble-other-text); }
.nano-chat-inner .bubble.other::after {
  content: ""; position: absolute; left: -6px; bottom: 5px; width: 17px; height: 17px;
  background: var(--bubble-other); clip-path: polygon(100% 0, 100% 100%, 0 100%);
}
.nano-chat-inner .bubble.me { background: var(--bubble-me); color: var(--bubble-me-text); margin-left: auto; }
.nano-chat-inner .bubble.me::after {
  content: ""; position: absolute; right: -6px; bottom: 5px; width: 17px; height: 17px;
  background: var(--bubble-me); clip-path: polygon(0 0, 100% 100%, 0 100%);
}
.nano-chat-inner .bubble.grouped::after { display: none; }
.nano-chat-inner .bubble.voice-transcript-bubble { background: #f2f2f4; color: #555; border-radius: 12px; padding: 4px 12px; margin-top: 4px; }
.nano-chat-inner .bubble.voice-transcript-bubble::before, .nano-chat-inner .bubble.voice-transcript-bubble::after { display: none; }

/* 2.3 语音气泡
   HTML：<div class="voice-bubble right|left"><span class="play-icon"></span>
           <div class="voice-wave"><span class="bar"></span>…</div>
           <span class="voice-duration">3''</span><span class="unread-dot"></span></div> */
.nano-chat-inner .voice-bubble { position: relative; display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 20px; max-width: 60%; cursor: pointer; }
.nano-chat-inner .voice-bubble.right { align-self: flex-end; background: var(--bubble-me); color: var(--bubble-me-text); flex-direction: row-reverse; }
.nano-chat-inner .voice-bubble.left { align-self: flex-start; background: var(--bubble-other); color: var(--bubble-other-text); }
.nano-chat-inner .voice-bubble.right::before, .nano-chat-inner .voice-bubble.left::before { content: ""; position: absolute; bottom: 6px; width: 16px; height: 16px; background: inherit; clip-path: polygon(0 0, 100% 100%, 0 100%); }
.nano-chat-inner .voice-bubble.right::before { right: -5px; }
.nano-chat-inner .voice-bubble.left::before { left: -5px; }
.nano-chat-inner .voice-bubble .voice-wave { display: flex; align-items: center; gap: 1.5px; height: 20px; }
.nano-chat-inner .voice-bubble .voice-wave .bar { width: 3px; border-radius: 2px; background: currentColor; opacity: 0.55; }
.nano-chat-inner .voice-bubble .voice-wave .bar.active { opacity: 1; }
.nano-chat-inner .voice-bubble .voice-duration { font-size: 13px; white-space: nowrap; margin-left: 4px; }
.nano-chat-inner .voice-bubble .unread-dot { position: absolute; top: -3px; width: 8px; height: 8px; border-radius: 50%; background: #ff3b30; }
.nano-chat-inner .voice-bubble.left .unread-dot { left: -3px; }
.nano-chat-inner .voice-bubble.right .unread-dot { right: -3px; }

/* 2.4 图片 / 文字图 / 图片描述 */
.nano-chat-inner .image-bubble { max-width: 140px; border-radius: 16px; overflow: hidden; line-height: 0; }
.nano-chat-inner .image-bubble.right { align-self: flex-end; }
.nano-chat-inner .image-bubble.left { align-self: flex-start; }
.nano-chat-inner .image-bubble img { width: 100%; display: block; }
.nano-chat-inner .image-wrapper { display: flex; flex-direction: column; gap: 6px; max-width: 140px; }
.nano-chat-inner .image-wrapper.left { align-self: flex-start; }
.nano-chat-inner .image-wrapper.right { align-self: flex-end; }
.nano-chat-inner .image-actions { display: flex; gap: 8px; }
.nano-chat-inner .image-actions button { border: none; border-radius: 10px; padding: 6px 10px; background: rgba(120, 120, 128, 0.14); font-size: 12px; cursor: pointer; }
.nano-chat-inner .text-image-bubble { border-radius: 16px; overflow: hidden; max-width: 200px; }
.nano-chat-inner .text-image-bubble.left { align-self: flex-start; }
.nano-chat-inner .text-image-bubble .ti-text { padding: 10px 12px; font-size: 14px; }
.nano-chat-inner .image-desc-bubble { border-radius: 16px; background: #eef2f7; max-width: 220px; }
.nano-chat-inner .image-desc-bubble.right { align-self: flex-end; }
.nano-chat-inner .image-desc-bubble.left { align-self: flex-start; }
.nano-chat-inner .image-desc-bubble .idb-inner { padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.nano-chat-inner .image-desc-bubble .idb-text { font-size: 12px; color: #3c4a58; line-height: 1.4; }

/* 2.5 卡片（私聊）——通用模板
   HTML（由 js/nano-card-ui.js 统一生成）：
   <div class="bubble-card left|right transfer|gift|listen|couple|call|file|...">
     <div class="card-header"><div class="status"><svg/><span>状态</span></div><div class="time">14:28</div></div>
     <div class="main-section">金额 / 图标 + 标题</div>
     <div class="info-section"><div class="info-grid">4 个 .info-item</div></div>
     <div class="message-box card-note">留言（可选）</div>
     <div class="card-footer">.card-footer-text 或 .card-actions > .card-btn</div>
   </div>
   兼容旧选择器：.card-main / .card-title / .card-sub / .icon-wrap / .card-footer / .card-btn
   仍然保留，之前写的卡片美化大多可以直接继续用。 */
.nano-chat-inner .bubble-card {
    position: relative; width: 248px; max-width: 100%;
    background: #ffffff; color: #111111;
    border: 1px solid #e5e5e5; border-radius: 16px;
    box-shadow: 0 5px 18px rgba(0,0,0,0.08);
    overflow: hidden; font-size: 14px; line-height: 1.3;
}
.nano-chat-inner .bubble-card.right { align-self: flex-end; }
.nano-chat-inner .bubble-card.left { align-self: flex-start; }
.nano-chat-inner .bubble-card::before,
.nano-chat-inner .bubble-card::after { content: none !important; display: none !important; }
.nano-chat-inner .bubble-card .card-header {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 12px; background: #111111; color: #ffffff;
}
.nano-chat-inner .bubble-card .status {
    display: flex; align-items: center; gap: 6px; min-width: 0;
    font-size: 12px; font-weight: 500;
}
.nano-chat-inner .bubble-card .status svg { width: 13px; height: 13px; flex-shrink: 0; color: #a0a0a0; }
.nano-chat-inner .bubble-card .status span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nano-chat-inner .bubble-card .time { flex-shrink: 0; font-size: 11px; color: #b0b0b0; }
.nano-chat-inner .bubble-card .main-section {
    padding: 12px 12px 10px; text-align: center; border-bottom: 1px solid #f0f0f0;
}
.nano-chat-inner .bubble-card .main-icon {
    width: 38px; height: 38px; margin: 0 auto 6px;
    display: flex; align-items: center; justify-content: center;
    background: #f5f5f5; border-radius: 11px; color: #222222;
}
.nano-chat-inner .bubble-card .main-icon svg { width: 18px; height: 18px; }
.nano-chat-inner .bubble-card .main-label { font-size: 10.5px; color: #888888; margin-bottom: 2px; }
.nano-chat-inner .bubble-card .main-title {
    font-size: 15px; font-weight: 700; color: #111111; line-height: 1.25;
    overflow-wrap: anywhere; word-break: break-word;
}
.nano-chat-inner .bubble-card .main-sub { margin-top: 3px; font-size: 10.5px; color: #8e8e93; line-height: 1.35; overflow-wrap: anywhere; }
.nano-chat-inner .bubble-card .amount {
    font-size: 23px; font-weight: 700; color: #111111; letter-spacing: -0.4px; line-height: 1.15;
    overflow-wrap: anywhere;
}
.nano-chat-inner .bubble-card .amount span { font-size: 14px; font-weight: 500; margin-right: 1px; }
.nano-chat-inner .bubble-card .info-section { padding: 9px 12px 4px; }
.nano-chat-inner .bubble-card .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 9px; }
.nano-chat-inner .bubble-card .info-item { display: flex; align-items: center; gap: 6px; min-width: 0; }
.nano-chat-inner .bubble-card .icon-box {
    width: 25px; height: 25px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: #f5f5f5; border-radius: 7px; color: #333333;
}
.nano-chat-inner .bubble-card .icon-box svg { width: 12px; height: 12px; }
.nano-chat-inner .bubble-card .info-content { min-width: 0; }
.nano-chat-inner .bubble-card .info-label { font-size: 9px; color: #999999; line-height: 1.1; margin-bottom: 1px; }
.nano-chat-inner .bubble-card .info-value {
    font-size: 10.5px; font-weight: 500; color: #111111; line-height: 1.2;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nano-chat-inner .bubble-card .message-box {
    margin: 8px 12px 0; padding: 6px 8px;
    background: #f8f8f8; border-radius: 8px;
    font-size: 11px; line-height: 1.4; color: #444444;
    white-space: pre-wrap; overflow-wrap: anywhere;
    max-height: 76px; overflow-y: auto;
}
.nano-chat-inner .bubble-card .chain-list {
    margin: 8px 12px 0; padding: 4px 8px; max-height: 120px; overflow-y: auto;
    background: #f8f8f8; border-radius: 8px;
}
.nano-chat-inner .bubble-card .chain-item { padding: 3px 0; font-size: 11px; color: #333; line-height: 1.35; }
.nano-chat-inner .bubble-card .chain-item .idx { color: #999; margin-right: 4px; }
.nano-chat-inner .bubble-card .chain-item .chain-name { color: #999; font-size: 10px; }
.nano-chat-inner .bubble-card .card-image { padding: 0; border-bottom: 1px solid #f0f0f0; background: #f5f5f5; }
.nano-chat-inner .bubble-card .card-image img { display: block; width: 100%; max-height: 120px; object-fit: cover; }
.nano-chat-inner .bubble-card .card-footer {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px 11px; border-top: 0; opacity: 1;
}
.nano-chat-inner .bubble-card .card-footer.status-only { padding: 8px 12px 10px; }
.nano-chat-inner .bubble-card .card-footer-text {
    flex: 1; min-width: 0; display: flex; align-items: center;
    font-size: 10.5px; line-height: 1.4; color: #8e8e93;
}
.nano-chat-inner .bubble-card .card-actions { display: flex; gap: 8px; flex: 1; }
.nano-chat-inner .bubble-card .card-btn,
.nano-chat-inner .bubble-card .btn {
    flex: 1; height: 32px; min-width: 0; padding: 0 8px;
    display: flex; align-items: center; justify-content: center; gap: 4px;
    border: none; border-radius: 9px; font-family: inherit;
    font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer;
    transition: transform .12s ease, background .12s ease;
}
.nano-chat-inner .bubble-card .card-btn:active,
.nano-chat-inner .bubble-card .btn:active { transform: scale(.97); }
.nano-chat-inner .bubble-card .btn-primary,
.nano-chat-inner .bubble-card .card-btn.primary { background: #111111; color: #ffffff; }
.nano-chat-inner .bubble-card .btn-primary:active,
.nano-chat-inner .bubble-card .card-btn.primary:active { background: #333333; }
.nano-chat-inner .bubble-card .btn-secondary,
.nano-chat-inner .bubble-card .card-btn.secondary,
.nano-chat-inner .bubble-card .card-btn.return-btn { background: #f5f5f5; color: #333333; }
.nano-chat-inner .bubble-card .btn-secondary:active,
.nano-chat-inner .bubble-card .card-btn.secondary:active,
.nano-chat-inner .bubble-card .card-btn.return-btn:active { background: #e8e8e8; }
.nano-chat-inner .bubble-card.claimed .card-header,
.nano-chat-inner .bubble-card.response .card-header,
.nano-chat-inner .bubble-card.received .card-header,
.nano-chat-inner .bubble-card.returned .card-header,
.nano-chat-inner .bubble-card.accepted .card-header,
.nano-chat-inner .bubble-card.rejected .card-header,
.nano-chat-inner .bubble-card.opened .card-header { background: #8e8e93; }
.nano-chat-inner .bubble-card.claimed .main-section,
.nano-chat-inner .bubble-card.response .main-section,
.nano-chat-inner .bubble-card.received .main-section,
.nano-chat-inner .bubble-card.returned .main-section,
.nano-chat-inner .bubble-card.accepted .main-section,
.nano-chat-inner .bubble-card.rejected .main-section,
.nano-chat-inner .bubble-card.opened .main-section { opacity: .82; }
.nano-chat-inner .bubble-card .card-btn:disabled { opacity: .5; cursor: default; }

/* 2.6 输入中动画 */
.nano-chat-inner .typing-indicator { display: none; align-items: flex-end; gap: 8px; padding: 4px 0 6px 0; }
.nano-chat-inner .typing-indicator.active { display: flex; }
.nano-chat-inner .typing-indicator .ti-avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; overflow: hidden; background: #e8e8ec; border: 0.5px solid rgba(0, 0, 0, 0.04); display: flex; align-items: center; justify-content: center; font-size: 14px; color: var(--chat-sub); }
.nano-chat-inner .typing-indicator .ti-bubble { background: var(--bubble-other); border-radius: 22px; padding: 10px 14px; display: flex; align-items: center; gap: 5px; }
.nano-chat-inner .typing-indicator .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--chat-sub); animation: chatTypingBounce 1.4s infinite ease-in-out; }
.nano-chat-inner .typing-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
.nano-chat-inner .typing-indicator .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes chatTypingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.3; } 30% { transform: translateY(-6px); opacity: 1; } }

/* 2.7 底部 dock（私聊）
   HTML：<footer class="bottom-bar">
           <div class="emoji-recommend hidden" id="emojiRecommend"></div>
           <button class="more-btn" id="moreBtn"><svg>+</svg></button>
           <div class="input-shell">
             <div class="above-input" id="aboveInput">
               <div class="quote-bar" id="quoteBar">…</div></div>
             <div class="input-row"><input class="input" id="messageInput">
               <div class="emoji-voice-group">
                 <button class="emoji-btn" id="emojiBtn"><i class="far fa-smile"></i></button>
                 <button class="voice-btn" id="voiceBtn"><i class="fas fa-microphone"></i></button>
               </div></div>
           </div>
           <button class="send-btn" id="sendBtn"><i class="fas fa-arrow-up"></i></button>
         </footer>
   JS：#moreBtn 更多面板；#emojiBtn 表情包；#voiceBtn 语音；#sendBtn 发送
       （.disabled 置灰 / .reply-mode 深灰=回复）；.voice-btn.active 录音中。 */
.nano-chat-inner .bottom-bar {
  position: relative; z-index: 30; width: 100%; flex-shrink: 0;
  padding: var(--chat-bottombar-pad, 6px 14px 4px);
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.nano-chat-inner .more-btn { width: 42px; height: 42px; border: none; border-radius: 50%; background: var(--chat-glass-bg); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; border: 0.5px solid var(--chat-glass-line); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.6); color: var(--chat-text); transition: all 0.15s; }
.nano-chat-inner .more-btn:active { transform: scale(0.88); background: rgba(200, 200, 210, 0.15); }
.nano-chat-inner .more-btn svg { width: 20px; height: 20px; stroke: currentColor; stroke-width: 2; fill: none; }
.nano-chat-inner .input-shell { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 2px 6px 2px 14px; background: rgba(255, 255, 255, 0.32); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 30px; border: 0.5px solid var(--chat-glass-line); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.6); min-height: 42px; justify-content: center; }
.nano-chat-inner .input-row { display: flex; align-items: center; gap: 4px; width: 100%; }
.nano-chat-inner .input { flex: 1; border: none; outline: none; background: transparent; font-size: 16px; color: var(--chat-text); padding: 6px 2px; min-width: 0; font-family: inherit; }
.nano-chat-inner .input::placeholder { color: #aeaeb2; font-weight: 400; }
.nano-chat-inner .emoji-voice-group { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.nano-chat-inner .emoji-btn, .nano-chat-inner .voice-btn { width: 32px; height: 32px; border: none; border-radius: 50%; background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; color: var(--chat-sub); font-size: 17px; transition: all 0.15s; }
.nano-chat-inner .emoji-btn:active, .nano-chat-inner .voice-btn:active { transform: scale(0.88); background: rgba(0, 0, 0, 0.04); }
.nano-chat-inner .voice-btn.active { color: #ff3b30; background: rgba(255, 59, 48, 0.12); }
.nano-chat-inner .send-btn { position: relative; overflow: visible; width: 42px; height: 42px; border: none; border-radius: 50%; background: var(--bubble-me); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: all 0.15s; color: #fff; font-size: 17px; box-shadow: 0 4px 16px rgba(44, 44, 46, 0.28); }
.nano-chat-inner .send-btn:active { transform: scale(0.88); background: #1c1c1e; }
.nano-chat-inner .send-btn.disabled { background: #8e8e93; box-shadow: none; }
.nano-chat-inner .send-btn.reply-mode { background: #2c2c2e; box-shadow: 0 4px 16px rgba(44, 44, 46, 0.28); }
.nano-chat-inner .quote-bar { display: none; align-items: center; background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); padding: 8px 12px; border-radius: 14px; border: 0.5px solid var(--chat-glass-line); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.6); font-size: 13px; color: var(--chat-sub); gap: 8px; max-width: 100%; }
.nano-chat-inner .quote-bar.active { display: flex; }
.nano-chat-inner .quote-bar .quote-name { font-weight: 600; color: var(--chat-text); margin-right: 2px; flex-shrink: 0; }
.nano-chat-inner .quote-bar .quote-text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nano-chat-inner .quote-bar .quote-cancel { background: rgba(0, 0, 0, 0.06); border: none; color: var(--chat-sub); cursor: pointer; font-size: 13px; width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 0; }
.nano-chat-inner .above-input { position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); display: flex; flex-direction: column; gap: 8px; z-index: 70; pointer-events: none; }
.nano-chat-inner .above-input > * { pointer-events: auto; }
.nano-chat-inner .emoji-recommend { display: flex; gap: 8px; overflow-x: auto; padding: 8px 10px; background: rgba(255, 255, 255, 0.92); border-radius: 14px; border: 0.5px solid var(--chat-glass-line); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08); }
.nano-chat-inner .emoji-recommend.hidden { display: none; }
.nano-chat-inner .bottom-bar > .emoji-recommend { position: absolute; left: 12px; right: 12px; bottom: calc(100% + 6px); z-index: 70; }
.nano-chat-inner .er-item { border: none; background: transparent; padding: 4px; border-radius: 8px; cursor: pointer; }
.nano-chat-inner .er-item img { width: 46px; height: 46px; object-fit: cover; border-radius: 6px; }

/* ============================================================
   3. 群聊 groups（.nano-groups）
   ------------------------------------------------------------
   3.1 顶栏 + 群公告条
   HTML：<header class="topbar">
           <button class="back-btn" id="backBtn">…</button>
           <div class="topbar-title" id="chatTitle">群名<span class="g-meta">…</span></div>
           <div class="topbar-avatar" id="topbarAvatar">群</div>
         </header>
         <div class="group-notice-bar"><span class="notice-icon"></span>
           <span class="notice-text">…</span><span class="notice-more">详情</span></div>
   群顶栏高度用 --chat-topbar-pad 也可控制；群公告条可 order/margin 调整或隐藏。 */
.nano-groups .topbar {
  position: relative; z-index: 30; width: 100%; flex-shrink: 0;
  padding: var(--chat-topbar-pad, var(--chat-safe-top)) 12px 6px;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
/* 群聊顶栏的返回 / 群名 / 头像与单聊共享上面「2.1 顶栏」那套透明胶囊样式。
   想单独改群聊或去掉胶囊，在这里写 .nano-groups … 覆盖即可（例如 background: transparent）。 */
.nano-groups .group-notice-bar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #fef6e0; font-size: 13px; color: #8a6d1f; flex-shrink: 0; margin: 0 12px 6px; border-radius: 8px; }
.nano-groups .group-notice-bar .notice-icon { color: #f0a500; display: flex; flex-shrink: 0; }
.nano-groups .group-notice-bar .notice-icon svg { width: 18px; height: 18px; }
.nano-groups .group-notice-bar .notice-text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.nano-groups .group-notice-bar .notice-more { flex-shrink: 0; font-size: 12px; color: #b8860b; font-weight: 500; cursor: pointer; }

/* 3.2 消息区 / 行 / 头像 / 昵称行 / 气泡 */
.nano-groups .message-scroll { flex: 1; overflow-y: auto; padding: 4px 14px 14px 14px; -webkit-overflow-scrolling: touch; position: relative; }
.nano-groups .message-scroll::-webkit-scrollbar { width: 0; }
.nano-groups .message-row { display: flex; align-items: flex-start; margin-bottom: 14px; width: 100%; position: relative; }
.nano-groups .message-row.left { justify-content: flex-start; }
.nano-groups .message-row.right { justify-content: flex-end; }
/* 居中类必须在 .left/.right 之后：撤回 / 系统提示 / 居中卡片一律居中 */
.nano-groups .message-row.centered { justify-content: center; }
.nano-groups .message-row.centered .message-avatar { display: none; }
.nano-groups .message-row.centered .message-content { max-width: 88%; align-items: center; }
.nano-groups .message-row.tip-row-wrap,
.nano-groups .message-row.recalled,
.nano-groups .message-row.sys-notice { justify-content: center; }
.nano-groups .message-row.recalled .message-avatar,
.nano-groups .message-row.sys-notice .message-avatar { display: none; }
.nano-groups .message-row.sys-notice .message-content { max-width: 88%; align-items: center; }
.nano-groups .message-avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; overflow: hidden; background: #e8e8ec; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600; color: #fff; cursor: pointer; align-self: flex-end; }
.nano-groups .message-row.left .message-avatar { margin-right: 8px; }
.nano-groups .message-row.right .message-avatar { margin-left: 8px; order: 2; }
.nano-groups .message-avatar img { width: 100%; height: 100%; object-fit: cover; }
.nano-groups .message-content { max-width: 72%; min-width: 0; display: flex; flex-direction: column; }
.nano-groups .message-row.right .message-content { align-items: flex-end; }
.nano-groups .msg-name-line { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; font-size: 11px; line-height: 1.3; white-space: nowrap; flex-wrap: wrap; }
.nano-groups .msg-name-line .n-badge { display: inline-flex; align-items: center; font-size: 10px; padding: 1px 7px; border-radius: 9px; color: #fff; font-weight: 600; line-height: 1.5; }
.nano-groups .msg-name-line .n-badge .n-title-inner { font-weight: 500; font-size: 10px; margin-left: 4px; }
.nano-groups .msg-name-line .n-name { color: var(--chat-sub); font-weight: 400; font-size: 11px; }
.nano-groups .bubble { position: relative; width: max-content; max-width: 100%; padding: 8px 14px; border-radius: 20px; font-size: 15px; line-height: 1.35; overflow-wrap: anywhere; word-wrap: break-word; white-space: pre-wrap; }
.nano-groups .bubble.other { background: #e5e5ea; color: #111; }
.nano-groups .bubble.other::after { content: ""; position: absolute; left: -6px; bottom: 6px; width: 16px; height: 16px; background: #e5e5ea; clip-path: polygon(100% 0, 100% 100%, 0 100%); }
.nano-groups .bubble.me { background: var(--bubble-me); color: #fff; }
.nano-groups .bubble.me::after { content: ""; position: absolute; right: -6px; bottom: 6px; width: 16px; height: 16px; background: var(--bubble-me); clip-path: polygon(0 0, 100% 100%, 0 100%); }
.nano-groups .bubble.grouped::after { display: none; }
.nano-groups .mention { display: inline-block; color: var(--chat-accent); font-weight: 600; background: rgba(255, 255, 255, 0.9); padding: 0 6px; border-radius: 6px; margin: 0 1px; }
.nano-groups .bubble.me .mention { color: #fff; background: rgba(255, 255, 255, 0.25); }

/* 3.3 语音（群聊包一层 .voice-wrapper，可含转写 .voice-transcript） */
.nano-groups .voice-wrapper { display: flex; flex-direction: column; gap: 4px; max-width: 100%; }
.nano-groups .voice-bubble { position: relative; display: flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 20px; max-width: 60%; cursor: pointer; }
.nano-groups .voice-bubble.right { background: var(--bubble-me); color: #fff; flex-direction: row-reverse; }
.nano-groups .voice-bubble.left { background: #e5e5ea; color: #111; }
.nano-groups .voice-bubble.right::before { content: ""; position: absolute; right: -5px; bottom: 6px; width: 16px; height: 16px; background: inherit; clip-path: polygon(0 0, 100% 100%, 0 100%); }
.nano-groups .voice-bubble.left::before { content: ""; position: absolute; left: -5px; bottom: 6px; width: 16px; height: 16px; background: inherit; clip-path: polygon(0 0, 100% 100%, 0 100%); }
.nano-groups .voice-bubble .voice-wave { display: flex; align-items: center; gap: 2px; height: 20px; }
.nano-groups .voice-bubble .voice-wave .bar { width: 3px; border-radius: 2px; background: currentColor; opacity: 0.55; }
.nano-groups .voice-bubble .voice-duration { font-size: 13px; margin-left: 4px; }
.nano-groups .voice-transcript { font-size: 13px; color: #555; }

/* 3.4 卡片（群聊：红包 / 群公告 / 群接龙）
   与私聊共用同一套通用模板 HTML / 类名，只是额外支持：
   .chain-list / .chain-item / .chain-name（接龙列表）
   .card-btn[data-notice]（群公告确认）
   .card-btn[data-chain]（群接龙参与） */
.nano-groups .bubble-card {
    position: relative; width: 248px; max-width: 100%;
    background: #ffffff; color: #111111;
    border: 1px solid #e5e5e5; border-radius: 16px;
    box-shadow: 0 5px 18px rgba(0,0,0,0.08);
    overflow: hidden; font-size: 14px; line-height: 1.3;
}
.nano-groups .bubble-card.right { align-self: flex-end; }
.nano-groups .bubble-card.left { align-self: flex-start; }
.nano-groups .bubble-card::before,
.nano-groups .bubble-card::after { content: none !important; display: none !important; }
.nano-groups .bubble-card .card-header {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 12px; background: #111111; color: #ffffff;
}
.nano-groups .bubble-card .status {
    display: flex; align-items: center; gap: 6px; min-width: 0;
    font-size: 12px; font-weight: 500;
}
.nano-groups .bubble-card .status svg { width: 13px; height: 13px; flex-shrink: 0; color: #a0a0a0; }
.nano-groups .bubble-card .status span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nano-groups .bubble-card .time { flex-shrink: 0; font-size: 11px; color: #b0b0b0; }
.nano-groups .bubble-card .main-section {
    padding: 12px 12px 10px; text-align: center; border-bottom: 1px solid #f0f0f0;
}
.nano-groups .bubble-card .main-icon {
    width: 38px; height: 38px; margin: 0 auto 6px;
    display: flex; align-items: center; justify-content: center;
    background: #f5f5f5; border-radius: 11px; color: #222222;
}
.nano-groups .bubble-card .main-icon svg { width: 18px; height: 18px; }
.nano-groups .bubble-card .main-label { font-size: 10.5px; color: #888888; margin-bottom: 2px; }
.nano-groups .bubble-card .main-title {
    font-size: 15px; font-weight: 700; color: #111111; line-height: 1.25;
    overflow-wrap: anywhere; word-break: break-word;
}
.nano-groups .bubble-card .main-sub { margin-top: 3px; font-size: 10.5px; color: #8e8e93; line-height: 1.35; overflow-wrap: anywhere; }
.nano-groups .bubble-card .amount {
    font-size: 23px; font-weight: 700; color: #111111; letter-spacing: -0.4px; line-height: 1.15;
    overflow-wrap: anywhere;
}
.nano-groups .bubble-card .amount span { font-size: 14px; font-weight: 500; margin-right: 1px; }
.nano-groups .bubble-card .info-section { padding: 9px 12px 4px; }
.nano-groups .bubble-card .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 9px; }
.nano-groups .bubble-card .info-item { display: flex; align-items: center; gap: 6px; min-width: 0; }
.nano-groups .bubble-card .icon-box {
    width: 25px; height: 25px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: #f5f5f5; border-radius: 7px; color: #333333;
}
.nano-groups .bubble-card .icon-box svg { width: 12px; height: 12px; }
.nano-groups .bubble-card .info-content { min-width: 0; }
.nano-groups .bubble-card .info-label { font-size: 9px; color: #999999; line-height: 1.1; margin-bottom: 1px; }
.nano-groups .bubble-card .info-value {
    font-size: 10.5px; font-weight: 500; color: #111111; line-height: 1.2;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nano-groups .bubble-card .message-box {
    margin: 8px 12px 0; padding: 6px 8px;
    background: #f8f8f8; border-radius: 8px;
    font-size: 11px; line-height: 1.4; color: #444444;
    white-space: pre-wrap; overflow-wrap: anywhere;
    max-height: 76px; overflow-y: auto;
}
.nano-groups .bubble-card .chain-list {
    margin: 8px 12px 0; padding: 4px 8px; max-height: 120px; overflow-y: auto;
    background: #f8f8f8; border-radius: 8px;
}
.nano-groups .bubble-card .chain-item { padding: 3px 0; font-size: 11px; color: #333; line-height: 1.35; }
.nano-groups .bubble-card .chain-item .idx { color: #999; margin-right: 4px; }
.nano-groups .bubble-card .chain-item .chain-name { color: #999; font-size: 10px; }
.nano-groups .bubble-card .card-image { padding: 0; border-bottom: 1px solid #f0f0f0; background: #f5f5f5; }
.nano-groups .bubble-card .card-image img { display: block; width: 100%; max-height: 120px; object-fit: cover; }
.nano-groups .bubble-card .card-footer {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px 11px; border-top: 0; opacity: 1;
}
.nano-groups .bubble-card .card-footer.status-only { padding: 8px 12px 10px; }
.nano-groups .bubble-card .card-footer-text {
    flex: 1; min-width: 0; display: flex; align-items: center;
    font-size: 10.5px; line-height: 1.4; color: #8e8e93;
}
.nano-groups .bubble-card .card-actions { display: flex; gap: 8px; flex: 1; }
.nano-groups .bubble-card .card-btn,
.nano-groups .bubble-card .btn {
    flex: 1; height: 32px; min-width: 0; padding: 0 8px;
    display: flex; align-items: center; justify-content: center; gap: 4px;
    border: none; border-radius: 9px; font-family: inherit;
    font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer;
    transition: transform .12s ease, background .12s ease;
}
.nano-groups .bubble-card .card-btn:active,
.nano-groups .bubble-card .btn:active { transform: scale(.97); }
.nano-groups .bubble-card .btn-primary,
.nano-groups .bubble-card .card-btn.primary { background: #111111; color: #ffffff; }
.nano-groups .bubble-card .btn-primary:active,
.nano-groups .bubble-card .card-btn.primary:active { background: #333333; }
.nano-groups .bubble-card .btn-secondary,
.nano-groups .bubble-card .card-btn.secondary,
.nano-groups .bubble-card .card-btn.return-btn { background: #f5f5f5; color: #333333; }
.nano-groups .bubble-card .btn-secondary:active,
.nano-groups .bubble-card .card-btn.secondary:active,
.nano-groups .bubble-card .card-btn.return-btn:active { background: #e8e8e8; }
.nano-groups .bubble-card.claimed .card-header,
.nano-groups .bubble-card.response .card-header,
.nano-groups .bubble-card.received .card-header,
.nano-groups .bubble-card.returned .card-header,
.nano-groups .bubble-card.accepted .card-header,
.nano-groups .bubble-card.rejected .card-header,
.nano-groups .bubble-card.opened .card-header { background: #8e8e93; }
.nano-groups .bubble-card.claimed .main-section,
.nano-groups .bubble-card.response .main-section,
.nano-groups .bubble-card.received .main-section,
.nano-groups .bubble-card.returned .main-section,
.nano-groups .bubble-card.accepted .main-section,
.nano-groups .bubble-card.rejected .main-section,
.nano-groups .bubble-card.opened .main-section { opacity: .82; }
.nano-groups .bubble-card .card-btn:disabled { opacity: .5; cursor: default; }

/* 3.5 底部 dock（群聊） */
.nano-groups .bottom-bar { position: relative; z-index: 30; width: 100%; flex-shrink: 0; padding: var(--chat-bottombar-pad, 8px 12px 4px); display: flex; align-items: center; gap: 8px; background: transparent; }
.nano-groups .more-btn { width: 42px; height: 42px; border: none; border-radius: 50%; background: rgba(255, 255, 255, 0.95); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; color: var(--chat-text); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08); }
.nano-groups .more-btn:active { transform: scale(0.92); background: #f0f0f3; }
.nano-groups .more-btn svg { width: 22px; height: 22px; stroke: currentColor; stroke-width: 2; fill: none; }
.nano-groups .input-shell { flex: 1; min-width: 0; display: flex; flex-direction: column; background: rgba(255, 255, 255, 0.5); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 22px; border: 0.5px solid rgba(255,255,255,0.5); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.6); position: relative; overflow: visible; }
.nano-groups .input-row { display: flex; align-items: center; gap: 4px; padding: 4px 12px; min-height: 42px; }
.nano-groups .input { flex: 1; border: none; outline: none; background: transparent; font-size: 16px; color: var(--chat-text); padding: 6px 2px; min-width: 0; font-family: inherit; }
.nano-groups .input::placeholder { color: #aeaeb2; }
.nano-groups .emoji-voice-group { display: flex; gap: 4px; flex-shrink: 0; }
.nano-groups .emoji-btn, .nano-groups .voice-btn { width: 30px; height: 30px; border: none; border-radius: 50%; background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--chat-sub); font-size: 19px; }
.nano-groups .emoji-btn:active, .nano-groups .voice-btn:active { background: rgba(0, 0, 0, 0.05); }
.nano-groups .send-btn { position: relative; overflow: visible; width: 42px; height: 42px; border: none; border-radius: 50%; background: var(--bubble-me); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; color: #fff; font-size: 18px; box-shadow: 0 2px 8px rgba(44, 44, 46, 0.3); }
.nano-groups .send-btn:active { transform: scale(0.9); }
.nano-groups .send-btn.reply-mode { background: #2c2c2e; box-shadow: 0 2px 8px rgba(44, 44, 46, 0.3); }
.nano-groups .quote-bar { display: none; background: rgba(255, 255, 255, 0.96); padding: 8px 12px; font-size: 12px; align-items: center; gap: 8px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); }
.nano-groups .quote-bar.active { display: flex; }
.nano-groups .quote-bar .qb-name { font-weight: 600; color: var(--chat-accent); flex-shrink: 0; }
.nano-groups .quote-bar .qb-text { color: var(--chat-sub); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nano-groups .quote-bar .qb-cancel { border: none; background: rgba(0, 0, 0, 0.06); color: var(--chat-sub); width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: 11px; line-height: 1; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; }
.nano-groups .above-input { position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); display: flex; flex-direction: column; gap: 8px; z-index: 70; pointer-events: none; }
.nano-groups .above-input > * { pointer-events: auto; }
.nano-groups .emoji-recommend { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 8px; padding: 8px 10px; background: rgba(255, 255, 255, 0.96); border-radius: 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); z-index: 40; }
.nano-groups .emoji-recommend.hidden { display: none; }
.nano-groups .er-item { flex: 0 0 auto; width: 54px; height: 54px; display: flex; align-items: center; justify-content: center; border-radius: 10px; background: rgba(120, 120, 128, 0.08); cursor: pointer; overflow: hidden; }
.nano-groups .er-item img { width: 46px; height: 46px; object-fit: cover; border-radius: 6px; }

/* ============================================================
   4. DIY 参考配方（默认注释，复制需要的使用）
   ============================================================ */
/* 配方 A：去掉顶栏「玻璃外包裹」（返回/昵称/设置按钮）
   .nano-chat-inner .back-btn, .nano-chat-inner .topbar-title, .nano-chat-inner .topbar-avatar,
   .nano-chat-inner .input-shell, .nano-chat-inner .more-btn {
     background: transparent !important; backdrop-filter: none !important;
     -webkit-backdrop-filter: none !important; border: none !important; box-shadow: none !important;
   }
*/

/* 配方 B：头像显示方式（任选其一；.grouped-row 表示与上一条同侧，
   不管是气泡 / 图片 / 表情包 / 卡片 / 语音都算连续，四选一即可）
   // ① 每条都显示（默认，什么都不用写）
   // ② 只显示一次：同侧连续消息里，后面的隐藏头像（保留占位，对齐不跑）
   .nano-chat-inner .message-row.grouped-row .message-avatar,
   .nano-groups .message-row.grouped-row .message-avatar { visibility: hidden; }
   // ③ 完全不显示头像（连占位都不留）
   .nano-chat-inner .message-avatar, .nano-groups .message-avatar { display: none; }
   // ④ 只显示对方头像、隐藏自己的
   .nano-chat-inner .message-row.right .message-avatar,
   .nano-groups .message-row.right .message-avatar { display: none; }
   // ⑤ 圆形头像框（box-shadow 不依赖 overflow，任何模板都不会被裁）
   .nano-chat-inner .message-avatar { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #ff6fa0; }
*/

/* 配方 C：把顶栏「头像」从设置按钮上剥离成独立覆盖装饰，可自由移动；
   设置按钮原地不动、照样能点（头像只是它的覆盖装饰）。
   原理：头像图片/占位文字脱离按钮的布局流（position:fixed），按钮只留一个透明点击区。
   —— 想移动头像只改 left / right / top；不想要阴影就删掉 box-shadow。

   .nano-chat-inner .topbar-avatar,
   .nano-groups .topbar-avatar {
     position: relative !important;           // 设置按钮留在顶栏原位
     overflow: visible !important;
     background: transparent !important;
     border: none !important;
     box-shadow: none !important;
     backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
   }
   .nano-chat-inner .topbar-avatar > img,
   .nano-chat-inner .topbar-avatar > span,
   .nano-groups .topbar-avatar > img,
   .nano-groups .topbar-avatar > span {
     position: fixed !important;              // 固定定位 = 可放到屏幕任意位置
     left: auto !important;
     right: 16px;                             // ← 改这里可左右移动头像
     top: calc(var(--safe-top, 0px) + 10px);  // ← 改这里可上下移动头像
     width: 52px !important; height: 52px !important;
     border-radius: 50% !important;
     object-fit: cover;
     z-index: 26 !important;
     pointer-events: none !important;         // 装饰层不挡点击，点击仍落到设置按钮
     box-shadow: 0 4px 14px rgba(0, 0, 0, .18);
   }
   // 可选：给透明的设置按钮自己加个可见图标（设置自己渲染）
   // .nano-chat-inner .topbar-avatar::before { content: "⚙"; font-size: 18px; color: #8e8e93; }
*/

/* 配方 K：顶栏整体 DIY（移动 / 隐藏 / 换样式；返回、设置按钮功能保持不变）
   顶栏 = .nano-chat-inner .topbar（群聊为 .nano-groups .topbar）。三个子元素：
   .back-btn 返回 · .topbar-title 昵称 · .topbar-avatar 设置按钮。改样式不影响点击逻辑。

   // ① 整条顶栏再往下让一点（默认已紧贴灵动岛）
   .nano-chat-inner .topbar { padding-top: calc(var(--chat-topbar-pad, 28px) + 10px) !important; }
   // ② 隐藏整条顶栏（注意会失去返回/设置入口，慎用）：
   .nano-chat-inner .topbar { display: none !important; }
   // ③ 只隐藏昵称，保留返回和设置：
   .nano-chat-inner .topbar-title { display: none !important; }
   // ④ 顶栏底色：悬浮结构默认透明，直接写 .topbar{background:#fff} 即可盖住
   //    （渐变遮罩用变量 --chat-topbar-mask，见配方 K2）；
   //    下面演示去掉子按钮的玻璃外包裹：
   .nano-chat-inner .back-btn, .nano-chat-inner .topbar-title, .nano-chat-inner .topbar-avatar {
     background: transparent !important; box-shadow: none !important; border: none !important;
   }
   // ⑤ 把顶栏固定到屏幕顶部（可再配 left/right 微调）：
   .nano-chat-inner .topbar { position: fixed !important; top: 0 !important; left: 0; right: 0; }
   // ⑥ 设置按钮换成图片（隐藏图标但保留点击）：
   .nano-chat-inner .topbar-avatar > img, .nano-chat-inner .topbar-avatar > span { visibility: hidden; }
   .nano-chat-inner .topbar-avatar { background: url("https://your.cdn/settings.png") center / cover no-repeat !important; }
   // 想把「头像」从设置按钮上剥离单独移动 → 配方 C；只移动消息头像 → 配方 L。
*/

/* ============================================================
   配方 K2：给悬浮的「顶栏 / 底栏」加底（实色 / 渐变 / 毛玻璃）★最常用
   ------------------------------------------------------------
   悬浮结构默认完全透明（气泡会从栏的下方穿过、看得见）。两种写法都支持：
   // ① 直接写实色（推荐，和线下一样）：
   .nano-chat-inner .topbar, .nano-groups .topbar { background: #fff; }
   .nano-chat-inner .bottom-bar, .nano-groups .bottom-bar { background: #fff; }
   // ② 用变量（适合渐变遮罩，栏与内容交界更自然）：
   :root {
     --chat-topbar-mask: linear-gradient(#fff 65%, transparent);
     --chat-bottom-mask: linear-gradient(transparent, #fff 45%);
     // 实色 / 半透明也行：
     // --chat-topbar-mask: #fff;
     // --chat-topbar-mask: rgba(255,255,255,.72);
   }
   // 想要毛玻璃：先给半透明色，再开 blur：
   .nano-chat-inner .topbar, .nano-groups .topbar,
   .nano-chat-inner .bottom-bar, .nano-groups .bottom-bar {
     backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
   }
   深色就把 #fff 换成 #1c1c1e / #000。
   ============================================================ */

/* ============================================================
   配方 N：底部 dock「位置重绑」——隐藏原图标，把功能放到新图标位置上
   ------------------------------------------------------------
   关键：CSS 用 ::before / ::after 画出来的图标【不能点】。
   真正能响应点击的只有 4 个真实按钮：
     #moreBtn(更多) · #emojiBtn(表情) · #voiceBtn(语音) · #sendBtn(发送)
   所以「把麦克风/表情搬到别处、还保留功能」= 给按钮换外衣 + 挪位置，
   按钮本身千万不要删，点击逻辑原样保留。想给「第 5、6 个」也接功能
   需要新增真实按钮并绑 JS，纯 CSS 做不到（可让纳米加）。

   // ① 隐藏输入框里的原图标（按钮还在，点击区保留）
   .nano-chat-inner #emojiBtn > i, .nano-chat-inner #voiceBtn > i { display: none; }
   // ② 换成你的 SVG（用背景图）
   .nano-chat-inner #emojiBtn { background: url("https://.../emoji.svg") center/22px no-repeat; }
   .nano-chat-inner #voiceBtn { background: url("https://.../mic.svg") center/22px no-repeat; }

   // ③ 让输入胶囊不再当定位基准，图标就能以 .bottom-bar 为基准自由摆放
   .nano-chat-inner .input-shell { position: static !important; margin: 0 56px; }   // 两侧给图标留位
   .nano-chat-inner .above-input { position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); }
   .nano-chat-inner .more-btn, .nano-chat-inner .send-btn,
   .nano-chat-inner #emojiBtn, .nano-chat-inner #voiceBtn { position: absolute;
     bottom: calc(10px + var(--nano-safe-bottom, env(safe-area-inset-bottom, 0px))); }

   // ④ 从左到右排 6 格：4 个真按钮 + 2 个纯装饰占位（装饰不可点）
   .nano-chat-inner #moreBtn  { left: 8px; }
   .nano-chat-inner #emojiBtn { left: 60px; }
   .nano-chat-inner #voiceBtn { left: 112px; }
   .nano-chat-inner .bottom-bar::before {            // 装饰位 1（占位，不可点）
     content: ""; position: absolute; left: 164px; pointer-events: none;
     bottom: calc(16px + var(--nano-safe-bottom, env(safe-area-inset-bottom, 0px)));
     width: 22px; height: 22px; background: url("https://.../decor1.svg") center/22px no-repeat;
   }
   .nano-chat-inner .bottom-bar::after {             // 装饰位 2（占位，不可点）
     content: ""; position: absolute; left: 216px; pointer-events: none;
     bottom: calc(16px + var(--nano-safe-bottom, env(safe-area-inset-bottom, 0px)));
     width: 22px; height: 22px; background: url("https://.../decor2.svg") center/22px no-repeat;
   }
   .nano-chat-inner #sendBtn { right: 8px; }

   注意：
   - 坐标是写死的，窄屏可能挤；可用 @media (max-width:420px) 收窄 left 间距。
   - 群聊同理，把前缀 .nano-chat-inner 换成 .nano-groups 即可。
   - 想换 #moreBtn / #sendBtn 的图标也一样：隐藏其 svg/i，再给按钮设 background。
   ============================================================ */

/* ============================================================
   配方 O：卡片（转账 / 红包 / 一起听 / 文件 / 情侣卡…）完全重构
   ------------------------------------------------------------
   所有卡片同构（变体：transfer / gift / listen / file / couple / invite / call / familycard / takeout / location / redpacket / notice / chain …）：
     .bubble-card.<变体>
       .card-header
         .status > svg + span        ← 深色状态栏：状态图标 + 文字
         .time                       ← 右侧时间
       .main-section
         .main-icon > svg            ← 图标（金额类没有这一块）
         .main-label                 ← 小标签
         .main-title.card-title      ← 主标题
         .main-sub.card-sub          ← 副标题
         .amount                     ← 金额（转账 / 外卖 / 商城等金额类）
       .info-section > .info-grid > .info-item ×4
         .icon-box + .info-content > .info-label + .info-value
       .message-box.card-note        ← 留言 / 文件预览（可选）
       .card-footer
         .card-footer-text           ← 纯状态文字
         或 .card-actions > .card-btn
   重点：默认就是「通用模板」的上下结构；改颜色 / 宽度 / 按钮最安全，别删按钮。

   // ① 改宽度 / 圆角 / 底色
   .nano-chat-inner .bubble-card { width: 260px; border-radius: 14px; }
   .nano-chat-inner .bubble-card.transfer { background: #fff; color: #111; }
   // ② 改顶部状态栏（深色 / 浅色 / 渐变都行）
   .nano-chat-inner .bubble-card .card-header { background: #1c1c1e; }
   // ③ 改主区图标 / 金额
   .nano-chat-inner .bubble-card .main-icon { width: 44px; height: 44px; border-radius: 14px; }
   .nano-chat-inner .bubble-card .amount { font-size: 28px; }
   // ④ 两列信息改成单列（或调间距）
   .nano-chat-inner .bubble-card .info-grid { grid-template-columns: 1fr; gap: 6px; }
   // ⑤ 换图标（.main-icon / .icon-box 里都是 svg）
   .nano-chat-inner .bubble-card.transfer .main-icon svg { display: none; }
   .nano-chat-inner .bubble-card.transfer .main-icon { background: url("https://.../icon.svg") center/20px no-repeat; }
   // ⑥ 底部按钮（primary = 接收 / 确认，return-btn = 退还 / 拒绝）
   .nano-chat-inner .bubble-card .card-btn.primary { background: #111; color: #fff; }
   .nano-chat-inner .bubble-card .card-btn.return-btn { background: #f5f5f5; color: #333; }

   注意：
   - 选择器一定要带 .nano-chat-inner 前缀，并且写在模板后面才压得住默认样式。
   - 保留 .card-header / .main-section / .info-section / .card-footer / .card-btn 等类名；
     旧的卡片美化如果只改颜色 / 圆角 / 宽度，通常仍然生效。
   - 卡片 HTML 由 js/nano-card-ui.js 统一生成；要改结构（加行 / 删行）请改该文件。
   ============================================================ */

/* ============================================================
   配方 O2：卡片紧凑 / 方形版式（可玩性配方 · 默认不启用）
   新的卡片结构是：.card-header → .main-section → .info-section → .card-footer，
   想改方形 / 更紧凑，直接改这些块即可；按钮 .card-btn 不要删。
   用法：把下面注释里的整段 CSS 复制到你的「聊天美化」CSS 末尾即可生效。
   ============================================================ */
/* 紧凑方形卡片 CSS：
.nano-chat-inner .bubble-card.transfer,
.nano-chat-inner .bubble-card.gift {
  width: 220px; border-radius: 18px;
}
.nano-chat-inner .bubble-card .card-header { padding: 6px 10px; }
.nano-chat-inner .bubble-card .main-section { padding: 10px 10px 8px; }
.nano-chat-inner .bubble-card .main-icon { width: 34px; height: 34px; border-radius: 9px; }
.nano-chat-inner .bubble-card .amount { font-size: 26px; }
.nano-chat-inner .bubble-card .info-section { padding: 8px 10px 2px; }
.nano-chat-inner .bubble-card .info-grid { gap: 6px 8px; }
.nano-chat-inner .bubble-card .card-footer { padding: 8px 10px 10px; }
.nano-chat-inner .bubble-card .card-btn { height: 30px; font-size: 11px; }
*/
/* 配方 L：只移动「消息头像」，顶栏「设置」按钮原地不动、逻辑不变
   消息头像 = .message-avatar；顶栏设置按钮 = .topbar-avatar，两者完全独立。
   只动消息头像用本配方；要把顶栏头像/设置按钮一起重排用配方 C。三种玩法任选：

   // ① 头像贴到屏幕两侧（左消息头像靠左、右消息靠右），设置按钮仍在右上角
   .nano-chat-inner .message-avatar, .nano-groups .message-avatar { position: absolute !important; top: 0; }
   .nano-chat-inner .message-row.left .message-avatar,
   .nano-groups .message-row.left .message-avatar { left: 4px !important; margin: 0 !important; }
   .nano-chat-inner .message-row.right .message-avatar,
   .nano-groups .message-row.right .message-avatar { right: 4px !important; left: auto !important; margin: 0 !important; }

   // ② 头像固定在屏幕某个位置（不随消息滚动），设置按钮照常可点
   .nano-chat-inner .message-avatar, .nano-groups .message-avatar {
     position: fixed !important; left: 10px !important; top: 45% !important;
     width: 56px !important; height: 56px !important; z-index: 20 !important;
     pointer-events: none !important;      // 装饰层不挡点击
   }

   // ③ 放大 / 换形状（只改头像，不动设置按钮）
   .nano-chat-inner .message-avatar,
   .nano-groups .message-avatar { width: 54px !important; height: 54px !important; border-radius: 16px !important; }
   // 想彻底隐藏头像参考配方 B 的 ③④。
*/

/* 配方 D：气泡尾巴规则 / 已读 / 时间
   // 连发也显示尾巴（都显示）
   .nano-chat-inner .bubble.grouped::after, .nano-groups .bubble.grouped::after { display: block !important; }
   // 全部不要尾巴
   .bubble.other::after, .bubble.me::after,
   .voice-bubble.left::before, .voice-bubble.right::before { display: none !important; }
   // 气泡旁边加「时间」小字：chat-core 已把时间写到行上 data-time，直接用 attr() 读取
   .nano-chat-inner .message-row[data-time] .message-content::before,
   .nano-groups .message-row[data-time] .message-content::before {
     content: attr(data-time); position: absolute; top: -13px; left: 2px;
     font-size: 10px; color: #aeaeb2; white-space: nowrap;
   }
   .nano-chat-inner .message-row.right[data-time] .message-content::before,
   .nano-groups .message-row.right[data-time] .message-content::before { left: auto; right: 2px; }
   // 自己消息下方加「已读」小字
   .nano-chat-inner .message-row.right .message-content::after,
   .nano-groups .message-row.right .message-content::after {
     content: "已读"; font-size: 10px; color: #34c759; margin-top: 2px;
   }
*/

/* 配方 E：翻译拆成独立气泡（外语 / 中文分开）
   .bubble .translation-text {
     margin-top: 6px; padding: 6px 12px; border-radius: 18px;
     border-top: none; background: #fff; color: #1c1c1e;
     box-shadow: 0 1px 4px rgba(0,0,0,.08); opacity: 1;
   }
*/

/* 配方 F：去掉引用昵称前的小拐角
   .quote-block .quote-fold { display: none !important; }
*/

/* 配方 G：用 URL 图片覆盖按钮 / 图标并浮在最上层；无功能占位图
   // 发送键换成图片
   .nano-chat-inner .send-btn i { display: none; }
   .nano-chat-inner .send-btn::before {
     content: url("https://your.cdn/send.png"); position: absolute; inset: 0; z-index: 2;
     display: flex; align-items: center; justify-content: center;
   }
   // 卡片图标换图片（示例：转账）
   .nano-chat-inner .bubble-card.transfer .icon-wrap svg { display: none; }
   .nano-chat-inner .bubble-card.transfer .icon-wrap::before { content: url("https://your.cdn/transfer.png"); }
   // 底栏加纯装饰占位（无功能）
   .nano-chat-inner .bottom-bar::after { content: url("https://your.cdn/deco.png"); width: 32px; height: 32px; object-fit: contain; flex-shrink: 0; }
*/

/* 配方 H：把表情/语音按钮移出输入栏（浮在输入栏上方），隐藏图标但保留功能
   .nano-chat-inner .input-shell { overflow: visible; }
   .nano-chat-inner .emoji-voice-group {
     position: absolute; right: 0; top: -46px;
     background: rgba(255,255,255,.9); border-radius: 999px; padding: 4px 6px;
     box-shadow: 0 4px 14px rgba(0,0,0,.12);
   }
   .nano-chat-inner .emoji-btn i, .nano-chat-inner .voice-btn i { visibility: hidden; }
*/

/* 配方 I：整条底栏换样式（去胶囊）
   顶/底栏默认透明（气泡会从栏下穿过），想加底色/遮罩请用变量（见配方 J）：
   :root { --chat-bottom-mask: #f7f7fa; }
   .nano-chat-inner .input-shell {
     background: #fff !important; backdrop-filter: none !important;
     border-radius: 14px !important; border: 1px solid rgba(0,0,0,.06) !important; box-shadow: none !important;
   }
*/

/* 配方 J：给顶栏/底栏加遮罩（默认透明，气泡从栏下穿过）
   结构层已把 .topbar/.bottom-bar 固定成悬浮透明，直接写 background 会被覆盖；
   请用变量加遮罩（px / 渐变 / URL 图片都行）：
   :root { --chat-topbar-mask: linear-gradient(#fff 60%, rgba(255,255,255,0)); }
   :root { --chat-bottom-mask: linear-gradient(transparent, #fff 40%); }
   // 用图片做底栏遮罩：
   :root { --chat-bottom-mask: url("https://your.cdn/bottom.png") center / cover no-repeat; }
   // 群聊底栏未启用悬浮结构，仍可直接写 background：
   .nano-groups .bottom-bar {
     background: url("https://your.cdn/bottom.png") center / cover no-repeat;
   }
*/

/* ============================================================
   5. 弹层速查（结构说明，默认不改样式，需要时自行覆盖）
   ------------------------------------------------------------
   - 长按菜单：.longpress-menu(.active) > .menu-item[data-action=reply|edit|recall|
     delete|multiselect|favorite|translate|voice2text]（.danger 红），.menu-divider
   - 表情包：.emoji-panel-overlay(.active) > .emoji-panel(.ep-header/.ep-title/
     .ep-close/.ep-groups/.ep-group-tab/.ep-grid/.ep-item/.ep-empty)
   - 发送语音：.voice-sheet-overlay(.active) > .voice-sheet(.vs-header/.vs-tabs/
     .vs-tab/.vs-body/.vs-input/.vs-record/.vs-footer/.vs-btn)
   - 更多菜单：.more-overlay(.active) > .more-item(.mi-icon/.mi-label)
   - 图片查看器：.image-viewer(.active) > img + .iv-actions > .iv-act
   - 通用弹窗：.ios-popup-overlay(.active) > .ios-popup-card（礼物/图片/转账/编辑）
   - 提示弹窗：.ios-alert-overlay(.active) > .ios-alert-box
   - 通话记录抽屉：.call-sheet-overlay(.active) > .call-sheet
   - @下拉（群聊）：.mention-dropdown(.active) > .mention-item(.ma-avatar/.ma-name/.ma-title)
   JS 行为由类名与 data-action 驱动；隐藏用 visibility，彻底移除用 display:none。
   ============================================================ */
`;
