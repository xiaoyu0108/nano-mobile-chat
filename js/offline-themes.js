/* ============================================================================
 * 线下内置美化主题（唯一数据源）
 * 设置页（offline-setting）与聊天页（offline）都从这里读取，保证一致。
 * 想加内置主题：在 list 里追加一项 { key, name, css } 即可。
 * ==========================================================================*/
(function () {
    var soft = `:root{--page:#f7f4f5;--card:#fffdfd;--header:#fbf6f7;--line:#f1e7e9;--line-strong:#ead9dc;--ink:#40393b;--muted:#b5a8aa;--pink:#f3cdd4;--pink-deep:#e6b3bb;--gray-pink:#f1e6e8}.message{background:var(--card);border-color:var(--line-strong);box-shadow:0 5px 20px rgba(105,82,100,.06)}.topbar{background:rgba(251,246,247,.92)}`;

    var minimal = `:root{--page:#f0f1f3;--card:#fff;--header:#f6f7f8;--line:#e6e7ea;--line-strong:#d9dbe0;--ink:#2c2e32;--muted:#96989d;--pink:#e2e3e7;--pink-deep:#c9cbd2;--gray-pink:#eceef0}.message{background:var(--card);border-color:var(--line-strong);box-shadow:0 3px 14px rgba(30,35,40,.04)}.topbar{background:rgba(246,247,248,.95)}`;

    var textbook = `/* 语文书 · 简约（内置）— 重构版式：去掉 Diary 头，改为书页文章；暖白底色；重点色 黑/深蓝/红褐；无 emoji */
:root{
  --page:#ffffff;--card:#ffffff;--header:#ffffff;--line:#e6e6e2;--line-strong:#d8d8d2;
  --ink:#2b2621;--muted:#9a8f7d;--pink:#d8cdb6;--pink-deep:#1f3a5f;--gray-pink:#f0e9da;
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
.topbar{background:rgba(255,255,255,.94);border-bottom:1px solid var(--line-strong);backdrop-filter:blur(10px)}
.top-title{color:#1f3a5f;font-family:"Songti SC","STSong","SimSun",serif;font-weight:600;letter-spacing:3px}
.top-btn{color:#8a8175}
/* 场景 Tab：下划线式 */
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
.heart-state{order:3;margin:2px 26px 10px;padding:10px 12px;background:#f4eddd;border-left:3px solid #7a3b2e;border-radius:0 4px 4px 0;color:#6f675a;font-size:12.5px;line-height:1.55}
.thinking{order:4;margin:2px 26px 10px;padding:10px 12px;background:#f4eddd;border-left:3px solid #1f3a5f;border-radius:0 4px 4px 0;color:#6f675a;font-size:12.5px;line-height:1.6}
.time-row{order:5;height:24px;justify-content:flex-end;color:#b3a992;padding:0 26px 6px}
.time-row .clock-icon{opacity:.7}
.plot-area{order:6;background:transparent;border-top:1px dashed var(--line-strong);border-radius:0;padding:6px 22px 12px}
.plot-toggle{color:#9a8f7d}
.plot-opt{background:#fdfbf4;border:1px solid var(--line-strong);border-radius:4px;color:#2b2621;font-weight:500}
.plot-opt:active{background:#f0e9da;color:#1f3a5f}
.actions{order:7;border-top:1px solid var(--line)}
.action{color:#4a463f;font-weight:600;letter-spacing:1px}
.action:hover{color:#1f3a5f}
.edit-bar{order:8;background:#fdfbf4}
.more-menu{background:rgba(255,253,247,.99);border:1px solid var(--line-strong);box-shadow:0 10px 26px rgba(40,34,26,.12)}
.more-menu button{color:#2b2621}
.more-menu button:active{background:#f0e9da}
.bottom{background:rgba(255,255,255,.94);border-top:1px solid var(--line-strong)}
.composer{grid-template-columns:43px 1fr 43px}
.round-btn{background:#fffdf7;border:1px solid var(--line-strong);color:#8a8175;border-radius:6px}
.send{background:#1f3a5f;border-color:#1f3a5f;color:#fff}
.input{border:1px solid var(--line-strong);border-radius:6px;background:#fffdf7;color:#2b2621}
.input:focus{border-color:#1f3a5f;box-shadow:0 0 0 2px rgba(31,58,95,.12)}
.input::placeholder{color:#b3a992}
.toast{background:#1f3a5f}
.modal{background:rgba(255,253,247,.99)}
.modal-title{color:#1f3a5f;font-family:"Songti SC","STSong","SimSun",serif}
.exit-btn{background:#f0e9da}
.exit-btn.primary{background:#1f3a5f;color:#fff;box-shadow:0 8px 18px rgba(31,58,95,.25)}
.exit-mem-toggle input{accent-color:#1f3a5f}
.select-bar{background:#1f3a5f}
.typing-card .typing-dots span{background:#1f3a5f}
/* 小剧场 / 开场白 选择弹层 */
.tp-mask{background:rgba(30,24,16,.34)}
.tp-sheet{background:var(--card);border:1px solid var(--line-strong);border-radius:6px;box-shadow:0 16px 40px rgba(40,34,26,.2)}
.tp-head{color:#1f3a5f;font-family:"Songti SC","STSong","SimSun",serif;font-weight:600;letter-spacing:2px}
.tp-sub{color:#9a8f7d}
.op-row{background:#fdfbf4;border:1px solid var(--line-strong);border-radius:4px;color:#2b2621}
.op-row.active{border-color:#1f3a5f;background:#f0e9da}
.op-idx{color:#7a3b2e}
.op-text{color:#6f675a}
.op-new-text{background:#fffdf7;border:1px solid var(--line-strong);border-radius:4px;color:#2b2621}
.tp-new{background:#1f3a5f;color:#fff;border-radius:4px}
.tp-cancel,.tp-mini{background:#f0e9da;color:#4a463f;border-radius:4px}
.tp-row{background:#fdfbf4;border:1px solid var(--line-strong);border-radius:4px}
.tp-row.active{border-color:#1f3a5f;background:#f0e9da}
.tp-open{color:#2b2621;font-weight:600}
.tp-row.active .tp-open{color:#1f3a5f}
.tp-danger{color:#7a3b2e}
.tp-list{background:transparent}
.tp-empty,.no-result{color:#b3a992}
/* 美化等底部弹层 */
.om-card{background:var(--card);border:1px solid var(--line-strong);border-radius:8px}
.om-card-head{color:#1f3a5f;font-family:"Songti SC","STSong","SimSun",serif}`;

    window.NANOOfflineThemes = {
        css: { soft: soft, minimal: minimal, textbook: textbook },
        list: [
            { key: 'soft', name: 'Soft Pink', css: soft },
            { key: 'minimal', name: 'Minimal Gray', css: minimal },
            { key: 'textbook', name: '语文书 · 简约', css: textbook }
        ]
    };
})();
