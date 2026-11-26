# 纳米 Nano

一个本地优先的 AI 角色陪伴 / 聊天应用。前端是纯静态 Web App（PWA），可以直接部署到 GitHub Pages、Netlify 或任意静态服务器；同一套页面也可以打包进 Android WebView APK。

项目不内置任何模型或 API Key，所有对话请求都使用你在应用「API」页面里填写的地址、Key 和模型。

## 功能

- **私聊 / 群聊**：多角色、群成员、角色关系网、语音气泡、图片 / 文件 / 卡片消息。
- **线下模式**：独立的长篇文字冒险界面，支持规则、文风、思维链、字数、人称、用户行动预测、状态栏。
- **长期记忆**：自动 / 手动总结，记忆卡片与聊天记录分开保存，清空聊天不会删除记忆。
- **世界书**：全局 / 单人 / 线上 / 线下绑定，关键词触发 + 预算内补读，聊天、群聊、线下共用同一套设定。
- **Books**：一起看书、段落标记分享、悬浮球聊天，不打断阅读和生成。
- **生活化 App**：朋友圈、Ins、音乐、日程、钱包、外卖、旅途、小剧场、家庭卡等页面。
- **美化与共享集市**：聊天 / 线上 / 线下 / 心声美化，预设导入导出，共享集市发布与下载。
- **云备份 / 主动消息**：可选的 Cloudflare Worker 备份与推送服务。

## 快速开始

### 直接运行

```bash
# 在项目根目录启动任意静态服务器
python -m http.server 8080
# 然后打开 http://localhost:8080
```

PWA（安装到桌面 / Service Worker）需要 HTTPS 或 localhost。

### 部署到静态托管

- GitHub Pages：仓库已包含 `.nojekyll`。
- Netlify：仓库已包含 `_headers`。
- 其他平台：把仓库根目录作为站点根目录即可。

### 配置 API

打开应用后进入「API」页面，填写：

- 主 API 地址（OpenAI 兼容 `/v1` 或 Anthropic）
- API Key
- 模型名

这些配置只保存在当前设备的浏览器存储里。

## Android APK

需要：

- JDK 17
- Android SDK Platform 35 + Build Tools
- 签名文件（放在 `apk/signing/`，不要提交到公开仓库）

```powershell
powershell -ExecutionPolicy Bypass -File android/build.ps1 `
  -VersionCode 19 -VersionName 2.3.2 `
  -KsPass "你的 keystore 密码" -KeyPass "你的 key 密码"
```

构建产物：`apk/nano.apk`。

Android 端使用 WebView 承载同一套网页资源，并处理状态栏 / 刘海 / 手势条安全区、文件选择、通知、后台保活等原生能力。

## 可选服务

### 主动消息 / 共享集市后端

```bash
cd push-worker
npm install
npx wrangler deploy
```

### 云备份后端

`backup-worker/index.js` 是可直接部署的 Cloudflare Worker；应用内「云备份」页面会读取该文件并给出部署说明。

## 目录结构

```text
index.html              应用外壳（iframe 容器、导航、安全区）
html/                   各个页面
js/                     页面逻辑、API、记忆、世界书、美化、Android 桥
css/                    页面样式
android/                Android WebView 工程与构建脚本
apk/                    构建好的 APK 与签名材料（签名材料已被 .gitignore 排除）
push-worker/            主动消息 / 共享集市 Worker
backup-worker/          云备份 Worker
docs/                   部署与第三方许可说明
```

## 数据与隐私

- 聊天记录、记忆、世界书、角色卡、美化配置默认保存在浏览器 IndexedDB / localStorage。
- API Key 不会上传到项目自带的服务；只有你自己配置的 API、推送 Worker、备份 Worker 会收到请求。
- 共享集市、主动消息、云备份都是可选功能，不配置就不会联网。
- 请勿把 `apk/signing/`、API Key、Cloudflare Token 等敏感信息提交到公开仓库。

## 第三方资源

- 图标：Lucide（许可见 `docs/lucide-license.txt`）
- 字体：见 `fonts/LICENSE.txt`
- 其他依赖的许可证请以对应文件为准。

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请：

1. 不要提交任何密钥、签名文件或包含个人隐私的数据。
2. 修改带版本号的静态资源时，同步更新 HTML 里的 `?v=`。
3. 尽量在 Android WebView 和手机浏览器各验证一次安全区、键盘和返回手势。

## License

本仓库目前没有根目录 `LICENSE` 文件。开源发布前请补充你选择的许可证（例如 MIT 或 Apache-2.0），并确认第三方资源的许可证兼容。
