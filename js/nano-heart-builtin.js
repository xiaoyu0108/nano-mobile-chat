/* ============================================================
   nano-heart-builtin.js — 心声内置美化模板
   ------------------------------------------------------------
   这里的内置模板会在心声初始化 / 心声美化页打开时写入
   NanoVoiceDB/templates（只补缺失，不覆盖用户已改过的同名预设）。
   ============================================================ */
(function () {
  'use strict';

  var PINK_DOTS_CSS = `/* nano-heart-pink-dots:v2
   ============================================================
   心声 · 粉色波点便签（内置）
   ------------------------------------------------------------
   超级淡的粉色波点便签卡片，顶部中间透明胶带；
   卡片内只保留左对齐的头像 / 昵称，下面直接是心声。
   收件人、时间、此刻印象、小标题等默认隐藏，需要时删掉对应
   display:none 那一行即可。

   ---- 想怎么 DIY 都行（都在本模板里改）----
   1) 隐藏 / 显示某部分：删掉对应 display:none!important 即可。
      .iv-caption        “发送人”小字
      .iv-unread         未读红点
      .iv-meta           收件人 / 时间
      .iv-subject        此刻 · 印象
      .iv-content-label  “心声 · 手记”小标题
   2) 移动头像：.iv-avatar{ position:absolute; left:10px; top:40px; }
      .iv-sender 已是 position:relative；不要用 position:fixed。
   3) 头像 / 昵称换位置或居右：
      .iv-sender{ flex-direction:row-reverse; }
      .iv-sender-info{ margin-left:0; margin-right:12px; text-align:right; }
   4) 换胶带位置 / 大小 / 角度：改 .nano-voice-modal::before 的
      left / top / width / height / transform。
   5) 加新板块（评论区、穿搭等）：在文件末尾的 @heart-sections
      注释块里，每行写「[板块名] 生成要求」。
   6) 加贴纸 / 文字：用 .iv-deco-top / .iv-deco-bottom 的 ::before / ::after，
      或给 .iv-deco 加 .on 后放图片；也可以写 @js 脚本块（写法见默认模板）。
   注意：不要删 JS 写入数据的 id / 类名，也不要写 position:fixed。
   ============================================================ */
.nano-voice-modal {
  --iv-avatar-size: 46px;
  --iv-avatar-radius: 14px;
  position: relative;
  width: min(372px, calc(100vw - 32px));
  max-height: none;
  overflow: visible;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  background-color: #fff8fb;
  background-image:
    radial-gradient(circle at center, rgba(236, 182, 201, 0.38) 1.8px, transparent 2.3px),
    linear-gradient(180deg, #fffafc 0%, #fff2f7 100%);
  background-size: 18px 18px, 100% 100%;
  background-repeat: repeat, no-repeat;
  border: 1px solid #f7dfe7;
  border-radius: 14px 14px 16px 10px;
  box-shadow: 0 20px 46px rgba(187, 132, 152, 0.16), 0 2px 6px rgba(187, 132, 152, 0.06);
  color: #6b5560;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* 顶部中间的透明胶带 */
.nano-voice-modal::before {
  content: "";
  position: absolute;
  z-index: 20;
  top: -12px;
  right: auto;
  left: 50%;
  width: 94px;
  height: 24px;
  transform: translateX(-50%) rotate(-2deg);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(244, 240, 244, 0.42)),
    repeating-linear-gradient(105deg, rgba(255, 255, 255, 0.42) 0 7px, rgba(255, 255, 255, 0.14) 7px 14px);
  border: 1px solid rgba(255, 255, 255, 0.88);
  border-radius: 1px;
  box-shadow: 0 1px 4px rgba(160, 120, 137, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  -webkit-backdrop-filter: blur(1.5px) saturate(120%);
  backdrop-filter: blur(1.5px) saturate(120%);
  opacity: 0.96;
  pointer-events: none;
}

/* 纸面柔光 */
.nano-voice-modal::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  background: radial-gradient(circle at 82% 12%, rgba(255, 255, 255, 0.55), transparent 38%);
  pointer-events: none;
}

/* 头像 + 昵称：左上角，左对齐 */
.nano-voice-modal .iv-header {
  position: relative;
  z-index: 2;
  padding: 32px 22px 6px;
  background: transparent;
  border-bottom: 0;
  border-radius: 0;
  text-align: left;
}
.nano-voice-modal .iv-sender {
  flex-direction: row;
  align-items: center;
  text-align: left;
}
.nano-voice-modal .iv-avatar {
  width: var(--iv-avatar-size, 46px);
  height: var(--iv-avatar-size, 46px);
  flex: 0 0 var(--iv-avatar-size, 46px);
  border-radius: var(--iv-avatar-radius, 14px);
  border: 2px solid rgba(255, 255, 255, 0.92);
  background: #ffe7ef;
  box-shadow: 0 3px 9px rgba(187, 132, 152, 0.16);
}
.nano-voice-modal .iv-avatar img { border-radius: inherit; }
.nano-voice-modal .iv-avatar-fallback {
  color: #c68ba1;
  font-size: 17px;
  font-weight: 700;
}
.nano-voice-modal .iv-sender-info {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0 0 0 12px;
  text-align: left;
}
.nano-voice-modal .iv-name {
  color: #855a6b;
  font-family: "Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", sans-serif;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.4px;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* 只留下头像、昵称和心声 */
.nano-voice-modal .iv-caption,
.nano-voice-modal .iv-unread,
.nano-voice-modal .iv-meta,
.nano-voice-modal .iv-subject,
.nano-voice-modal .iv-content-label { display: none !important; }

.nano-voice-modal .iv-content {
  position: relative;
  z-index: 2;
  min-height: 0;
  padding: 4px 22px 26px;
  background: transparent;
  border-radius: 0 0 16px 10px;
}
.nano-voice-modal .iv-thought {
  color: #6d5560;
  font-family: "Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 15.5px;
  font-weight: 400;
  font-style: normal;
  line-height: 1.85;
  letter-spacing: 0.25px;
  padding: 0;
  max-height: 48vh;
  transform: none;
  text-shadow: none;
  white-space: pre-wrap;
  word-break: break-word;
}
.nano-voice-modal .iv-thought::after { display: none !important; content: none !important; }

/* 附加文字 / 附加板块（默认空则完全不出现） */
.nano-voice-modal .iv-extra-text {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px dashed #f0d7e1;
  color: #a17f8d;
  font-size: 12.5px;
  line-height: 1.7;
}
.nano-voice-modal .iv-section {
  padding: 12px 22px;
  border-top: 1px dashed #f0d3df;
  background: rgba(255, 255, 255, 0.32);
}
.nano-voice-modal .iv-section-title {
  color: #b07e91;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.4px;
  margin-bottom: 6px;
}
.nano-voice-modal .iv-section-body {
  color: #6d5560;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.nano-voice-modal.has-sections .iv-content { border-radius: 0; }
.nano-voice-modal.has-sections .iv-sections {
  border-radius: 0 0 16px 10px;
  overflow: hidden;
}

/* ============================================================
   附加板块定义区
   想新增板块时，在下面注释块里每行写：[板块名] 生成要求
   例如：[评论区] 以粉丝视角写 5 条评论，每条 20 字
   现在为空 = 不生成任何附加板块。
   ============================================================ */
/* @heart-sections
*/`;

  window.NANO_HEART_BUILTIN_TEMPLATES = [
    {
      id: 'builtin_pink_dots',
      name: '粉色波点便签 · 内置',
      version: 2,
      css: PINK_DOTS_CSS
    }
  ];
})();
