/* ============================================================
   js/nano-global-template.js
   Nano「全局美化」初始模板（高自由度 DIY 版）
   ------------------------------------------------------------
   本文件只做一件事：把初始模板字符串挂到 window.NANO_GLOBAL_TEMPLATE，
   供 js/beautify.js 作为「全局」初始代码使用（还原 / 复制初始 / 首次进入）。

    ★ 最高权限：本模板除了 CSS，还能写脚本块（能造 HTML / 改 DOM / 绑事件）。
      写法：用英文注释把脚本包起来——开头写「/ * @js」，结尾写「* /」，
      中间就是 JS，被包住的部分不当作 CSS。示例（全角符号换成英文符号即可）：
        ／＊ @js
          mount.appendChild(el('div', { style:{position:'fixed',top:'0'} }, ['hello']));
          onCleanup(() => {});
        ＊／
      可直接用的名字：mount / $ / $$ / el / on / observe / onCleanup / document / window。
      点「还原 / 清空」会清空脚本、mount 与所有 onCleanup，回到初始 UI。

    美化系统怎么工作（务必先读）：
    1) 这是一个「CSS 注入」系统。你在美化页写的 CSS 会被 <style> 追加到
      各页面 body 末尾，因此天然晚于页面自带样式，绝大多数情况下能直接覆盖。
      覆盖不掉时，加 !important。
   2) 作用页面（js/appearance.js）：index / chat / chat_inner / groups /
      discover / more / api。字体（beautify_font）对所有页面生效。
   3) 全局 CSS 在聊天内页最后注入，所以「全局」也能覆盖聊天内页 UI。
   4) 本模板按「页面作用域」分区：index 用 body.nano-index 等类名限定，
      因此改 index 的规则不会误伤 chat/api/more 等页面。各页面 body 类名：
         index.html    -> .nano-index
         chat.html     -> .nano-chat
         api.html      -> .nano-api
         discover.html -> .nano-discover
         more.html     -> .nano-more
   5) HTML / JS 不能被 CSS 注入。要「新增 HTML 或改 JS」时：
      - 新增装饰/文字/角标：用 ::before / ::after 的 content（纯 CSS 就能加）。
      - 新增图标：用 content: url("图片地址") 替换原图标，或给元素加 background-image。
      - 隐藏但保留功能：display:none（元素还在，JS 仍能读写；只是用户点不到）。
      - 移动：order / margin / position / transform（JS 事件绑定在元素上，跟着走）。
      - 真正新增可交互 DOM / 改行为：需要改对应页面的 html / js（不在本 CSS 能力内）。
      每个分区都注释了对应的 HTML 结构与 JS 钩子，方便你定位要改的东西。

   常用 DIY 配方（把注释去掉即可生效）：
   A. 用 URL 图片当图标（保留点击功能）：
        .nano-index .capsule-btn[data-page="chat"] i { display:none; }
        .nano-index .capsule-btn[data-page="chat"]::before {
          content: url("https://your.cdn/chat.png");
          width: 26px; height: 26px; object-fit: contain;
        }
   B. 取消所有「按压缩小 / 悬浮动画」：
        .nano-index .capsule-btn:active,
        .nano-index .circle-more:active,
        .nano-chat .tab-btn:active,
        .nano-chat .chat-item:active { transform: none !important; }
   C. 去掉毛玻璃「透明包裹器」（胶囊底、分段控件底）：
        .nano-index .capsule-group,
        .nano-chat .tab-group {
          background: transparent !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          border: none !important; box-shadow: none !important; padding: 0 !important;
        }
   D. 换整条底栏/顶栏背景：
        .nano-index .bottom-actions { background: transparent !important; }
        .nano-chat .page-topbar { background: #f7f7fa; }
   E. 隐藏某个按钮（功能仍在，只是不可见）：
        .nano-index .capsule-btn[data-page="discover"] { display: none !important; }
        .nano-chat #characterPageBtn { display: none !important; }
   F. 移动/换位（用 order，flex 容器内有效）：
        .nano-chat .avatar-row .avatar-add { order: -1; }
   G. 加文字/角标：
        .nano-index .capsule-btn[data-page="chat"]::after {
          content: "聊天"; font-size: 10px; position: absolute; bottom: -12px;
        }
   H. 作用域技巧：只改某一个页面，就在选择器前加对应 body 类名。
   ============================================================ */

window.NANO_GLOBAL_TEMPLATE = `/* ============================================================
   Nano 全局美化模板（初始模板 · 高自由度 DIY）
   覆盖：index 主框架 / chat 列表页 / API 页 / Discover 页 / More 页
   分区用 body 类名限定，互不误伤；字体见「字体」页（全站生效）。
   ============================================================ */

/* ============================================================
   0. 主题变量（改这里可全局换色，各分区已尽量引用这些变量）
   ============================================================ */
:root {
  --nano-accent: #007aff;          /* 主色（选中态 / 强调） */
  --nano-accent-soft: rgba(0, 122, 255, 0.15);
  --nano-text: #1c1c1e;            /* 主文字 */
  --nano-text-2: #6c6c70;          /* 次级文字 */
  --nano-text-3: #8e8e93;          /* 弱文字 */
  --nano-bg: #ffffff;              /* 页面底色 */
  --nano-fill: #f5f5f7;            /* 浅填充（搜索框 / 分段底） */
  --nano-line: rgba(0, 0, 0, 0.04);/* 分隔线 */
  --nano-danger: #ff3b30;
  --nano-safe-top: var(--safe-top, 0px); /* PWA 全屏时主框架注入的灵动岛高度 */
}

/* ============================================================
   1. 通用重置（作用于所有「美化目标页」，index/chat/api/discover/more 等）
   注意：这里不写 position:fixed / overflow:hidden，避免锁死可滚动页。
   ============================================================ */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}
html, body {
  width: 100%;
  margin: 0;
  padding: 0;
  /* 不强制背景色：各页自带底色（api 保持透明以透出 index 背景）。
     想统一底色时取消下一行注释：background: var(--nano-bg); */
}

/* ============================================================
   2. index 主框架（页面作用域：body.nano-index）
   ------------------------------------------------------------
   HTML 结构：
   .app-container
     .top-bar#topBar                     （已清空，保留占位）
     .app-content#appContent
       .iframe-container#iframeChat     > iframe(chat.html)
       .iframe-container#iframeApi      > iframe(api.html)
       .iframe-container#iframeMore     > iframe(more.html)
       .iframe-container#iframeDiscover > iframe(discover.html)
     .bottom-actions#bottomBar          （底栏，可整体 DIY）
       .capsule-group                    （胶囊包裹器，可去底/去毛玻璃）
         button.capsule-btn[data-page=chat]#navChat     > i.fas.fa-comment-dots
         button.capsule-btn[data-page=api]#navApi       > i.fas.fa-sliders-h
         button.capsule-btn[data-page=discover]#navDiscover > i.fas.fa-compass
         button.capsule-btn[data-page=more]#navMore     > i.fas.fa-map-marked-alt
       .circle-more#circleMore           （右侧电话圆钮） > i.fas.fa-phone
   .fullscreen-overlay#fullscreenOverlay （全屏遮罩层：所有子页面都开在这里）
     .overlay-inner
       .overlay-header                   （内置顶栏：返回 + 标题）
         button.back-btn#overlayBack     （返回按钮）
         span.overlay-title#overlayTitle （标题）
         .placeholder
       .overlay-content
         iframe#overlayFrame / #voiceCallFrame / #chatInnerFrame
                / #musicFrame / #momentsFrame / #insFrame
   JS 钩子：
   - .capsule-btn 由 JS 绑定点击：按 data-page 切页（chat/api/discover/more）。
   - #circleMore 打开 phone.html；#overlayBack 触发 closeFullscreen。
   - 选中态类：.capsule-btn.active-btn / .circle-more.active-btn 由 JS 切换。
   - 隐藏类：.top-bar.hidden / .bottom-actions.hidden 由 JS 切换。
   ============================================================ */
.nano-index {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--nano-bg);
}
.nano-index .app-container {
  width: 100%;
  height: 100%;
  max-width: 430px;
  margin: 0 auto;
  /* 透明：让自定义背景（html/body 或 .nano-index 上的背景图）能完全透出，
     底栏区域不再有白底遮挡。默认仍是白底（来自 html/body）。 */
  background: transparent;
  padding: 0 16px 0 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: none;
  position: relative;
}

/* 顶栏（当前为空，保留：想加内容时直接在此加 HTML 或用 ::before/::after） */
.nano-index .top-bar {
  position: absolute;
  top: 14px;
  left: 16px;
  right: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 20;
  pointer-events: none;
}
.nano-index .top-bar.hidden { display: none !important; }
.nano-index .top-bar > * { pointer-events: auto; }

.nano-index .app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.nano-index .iframe-container {
  flex: 1;
  display: none;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  border-radius: 16px;
  background: transparent;
  position: relative;
}
.nano-index .iframe-container.active { display: flex; }
.nano-index .iframe-container iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
}

/* ---------- index 底栏 ---------- */
/* 想去掉「透明包裹器」：把 .capsule-group 的 background/backdrop/border/box-shadow
   清零即可（配方 C）。想整条底栏换背景：给 .bottom-actions 加 background。 */
.nano-index .bottom-actions {
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;   /* 想靠左/靠右：left / right / space-between */
  gap: 12px;
  z-index: 20;
  pointer-events: none;
  background: transparent;
}
.nano-index .bottom-actions.hidden { display: none !important; }
.nano-index .bottom-actions > * { pointer-events: auto; }

/* 底栏包裹器：保持完全透明、无任何遮挡（背景图可完全透出）。
   想要回磨砂胶囊包裹，把下面注释掉的几行打开即可：
   background: rgba(255,255,255,0.35);
   backdrop-filter: blur(30px) saturate(240%);
   -webkit-backdrop-filter: blur(30px) saturate(240%);
   border: 0.5px solid rgba(255,255,255,0.45);
   box-shadow: 0 2px 10px rgba(0,0,0,0.04); */
.nano-index .capsule-group {
  display: flex;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-radius: 50px;
  padding: 5px 8px;
  border: 0;
  box-shadow: none;
  gap: 2px;
}
.nano-index .capsule-btn {
  width: 50px;
  height: 40px;
  border-radius: 40px;
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--nano-text-3);
  cursor: pointer;
  transition: all 0.15s;
}
.nano-index .capsule-btn:active {
  transform: scale(0.88);            /* 取消缩放：transform:none !important */
  background: rgba(0, 122, 255, 0.08);
}
.nano-index .capsule-btn.active-btn {
  background: var(--nano-accent-soft);
  color: var(--nano-accent);
  box-shadow: none;
}
.nano-index .circle-more {
  width: 52px;
  height: 52px;
  border-radius: 52px;
  background: var(--nano-bg);
  border: 0.5px solid var(--nano-line);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--nano-text-3);
  cursor: pointer;
  transition: all 0.15s;
}
.nano-index .circle-more:active {
  transform: scale(0.88);
  background: rgba(0, 122, 255, 0.08);
}
.nano-index .circle-more.active-btn {
  background: var(--nano-accent-soft);
  color: var(--nano-accent);
  box-shadow: none;
}

/* ---------- index 全屏遮罩 + 内置顶栏（返回按钮） ---------- */
.nano-index .fullscreen-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--nano-bg);
  z-index: 100;
  display: none;
  flex-direction: column;
  overflow: hidden;
  border: none;
  padding: 0 16px 0 16px;
}
.nano-index .fullscreen-overlay.active { display: flex; }
.nano-index .fullscreen-overlay.no-header .overlay-header { display: none; }
.nano-index .overlay-inner {
  width: 100%;
  max-width: 430px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.nano-index .overlay-header {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  padding: calc(14px + var(--safe-inset-top, 0px)) 0 12px 0;
  flex-shrink: 0;
  position: relative;
}
/* 返回按钮：想换成 URL 图片图标就隐藏 i 再用 ::before content:url() */
.nano-index .overlay-header .back-btn {
  width: 38px;
  height: 38px;
  border-radius: 38px;
  background: var(--nano-bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
  border: 0.5px solid var(--nano-line);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  color: var(--nano-text);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.nano-index .overlay-header .back-btn:active {
  transform: scale(0.88);
  background: rgba(0, 0, 0, 0.05);
}
.nano-index .overlay-header .back-btn.hidden { display: none !important; }
.nano-index .overlay-header .overlay-title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  color: var(--nano-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nano-index .overlay-header .placeholder { width: 38px; flex-shrink: 0; }
.nano-index .overlay-content {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  border-radius: 16px;
  background: transparent;
  position: relative;
}
.nano-index .overlay-content iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
}
.nano-index #voiceCallFrame,
.nano-index #chatInnerFrame,
.nano-index #musicFrame,
.nano-index #momentsFrame,
.nano-index #insFrame {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  display: none;
}

/* ---------- index 语音悬浮球 ---------- */
.nano-index .voice-float-ball {
  position: fixed;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(145deg, #34c759, #12a150);
  box-shadow: 0 8px 24px rgba(18, 161, 80, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  cursor: grab;
  z-index: 99999;
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  transition: transform 0.15s, box-shadow 0.15s;
}
.nano-index .voice-float-ball.is-video {
  background: linear-gradient(145deg, #5ac8fa, #0a84ff);
  box-shadow: 0 8px 24px rgba(10, 132, 255, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
.nano-index .voice-float-ball::after {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 2px solid rgba(52, 199, 89, 0.5);
  animation: voiceBallPulse 1.8s ease-out infinite;
  pointer-events: none;
}
.nano-index .voice-float-ball.is-video::after { border-color: rgba(10, 132, 255, 0.5); }
@keyframes voiceBallPulse {
  0% { transform: scale(0.9); opacity: 0.7; }
  100% { transform: scale(1.3); opacity: 0; }
}
.nano-index .voice-float-ball:active { cursor: grabbing; transform: scale(0.92); }
.nano-index .voice-float-ball .ball-icon {
  width: 24px;
  height: 24px;
  stroke: #ffffff;
  stroke-width: 2.5;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
.nano-index .voice-float-ball .ball-time {
  font-size: 10px;
  color: #ffffff;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-top: 1px;
  pointer-events: none;
}
.nano-index .voice-float-ball.dragging {
  transition: none;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06);
}

/* ---------- index 后台通知条 ---------- */
.nano-index .app-notify {
  position: fixed;
  left: 50%;
  top: 10px;
  transform: translate(-50%, -140%);
  z-index: 100000;
  width: min(92vw, 420px);
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(28, 28, 30, 0.96);
  color: #fff;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.32s;
  opacity: 0;
  cursor: pointer;
}
.nano-index .app-notify.show { transform: translate(-50%, 0); opacity: 1; }
.nano-index .app-notify .an-icon { font-size: 18px; line-height: 1.2; }
.nano-index .app-notify .an-main { min-width: 0; flex: 1; }
.nano-index .app-notify .an-title { font-size: 13px; font-weight: 700; }
.nano-index .app-notify .an-body {
  font-size: 12px;
  color: #d2d2d6;
  margin-top: 3px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 窄屏：去掉左右白边 */
@media (max-width: 520px) {
  .nano-index .app-container { padding: 0; }
  .nano-index .fullscreen-overlay { padding: 0; }
  .nano-index .overlay-inner { max-width: none; }
  .nano-index .overlay-content { border-radius: 0; }
}

/* ============================================================
   3. chat 列表页（页面作用域：body.nano-chat）
   ------------------------------------------------------------
   HTML 结构（.app-content 内自上而下）：
   1) .page-topbar                 （新增顶栏：mask + character 两个按钮）
        button.page-topbar-btn#maskPageBtn      > i.fas.fa-bars   （打开人设页 mask.html）
        button.page-topbar-btn.primary#characterPageBtn > i.fas.fa-plus
                                                （好友页打开角色库；群聊页打开建群弹窗）
   2) .nano-brand                  （Nano 艺术字）
   3) .user-status-wrapper
        .user-status-bar#userStatusBar
          .left > .user-avatar#userAvatar > span#userAvatarPlaceholder / img#userAvatarImage
                + .user-name#userNameDisplay
          .right > .char-count#charCountDisplay + .arrow#arrowIcon
        .user-dropdown#userDropdown （人设下拉）
   4) .avatar-row#avatarRow        （照片墙）
        .avatar-item[data-index=0..3] + .avatar-item.avatar-add#avatarAddBtn
   5) .search-wrap > .search-box
        i.fas.fa-search#searchIcon + input#searchInput + span.search-clear#searchClear
   6) .tabs-switch > .tab-group
        button.tab-btn#tabFriends(.active) + button.tab-btn#tabGroups
   7) .chat-list#chatList
        .no-result#noResult
        .chat-item-wrap > .chat-swipe-actions(.pin/.del) + .chat-swipe-front > .chat-item
          .chat-avatar + .chat-info(.chat-name/.chat-msg) + .chat-time + .chat-unread
   群聊创建弹窗：.group-modal#groupModal（.group-modal-card ...）
   JS 钩子：
   - #maskPageBtn  -> postMessage openFullscreen mask.html
   - #characterPageBtn -> 好友页 openRoleLibrary；群聊页 openGroupModal
   - #tabFriends / #tabGroups 切列表；#avatarAddBtn 预留
   - 选中/显示类：.tab-btn.active / .chat-item.hidden-item / .chat-unread
   ============================================================ */
.nano-chat .app-container {
  width: 100%;
  height: 100%;
  max-width: 430px;
  margin: 0 auto;
  background: var(--nano-bg);
  padding: 0 16px 0 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: none;
  position: relative;
}
.nano-chat .app-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

/* ---- chat 顶栏（mask / character 按钮）---- */
.nano-chat .page-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;   /* 想两个按钮都靠右：改成 flex-end + gap */
  padding: var(--nano-safe-top) 0 0 0;
  flex-shrink: 0;
}
.nano-chat .page-topbar-btn {
  width: 38px;
  height: 38px;
  border-radius: 38px;
  background: var(--nano-bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
  border: 0.5px solid var(--nano-line);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  color: var(--nano-text);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
  padding: 0;
  position: relative;
}
.nano-chat .page-topbar-btn.primary { color: var(--nano-accent); font-size: 20px; }
.nano-chat .page-topbar-btn:active {
  transform: scale(0.88);          /* 取消悬浮动画：transform:none !important */
  background: rgba(0, 0, 0, 0.05);
}

/* ---- Nano 品牌字 ---- */
.nano-chat .nano-brand {
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 3px;
  padding: 12px 0 10px 0;
  flex-shrink: 0;
  text-align: left;
  background: linear-gradient(180deg, #8e8e93 0%, #5a5a60 40%, #1c1c1e 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.03));
  padding-left: 2px;
}

/* ---- 人设状态栏 ---- */
.nano-chat .user-status-wrapper { position: relative; flex-shrink: 0; margin: 0 0 12px 0; }
.nano-chat .user-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 8px 8px;
  background: var(--nano-bg);
  border-radius: 16px;
  cursor: pointer;
  transition: background 0.15s;
  min-height: 44px;
  width: 100%;
  border: 0.5px solid rgba(0, 0, 0, 0.03);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
}
.nano-chat .user-status-bar:active { background: var(--nano-fill); }
.nano-chat .user-status-bar .left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.nano-chat .user-status-bar .left .user-avatar {
  width: 34px; height: 34px; border-radius: 50%; overflow: hidden;
  background: #e8e8ec; flex-shrink: 0; display: flex; align-items: center;
  justify-content: center; font-size: 13px; font-weight: 500; color: var(--nano-text-3);
  border: 0.5px solid var(--nano-line);
}
.nano-chat .user-status-bar .left .user-avatar img { width: 100%; height: 100%; object-fit: cover; }
.nano-chat .user-status-bar .left .user-name {
  font-size: 15px; font-weight: 600; color: var(--nano-text);
  letter-spacing: -0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nano-chat .user-status-bar .left .user-name .placeholder { color: #aeaeb2; font-weight: 400; }
.nano-chat .user-status-bar .right {
  display: flex; align-items: center; gap: 6px; color: #aeaeb2;
  font-size: 12px; font-weight: 400; flex-shrink: 0;
}
.nano-chat .user-status-bar .right .char-count { color: var(--nano-text); font-weight: 600; font-size: 14px; }
.nano-chat .user-status-bar .right .arrow { font-size: 12px; color: var(--nano-text-3); transition: transform 0.25s ease; margin-left: 2px; }
.nano-chat .user-status-bar .right .arrow.open { transform: rotate(180deg); }

/* ---- 人设下拉 ---- */
.nano-chat .user-dropdown {
  display: none; position: absolute; top: calc(100% + 6px); left: 0; right: 0;
  background: var(--nano-bg); border-radius: 14px; border: 0.5px solid var(--nano-line);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08); z-index: 50; max-height: 200px;
  overflow-y: auto; padding: 6px;
}
.nano-chat .user-dropdown.show { display: block; }
.nano-chat .user-dropdown .dropdown-item {
  display: flex; align-items: center; padding: 10px 12px; gap: 10px;
  cursor: pointer; transition: background 0.1s; border-radius: 10px;
}
.nano-chat .user-dropdown .dropdown-item:active { background: var(--nano-fill); }
.nano-chat .user-dropdown .dropdown-item .d-avatar {
  width: 32px; height: 32px; border-radius: 50%; background: #f0f0f3;
  display: flex; align-items: center; justify-content: center; font-size: 12px;
  font-weight: 500; color: var(--nano-text-3); flex-shrink: 0; overflow: hidden;
}
.nano-chat .user-dropdown .dropdown-item .d-avatar img { width: 100%; height: 100%; object-fit: cover; }
.nano-chat .user-dropdown .dropdown-item .d-name { flex: 1; font-size: 14px; color: var(--nano-text); font-weight: 500; }
.nano-chat .user-dropdown .dropdown-item .d-check { color: #34c759; font-size: 14px; }
.nano-chat .user-dropdown .dropdown-item .d-check.hidden { visibility: hidden; }

/* ---- 照片墙 ---- */
.nano-chat .avatar-row {
  display: flex; gap: 10px; padding: 4px 0 14px 0; flex-shrink: 0;
  overflow-x: auto; overflow-y: visible; -webkit-overflow-scrolling: touch;
  scrollbar-width: none; flex-wrap: nowrap;
}
.nano-chat .avatar-item {
  width: 56px; height: 56px; min-width: 56px; border-radius: 56px;
  background: #f0f0f3; border: 0.5px solid var(--nano-line); display: flex;
  align-items: center; justify-content: center; font-size: 22px; font-weight: 500;
  color: var(--nano-text-3); cursor: pointer; flex-shrink: 0; overflow: hidden;
  transition: all 0.1s; position: relative;
}
.nano-chat .avatar-add {
  background: #f0f0f3; border: 0.5px solid var(--nano-line); color: #aeaeb2;
  font-size: 26px; cursor: default; opacity: 0.6;
}
.nano-chat .avatar-item img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  position: relative; z-index: 2;
}
.nano-chat .avatar-item.has-image { background: transparent !important; }

/* ---- 搜索 ---- */
.nano-chat .search-wrap { padding: 0 0 8px 0; flex-shrink: 0; }
.nano-chat .search-box {
  background: var(--nano-fill); border-radius: 28px; padding: 6px 14px;
  border: 0.5px solid rgba(0, 0, 0, 0.02); display: flex; align-items: center; gap: 6px;
}
.nano-chat .search-box i { color: #aeaeb2; font-size: 14px; cursor: pointer; }
.nano-chat .search-box input {
  background: transparent; border: none; outline: none; flex: 1; font-size: 15px;
  font-weight: 400; color: var(--nano-text); letter-spacing: -0.2px;
  padding: 4px 0; min-width: 0; width: 100%;
}
.nano-chat .search-box input::placeholder { color: #aeaeb2; font-weight: 400; }
.nano-chat .search-clear { color: #aeaeb2; font-size: 14px; cursor: pointer; padding: 2px; opacity: 0.5; }
.nano-chat .search-clear.hidden { display: none; }

/* ---- Tab ---- */
.nano-chat .tabs-switch { display: flex; justify-content: center; padding: 2px 0 10px 0; flex-shrink: 0; }
.nano-chat .tab-group {
  display: flex; background: var(--nano-fill); border-radius: 30px; padding: 3px;
  border: 0.5px solid rgba(0, 0, 0, 0.02);
}
.nano-chat .tab-btn {
  padding: 5px 22px; border-radius: 30px; font-size: 15px; font-weight: 500;
  color: var(--nano-text-3); cursor: pointer; transition: all 0.15s;
  background: transparent; border: none; letter-spacing: -0.2px;
}
.nano-chat .tab-btn.active {
  background: var(--nano-bg); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  color: var(--nano-text); font-weight: 600;
}
.nano-chat .tab-btn:active { transform: scale(0.94); }

/* ---- 聊天卡片列表 ---- */
.nano-chat .chat-list {
  flex: 1; display: flex; flex-direction: column; gap: 0; padding: 4px 0 8px 0;
  overflow-y: auto; min-height: 0; scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.02) transparent;
}
.nano-chat .chat-item {
  display: flex; align-items: center; gap: 14px; padding: 12px;
  background: transparent; border: none; border-bottom: 0.5px solid var(--nano-line);
  transition: background 0.08s; cursor: pointer; flex-shrink: 0;
}
.nano-chat .chat-item:last-child { border-bottom: none; }
.nano-chat .chat-item:active { background: var(--nano-fill); }
.nano-chat .chat-item.hidden-item { display: none; }
.nano-chat .chat-avatar {
  width: 48px; height: 48px; border-radius: 48px; background: #f0f0f3;
  flex-shrink: 0; overflow: hidden; border: 0.5px solid var(--nano-line);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 500; color: var(--nano-text-3);
}
.nano-chat .chat-avatar img { width: 100%; height: 100%; object-fit: cover; }
.nano-chat .chat-info { flex: 1; min-width: 0; }
.nano-chat .chat-name {
  font-size: 15px; font-weight: 600; color: var(--nano-text);
  letter-spacing: -0.2px; display: flex; align-items: baseline; gap: 6px;
}
.nano-chat .chat-name span { font-weight: 400; font-size: 12px; color: #aeaeb2; }
.nano-chat .chat-msg {
  font-size: 13px; color: #aeaeb2; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 140px; margin-top: 2px;
}
.nano-chat .chat-time { font-size: 11px; color: #aeaeb2; white-space: nowrap; padding-left: 8px; }
.nano-chat .chat-unread {
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
  background: var(--nano-danger); color: #fff; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  margin-left: 6px; box-sizing: border-box;
}
.nano-chat .no-result { display: none; text-align: center; padding: 40px 0; color: #aeaeb2; font-size: 15px; }
.nano-chat .no-result.active { display: block; }

/* ---- 左滑置顶 / 删除 ---- */
.nano-chat .chat-item-wrap {
  position: relative; overflow: hidden; background: #fff;
  border-bottom: 0.5px solid var(--nano-line); flex-shrink: 0;
}
.nano-chat .chat-item-wrap:last-child { border-bottom: none; }
.nano-chat .chat-swipe-actions {
  position: absolute; top: 0; right: 0; bottom: 0; display: flex; width: 148px;
  transform: translateX(148px); transition: transform 0.18s ease;
}
.nano-chat .chat-item-wrap.swiped .chat-swipe-actions { transform: translateX(0); }
.nano-chat .chat-swipe-actions .chat-swipe-btn {
  flex: 1; border: none; color: #fff; font-size: 15px; font-weight: 500;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.nano-chat .chat-swipe-actions .pin { background: #ffcc00; color: #3c3c3c; }
.nano-chat .chat-swipe-actions .del { background: var(--nano-danger); }
.nano-chat .chat-swipe-front {
  position: relative; z-index: 1; background: #fff; transition: transform 0.18s ease;
}
.nano-chat .chat-item-wrap.swiped .chat-swipe-front { transform: translateX(-148px); }
.nano-chat .chat-item-wrap .chat-item { border-bottom: none; }

/* ---- 建群弹窗 ---- */
.nano-chat .group-modal {
  display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  align-items: center; justify-content: center; z-index: 999;
}
.nano-chat .group-modal.active { display: flex; }
.nano-chat .group-modal-card {
  width: 340px; max-height: 80vh; background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(50px); -webkit-backdrop-filter: blur(50px);
  border-radius: 24px; padding: 24px 20px 18px;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.08);
  border: 0.5px solid rgba(255, 255, 255, 0.3); overflow-y: auto;
}
.nano-chat .group-modal-card h4 { font-weight: 600; font-size: 18px; color: var(--nano-text); text-align: center; margin-bottom: 4px; }
.nano-chat .group-modal-card .sub-title { font-size: 13px; color: #aeaeb2; text-align: center; margin-bottom: 16px; }
.nano-chat .group-form-group { margin-bottom: 14px; }
.nano-chat .group-form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--nano-text-3); margin-bottom: 4px; }
.nano-chat .group-form-group input {
  width: 100%; padding: 10px 14px; border-radius: 12px; border: 0.5px solid var(--nano-line);
  font-size: 15px; background: rgba(255, 255, 255, 0.4); outline: none; color: var(--nano-text);
}
.nano-chat .group-avatar-picker { display: flex; justify-content: center; margin-bottom: 14px; }
.nano-chat .group-avatar-picker .g-avatar {
  width: 72px; height: 72px; border-radius: 50%; background: #f0f0f3;
  display: flex; align-items: center; justify-content: center; font-size: 28px;
  font-weight: 500; color: var(--nano-text-3); cursor: pointer; overflow: hidden;
  border: 0.5px solid var(--nano-line); position: relative;
}
.nano-chat .group-avatar-picker .g-avatar img { width: 100%; height: 100%; object-fit: cover; }
.nano-chat .group-member-list { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 14px; max-height: 150px; overflow-y: auto; }
.nano-chat .group-member-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 10px; background: rgba(0, 0, 0, 0.02); }
.nano-chat .group-member-item .gm-avatar {
  width: 32px; height: 32px; border-radius: 50%; background: #f0f0f3;
  display: flex; align-items: center; justify-content: center; font-size: 13px;
  font-weight: 500; color: var(--nano-text-3); flex-shrink: 0; overflow: hidden;
}
.nano-chat .group-member-item .gm-avatar img { width: 100%; height: 100%; object-fit: cover; }
.nano-chat .group-member-item .gm-name { flex: 1; font-size: 14px; color: var(--nano-text); }
.nano-chat .group-member-item .gm-remove { color: #aeaeb2; cursor: pointer; padding: 4px 6px; font-size: 14px; }
.nano-chat .group-add-member-row { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; }
.nano-chat .group-add-member-row select {
  flex: 1; padding: 8px 12px; border-radius: 10px; border: 0.5px solid var(--nano-line);
  font-size: 14px; background: rgba(255, 255, 255, 0.4); outline: none; color: var(--nano-text);
}
.nano-chat .group-add-member-row .btn-add-member {
  padding: 8px 16px; border: none; border-radius: 10px; background: var(--nano-accent);
  color: #fff; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.nano-chat .group-modal-actions { display: flex; gap: 10px; margin-top: 14px; padding-top: 12px; border-top: 0.5px solid var(--nano-line); }
.nano-chat .group-modal-actions button { flex: 1; padding: 12px 0; border-radius: 14px; font-size: 16px; font-weight: 600; border: none; cursor: pointer; }
.nano-chat .group-modal-actions .btn-add { background: var(--nano-accent); color: #fff; }
.nano-chat .group-modal-actions .btn-cancel { background: rgba(255, 255, 255, 0.9); color: var(--nano-accent); border: 0.5px solid var(--nano-line); }

/* ============================================================
   4. API 页（页面作用域：body.nano-api）
   ------------------------------------------------------------
   HTML 结构：
   .app-container
     .top-title-wrap > span.top-title            （居中标题“API”）
     .tab-bar#tabBar                             （分段控件）
       button.tab-item[data-tab=chat|image|tts] + span.tab-indicator#tabIndicator
     .app-content > .scroll-area
       .tab-panel#panel-chat / #panel-image / #panel-tts
         .api-card
           .api-card-header > .api-card-title + button.api-card-toggle[data-target]
           .api-card-body#mainBody ...
         .form-group > .form-label + .form-control / .form-row
         .preset-row > select.form-control + button.btn.btn-xs.btn-danger
         .key-input-wrap > input.form-control + button.eye-btn[data-target]
         button.btn.btn-primary / .btn-success / .btn-sm / .btn-xs + .btn-group
         .toggle-switch#subToggle（副 API 开关，JS 加 .active）
         input.temp-range + .temp-val + .temp-hint
         .model-select-wrap > .model-search-row + select.model-select
         .prompt-section > .prompt-toggle-btn + .prompt-content(.open)
           .prompt-row > input.form-control + button.btn.btn-xs
           .prompt-box-wrap > .prompt-box + button.prompt-clear-btn
         .connection-status#mainStatus(.show)
   .ios-modal#apiModal（确认弹窗）
   JS 钩子：data-tab 切面板；.api-card-toggle[data-target] 折叠 .api-card-body；
            .eye-btn[data-target] 明文/密文；.toggle-switch 加/去 .active。
   ============================================================ */
.nano-api .app-container {
  width: 100%;
  max-width: 430px;
  margin: 0 auto;
  background: transparent;
  padding: 0 16px 16px 16px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: relative;
}
.nano-api .app-content {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  min-height: 0; padding-top: 0; padding-bottom: 0;
}
.nano-api .top-title-wrap {
  flex-shrink: 0; padding: 10px 0 6px 0; text-align: center;
  position: sticky; top: 0; background: transparent; z-index: 10;
  border-radius: 0 0 16px 16px;
}
.nano-api .top-title {
  font-size: 18px; font-weight: 600; color: var(--nano-text); letter-spacing: -0.3px;
  background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px); padding: 6px 20px; border-radius: 30px;
  border: 0.5px solid rgba(255, 255, 255, 0.15); display: inline-block;
}
.nano-api .scroll-area { flex: 1; overflow-y: auto; padding: 4px 0 12px 0; }

/* 分段 Tab + 滑动白块 */
.nano-api .tab-bar {
  position: relative; display: flex; padding: 4px; margin: 0 0 12px 0;
  background: rgba(120, 120, 128, 0.12); backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px); border-radius: 12px;
  border: 0.5px solid rgba(255, 255, 255, 0.2); flex-shrink: 0; z-index: 1;
}
.nano-api .tab-item {
  flex: 1; position: relative; z-index: 2; padding: 8px 0; border: none;
  background: transparent; border-radius: 9px; font-size: 13px; font-weight: 500;
  color: var(--nano-text-2); cursor: pointer; transition: color 0.25s ease;
  letter-spacing: -0.2px;
}
.nano-api .tab-item.active { color: var(--nano-accent); font-weight: 600; }
.nano-api .tab-item:active { transform: scale(0.97); }
.nano-api .tab-indicator {
  position: absolute; top: 4px; left: 4px; height: calc(100% - 8px); width: 25%;
  background: #fff; border-radius: 9px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08), 0 0 0 0.5px rgba(0, 0, 0, 0.02);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1; pointer-events: none;
}
.nano-api .tab-panel { display: none; }
.nano-api .tab-panel.active { display: block; }

/* API 卡片 */
.nano-api .api-card {
  background: rgba(255, 255, 255, 0.2); backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px); border-radius: 20px; padding: 16px 16px 14px;
  margin-bottom: 14px; border: 0.5px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.02), inset 0 1px 1px rgba(255, 255, 255, 0.3);
}
.nano-api .api-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.nano-api .api-card-title { font-size: 16px; font-weight: 600; color: var(--nano-text); letter-spacing: -0.3px; }
.nano-api .api-card-toggle {
  background: none; border: none; color: var(--nano-text-3); font-size: 14px;
  cursor: pointer; padding: 4px 8px; border-radius: 8px; transition: all 0.15s;
}
.nano-api .api-card-body.collapsed { display: none; }

/* 表单 */
.nano-api .form-group { margin-bottom: 12px; }
.nano-api .form-label { font-size: 13px; font-weight: 500; color: var(--nano-text-2); margin-bottom: 4px; display: block; }
.nano-api .form-label .hint { color: var(--nano-text-3); font-weight: 400; font-size: 12px; }
.nano-api .form-control {
  width: 100%; padding: 10px 14px; border-radius: 12px; border: 0.5px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.4); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px); font-size: 15px; color: var(--nano-text);
  outline: none; transition: all 0.15s; height: 44px;
}
.nano-api .form-control:focus { border-color: var(--nano-accent); background: rgba(255, 255, 255, 0.6); }
.nano-api .form-control::placeholder { color: var(--nano-text-3); }
.nano-api .form-row { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 12px; }
.nano-api .form-row .form-group { flex: 1; margin-bottom: 0; display: flex; flex-direction: column; }

/* 按钮 */
.nano-api .btn {
  padding: 6px 12px; border-radius: 8px; border: none; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; background: rgba(255, 255, 255, 0.3);
  color: var(--nano-accent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 0.5px solid rgba(255, 255, 255, 0.1); white-space: nowrap; height: 32px;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
}
.nano-api .btn:active { transform: scale(0.94); }
.nano-api .btn-primary { background: var(--nano-accent); color: #fff; border: none; }
.nano-api .btn-success { background: #34c759; color: #fff; border: none; }
.nano-api .btn-sm { padding: 4px 8px; font-size: 11px; height: 26px; min-width: 44px; }
.nano-api .btn-xs { padding: 3px 6px; font-size: 11px; height: 24px; min-width: 36px; }
.nano-api .btn-group { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.nano-api .btn-group .btn { flex: 1; min-width: 50px; }

/* 预设行 */
.nano-api .preset-row { display: flex; gap: 6px; align-items: center; }
.nano-api .preset-row .form-control { flex: 1; height: 30px; padding: 2px 10px; font-size: 13px; border-radius: 6px; }
.nano-api .preset-row .btn { flex-shrink: 0; background: var(--nano-danger); color: #fff; border: none; padding: 2px 10px; border-radius: 6px; font-size: 11px; height: 26px; }

/* Key 明暗切换 */
.nano-api .key-input-wrap { position: relative; display: flex; align-items: center; }
.nano-api .key-input-wrap .form-control { padding-right: 44px; }
.nano-api .key-input-wrap .eye-btn {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--nano-text-3); font-size: 18px;
  cursor: pointer; padding: 4px; width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.nano-api .key-input-wrap .eye-btn:active { background: rgba(0, 0, 0, 0.04); color: var(--nano-accent); }

/* 温度滑杆 */
.nano-api .temp-val { float: right; color: var(--nano-accent); font-weight: 600; font-size: 13px; }
.nano-api .temp-range {
  -webkit-appearance: none; appearance: none; width: 100%; height: 8px; border-radius: 4px;
  background: rgba(120, 120, 128, 0.20); outline: none; cursor: pointer; margin: 12px 0 6px;
}
.nano-api .temp-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; border: 0.5px solid rgba(0, 0, 0, 0.10);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22), 0 0 0 0.5px rgba(0, 0, 0, 0.04); margin-top: -4px;
}
.nano-api .temp-hint { display: flex; justify-content: space-between; font-size: 10px; color: var(--nano-text-3); margin-top: -2px; }

/* 开关 */
.nano-api .toggle-switch {
  width: 44px; height: 24px; border-radius: 24px; background: #c7c7cc; cursor: pointer;
  transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1); position: relative;
  flex-shrink: 0; border: none; padding: 0; outline: none;
}
.nano-api .toggle-switch.active { background: #34c759; }
.nano-api .toggle-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
  border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
  transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.nano-api .toggle-switch.active::after { left: 22px; }

/* 模型选择 */
.nano-api .model-select-wrap {
  margin-top: 10px; padding: 10px 14px; background: rgba(0, 122, 255, 0.04);
  border-radius: 12px; border: 0.5px solid rgba(0, 122, 255, 0.08); display: none;
}
.nano-api .model-select-wrap.show { display: block; }
.nano-api .model-search-row { display: flex; gap: 6px; margin-bottom: 4px; }
.nano-api .model-search-row .form-control { flex: 1; height: 26px; padding: 1px 8px; font-size: 11px; border-radius: 4px; }
.nano-api .model-select { height: 42px; font-size: 12px; padding: 2px 6px; border-radius: 4px; }

/* 提示词折叠区 */
.nano-api .prompt-section { margin-top: 12px; padding-top: 12px; border-top: 0.5px solid rgba(0, 0, 0, 0.05); }
.nano-api .prompt-toggle-btn {
  background: none; border: none; color: var(--nano-accent); font-size: 14px; font-weight: 500;
  cursor: pointer; padding: 4px 0; display: flex; align-items: center; gap: 6px;
}
.nano-api .prompt-content { display: none; margin-top: 10px; }
.nano-api .prompt-content.open { display: block; }
.nano-api .prompt-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.nano-api .prompt-row .form-control { flex: 1; height: 34px; padding: 4px 10px; font-size: 13px; border-radius: 8px; }
.nano-api .prompt-box-wrap { position: relative; margin-top: 6px; }
.nano-api .prompt-box {
  background: #eef4ff; border: 1px solid rgba(0, 122, 255, 0.15); border-radius: 12px;
  padding: 12px 44px 12px 16px; min-height: 56px; max-height: 120px; overflow-y: auto;
  font-size: 14px; color: var(--nano-text); line-height: 1.6; word-break: break-all;
}
.nano-api .prompt-box .empty-hint { color: var(--nano-text-3); font-size: 13px; }
.nano-api .prompt-box .tag { display: inline; color: var(--nano-text); margin: 0 4px 0 0; font-size: 14px; }
.nano-api .prompt-box .tag::after { content: '、'; color: var(--nano-text-3); }
.nano-api .prompt-box .tag:last-child::after { content: ''; }
.nano-api .prompt-clear-btn {
  position: absolute; top: 8px; right: 10px; background: rgba(0, 0, 0, 0.04); border: none;
  border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center;
  justify-content: center; color: var(--nano-text-2); font-size: 12px; cursor: pointer;
}
.nano-api .connection-status {
  background: rgba(52, 199, 89, 0.08); border: 0.5px solid rgba(52, 199, 89, 0.15);
  border-radius: 10px; padding: 8px 12px; margin-top: 8px; font-size: 12px;
  color: #28a745; display: none;
}
.nano-api .connection-status.show { display: block; }
.nano-api .connection-status .value { font-weight: 500; color: var(--nano-text); word-break: break-all; }

/* API 弹窗 */
.nano-api .ios-modal {
  display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  align-items: center; justify-content: center; z-index: 999;
}
.nano-api .ios-modal.active { display: flex; }
.nano-api .ios-modal-card {
  width: 280px; background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px); border-radius: 14px; overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.05);
}
.nano-api .ios-modal-title { font-size: 17px; font-weight: 600; color: var(--nano-text); text-align: center; padding: 18px 20px 4px; }
.nano-api .ios-modal-message { font-size: 13px; color: var(--nano-text-3); text-align: center; padding: 4px 20px 18px; line-height: 1.5; }
.nano-api .ios-modal-actions { display: flex; border-top: 0.5px solid rgba(60, 60, 67, 0.15); }
.nano-api .ios-modal-btn { flex: 1; padding: 12px 0; font-size: 17px; background: none; border: none; cursor: pointer; text-align: center; }
.nano-api .ios-modal-btn.cancel-btn { color: var(--nano-accent); border-right: 0.5px solid rgba(60, 60, 67, 0.15); }
.nano-api .ios-modal-btn.confirm-btn { color: var(--nano-accent); font-weight: 600; }

/* ============================================================
   5. Discover 页（页面作用域：body.nano-discover）
   ------------------------------------------------------------
   HTML 结构：
   .top-bar > span.top-bar-title            （居中标题）
   .container#mainContainer
     .carousel-section > .carousel#carousel   （照片墙 5 张卡）
        .card.center > img#photo0   （中间可点，弹换图）
        .card.left / .card.right / .card.farleft / .card.farright > img
       + .dots#dots > .dot(.active)
     nav.entries
        button.entry[data-app=moments|ins|couple|halo|books|music]
          span.entry-icon (内联 background 颜色) > svg
          span.entry-text > .entry-title + .entry-desc
          svg.entry-arrow
   .mask#mask + .sheet#sheet（换图弹层：.grabber / h3 / #choose / #cancel）+ .toast#toast
   JS 钩子：.entry[data-app] 打开对应 App；点 .card.center 打开 .sheet 换图。
   ------------------------------------------------------------
   换照片墙样式：
   - 改卡片尺寸圆角：.nano-discover .card { width / height / border-radius }
   - 改纵深：.nano-discover .card.left / .right / .farleft / .farright 的 transform
   - 想给某张卡换 URL 底图：.nano-discover .card.center img { content: url("...") }
   ============================================================ */
.nano-discover .top-bar {
  position: sticky; top: 0; z-index: 10; height: 52px; display: flex;
  align-items: center; justify-content: center; background: var(--nano-bg);
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.06);
}
.nano-discover .top-bar-title { font-size: 17px; font-weight: 600; letter-spacing: -0.3px; color: #111; }
.nano-discover .container { max-width: 560px; margin: 0 auto; padding: 26px 20px 52px; }
.nano-discover .carousel-section { margin-bottom: 36px; }
.nano-discover .carousel { height: 340px; position: relative; perspective: 1000px; }
.nano-discover .card {
  position: absolute; width: 212px; height: 284px; left: 50%; top: 16px;
  transform: translateX(-50%); border-radius: 26px; background: #f2f2f7;
  overflow: hidden; box-shadow: 0 16px 34px rgba(0, 0, 0, 0.10);
  transition: transform 0.5s cubic-bezier(0.2, 0.75, 0.2, 1), opacity 0.35s;
  cursor: pointer; user-select: none;
}
.nano-discover .card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nano-discover .card::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 45%, rgba(0, 0, 0, 0.10));
}
.nano-discover .card.center   { transform: translateX(-50%) scale(1); z-index: 5; }
.nano-discover .card.left     { transform: translateX(calc(-50% - 122px)) scale(0.80) rotateY(14deg); z-index: 3; opacity: 0.95; }
.nano-discover .card.right    { transform: translateX(calc(-50% + 122px)) scale(0.80) rotateY(-14deg); z-index: 3; opacity: 0.95; }
.nano-discover .card.farleft  { transform: translateX(calc(-50% - 196px)) scale(0.64) rotateY(20deg); z-index: 2; opacity: 0.68; }
.nano-discover .card.farright { transform: translateX(calc(-50% + 196px)) scale(0.64) rotateY(-20deg); z-index: 2; opacity: 0.68; }
.nano-discover .dots { display: flex; justify-content: center; gap: 6px; margin-top: 20px; }
.nano-discover .dot { width: 5px; height: 5px; border-radius: 50%; background: #dcdce0; transition: 0.25s; }
.nano-discover .dot.active { width: 18px; border-radius: 9px; background: #111; }
.nano-discover .entries { display: flex; flex-direction: column; gap: 12px; }
.nano-discover .entry {
  display: flex; align-items: center; padding: 15px 16px; border-radius: 20px;
  background: #fafafa; border: 0.5px solid rgba(0, 0, 0, 0.04); text-align: left;
  transition: background 0.18s, transform 0.18s;
}
.nano-discover .entry:active { background: #f2f2f7; transform: scale(0.985); }
.nano-discover .entry-icon {
  width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center;
  flex: none; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.nano-discover .entry-icon svg { width: 22px; height: 22px; fill: #fff; }
.nano-discover .entry-text { flex: 1; margin-left: 14px; display: flex; flex-direction: column; min-width: 0; }
.nano-discover .entry-title { font-size: 16px; font-weight: 600; letter-spacing: -0.3px; color: #111; }
.nano-discover .entry-desc {
  margin-top: 3px; font-size: 11px; color: #9a9a9f; letter-spacing: 0.1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nano-discover .entry-arrow { width: 8px; height: 14px; flex: none; margin-left: 10px; }
.nano-discover .mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.2); opacity: 0; pointer-events: none; transition: 0.25s; z-index: 20; }
.nano-discover .mask.open { opacity: 1; pointer-events: auto; }
.nano-discover .sheet {
  position: fixed; left: 50%; bottom: 0; width: min(560px, 100%);
  transform: translate(-50%, 105%); background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border-radius: 24px 24px 0 0; padding: 11px 20px 25px; z-index: 21;
  transition: 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.nano-discover .sheet.open { transform: translate(-50%, 0); }
.nano-discover .grabber { width: 35px; height: 4px; background: #d1d1d6; border-radius: 9px; margin: 1px auto 18px; }
.nano-discover .sheet h3 { font-size: 14px; margin: 0 0 13px; font-weight: 600; }
.nano-discover .sheet button { width: 100%; height: 49px; text-align: left; border-top: 0.5px solid #ececec; font-size: 15px; }
.nano-discover .sheet .cancel { color: var(--nano-text-3); }
.nano-discover .toast {
  position: fixed; left: 50%; bottom: 24px; z-index: 30; background: #111; color: #fff;
  border-radius: 30px; padding: 9px 15px; font-size: 12px;
  transform: translate(-50%, 12px); opacity: 0; transition: 0.25s;
  pointer-events: none; white-space: nowrap;
}
.nano-discover .toast.show { opacity: 1; transform: translate(-50%, 0); }

/* ============================================================
   6. More 页（页面作用域：body.nano-more）
   ------------------------------------------------------------
   HTML 结构：
   .top-bar > span.top-bar-title            （居中标题“More”）
   .container#mainContainer
     .profile-card#profileCard             （名片栏）
       .profile-avatar#profileAvatar > img#avatarImage / svg#avatarSvg
       .profile-info#profileInfo > .profile-name#profileName + .profile-desc
       svg.chevron-right
     .list-group > .list-item[data-page=wallet|favorite|emoji|worldbook|beautify|storage|backup|other]
       .item-icon.icon-xxx > svg
       span.item-title
       svg.chevron-right
   .modal-overlay#nameModal / #avatarModal  （改名字 / 换头像）
   JS 钩子：.list-item[data-page] 打开对应页面；点 #profileCard 改资料。
   ------------------------------------------------------------
   改信息栏样式：改 .profile-card / .profile-avatar / .profile-name / .profile-desc。
   改功能栏 UI：改 .list-group / .list-item / .item-icon（含各 .icon-xxx 底色）/ .item-title。
   用 URL 图片当图标：.nano-more .list-item[data-page="wallet"] .item-icon svg { display:none; }
                       .nano-more .list-item[data-page="wallet"] .item-icon { background-image:url("..."); }
   ============================================================ */
.nano-more .top-bar { padding: 14px 0 6px 0; text-align: center; background: var(--nano-bg); position: sticky; top: 0; z-index: 10; }
.nano-more .top-bar-title { font-size: 17px; font-weight: 600; color: var(--nano-text); letter-spacing: -0.3px; }
.nano-more .container {
  max-width: 430px; margin: 0 auto; padding: 0 16px 40px 16px;
  overflow-y: auto; height: calc(100vh - 50px); background: var(--nano-bg);
}
.nano-more .profile-card {
  display: flex; align-items: center; background: var(--nano-bg); border-radius: 12px;
  padding: 14px 16px; margin-bottom: 20px; cursor: pointer; transition: background 0.15s;
  border: 0.5px solid var(--nano-line);
}
.nano-more .profile-card:active { background: #f2f2f7; }
.nano-more .profile-avatar {
  width: 60px; height: 60px; border-radius: 50%; background: #e5e5ea; display: flex;
  justify-content: center; align-items: center; margin-right: 16px; overflow: hidden; flex-shrink: 0;
}
.nano-more .profile-avatar svg { width: 32px; height: 32px; fill: var(--nano-text-3); }
.nano-more .profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.nano-more .profile-info { flex-grow: 1; min-width: 0; }
.nano-more .profile-name { font-size: 18px; font-weight: 500; margin-bottom: 2px; }
.nano-more .profile-desc { font-size: 12px; color: var(--nano-text-3); }
.nano-more .chevron-right { width: 8px; height: 14px; flex-shrink: 0; margin-left: 4px; }
.nano-more .list-group {
  background: var(--nano-bg); border-radius: 12px; margin-bottom: 6px;
  overflow: hidden; border: 0.5px solid var(--nano-line);
}
.nano-more .list-item { display: flex; align-items: center; padding: 12px 14px; background: var(--nano-bg); cursor: pointer; gap: 14px; }
.nano-more .list-item:active { background: #f2f2f7; }
.nano-more .list-item:not(:last-child) { border-bottom: 0.5px solid var(--nano-line); }
.nano-more .item-icon {
  width: 32px; height: 32px; border-radius: 7px; display: flex; justify-content: center;
  align-items: center; flex-shrink: 0; background-size: cover; background-position: center;
}
.nano-more .item-icon svg { width: 19px; height: 19px; fill: #fff; }
.nano-more .icon-wallet { background-color: #34c759; }
.nano-more .icon-fav { background-color: #ff9500; }
.nano-more .icon-emoji { background-color: #ffcc00; }
.nano-more .icon-music { background-color: #ff2d55; }
.nano-more .icon-world { background-color: var(--nano-accent); }
.nano-more .icon-beautify { background-color: #af52de; }
.nano-more .icon-storage { background-color: #ff6b8a; }
.nano-more .icon-data { background-color: #5856d6; }
.nano-more .icon-other { background-color: #5ac8fa; }
.nano-more .item-title { font-size: 17px; font-weight: 400; flex: 1; color: var(--nano-text); }
.nano-more .ios-switch { position: relative; display: inline-block; width: 50px; height: 30px; flex-shrink: 0; margin-left: auto; }
.nano-more .ios-switch input { opacity: 0; width: 0; height: 0; }
.nano-more .ios-switch-track { position: absolute; inset: 0; background: #e5e5ea; border-radius: 16px; transition: background 0.2s ease; }
.nano-more .ios-switch-track::before {
  content: ""; position: absolute; width: 26px; height: 26px; left: 2px; top: 2px;
  background: #fff; border-radius: 50%; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}
.nano-more .ios-switch input:checked + .ios-switch-track { background: #34c759; }
.nano-more .ios-switch input:checked + .ios-switch-track::before { transform: translateX(20px); }
.nano-more .modal-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.12); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px); display: flex; justify-content: center; align-items: center;
  opacity: 0; visibility: hidden; transition: opacity 0.25s ease; z-index: 3000;
}
.nano-more .modal-overlay.active { opacity: 1; visibility: visible; }
.nano-more .modal-box {
  width: 280px; background: rgba(242, 242, 247, 0.92); backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%); border-radius: 14px; text-align: center;
  transform: scale(0.92); transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.12); overflow: hidden;
}
.nano-more .modal-overlay.active .modal-box { transform: scale(1); }

/* ============================================================
   7. 其它通用 DIY 参考（按需启用；默认注释，避免影响初始外观）
   ============================================================ */
/* 7.1 去掉所有按键的按压缩放（全站最强）： */
/*
.nano-index .capsule-btn:active,
.nano-index .circle-more:active,
.nano-index .back-btn:active,
.nano-index .page-topbar-btn:active,
.nano-chat .tab-btn:active,
.nano-chat .chat-item:active,
.nano-discover .entry:active,
.nano-more .list-item:active,
.nano-api .btn:active,
.nano-api .tab-item:active { transform: none !important; }
*/

/* 7.2 统一圆角 / 去阴影： */
/*
.nano-chat .search-box,
.nano-chat .user-status-bar,
.nano-more .list-group,
.nano-api .api-card { border-radius: 0 !important; box-shadow: none !important; }
*/

/* 7.3 把 index 底栏变成长条贴底工具栏： */
/*
.nano-index .bottom-actions { left: 0; right: 0; bottom: 0; }
.nano-index .capsule-group {
  flex: 1; border-radius: 0; justify-content: space-around;
  padding: 10px 8px calc(10px + 0px);
  background: rgba(255, 255, 255, 0.92);
}
*/

/* 7.4 给 chat 顶栏两个按钮整体靠右 / 加文字： */
/*
.nano-chat .page-topbar { justify-content: flex-end; gap: 10px; }
.nano-chat #characterPageBtn::after {
  content: "角色"; font-size: 11px; margin-left: 4px;
}
*/

/* 7.5 用 URL 图片替换 More 列表图标（示例：钱包）： */
/*
.nano-more .list-item[data-page="wallet"] .item-icon svg { display: none; }
.nano-more .list-item[data-page="wallet"] .item-icon {
  background-image: url("https://your.cdn/wallet.png");
  background-size: 22px 22px; background-repeat: no-repeat; background-position: center;
  background-color: transparent;
}
*/

/* 7.6 给任意元素加装饰性文字（不影响功能）： */
/*
.nano-chat .nano-brand::after {
  content: " · 高自由度美化"; font-size: 12px; letter-spacing: 0;
  margin-left: 8px; -webkit-text-fill-color: #8e8e93;
}
*/

/* 7.7 「隐藏原图标 → 把功能绑到新图标位置」（全站通用，和聊天配方 N 同一招）
   关键：能点的图标必须是「真实按钮」；::before / ::after 画的图标不能点。
   所以做法是给真实按钮换外衣 + 挪位置，按钮本身别删，功能照旧。三步：
   // ① 隐藏按钮里的原图案（按钮和点击区保留）
   .某按钮 > svg, .某按钮 > i { display: none; }
   // ② 换上新图标
   .某按钮 { background: url("https://your.cdn/icon.svg") center/22px no-repeat; }
   // ③ 想挪到别处就改定位（相对最近的非 static 祖先），或直接 transform 平移
   .某按钮 { position: absolute; right: 16px; bottom: 12px; }
   // 纯装饰占位（不可点）：给一个稳定的父元素加伪元素
   .某父元素::before {
     content: ""; position: absolute; pointer-events: none;
     width: 22px; height: 22px; background: url("https://your.cdn/decor.svg") center/22px no-repeat;
   }

   实例（把 More 页「钱包」行的图标换成你的图，功能仍走整行点击）：
   .nano-more .list-item[data-page="wallet"] .item-icon svg { display: none; }
   .nano-more .list-item[data-page="wallet"] .item-icon {
     background: url("https://your.cdn/wallet.png") center/22px no-repeat;
   }
   其它页同理：先找到那一页真实的按钮/行元素选择器，再套上面三步。
   想新增「第 N 个」纯属没有对应功能的图标：用伪元素做装饰即可（不可点）；
   若要它也接功能，需要新增真实按钮并绑 JS（纯 CSS 做不到，可让纳米加）。
*/
`;
