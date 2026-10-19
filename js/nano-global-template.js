/* ============================================================
   js/nano-global-template.js
   纳米「全局美化」初始模板 —— 聊天页（chat.html）完整版
   ------------------------------------------------------------
   作用页面：chat.html（body.nano-chat）
   * 全局美化 CSS 会注入到 index / chat / chat_inner / groups /
     discover / more / api 等页面，但本模板全部用 .nano-chat 限定，
     所以只会改「聊天列表页」，不会误伤其它页面。
   * 聊天内页（私聊 chat_inner.html / 群聊 groups.html）请用
     「聊天美化」模板（js/nano-chat-template.js）。
   * 这里的代码 = chat.html 当前完整 UI 的逐条 CSS，可直接任意 DIY。

   ★ 还能写脚本：用英文注释包住 JS（开头 / * @js，结尾 * /），
     可直接造 HTML / 改 DOM / 绑事件。可用：mount / $ / $$ / el / on /
     observe / onCleanup / document / window。
     点「还原 / 清空」会清空脚本、mount 与所有 onCleanup。

   ------------------------------------------------------------
   一、聊天页 HTML 结构（chat.html）
   ------------------------------------------------------------
   body.nano-chat
     .app
       .page.active#page-chat                     ← 聊天页
         .top-bar                                 （返回 / 标题 / Meet / 新建群聊）
           .left  > button.icon-btn#btn-back
           .title
           .right > button.icon-btn#btn-meet
                    button.icon-btn#btn-new-group
         .avatar-switcher#avatar-switcher         （面具头像，横向滚动）
           .avatar-item[.active] > .ring > .ring-inner > img/.placeholder
                                   .name
                                   .add-badge > svg      ← 第一个「+」项
         .thin-sep
         .search-wrap > .search-box > svg + input#search-input
         .tabs > .tab[data-tab=friends|groups][.active]
         .list-area#list-friends                  （好友列表，JS 渲染）
         .list-area#list-groups                   （群聊列表，JS 渲染）

       .page#page-contacts                        （通讯录占位）
       .page#page-moments                         （朋友圈占位）
       .page#page-profile                         ← 主页
         .top-bar
         .profile-header > .profile-avatar-wrap > .profile-avatar#profile-avatar
                           .profile-info > .profile-stats > .stat×3
         .profile-name-row > .profile-name#profile-name
         .profile-bio#profile-bio
         .profile-actions > button#btn-edit + button
         .func-list > .func-card[data-open=wallet|favorite|emoji|mask]
                        .icon-wrap + .func-text(.func-title/.func-desc) + svg.arrow

       .dock-wrap > .dock
         button.dock-btn[data-page=chat|contacts|moments|profile][.active] > svg

       .group-mask#groupMask > .group-sheet      ← 新建群聊
         .group-sheet-head > span + button#groupClose
         input.group-name-input#groupNameInput
         .group-members#groupMembers > .group-member-row（JS 渲染）
         button.group-create-btn#groupCreateBtn

   聊天条目（JS 渲染，每个 .chat-item 结构）：
     .chat-item[.pinned][.swiped]
       .chat-item-inner
         .avatar
         .content > .row1 > .name + .time
                    .msg
       .swipe-actions > button.pin-btn + button.del-btn

   二、常用 JS 钩子 / 选中态
     .page.active                           由 dock / tab 切换
     .tab.active                            当前好友 / 群聊页签
     .avatar-item.active                    当前面具
     .chat-item.pinned / .chat-item.swiped  置顶 / 左滑
     .dock-btn.active                       当前底栏页
     .group-mask.show                       新建群聊打开
     #search-input                          搜索好友 / 群聊
     #btn-new-group / #groupCreateBtn       新建群聊
     #btn-meet                              Meet
     #btn-edit                              编辑资料
     .func-card[data-open]                  钱包 / 收藏 / 表情包 / 面具

   三、DIY 速查（取消注释即可）
     A. 换主色 / 强调色（影响 Tab 下划线、底栏选中、按钮等）：
        .nano-chat { --accent: #111111; --text: #111111; --bg: #ffffff; }
     B. 页面底色 / 壁纸：
        .nano-chat { background: #f7f7fa; }
        body.nano-chat .app { background: url("图片") center/cover fixed; }
     C. 隐藏面具头像条（功能仍在，只是不显示）：
        .nano-chat .avatar-switcher { display: none !important; }
     D. 紧凑列表（改高度 / 头像 / 字号）：
        .nano-chat .chat-item { height: 64px; }
        .nano-chat .chat-item .avatar { width: 42px; height: 42px; }
        .nano-chat .chat-item .name { font-size: 15px; }
     E. 列表条目加圆角卡片：
        .nano-chat .list-area { padding: 8px 12px 96px; }
        .nano-chat .chat-item { border-radius: 14px; margin-bottom: 6px; }
        .nano-chat .chat-item-inner { border-radius: 14px; }
     F. 底栏 Dock 改色 / 改玻璃：
        .nano-chat .dock { background: rgba(255,255,255,.72); backdrop-filter: blur(20px); }
        .nano-chat .dock-btn.active { background: #111; color: #fff; }
     G. 顶栏改透明 / 吸顶：
        .nano-chat .top-bar { background: transparent; }
     H. 隐藏某个 Dock 按钮（功能仍在）：
        .nano-chat .dock-btn[data-page="moments"] { display: none !important; }
     I. 搜索框圆角 / 底色：
        .nano-chat .search-box { background: #f0f0f3; border-radius: 14px; }
     J. 头像圆环换成图片：
        .nano-chat .avatar-item.active .ring {
          background: url("头像框.png") center/cover no-repeat;
        }
     K. 新建群聊弹层圆角 / 背景：
        .nano-chat .group-sheet { border-radius: 28px 28px 0 0; background: #fafafa; }

   ============================================================ */

window.NANO_GLOBAL_TEMPLATE = `/* ============================================================
   Nano 全局美化 · 聊天页完整模板
   仅为 chat.html / body.nano-chat 编写，可整段替换、任意 DIY。
   ============================================================ */

.nano-chat {
  --bg: #ffffff;
  --text: #111111;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  --border: #f0f0f0;
  --hover: #f7f7f7;
  --active: #eeeeee;
  --accent: #111111;
  --danger: #e54d42;
  --radius: 16px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --gray-avatar: #d1d1d1;
}

/* 1. 基础重置 */
.nano-chat * {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

html body.nano-chat,
body.nano-chat {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  user-select: none;
}

/* 2. 主框架 / 页面容器 */
.nano-chat .app {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  max-width: 480px;
  margin: 0 auto;
  background: var(--bg);
}

.nano-chat .page {
  display: none;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  
  
  padding-bottom: 0;
}

.nano-chat .page.active {
  display: flex;
}

/* 3. 顶栏 */
/* 3.1 纳米接入层：安全区 / 真实头像 */
.nano-chat .top-bar {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  flex-shrink: 0;
  background: var(--bg);
}

.nano-chat .top-bar .left,
.nano-chat .top-bar .right {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 80px;
}

.nano-chat .top-bar .right {
  justify-content: flex-end;
}

.nano-chat .top-bar .title {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.nano-chat .icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text);
  transition: background 0.15s;
}

.nano-chat .icon-btn:active {
  background: var(--active);
}

.nano-chat .icon-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

/* 4. 面具头像切换 */
.nano-chat .avatar-switcher {
  padding: 12px 16px 14px;
  display: flex;
  gap: 18px;
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}

.nano-chat .avatar-switcher::-webkit-scrollbar {
  display: none;
}

.nano-chat .avatar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  cursor: pointer;
}

.nano-chat .avatar-item .ring {
  position: relative;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  padding: 3px;
  background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
  transition: all 0.25s ease;
}

.nano-chat .avatar-item:not(.active) .ring {
  background: #e8e8e8;
  padding: 2px;
}

.nano-chat .avatar-item.active .ring {
  background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
  padding: 3px;
}

.nano-chat .avatar-item .ring-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #fff;
  padding: 2px;
  display: block;
}

.nano-chat .avatar-item .ring img,
.nano-chat .avatar-item .ring .placeholder {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background: var(--gray-avatar);
  display: block;
}

.nano-chat .avatar-item .add-badge {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #111;
  border: 2px solid #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.nano-chat .avatar-item .add-badge svg {
  width: 12px;
  height: 12px;
  fill: #fff;
}

.nano-chat .avatar-item .name {
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 68px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.nano-chat .avatar-item.active .name {
  color: var(--text);
  font-weight: 500;
}

.nano-chat .thin-sep {
  height: 1px;
  background: var(--border);
  margin: 0 16px;
  flex-shrink: 0;
}

/* 5. 搜索框 */
.nano-chat .search-wrap {
  padding: 12px 16px;
  flex-shrink: 0;
}

.nano-chat .search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  background: #f5f5f5;
  border-radius: 18px;
  padding: 0 14px;
}

.nano-chat .search-box svg {
  width: 16px;
  height: 16px;
  fill: var(--text-tertiary);
  flex-shrink: 0;
}

.nano-chat .search-box input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--text);
  outline: none;
}

.nano-chat .search-box input::placeholder {
  color: var(--text-tertiary);
}

/* 6. 好友 / 群聊 Tab */
.nano-chat .tabs {
  display: flex;
  padding: 0 16px;
  gap: 24px;
  flex-shrink: 0;
  height: 40px;
  align-items: center;
}

.nano-chat .tab {
  font-size: 15px;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  padding: 6px 0;
  font-weight: 400;
  transition: color 0.15s;
}

.nano-chat .tab.active {
  color: var(--text);
  font-weight: 600;
}

.nano-chat .tab.active::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 2px;
  background: var(--text);
  border-radius: 1px;
}

/* 7. 聊天列表 */
.nano-chat .list-area {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  
  padding-bottom: 80px;
}

.nano-chat .list-area::-webkit-scrollbar {
  width: 0;
}

/* 7.1 聊天条目（左滑置顶 / 删除） */
.nano-chat .chat-item {
  position: relative;
  height: 72px;
  overflow: hidden;
  background: var(--bg);
}

.nano-chat .chat-item-inner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
  background: var(--bg);
  transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  z-index: 2;
}

.nano-chat .chat-item.swiped .chat-item-inner {
  transform: translateX(-140px);
}

.nano-chat .chat-item .avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--gray-avatar);
  flex-shrink: 0;
}

.nano-chat .chat-item .content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nano-chat .chat-item .row1 {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nano-chat .chat-item .name {
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nano-chat .chat-item .time {
  font-size: 12px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  margin-left: 8px;
}

.nano-chat .chat-item .msg {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nano-chat .chat-item.pinned .name::before {
  content: "";
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23999'%3E%3Cpath d='M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z'/%3E%3C/svg%3E") center/contain no-repeat;
  vertical-align: -1px;
}

.nano-chat .swipe-actions {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 140px;
  display: flex;
  z-index: 1;
}

.nano-chat .swipe-actions button {
  flex: 1;
  border: none;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}

.nano-chat .swipe-actions .pin-btn {
  background: #666;
}

.nano-chat .swipe-actions .del-btn {
  background: var(--danger);
}

.nano-chat .swipe-actions svg {
  width: 18px;
  height: 18px;
  fill: #fff;
}

.nano-chat .empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  font-size: 14px;
  gap: 12px;
}

.nano-chat .empty svg {
  width: 48px;
  height: 48px;
  fill: #ddd;
}

/* 8. 主页（我的） */
.nano-chat .profile-header {
  padding: 16px 16px 12px;
  display: flex;
  gap: 20px;
  align-items: center;
}

.nano-chat .profile-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.nano-chat .profile-avatar {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--gray-avatar);
  display: block;
}

.nano-chat .profile-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.nano-chat .profile-stats {
  display: flex;
  width: 100%;
}

.nano-chat .stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.nano-chat .stat .num {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
}

.nano-chat .stat .label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.nano-chat .profile-name-row {
  padding: 0 16px 2px;
}

.nano-chat .profile-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
}

.nano-chat .profile-bio {
  padding: 0 16px 14px;
  font-size: 14px;
  color: var(--text);
  line-height: 1.45;
}

.nano-chat .profile-actions {
  padding: 0 16px 18px;
  display: flex;
  gap: 8px;
}

.nano-chat .profile-actions button {
  flex: 1;
  height: 32px;
  border: none;
  background: #efefef;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}

.nano-chat .profile-actions button:active {
  background: #e0e0e0;
}

.nano-chat .func-list {
  padding: 4px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nano-chat .func-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 8px;
  background: transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.nano-chat .func-card:active {
  background: var(--hover);
}

.nano-chat .func-card .icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nano-chat .func-card .icon-wrap svg {
  width: 22px;
  height: 22px;
  fill: var(--text);
}

.nano-chat .func-card .func-text {
  flex: 1;
  min-width: 0;
}

.nano-chat .func-card .func-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}

.nano-chat .func-card .func-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.nano-chat .func-card .arrow {
  width: 18px;
  height: 18px;
  fill: #ccc;
  flex-shrink: 0;
}

/* 9. 占位页（通讯录 / 朋友圈） */
.nano-chat .placeholder-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 15px;
  gap: 12px;
}

.nano-chat .placeholder-page svg {
  width: 56px;
  height: 56px;
  fill: #ddd;
}

/* 10. 悬浮 Dock 底栏 */
.nano-chat .dock-wrap {
  position: absolute;
  bottom: calc(16px + var(--safe-bottom));
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  
  pointer-events: none;
}

.nano-chat .dock {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #ffffff;
  border-radius: 999px;
  padding: 6px 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0,0,0,0.04);
  pointer-events: auto;
}

.nano-chat .dock-btn {
  width: 52px;
  height: 52px;
  border: none;
  background: transparent;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #999;
  transition: all 0.2s;
}

.nano-chat .dock-btn svg {
  width: 24px;
  height: 24px;
  fill: currentColor;
}

.nano-chat .dock-btn.active {
  background: #111111;
  color: #fff;
}

.nano-chat .dock-btn:not(.active):active {
  background: rgba(0, 0, 0, 0.06);
}

.nano-chat .list-area {
  position: relative;
  z-index: 1;
}

.nano-chat .chat-item {
  position: relative;
  z-index: 1;
}

.nano-chat .page > .placeholder-page,
.nano-chat .page > .func-list {
  padding-bottom: 90px;
}

.nano-chat .top-bar {
  height: calc(52px + var(--safe-top, 0px));
  padding: var(--safe-top, 0px) 12px 0;
}

.nano-chat .chat-item .avatar {
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}

.nano-chat .profile-avatar {
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 28px;
  font-weight: 600;
}

.nano-chat .list-area {
  padding-bottom: calc(92px + var(--safe-bottom, 0px));
}

.nano-chat .page > .func-list {
  padding-bottom: calc(100px + var(--safe-bottom, 0px));
}

.nano-chat .func-card {
  cursor: pointer;
}

.nano-chat .empty[data-empty-action] {
  cursor: pointer;
}

/* 11. 新建群聊弹层 */
.nano-chat .group-mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: none;
  align-items: flex-end;
  background: rgba(0, 0, 0, .35);
}

.nano-chat .group-mask.show {
  display: flex;
}

.nano-chat .group-sheet {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  background: #fff;
  border-radius: 22px 22px 0 0;
  padding: 18px 16px calc(18px + var(--safe-bottom, 0px));
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, .12);
}

.nano-chat .group-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 17px;
  font-weight: 600;
}

.nano-chat .group-sheet-head button {
  width: 32px;
  height: 32px;
  border: 0;
  background: #f2f2f2;
  border-radius: 50%;
  font-size: 20px;
  line-height: 1;
  color: #555;
}

.nano-chat .group-name-input {
  height: 42px;
  border: 0;
  border-radius: 12px;
  background: #f5f5f5;
  padding: 0 13px;
  font-size: 15px;
  outline: none;
}

.nano-chat .group-members {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nano-chat .group-member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 2px;
  border-bottom: 1px solid #f3f3f3;
}

.nano-chat .group-member-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #d1d1d1 center/cover no-repeat;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  flex-shrink: 0;
  overflow: hidden;
}

.nano-chat .group-member-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nano-chat .group-member-row input {
  width: 20px;
  height: 20px;
  accent-color: #111;
}

.nano-chat .group-create-btn {
  height: 46px;
  border: 0;
  border-radius: 14px;
  background: #111;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}

.nano-chat .group-create-btn:disabled {
  opacity: .35;
}

.nano-chat .group-empty {
  padding: 26px 10px;
  text-align: center;
  color: #999;
  font-size: 13px;
  line-height: 1.7;
}



/* ============================================================
   四、更多 DIY 示例（默认注释，取消注释生效）
   ============================================================ */
/* 4.1 去掉所有按压回弹
.nano-chat .icon-btn:active,
.nano-chat .chat-item-inner:active,
.nano-chat .dock-btn:active,
.nano-chat .func-card:active { transform: none !important; }
*/

/* 4.2 搜索框改成描边风格
.nano-chat .search-box {
  background: transparent !important;
  border: 1px solid rgba(0,0,0,.12);
}
*/

/* 4.3 未读 / 置顶强化
.nano-chat .chat-item.pinned { background: #fafafa; }
.nano-chat .chat-item .time { color: #111; font-weight: 600; }
*/

/* 4.4 底栏改两枚悬浮圆钮（隐藏原胶囊底色）
.nano-chat .dock {
  background: transparent !important;
  box-shadow: none !important;
  gap: 12px;
}
.nano-chat .dock-btn {
  width: 48px; height: 48px;
  background: #fff;
  box-shadow: 0 6px 20px rgba(0,0,0,.12);
}
*/

/* 4.5 给聊天条目加分割线（默认无）
.nano-chat .chat-item-inner::after {
  content: ""; position: absolute; left: 76px; right: 0; bottom: 0;
  height: 1px; background: rgba(0,0,0,.05);
}
*/
`;
