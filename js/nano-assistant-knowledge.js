// nano-assistant-knowledge.js — 内置助手「娜娜」的应用知识库
// 只描述「通过覆盖/存储能改的东西」+ 关键 CSS 选择器与 JS 接口，供模型按需引用。
window.NANO_ASSISTANT_KB = {
  about: [
    'Nano 是一个纯前端 PWA（HTML/CSS/JS），没有服务器。',
    '娜娜只能「覆盖」样式与写入存储（美化 CSS、世界书、角色、设置等），不能修改部署后的源代码文件。',
    '用户点各页面的「恢复默认 / 恢复」即可回到源代码外观，因为覆盖只存在于浏览器存储里。',
    '无法做到的事：新增页面、改后端逻辑、改 fetch 地址等，需要开发者改源码并重新部署。'
  ],

  // 美化可改的范围（scope）：对应存储键与目标
  scopes: [
    {
      id: 'global', name: '全局美化',
      storage: 'localStorage: beautify_global_v2（同时写 beautify_global）',
      target: 'global',
      desc: '作用于 index / chat 列表 / discover / more / api 等非聊天内页的整体 UI，包括底部 tab、顶栏、卡片、列表。',
      selectors: ['.top-bar', '#tabbar / .tabbar', '.list-item', '.card', '.profile-card']
    },
    {
      id: 'chat', name: '聊天美化',
      storage: 'localStorage: beautify_chat_v2（同时写 beautify_chat）',
      target: 'chat',
      desc: '作用于单聊 chat_inner 与群聊 groups 内页：顶栏 .topbar、底栏 .bottom-bar、气泡 .bubble、引用 .quote-block、译文 .translation-bubble、头像 .message-avatar；也可以改聊天背景 .chat-container / .message-scroll / body（background / background-image）。',
      selectors: ['.nano-chat-inner .topbar', '.nano-chat-inner .bottom-bar', '.bubble', '.bubble.other', '.bubble.me', '.quote-block', '.translation-bubble', '.message-content', '.nano-chat-inner .chat-container', '.nano-chat-inner .message-scroll']
    },
    {
      id: 'chat-avatar', name: '聊天头像',
      storage: 'localStorage: beautify_chat_avatar',
      target: 'chat-avatar',
      desc: '单独控制聊天气泡旁头像 .message-avatar 的圆角/大小/边框。',
      selectors: ['.message-avatar', '.message-avatar img']
    },
    {
      id: 'heart', name: '心声美化',
      storage: 'localStorage: nano_voice_applied_css（同时写心声模板库 NanoVoiceDB/templates，预设名可直接用 name 覆盖更新）',
      target: 'heart',
      desc: '心声弹层，高度可 DIY。根容器 .nano-voice-modal；头像大小/圆角用变量 --iv-avatar-size / --iv-avatar-radius；默认头像居左（.iv-sender{flex-direction:row;align-items:center}）；想大头像居中：.iv-sender{flex-direction:column;align-items:center;text-align:center}；昵称换行：.iv-sender{flex-wrap:wrap} + .iv-sender-info{flex:1 1 100%}。移动元素用 position:absolute + transform，父级 .iv-header 已是 position:relative；不要用 position:fixed（会相对全屏乱飞），也别超出卡片（.nano-voice-modal 有 overflow 裁切）。装饰层 .iv-deco-top / .iv-deco-bottom（默认 display:none；用伪元素加内容前先设 display:block）和附加文字 .iv-extra-text。加行/换行用 ::after/::before + content（换行写 \\A 并配 white-space:pre）。加贴图可用 content:url("图片地址") 或 #ivDecoTop/#ivDecoBottom。底部「美化 / 取消」按钮在卡片外的 .iv-content-actions，勿用高 z-index 覆盖。',
      selectors: ['.nano-voice-modal', '.iv-sender', '.iv-sender-info', '.nano-voice-modal .iv-avatar', '.iv-name', '.iv-meta', '.iv-subject', '.iv-subject-text', '.iv-content', '.iv-content-label', '.iv-thought', '.iv-extra-text', '.iv-deco-top', '.iv-deco-bottom', '#ivDecoTop', '#ivDecoBottom', '.iv-unread']
    },
    {
      id: 'offline', name: '线下美化',
      storage: 'IndexedDB MeetSettingsDB / settings / main_settings.customCSS',
      target: 'offline',
      desc: '线下聊天页整体样式（顶栏、底栏、气泡、推荐回复等）。写入后需重新打开线下聊天生效。',
      selectors: ['.offline-app', '.chat-header', '.chat-input', '.msg', '.bubble']
    }
  ],

  // 关键页面与脚本，问到时可按需 fetch 读取真实源码
  pages: [
    { file: 'index.html', name: '外壳/首页', note: 'iframe 容器、底部 tab、悬浮球、通知、键盘处理' },
    { file: 'chat.html', name: '聊天列表', note: '聊天/群聊列表、未读红点' },
    { file: 'chat_inner.html', name: '单聊内页', note: '聊天 UI 结构、心声弹层、美化面板' },
    { file: 'css/chat-inner.css', name: '单聊样式', note: '气泡/顶栏/底栏/译文/心声基础样式' },
    { file: 'js/chat-core.js', name: '单聊逻辑', note: '消息渲染、记忆、翻译、生图、自动消息' },
    { file: 'groups.html', name: '群聊内页' },
    { file: 'js/groups.js', name: '群聊逻辑' },
    { file: 'offline.html', name: '线下模式' },
    { file: 'js/offline.js', name: '线下逻辑', note: '线下设置/记忆/小剧场' },
    { file: 'inner-setting.html', name: '聊天设置' },
    { file: 'js/inner-setting.js', name: '聊天设置逻辑' },
    { file: 'js/worldbook.js', name: '世界书', note: '数据结构与导入导出' },
    { file: 'js/beautify.js', name: '美化编辑器' },
    { file: 'js/appearance.js', name: '外观注入', note: '读取 beautify_* 存储并注入样式' },
    { file: 'js/nano-global-template.js', name: '全局美化模板与钩子说明' },
    { file: 'js/nano-chat-template.js', name: '聊天美化模板与钩子说明' },
    { file: 'discover.html', name: '发现页' },
    { file: 'js/discover.js', name: '发现页逻辑（照片墙持久化）' },
    { file: 'backup.html', name: '备份' },
    { file: 'js/backup.js', name: '备份逻辑' }
  ],

  // 数据存储位置（写入时要遵守）
  storage: {
    beautifyGlobal: 'localStorage.beautify_global_v2',
    beautifyChat: 'localStorage.beautify_chat_v2',
    beautifyChatAvatar: 'localStorage.beautify_chat_avatar',
    heartCss: 'localStorage.nano_voice_applied_css',
    heartBuiltinPrompt: 'localStorage.nano_heart_builtin_prompt',
    heartSections: '心声「附加板块」（评论区/穿搭等）：定义写在心声模板 CSS 里的注释块 /* @heart-sections 每行 [板块名] 生成要求 */，由它解析后缓存到 localStorage.nano_heart_sections（数组 [{name,prompt}]）。每轮 AI 按此在 [heart:…] 之后输出 [section:名]...[/section]，心声卡片里多渲染一块，可用 .iv-section/.iv-section-title/.iv-section-body 美化。要新增板块就改模板的 @heart-sections 块。',
    translationMode: 'localStorage.nano_trans_separate（1=独立气泡 0=同一气泡）',
    offlineSettings: 'IndexedDB MeetSettingsDB/settings，主记录 id=main_settings，字段 customCSS',
    worldbook: 'IndexedDB nano_worldbook_db/worldbook_data，值结构 {key:"data", value:{groups:[], files:[]}}；files[].entries[] 为条目',
    emoji: 'IndexedDB nano_api_db/emoji_data，key=nano_emoji_data，值 {emojiGroups:[{id,name,emojis:[{id,name,url}]}], balance, favorites}；同时 localStorage.nano_emoji_data',
    characters: 'IndexedDB nano_characters_db/characters',
    mask: 'localStorage.nano_mask_data + IndexedDB nano_mask_db',
    apiConfig: 'IndexedDB nano_api_db/api_data/nano_api_config',
    beautifyPresets: 'IndexedDB BeautifyAppDB/presets（每条 {category,name,code}；category = global|chat|chat-avatar|offline|font）',
    heartTemplates: 'IndexedDB NanoVoiceDB/templates（每条 {id,name,css}）',
    offlinePresets: 'IndexedDB MeetSettingsDB：文风 stylePresets（id=style_presets，presets:[{name,content}]）、思维链 cotPresets（id=cot_presets）、美化 cssPresets（id=css_presets）、规则 rules（id=main_rules，groups:[{name,rules:[{name,content,enabled}]}]）',
    offlineMenuPlugins: 'localStorage.offline_menu_plugins（数组，每条 {name,js}；js 用 new Function("api", js) 在线下头像菜单执行）'
  },

  // 世界书条目字段
  worldbookEntryFields: ['id', 'enabled', 'title', 'keywords', 'keywordEnabled', 'vectorEnabled', 'permanent', 'position', 'scanDepth', 'priority', 'probability', 'content', 'collapsed'],

  // 助手可以下发的动作（写进 <action>...</action> 代码块）
  commands: [
    { tool: 'apply_beautify', args: { scope: 'global|chat|chat-avatar|heart|offline', name: '预设名', css: '完整 CSS', append: '（可选）true = 在现有 CSS 后追加细节，不覆盖原内容' }, note: '覆盖对应美化并存成可切换预设；若同名预设已存在则直接更新它（用户说「改我的某个预设」时，name 填那个预设的名字即可）。用户说「在现有基础上加细节」时 append:true' },
    { tool: 'add_worldbook', args: { name: '世界书名', worldbook: '（可选）要填入的已有世界书名或 id，填了就追加条目而不是新建', group: '（可选）分组名', entries: [{ title: '条目名', keywords: '触发词', content: '内容' }] }, note: '新增一本世界书，或把条目追加进已有世界书（worldbook 填书名）；用户发来文件/长文本要求「分条做世界书 / 填入世界书」时用这个，条目多时分批输出多个 action' },
    { tool: 'add_emoji', args: { group: '分组名', emojis: [{ name: '表情名', url: '图片地址' }] }, note: '把「名字:图片链接」清单加入表情包（用户说加表情包时用这个，不要用 add_worldbook）' },
    { tool: 'set_chat_background', args: { color: '#ffffff', image: '图片URL（可选）' }, note: '直接更换当前聊天背景（颜色或图片）；用户说“换背景”优先用这个' },
    { tool: 'set_avatar', args: { useLast: true }, note: '把当前角色头像换成用户刚发送的图片（用户在纳米聊天里发图后说「用这张当头像」时用这个，不要用 apply_beautify）；也可用 url 指定图片地址' },
    { tool: 'read_file', args: { path: 'js/chat-core.js' }, note: '只读，用于准确回答/给出修改步骤' },
    { tool: 'create_file', args: { name: '文件名（如 theme.css）', content: '完整文件内容', ext: 'txt|md|css|html|js|json' }, note: '把生成的文件保存到 Nano 文件库，并生成聊天文件卡片。文件独立于聊天消息，删除消息也不会丢。用户说导出/生成/保存文件时用这个' },
    { tool: 'open_page', args: { url: 'beautify.html' }, note: '帮用户打开对应页面' },
  { tool: 'clear_beautify', args: { scope: 'chat|groups|heart|offline|global' }, note: '清空对应范围的美化，恢复默认样式（用户说「清空线上/群聊/心声/线下/全局美化」时用这个）' },
  { tool: 'create_character', args: { name: '角色名', setting: '完整人设文本', gender: '（可选）性别', nationality: '（可选）国籍', bindUser: '（可选）绑定到哪个 user 面具，默认当前面具', avatar: '（可选）头像URL', append: '（可选）true = 在已有角色人设后追加细节' }, note: '新建一个角色并写入完整人设；同名/同 id 已存在时更新该角色。会写入角色库并自动归档文件，用户说「写一个新角色 / 写角色人设」时用这个，不要只 create_file。用户说「给现有角色加细节」时 append:true' },
  { tool: 'edit_persona', args: { name: '角色名或id', setting: '新的人设文本', append: '（可选）true = 只追加补充细节，不覆盖旧人设' }, note: '修改某个角色的完整人设（会自动先存一个历史版本，可回退）；角色不存在时会自动新建。用户说「新增细节」时 append:true' },
  { tool: 'create_mask', args: { name: '面具名', setting: '完整 user 人设文本', gender: '（可选）性别', wechat: '（可选）微信号', current: false }, note: '新建或更新一个 user 面具（localStorage nano_mask_data + IndexedDB）；current=true 时切换为当前面具。用户说「给 user 写面具 / 写我的马甲」时用这个' },
  { tool: 'edit_mask', args: { name: '面具名或id', setting: '新的完整 user 人设文本', gender: '（可选）性别', wechat: '（可选）微信号', current: false }, note: '修改已有 user 面具；与 create_mask 相同，同名直接更新' },
  { tool: 'bind_character', args: { name: '角色名或id', mask: '面具名或id（留空则绑定当前面具）' }, note: '把一个角色绑定到指定 user 面具（写入角色的 bindUser），绑定后该面具下才能看到这个角色' },
  { tool: 'save_persona_version', args: { name: '角色名或id' }, note: '为某角色人设手动存一个历史版本' },
  { tool: 'list_persona_versions', args: { name: '角色名或id' }, note: '列出某角色保存过的人设历史版本（含版本号，用于回退）' },
  { tool: 'restore_persona_version', args: { name: '角色名或id', index: 1 }, note: '把某角色人设回退到第 index 个历史版本（index 从 1 开始，1=最新保存的版本）' },
  { tool: 'save_preset', args: { scope: 'global|chat|chat-avatar|offline|heart|offline-style|offline-cot|offline-css', name: '预设名', content: '预设内容', append: '（可选）true = 在已有预设后追加细节' }, note: '保存/覆盖一个预设。全局、聊天、聊天头像、线下美化存到 BeautifyAppDB（不会自动应用，只进预设列表）；heart 存心声模板；offline-style/offline-cot/offline-css 存线下「文风/思维链/美化」预设；menu-plugin 用 add_menu_plugin。用户说「在现有预设上加细节」时 append:true' },
  { tool: 'delete_preset', args: { scope: '同上', name: '预设名' }, note: '删除某个已保存的预设' },
  { tool: 'add_offline_rule', args: { group: '规则组名（可新建）', name: '规则名', content: '规则内容' }, note: '给线下「规则」新增一条规则；group 填已有组名（如“行为规则”）或新组名。用户说“给规则加一条/加个规则”时用这个' },
  { tool: 'add_menu_plugin', args: { name: '插件名', js: '插件 JS 代码' }, note: '给线下输入框头像菜单添加一个 JS 插件按钮。js 里用 api.addItem({label,icon,run}) 注册按钮，可用 api.toast/getMessages/scrollToFloor/reroll 等。用户说“给线下加个插件/加个按钮功能”时用这个' },
  { tool: 'list_presets', args: { scope: 'global|chat|chat-avatar|offline|heart|offline-style|offline-cot|offline-css|offline-rules|menu-plugin' }, note: '只读：列出该范围已保存的预设名与摘要（系统会把结果读给你，然后你继续回答）' },
  { tool: 'read_preset', args: { scope: '同上', name: '预设名' }, note: '只读：读取某个预设的完整内容（系统会把内容读给你）' },
  { tool: 'list_characters', args: {}, note: '只读：列出全部角色（id / 昵称 / 性别 / 国籍 / 人设字数 / 世界书绑定数量）' },
  { tool: 'read_character', args: { name: '角色名或id' }, note: '只读：读取角色完整信息（含完整人设），修改人设前先用这个' },
  { tool: 'list_worldbooks', args: {}, note: '只读：列出全部世界书、条目数、分组和绑定角色' },
  { tool: 'read_worldbook', args: { name: '世界书名或id' }, note: '只读：读取一本世界书的完整条目' },
  { tool: 'read_beautify', args: { scope: 'global|chat|chat-avatar|offline|heart' }, note: '只读：读取该范围当前生效的 CSS，并列出已保存的预设名' },
  { tool: 'list_status_bars', args: {}, note: '只读：读取线下自定义状态栏列表' },
  { tool: 'add_offline_status', args: { name: '状态栏名（≤12字）', html: '状态栏 HTML（可用 {{content}}）', css: '只作用于这条状态栏的 CSS', prompt: '每轮生成要求', pos: 'top|before|after|bottom', collapsed: false, enabled: true }, note: '新增或覆盖一条线下自定义状态栏；同名直接覆盖' },
  { tool: 'list_offline_rules', args: {}, note: '只读：列出现有线下规则组和规则摘要' },
  { tool: 'read_offline_rules', args: {}, note: '只读：读取全部线下规则的完整内容' },
  { tool: 'list_apps', args: {}, note: '只读：列出 AppStore 已安装应用' },
  { tool: 'read_app', args: { id: '应用id或名称' }, note: '只读：读取应用完整信息与 HTML' },
  { tool: 'create_app', args: { id: '应用id（可选）', name: '应用名', icon: '图标（emoji或图片URL）', color: '#4a6cf7', desc: '描述', html: '完整应用 HTML' }, note: '直接创建并安装一个 AppStore 应用。HTML 会被注入 app-host 运行，可用 Nano.* 能力' },
  { tool: 'list_files', args: {}, note: '只读：列出 Nano 文件库里的所有文件' },
  { tool: 'read_generated_file', args: { name: '文件名或id' }, note: '只读：读取文件库中某个文件的完整内容' },
  { tool: 'read_memory', args: { name: '角色名或id' }, note: '只读：读取某个角色的长期记忆（nano_vector_memory_db）' }
  ]
};
