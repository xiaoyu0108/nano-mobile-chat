/* ============================================================
   js/nano-chat-theme-gray-pink.js
   Nano「灰粉对话 · Gray-Pink」聊天内置美化（第二套内置气泡）
   ------------------------------------------------------------
   气泡取自内置小组件「灰粉对话」：我方浅粉、对方深灰（已去掉波点）。
   顶栏 / 底栏参考 iMessage：悬浮圆形按钮 + 胶囊输入栏。
   供 js/beautify.js 的「内置风格」切换使用，挂载到
   window.NANO_CHAT_TEMPLATE_GRAY_PINK。
   ============================================================ */

window.NANO_CHAT_TEMPLATE_GRAY_PINK = `/* ============================================================
   灰粉对话 · Gray-Pink（内置第二套）
   —— 私聊 chat_inner（body.nano-chat-inner）
   ============================================================ */
:root {
  --gp-ink: #4a4a4a;
  --gp-pink: #f9d5e0;
  --gp-pink-soft: #fdf1f5;
  --gp-pink-deep: #e8b6c7;
  --gp-rose: #bd8395;
  --gp-muted: #a49a9d;
  --gp-line: rgba(74, 74, 74, 0.10);
  --chat-bg: #ffffff;
  --chat-text: #3f3537;
  --chat-sub: #a49a9d;
  --chat-accent: #bd8395;
  --chat-glass-bg: rgba(255, 255, 255, 0.62);
  --chat-glass-line: rgba(255, 255, 255, 0.92);
  --bubble-me: #f9d5e0;
  --bubble-me-text: #5a5a5a;
  --bubble-other: #4a4a4a;
  --bubble-other-text: #ffffff;
  --chat-top-inset: calc(var(--safe-top, 0px) + 104px);
  --chat-bottom-inset: 76px;
  --chat-topbar-pad: calc(var(--safe-top, 0px) + 8px);
  --chat-topbar-mask: transparent;
  --chat-bottom-mask: transparent;
  /* 纯 CSS 固定翻译模式：1 = 独立译文（放在外语气泡下方），不受聊天设置开关影响 */
  --nano-trans-separate: 1;
}

body.nano-chat-inner .chat-container { background: #ffffff; }
body.nano-chat-inner .chat-bg { background-color: #ffffff; }

/* ============================================================
   1. 顶栏 —— iMessage 式悬浮玻璃圆钮 + 居中头像昵称
   ============================================================ */
body.nano-chat-inner .topbar {
  height: calc(var(--safe-top, 0px) + 94px);
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--chat-topbar-pad, calc(var(--safe-top, 0px) + 8px)) 16px 0;
  background: transparent !important;
  box-shadow: none !important;
}
body.nano-chat-inner .back-btn,
body.nano-chat-inner .topbar-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--chat-glass-bg);
  border: 0.5px solid var(--chat-glass-line);
  box-shadow: 0 5px 18px rgba(74, 74, 74, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.95);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
body.nano-chat-inner .back-btn:active,
body.nano-chat-inner .topbar-avatar:active { transform: scale(0.92); background: rgba(255, 255, 255, 0.85); }
body.nano-chat-inner .back-btn i { display: none !important; }
body.nano-chat-inner .back-btn::before {
  content: "";
  width: 20px;
  height: 20px;
  display: block;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23111111' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14.5 5 7.5 12l7 7'/%3E%3C/svg%3E") center / contain no-repeat;
}
body.nano-chat-inner .topbar-avatar > img,
body.nano-chat-inner .topbar-avatar > span { display: none !important; }
body.nano-chat-inner .topbar-avatar::before {
  content: "";
  width: 20px;
  height: 20px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23111111' stroke-width='2.1' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='2.8' y='6.2' width='13.2' height='11.6' rx='1.5'/%3E%3Cpath d='M16 10.4 21.2 7.4v9.2L16 13.6z'/%3E%3C/svg%3E") center / contain no-repeat;
  display: block;
}
body.nano-chat-inner .topbar-title {
  position: absolute;
  left: 50%;
  top: calc(var(--safe-top, 0px) + 0px);
  transform: translateX(-50%);
  width: auto;
  max-width: 72%;
  padding: 0;
  margin: 0;
  background: none !important;
  border: 0 !important;
  box-shadow: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 0;
  line-height: 1.25;
  letter-spacing: -0.2px;
  color: transparent;
  text-align: center;
  white-space: nowrap;
  overflow: visible;
}
/* JS 未执行时的兜底：至少保留一个昵称胶囊 */
body.nano-chat-inner .topbar-title:not(.gp-ready) {
  font-size: 15px;
  color: #171214;
  padding: 7px 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94) !important;
  box-shadow: 0 5px 18px rgba(74, 74, 74, 0.10) !important;
}
body.nano-chat-inner .topbar-title:not(.gp-ready)::before { display: none; }
body.nano-chat-inner .topbar-title:not(.gp-ready)::after { display: none; }
body.nano-chat-inner .topbar-title::before {
  content: attr(data-gp-initial);
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #f3e3e8, #e7d7dd) center / cover no-repeat;
  border: 2px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 7px 20px rgba(74, 74, 74, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.85);
  color: #a08e93;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0;
}
body.nano-chat-inner .topbar-title.gp-has-avatar::before {
  background-image: var(--gp-avatar);
  color: transparent;
}
/* 昵称单独一颗胶囊，挂在头像下方 */
body.nano-chat-inner .topbar-title::after {
  content: attr(data-gp-name) "  ›";
  display: block;
  max-width: 100%;
  box-sizing: border-box;
  padding: 6px 15px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  border: 0.5px solid rgba(255, 255, 255, 0.98);
  box-shadow: 0 5px 18px rgba(74, 74, 74, 0.10), inset 0 1px 0 #fff;
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  color: #171214;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.18;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ============================================================
   2. 消息行 / 头像 / 气泡
   ============================================================ */
body.nano-chat-inner .message-scroll { padding-left: 16px; padding-right: 16px; }
body.nano-chat-inner .message-avatar,
body.nano-chat-inner .typing-indicator .ti-avatar { display: none !important; }
body.nano-chat-inner .message-row { margin-bottom: 10px; }
body.nano-chat-inner .message-content { max-width: 74%; }
body.nano-chat-inner .message-row:has(.bubble-card) .message-content { max-width: 88%; }

body.nano-chat-inner .date-label,
body.nano-chat-inner .chat-time-divider { color: #b2a9ac; font-size: 11px; font-weight: 500; }

body.nano-chat-inner .bubble {
  position: relative;
  width: max-content;
  max-width: 190px;
  min-width: 44px;
  padding: 6px 13px;
  border-radius: 18px;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.34;
  letter-spacing: 0.1px;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}
body.nano-chat-inner .bubble.other {
  background: #4a4a4a;
  background-image: none;
  color: #ffffff;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.14);
}
body.nano-chat-inner .bubble.other::after {
  content: "";
  position: absolute;
  left: 13px;
  bottom: -6px;
  width: 14px;
  height: 9px;
  background: #4a4a4a;
  border-radius: 0 0 0 2px;
  clip-path: polygon(0 0, 100% 0, 0 100%);
  display: block !important;
}
body.nano-chat-inner .bubble.me {
  background: #f9d5e0;
  background-image: none;
  color: #5a5a5a;
  box-shadow: 0 3px 10px rgba(74, 74, 74, 0.08);
  margin-left: auto;
}
body.nano-chat-inner .bubble.me::after {
  content: "";
  position: absolute;
  right: 13px;
  bottom: -6px;
  width: 14px;
  height: 9px;
  background: #f9d5e0;
  border-radius: 0 0 2px 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
  display: block !important;
}
/* 灰粉主题：每一条气泡都保留尾巴（连续消息也一样） */
body.nano-chat-inner .bubble.grouped::after { display: block !important; }

/* 图片 / 表情 / 文字图：去掉头像后保持左右对齐 */
body.nano-chat-inner .image-bubble,
body.nano-chat-inner .image-wrapper,
body.nano-chat-inner .text-image-bubble,
body.nano-chat-inner .image-desc-bubble { border-radius: 16px; box-shadow: 0 4px 14px rgba(74, 74, 74, 0.10); }

/* 输入中 */
body.nano-chat-inner .typing-indicator { gap: 0; }
body.nano-chat-inner .typing-indicator .ti-bubble {
  background: #4a4a4a;
  border-radius: 18px;
  padding: 9px 14px;
  position: relative;
}
body.nano-chat-inner .typing-indicator .ti-bubble::after {
  content: "";
  position: absolute;
  left: 13px;
  bottom: -6px;
  width: 14px;
  height: 9px;
  background: #4a4a4a;
  border-radius: 0 0 0 2px;
  clip-path: polygon(0 0, 100% 0, 0 100%);
}
body.nano-chat-inner .typing-indicator .dot { background: #f8b6c8; }

/* ============================================================
   2.1 群聊：同款灰粉气泡（保留群头像与昵称，不隐藏身份）
   ============================================================ */
body.nano-groups .bubble {
  position: relative;
  width: max-content;
  max-width: 100%;
  min-width: 44px;
  padding: 6px 13px;
  border-radius: 18px;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.34;
  letter-spacing: 0.1px;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}
body.nano-groups .bubble.other {
  background: #4a4a4a;
  background-image: none;
  color: #ffffff;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.14);
}
body.nano-groups .bubble.other::after {
  content: "";
  position: absolute;
  left: 13px;
  bottom: -6px;
  width: 14px;
  height: 9px;
  background: #4a4a4a;
  border-radius: 0 0 0 2px;
  clip-path: polygon(0 0, 100% 0, 0 100%);
  display: block !important;
}
body.nano-groups .bubble.me {
  background: #f9d5e0;
  background-image: none;
  color: #5a5a5a;
  box-shadow: 0 3px 10px rgba(74, 74, 74, 0.08);
}
body.nano-groups .bubble.me::after {
  content: "";
  position: absolute;
  right: 13px;
  bottom: -6px;
  width: 14px;
  height: 9px;
  background: #f9d5e0;
  border-radius: 0 0 2px 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
  display: block !important;
}
body.nano-groups .bubble.grouped::after { display: block !important; }
body.nano-groups .msg-name-line { order: -2; }
body.nano-groups .voice-bubble.left { background: #4a4a4a; color: #ffffff; }
body.nano-groups .voice-bubble.right { background: #f9d5e0; color: #5a5a5a; }
body.nano-groups .voice-bubble.left::before,
body.nano-groups .voice-bubble.right::before {
  content: "";
  position: absolute;
  bottom: -6px;
  width: 14px;
  height: 9px;
  background: inherit;
  display: block;
}
body.nano-groups .voice-bubble.left::before {
  left: 13px;
  right: auto;
  border-radius: 0 0 0 2px;
  clip-path: polygon(0 0, 100% 0, 0 100%);
}
body.nano-groups .voice-bubble.right::before {
  right: 13px;
  left: auto;
  border-radius: 0 0 2px 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
}
body.nano-groups .bubble.voice-transcript-bubble {
  background: transparent !important;
  color: #a49a9d !important;
  border: 0 !important;
  box-shadow: none !important;
  padding: 2px 3px 0 !important;
  max-width: 190px;
  font-size: 12px;
}
body.nano-groups .bubble.voice-transcript-bubble::before,
body.nano-groups .bubble.voice-transcript-bubble::after { display: none !important; }
body.nano-groups .bubble.voice-transcript-bubble .voice-transcript {
  display: block;
  color: #a49a9d !important;
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  text-decoration-color: rgba(164, 154, 157, 0.7);
}
body.nano-groups .translation-bubble {
  order: 1;
  align-self: flex-start;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  padding: 0 5px 0 28px !important;
  margin: -9px 2px 9px !important;
  color: #161113 !important;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.4;
  text-shadow: 0 0 4px #fff, 0 0 4px #fff, 0 1px 0 #fff, 0 -1px 0 #fff, 1px 0 0 #fff, -1px 0 0 #fff;
}
body.nano-groups .translation-bubble.me {
  align-self: flex-end;
  color: #a56379 !important;
  text-align: right;
  padding: 0 28px 0 5px !important;
}
body.nano-groups .quote-block {
  order: -1;
  position: relative;
  display: flex;
  align-items: center;
  gap: 3px;
  align-self: flex-start;
  max-width: 100%;
  margin: 24px 0 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid #c9c9c9;
  box-shadow: 0 2px 7px rgba(74, 74, 74, 0.06);
  color: #171214;
  font-size: 12.5px;
  overflow: visible;
}
body.nano-groups .message-row.right .quote-block { align-self: flex-end; }
body.nano-groups .quote-block::before {
  content: "Reply";
  position: absolute;
  left: 2px;
  top: -24px;
  padding-left: 19px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: #8b8b8b;
  white-space: nowrap;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%238b8b8b'%3E%3Cpath d='M9.6 4.6 2.8 11l6.8 6.4v-4.2c4.8 0 8 1.7 9.9 5.4.5-6.7-3.2-11.5-9.9-11.9V4.6z'/%3E%3C/svg%3E") left center / 14px 14px no-repeat;
}
body.nano-groups .quote-block .quote-fold {
  position: absolute;
  left: -7px;
  top: -8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: #e9dfe3;
  background-image: var(--gp-quote-avatar, none);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  border: 1.5px solid #ffffff;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.14);
  overflow: hidden;
  z-index: 3;
}
body.nano-groups .quote-block .quote-fold svg { display: none !important; }
body.nano-groups .quote-block .quote-fold::after {
  content: attr(data-gp-qinitial);
  font-size: 10px;
  font-weight: 700;
  color: #8f7d82;
}
body.nano-groups .quote-block .quote-fold.gp-has-avatar::after { color: transparent; }
body.nano-groups .quote-block .quote-name {
  flex: none;
  font-size: 12.5px !important;
  font-weight: 500;
  color: #333333;
}
body.nano-groups .quote-block .quote-name::after { content: "："; }
body.nano-groups .quote-block .quote-text {
  min-width: 0;
  flex: 1;
  color: #555555;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
body.nano-groups .recall-notice {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: #1c1c1e !important;
  font-size: 11.5px;
}

/* ============================================================
   3. 语音气泡 + 转文字
   ============================================================ */
body.nano-chat-inner .voice-bubble {
  position: relative;
  padding: 7px 13px;
  border-radius: 18px;
  max-width: 62%;
}
body.nano-chat-inner .voice-bubble.left { background: #4a4a4a; color: #ffffff; }
body.nano-chat-inner .voice-bubble.right { background: #f9d5e0; color: #5a5a5a; }
body.nano-chat-inner .voice-bubble.left::before,
body.nano-chat-inner .voice-bubble.right::before {
  content: "";
  position: absolute;
  bottom: -6px;
  width: 14px;
  height: 9px;
  background: inherit;
  display: block;
}
body.nano-chat-inner .voice-bubble.left::before {
  left: 13px;
  border-radius: 0 0 0 2px;
  clip-path: polygon(0 0, 100% 0, 0 100%);
}
body.nano-chat-inner .voice-bubble.right::before {
  right: 13px;
  border-radius: 0 0 2px 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
}
/* 转文字：无包裹、无气泡，只是一条装饰性的划线 */
body.nano-chat-inner .bubble.voice-transcript-bubble {
  background: transparent !important;
  background-image: none !important;
  color: #a49a9d !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  padding: 2px 3px 0 !important;
  margin: 0;
  min-width: 0;
  max-width: 190px;
  font-size: 12px;
  line-height: 1.45;
}
body.nano-chat-inner .bubble.voice-transcript-bubble::before,
body.nano-chat-inner .bubble.voice-transcript-bubble::after { display: none !important; }
body.nano-chat-inner .bubble.voice-transcript-bubble .voice-transcript {
  position: relative;
  display: block;
  color: #a49a9d !important;
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  text-decoration-color: rgba(164, 154, 157, 0.7);
  text-align: left;
  white-space: pre-wrap;
}
body.nano-chat-inner .bubble.voice-transcript-bubble .voice-transcript::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: rgba(164, 154, 157, 0.55);
  pointer-events: none;
}
body.nano-chat-inner .message-row.right .voice-transcript-bubble .voice-transcript { text-align: right; }

/* ============================================================
   4. 翻译 —— 独立文字，放在外文气泡上方（参考 Q&A 气泡翻译）
   ============================================================ */
body.nano-chat-inner .translation-bubble {
  order: 1;
  position: relative;
  z-index: 2;
  display: block;
  align-self: flex-start;
  margin: -9px 2px 9px;
  padding: 0 5px 0 28px;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  color: #161113;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.4;
  letter-spacing: 0.1px;
  text-shadow: 0 0 4px #fff, 0 0 4px #fff, 0 1px 0 #fff, 0 -1px 0 #fff, 1px 0 0 #fff, -1px 0 0 #fff;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
  text-align: left;
}
body.nano-chat-inner .translation-bubble.me {
  align-self: flex-end;
  color: #a56379;
  text-align: right;
  padding: 0 28px 0 5px;
  background: transparent !important;
}
body.nano-chat-inner .bubble .translation-text {
  display: block;
  margin-top: 4px;
  padding-top: 0;
  border-top: 0;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.9;
  color: inherit;
}

/* ============================================================
   5. 引用 —— 小实心转发箭头 + 加粗 Re + 小头像 + 引用内容
   ============================================================ */
body.nano-chat-inner .quote-block {
  order: -1;
  position: relative;
  display: flex;
  align-items: center;
  gap: 3px;
  align-self: flex-start;
  max-width: 100%;
  margin: 24px 0 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid #c9c9c9;
  box-shadow: 0 2px 7px rgba(74, 74, 74, 0.06);
  color: #171214;
  font-size: 12.5px;
  line-height: 1.35;
  overflow: visible;
}
body.nano-chat-inner .message-row.right .quote-block { align-self: flex-end; }
/* Reply 弯箭头在胶囊外面 */
body.nano-chat-inner .quote-block::before {
  content: "Reply";
  position: absolute;
  left: 2px;
  top: -24px;
  padding-left: 19px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: #8b8b8b;
  white-space: nowrap;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%238b8b8b'%3E%3Cpath d='M9.6 4.6 2.8 11l6.8 6.4v-4.2c4.8 0 8 1.7 9.9 5.4.5-6.7-3.2-11.5-9.9-11.9V4.6z'/%3E%3C/svg%3E") left center / 14px 14px no-repeat;
}
/* 小头像咬住胶囊左上角外沿；由模板 JS 同步引用方头像 */
body.nano-chat-inner .quote-block .quote-fold {
  position: absolute;
  left: -7px;
  top: -8px;
  width: 20px;
  height: 20px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: #e9dfe3;
  background-image: var(--gp-quote-avatar, none);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  border: 1.5px solid #ffffff;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.14);
  color: #8f7d82;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  overflow: hidden;
  z-index: 3;
}
body.nano-chat-inner .quote-block .quote-fold svg { display: none !important; }
body.nano-chat-inner .quote-block .quote-fold::after {
  content: attr(data-gp-qinitial);
  font-size: 10px;
  font-weight: 700;
  color: #8f7d82;
}
body.nano-chat-inner .quote-block .quote-fold.gp-has-avatar::after { color: transparent; }
body.nano-chat-inner .quote-block .quote-name {
  flex: none;
  font-size: 12.5px !important;
  font-weight: 500;
  color: #333333;
  opacity: 1;
}
body.nano-chat-inner .quote-block .quote-name::after { content: "："; }
body.nano-chat-inner .quote-block .quote-text {
  display: block;
  min-width: 0;
  flex: 1;
  color: #555555;
  opacity: 1;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ============================================================
   6. 系统提示 / 撤回 —— 无包裹
   ============================================================ */
body.nano-chat-inner .message-row.recall-notice,
body.nano-chat-inner .message-row.sys-notice { padding: 4px 0; }
body.nano-chat-inner .message-row.sys-notice .recall-notice,
body.nano-chat-inner .message-row.recalled .recall-notice {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  padding: 2px 4px !important;
  color: #1c1c1e !important;
  font-size: 11.5px;
  font-weight: 500;
  white-space: normal;
  max-width: 92%;
  text-align: center;
}
body.nano-chat-inner .message-row.recalled .bubble {
  background: transparent !important;
  color: #1c1c1e !important;
  box-shadow: none !important;
  font-style: normal;
  font-size: 11.5px;
  padding: 2px 4px;
}
body.nano-chat-inner .message-row.recalled .bubble::before,
body.nano-chat-inner .message-row.recalled .bubble::after { display: none !important; }

/* ============================================================
   6.1 思维链 / 工具调用 —— 同色系小卡片
   ============================================================ */
body.nano-chat-inner .msg-think,
body.nano-groups .msg-think {
  display: block;
  align-self: flex-start;
  width: auto;
  max-width: 100%;
  margin: 0 0 7px;
  padding: 7px 10px;
  background: #faf6f7;
  border: 1px solid #efe3e7;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(74, 74, 74, 0.04);
  color: #8d8185;
  font-size: 11px;
  line-height: 1.45;
  overflow: hidden;
}
body.nano-chat-inner .msg-think .msg-think-toggle,
body.nano-groups .msg-think .msg-think-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #8d8185;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
body.nano-chat-inner .msg-think .msg-think-dot,
body.nano-groups .msg-think .msg-think-dot { background: #c9a6b2; }
body.nano-chat-inner .msg-think .msg-think-icon,
body.nano-groups .msg-think .msg-think-icon { width: 13px; height: 13px; color: #b78e9d; }
body.nano-chat-inner .msg-think .msg-think-body,
body.nano-groups .msg-think .msg-think-body {
  margin-top: 6px;
  padding: 0;
  max-height: 220px;
  overflow-y: auto;
  background: transparent;
  border: 0;
  color: #8d8185;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
}
body.nano-chat-inner .msg-think.open .msg-think-body,
body.nano-groups .msg-think.open .msg-think-body { display: block; }
body.nano-chat-inner .msg-tools,
body.nano-groups .msg-tools {
  background: #f8f3f4;
  border-color: #eadce1;
}
body.nano-chat-inner .msg-tools .msg-think-toggle,
body.nano-groups .msg-tools .msg-think-toggle { color: #8a7b80; }
body.nano-chat-inner .msg-tool,
body.nano-groups .msg-tool {
  padding: 6px 0;
  border-top: 1px solid #ede3e6;
}
body.nano-chat-inner .msg-tool:first-child,
body.nano-groups .msg-tool:first-child { border-top: 0; padding-top: 0; }
body.nano-chat-inner .msg-tool-name,
body.nano-groups .msg-tool-name {
  font-size: 11px;
  font-weight: 700;
  color: #554a4e;
}
body.nano-chat-inner .msg-tool-args,
body.nano-groups .msg-tool-args {
  margin-top: 2px;
  font-size: 10px;
  color: #a1969a;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}
body.nano-chat-inner .msg-tool-res,
body.nano-groups .msg-tool-res {
  margin-top: 3px;
  font-size: 10.5px;
  color: #6d6165;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ============================================================
   7. 卡片 —— 长方形：左 SVG / 右文字 / 底部接收·退还
   ============================================================ */
body.nano-chat-inner .bubble-card {
  width: var(--card-width, 258px);
  max-width: 100%;
  min-height: 0;
  background: #ffffff;
  color: #4a4a4a;
  border: 0.5px solid rgba(74, 74, 74, 0.08);
  border-radius: 15px;
  box-shadow: 0 7px 20px rgba(74, 74, 74, 0.08);
  overflow: hidden;
  font-size: 12.5px;
  line-height: 1.32;
}
body.nano-chat-inner .bubble-card .card-header { display: none !important; }
body.nano-chat-inner .bubble-card .main-section {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  justify-content: flex-start !important;
  gap: 10px !important;
  padding: 12px !important;
  text-align: left !important;
  border-bottom: 1px solid #f6ebef !important;
}
body.nano-chat-inner .bubble-card .main-text {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  flex: 1 !important;
  min-width: 0 !important;
  gap: 2px !important;
}
body.nano-chat-inner .bubble-card .main-icon,
body.nano-chat-inner .bubble-card .icon-wrap {
  width: 38px !important;
  height: 38px !important;
  margin: 0 !important;
  flex: none !important;
  border-radius: 12px !important;
  background: #f7e9ee !important;
  color: #bd8395 !important;
}
body.nano-chat-inner .bubble-card .main-icon svg,
body.nano-chat-inner .bubble-card .icon-wrap svg { width: 18px !important; height: 18px !important; }
/* 金额卡（转账 / 订单）没有图标节点，用伪元素补一个左侧 SVG */
body.nano-chat-inner .bubble-card.transfer .main-section::before,
body.nano-chat-inner .bubble-card .main-section:not(:has(.main-icon))::before {
  content: "";
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 12px;
  background-color: #f7e9ee;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23bd8395' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 8h14l-3-3'/%3E%3Cpath d='M20 16H6l3 3'/%3E%3C/svg%3E");
  background-position: center;
  background-size: 18px;
  background-repeat: no-repeat;
}
body.nano-chat-inner .bubble-card .main-label {
  margin: 0 !important;
  font-size: 10px !important;
  font-weight: 500 !important;
  letter-spacing: 0.2px;
  color: #a79a9e !important;
  text-align: left !important;
}
body.nano-chat-inner .bubble-card .main-title {
  font-size: 14px !important;
  font-weight: 650 !important;
  line-height: 1.28 !important;
  color: #4a4a4a !important;
  text-align: left !important;
}
body.nano-chat-inner .bubble-card .amount {
  font-size: 21px !important;
  font-weight: 700 !important;
  letter-spacing: -0.4px;
  line-height: 1.12 !important;
  color: #4a4a4a !important;
  text-align: left !important;
}
body.nano-chat-inner .bubble-card .amount span { font-size: 13px !important; font-weight: 600 !important; }
body.nano-chat-inner .bubble-card .main-sub {
  margin-top: 2px !important;
  font-size: 11px !important;
  color: #a79a9e !important;
  text-align: left !important;
}
body.nano-chat-inner .bubble-card .info-section { display: none !important; }
body.nano-chat-inner .bubble-card .message-box {
  margin: 0 !important;
  padding: 8px 12px 9px !important;
  background: #fbf7f8 !important;
  border-radius: 0 !important;
  font-size: 11px !important;
  color: #8f8487 !important;
  max-height: 64px;
}
body.nano-chat-inner .bubble-card .card-image { display: none !important; }
body.nano-chat-inner .bubble-card .card-footer {
  padding: 7px 10px !important;
  gap: 6px !important;
  background: #fdfafb !important;
  border-top: 1px solid #f6ebef !important;
}
body.nano-chat-inner .bubble-card .card-footer.status-only { padding: 8px 12px 9px !important; }
body.nano-chat-inner .bubble-card .card-footer-text {
  font-size: 10.5px !important;
  color: #a79a9e !important;
}
body.nano-chat-inner .bubble-card .card-actions {
  flex: 0 0 auto !important;
  margin-left: auto;
  gap: 6px !important;
}
body.nano-chat-inner .bubble-card .card-btn,
body.nano-chat-inner .bubble-card .btn {
  height: 28px !important;
  min-width: 0 !important;
  padding: 0 10px !important;
  border-radius: 9px !important;
  font-size: 11.5px !important;
  font-weight: 650 !important;
  color: #7a7073 !important;
  background: #f1eff0 !important;
  box-shadow: none !important;
}
body.nano-chat-inner .bubble-card .card-btn.primary,
body.nano-chat-inner .bubble-card .btn-primary {
  color: #ffffff !important;
  background: #cfa3b1 !important;
}
body.nano-chat-inner .bubble-card .card-btn.primary:active,
body.nano-chat-inner .bubble-card .btn-primary:active { background: #c190a0 !important; }
body.nano-chat-inner .bubble-card .card-btn.return-btn,
body.nano-chat-inner .bubble-card .btn-secondary { background: #f1eff0 !important; color: #7a7073 !important; }
body.nano-chat-inner .bubble-card .card-btn:active,
body.nano-chat-inner .bubble-card .btn:active { transform: scale(0.96); }

/* 转账 / 礼物卡：按钮只留图标（接收 / 退还） */
body.nano-chat-inner .bubble-card.transfer .card-btn,
body.nano-chat-inner .bubble-card.gift .card-btn,
body.nano-chat-inner .bubble-card .card-btn[data-act="receive"],
body.nano-chat-inner .bubble-card .card-btn[data-act="return"] {
  width: 30px !important;
  height: 28px !important;
  flex: 0 0 30px !important;
  padding: 0 !important;
  font-size: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
body.nano-chat-inner .bubble-card.transfer .card-btn::before,
body.nano-chat-inner .bubble-card.gift .card-btn::before,
body.nano-chat-inner .bubble-card .card-btn[data-act="receive"]::before,
body.nano-chat-inner .bubble-card .card-btn[data-act="return"]::before {
  content: "";
  width: 14px;
  height: 14px;
  display: block;
  background: center / contain no-repeat;
}
body.nano-chat-inner .bubble-card.transfer .card-btn.primary,
body.nano-chat-inner .bubble-card.gift .card-btn.primary,
body.nano-chat-inner .bubble-card .card-btn[data-act="receive"] {
  background: #d5a6b4 !important;
}
body.nano-chat-inner .bubble-card.transfer .card-btn.primary::before,
body.nano-chat-inner .bubble-card.gift .card-btn.primary::before,
body.nano-chat-inner .bubble-card .card-btn[data-act="receive"]::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E");
}
body.nano-chat-inner .bubble-card.transfer .card-btn.return-btn,
body.nano-chat-inner .bubble-card.gift .card-btn.return-btn,
body.nano-chat-inner .bubble-card .card-btn[data-act="return"] {
  background: #eef0ef !important;
}
body.nano-chat-inner .bubble-card.transfer .card-btn.return-btn::before,
body.nano-chat-inner .bubble-card.gift .card-btn.return-btn::before,
body.nano-chat-inner .bubble-card .card-btn[data-act="return"]::before {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237d8a80' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 14 4 9l5-5'/%3E%3Cpath d='M4 9h10a6 6 0 0 1 0 12h-2'/%3E%3C/svg%3E");
}
/* 已处理卡片保持柔和 */
body.nano-chat-inner .bubble-card.claimed .main-section,
body.nano-chat-inner .bubble-card.received .main-section,
body.nano-chat-inner .bubble-card.returned .main-section,
body.nano-chat-inner .bubble-card.accepted .main-section,
body.nano-chat-inner .bubble-card.rejected .main-section,
body.nano-chat-inner .bubble-card.opened .main-section { opacity: 0.78; }

/* ============================================================
   8. 底栏 —— iMessage 式悬浮输入；打字变绿，空态灰色话筒
   ============================================================ */
body.nano-chat-inner .bottom-bar {
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  background: transparent !important;
  box-shadow: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
body.nano-chat-inner .more-btn {
  width: 44px;
  height: 44px;
  background: var(--chat-glass-bg);
  border: 0.5px solid var(--chat-glass-line);
  box-shadow: 0 5px 18px rgba(74, 74, 74, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.95);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  color: #8f8789;
}
body.nano-chat-inner .more-btn:active { background: rgba(255, 255, 255, 0.85); }
body.nano-chat-inner .input-shell {
  min-height: 46px;
  padding: 0 6px 0 15px !important;
  border-radius: 23px !important;
  background: rgba(255, 255, 255, 0.62) !important;
  border: 0.5px solid var(--chat-glass-line) !important;
  box-shadow: 0 6px 20px rgba(74, 74, 74, 0.09), inset 0 1px 0 rgba(255, 255, 255, 0.95) !important;
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
body.nano-chat-inner .input-row { min-height: 46px; padding: 0 !important; gap: 2px !important; }
body.nano-chat-inner .input { font-size: 16px; color: #2f2a2b; padding: 6px 2px; }
body.nano-chat-inner .input::placeholder { color: #b3aaad; font-weight: 400; }

/* 输入时只让发送钮变绿，整条胶囊保持玻璃白（JS 加 .gp-typing，:has 作兜底） */

/* 表情 / 语音按钮：图标隐藏，位置与点击区不变（仍能弹出面板） */
body.nano-chat-inner .emoji-btn,
body.nano-chat-inner .voice-btn { width: 32px; height: 32px; opacity: 1; }
body.nano-chat-inner .emoji-btn i,
body.nano-chat-inner .voice-btn i { visibility: hidden; }
body.nano-chat-inner .emoji-btn:active,
body.nano-chat-inner .voice-btn:active { background: rgba(255, 255, 255, 0.22) !important; }

/* 话筒 / 发送：嵌在输入胶囊右侧；加号独立 */
body.nano-chat-inner .send-btn {
  width: 30px;
  height: 30px;
  min-width: 30px;
  margin-left: 2px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #8e8e93;
  box-shadow: none;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.18s ease, color 0.18s ease, transform 0.15s ease;
}
body.nano-chat-inner .send-btn:active { transform: scale(0.9); }
body.nano-chat-inner .send-btn i { font-size: 16px; color: inherit; }
body.nano-chat-inner .input-shell.gp-typing .send-btn,
body.nano-chat-inner .input-shell:has(.input:not(:placeholder-shown)) .send-btn {
  color: #ffffff;
  background: #34c759 !important;
  box-shadow: 0 3px 10px rgba(52, 199, 89, 0.32) !important;
}
body.nano-chat-inner .send-btn.reply-mode {
  background: transparent !important;
  box-shadow: none !important;
  color: #8e8e93;
}
body.nano-chat-inner .send-btn.reply-mode i { display: none !important; }
body.nano-chat-inner .send-btn.reply-mode::after {
  content: "";
  width: 19px;
  height: 19px;
  display: block;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238e8e93' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='3' width='6' height='11' rx='3'/%3E%3Cpath d='M6 11a6 6 0 0 0 12 0M12 17v4'/%3E%3C/svg%3E") center / contain no-repeat;
}
body.nano-chat-inner .send-btn.disabled { background: transparent !important; box-shadow: none !important; color: #8e8e93; }
body.nano-chat-inner .send-btn.disabled i { display: block !important; }
body.nano-chat-inner .send-btn.reply-mode.disabled::after { display: none; }
/* 引用待发送时显示「回复」箭头，而不是话筒 */
body.nano-chat-inner .bottom-bar:has(.quote-bar.active) .send-btn.reply-mode { color: #34c759; }
body.nano-chat-inner .bottom-bar:has(.quote-bar.active) .send-btn.reply-mode i { display: block !important; color: #34c759; }
body.nano-chat-inner .bottom-bar:has(.quote-bar.active) .send-btn.reply-mode::after { display: none; }

/* 输入框上方的引用 / 表情推荐 */
body.nano-chat-inner .quote-bar {
  background: rgba(255, 255, 255, 0.92);
  border: 0.5px solid var(--chat-glass-line);
  box-shadow: 0 6px 20px rgba(74, 74, 74, 0.08);
}
body.nano-chat-inner .quote-bar .quote-name { color: #bd8395; }
body.nano-chat-inner .quote-bar .quote-cancel { background: rgba(189, 131, 149, 0.12); color: #bd8395; }

/* ============================================================
   9. 其它细节
   ============================================================ */
body.nano-chat-inner .multi-select-bar {
  background: rgba(255, 255, 255, 0.82);
  border: 0.5px solid var(--chat-glass-line);
  box-shadow: 0 5px 18px rgba(74, 74, 74, 0.10);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
}
body.nano-chat-inner .message-row.jump-highlight .bubble,
body.nano-chat-inner .message-row.jump-highlight .voice-bubble { box-shadow: 0 0 0 3px rgba(232, 182, 199, 0.45) !important; }

/* 双击气泡菜单：iPhone 液态玻璃 */
body.nano-chat-inner .longpress-menu {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.48)) !important;
  border: 0.5px solid rgba(255, 255, 255, 0.88) !important;
  border-radius: 18px !important;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.95) !important;
  -webkit-backdrop-filter: blur(34px) saturate(190%) !important;
  backdrop-filter: blur(34px) saturate(190%) !important;
  padding: 6px !important;
}
body.nano-chat-inner .longpress-menu .menu-item {
  padding: 9px 12px !important;
  border-radius: 12px !important;
  color: #111111 !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}
body.nano-chat-inner .longpress-menu .menu-item:active { background: rgba(255, 255, 255, 0.55) !important; }
body.nano-chat-inner .longpress-menu .menu-item .mi-icon { color: #8e8e93 !important; }
body.nano-chat-inner .longpress-menu .menu-item.danger,
body.nano-chat-inner .longpress-menu .menu-item.danger .mi-icon { color: #ff3b30 !important; }
body.nano-chat-inner .longpress-menu .menu-divider { background: rgba(0, 0, 0, 0.06) !important; margin: 4px 10px !important; }

/* ============================================================
   外卖 / 定位卡片：各自独立，不套用转账卡片模板
   ============================================================ */
body.nano-chat-inner .bubble-card.takeout {
  width: var(--card-width, 268px);
  background: linear-gradient(180deg, #fffdfb, #fdf3e9);
  border: 0.5px solid #edd7c4;
  border-radius: 18px;
  box-shadow: 0 8px 22px rgba(150, 110, 80, 0.10);
  color: #4b3a30;
  font-size: 12.5px;
}
body.nano-chat-inner .bubble-card.takeout .tk-bubble-head { padding: 13px 14px 10px; }
body.nano-chat-inner .bubble-card.takeout .tk-bubble-food { color: #4b3a30; font-size: 17px; font-weight: 750; }
body.nano-chat-inner .bubble-card.takeout .tk-bubble-shop { color: #a58a79; }
body.nano-chat-inner .bubble-card.takeout .tk-bubble-note {
  background: rgba(255, 255, 255, 0.72);
  border: 1px dashed #ecd8c8;
  color: #8d7565;
}
body.nano-chat-inner .bubble-card.takeout .tk-bubble-map {
  background: linear-gradient(135deg, #eef4ee, #e3edf5 55%, #f3f1ee);
  border: 1px solid rgba(80, 90, 100, 0.08);
}
body.nano-chat-inner .bubble-card.takeout .tk-bubble-btn {
  background: #e9a36b;
  color: #fff;
}
body.nano-chat-inner .bubble-card.takeout .tk-bubble-status { color: #a58a79; }

body.nano-chat-inner .bubble-card.location {
  width: var(--card-width, 258px);
  background: linear-gradient(180deg, #f9fcfd, #edf5fa);
  border: 0.5px solid #d7e5ee;
  border-radius: 18px;
  box-shadow: 0 8px 22px rgba(70, 110, 135, 0.09);
  color: #33505f;
  font-size: 12.5px;
}
body.nano-chat-inner .bubble-card.location .loc-bubble-head { padding: 12px 14px 10px; }
body.nano-chat-inner .bubble-card.location .loc-bubble-place { color: #33505f; font-size: 16px; font-weight: 750; }
body.nano-chat-inner .bubble-card.location .loc-bubble-dist { color: #7f9aa8; }
body.nano-chat-inner .bubble-card.location .loc-bubble-map {
  background: linear-gradient(135deg, #eaf3f0, #e1edf5 55%, #eef4f7);
  border: 1px solid rgba(70, 100, 120, 0.08);
}

/* @js
(function () {
  // 灰粉固定采用「外文气泡 + 下方独立译文」结构；显式声明一次，
  // 避免某些页面读不到 :root 的 --nano-trans-separate 时退回合并样式。
  try { window.NANO_TRANSLATION_SEPARATE = 1; } catch (e) {}
  var isPrivate = document.body && document.body.classList.contains('nano-chat-inner');
  var isNewNanoUI = document.body && document.body.classList.contains('nano-ai-ui');
  var title = document.getElementById('chatTitle');
  var img = document.getElementById('avatarImage');
  var ph = document.getElementById('avatarPlaceholder');
  var sendBtn = document.getElementById('sendBtn');
  var inputShell = document.querySelector('.input-shell');
  var inputRow = inputShell && inputShell.querySelector('.input-row');
  var input = document.getElementById('messageInput');
  var bottomBar = document.querySelector('.bottom-bar');
  var movedSend = false;
  var origParent = sendBtn && sendBtn.parentNode;
  var origNext = sendBtn && sendBtn.nextSibling;
  var timer = null;
  var interval = null;

  function syncIdentity() {
    if (!title) return;
    title.classList.add('gp-ready');
    var src = img && img.getAttribute('src');
    if (src) {
      title.style.setProperty('--gp-avatar', 'url("' + String(src).replace(/"/g, '%22') + '")');
      title.classList.add('gp-has-avatar');
    } else {
      title.style.removeProperty('--gp-avatar');
      title.classList.remove('gp-has-avatar');
    }
    var name = (title.textContent || '').trim();
    title.setAttribute('data-gp-name', name);
    var ch = ((ph && ph.textContent) || '').trim() || name;
    title.setAttribute('data-gp-initial', ch ? ch.slice(0, 1).toUpperCase() : '');
  }

  function quoteAvatarFor(name) {
    var charName = title ? (title.textContent || '').trim() : '';
    var charSrc = (img && img.getAttribute('src')) || '';
    if (!charSrc) {
      var leftImg = document.querySelector('.message-row.left .message-avatar img');
      charSrc = (leftImg && leftImg.getAttribute('src')) || '';
    }
    if (name && charName && name === charName) return charSrc;
    var meImg = document.querySelector('.message-row.right .message-avatar img');
    var meSrc = meImg && meImg.getAttribute('src');
    return meSrc || '';
  }

  function syncQuotes() {
    var blocks = document.querySelectorAll('.quote-block');
    for (var i = 0; i < blocks.length; i++) {
      var q = blocks[i];
      var nameEl = q.querySelector('.quote-name');
      var fold = q.querySelector('.quote-fold');
      if (!fold) continue;
      var qname = nameEl ? (nameEl.textContent || '').trim() : '';
      var src = quoteAvatarFor(qname);
      if (src) {
        fold.style.setProperty('--gp-quote-avatar', 'url("' + String(src).replace(/"/g, '%22') + '")');
        fold.classList.add('gp-has-avatar');
      } else {
        fold.style.removeProperty('--gp-quote-avatar');
        fold.classList.remove('gp-has-avatar');
      }
      fold.setAttribute('data-gp-qinitial', qname ? qname.slice(0, 1).toUpperCase() : '');
    }
  }

  function syncComposer() {
    if (!input || !inputShell) return;
    var has = !!String(input.value || '').trim();
    inputShell.classList.toggle('gp-typing', has);
    if (bottomBar) bottomBar.classList.toggle('gp-typing', has);
  }

  syncIdentity();
  syncQuotes();
  syncComposer();

  var mo = new MutationObserver(function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      syncIdentity();
      syncQuotes();
      syncComposer();
    }, 60);
  });
  try {
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
  } catch (e) {}

  // 输入框与话筒/发送按钮同处一颗胶囊；加号留在外面
  if (isPrivate && !isNewNanoUI && sendBtn && inputRow && sendBtn.parentNode !== inputRow) {
    inputRow.appendChild(sendBtn);
    movedSend = true;
  }
  function onInput() { syncComposer(); }
  if (isPrivate && !isNewNanoUI && input) {
    ['input', 'change', 'keyup', 'compositionend', 'paste', 'cut'].forEach(function (ev) {
      input.addEventListener(ev, onInput);
    });
  }
  if (isPrivate && !isNewNanoUI) interval = setInterval(syncComposer, 350);

  // 顶栏右侧视频按钮 = 设置页（独立打开 chat_inner 时也能跳转）
  var gear = document.getElementById('topbarAvatar');
  function openSettings() {
    var cid = '';
    try { cid = new URLSearchParams(location.search).get('chat') || ''; } catch (e) {}
    var isNano = false;
    try { isNano = !!(window.NanoAssistant && window.NanoAssistant.isNano && window.NanoAssistant.isNano(cid)); } catch (e) {}
    location.href = (isNano ? 'nano-setting.html' : 'inner-setting.html') + '?chat=' + encodeURIComponent(cid);
  }
  if (isPrivate && gear && window.parent === window) gear.addEventListener('click', openSettings);

  onCleanup(function () {
    clearTimeout(timer);
    if (interval) clearInterval(interval);
    try { mo.disconnect(); } catch (e) {}
    if (isPrivate && input) {
      ['input', 'change', 'keyup', 'compositionend', 'paste', 'cut'].forEach(function (ev) {
        input.removeEventListener(ev, onInput);
      });
    }
    if (movedSend && sendBtn && origParent) {
      try {
        if (origNext && origNext.parentNode === origParent) origParent.insertBefore(sendBtn, origNext);
        else origParent.appendChild(sendBtn);
      } catch (e) {}
    }
    if (inputShell) inputShell.classList.remove('gp-typing');
    if (bottomBar) bottomBar.classList.remove('gp-typing');
    if (gear) gear.removeEventListener('click', openSettings);
  });
})();
*/
`;
