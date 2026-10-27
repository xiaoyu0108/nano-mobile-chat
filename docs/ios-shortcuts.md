# iOS「窥屏 + 互动」完整配置流程

让角色（TA）看到你手机屏幕上的内容，并用人设点评、写进聊天；可选在灵动岛 / 锁屏实时显示。

> 结论先行：iOS 上第三方 **没有通用悬浮窗、也不能后台连续读屏**。
> 现实可行的做法是「**你按一下 → TA 看一眼 → TA 说话**」，触发用「快捷指令 + 轻点背面」，
> 显示用「通知」，要常驻小窗则必须配一个原生 App（灵动岛 / Live Activity）。
>
> **2026-10 更新**：窥屏页已精简为「电脑共享 / 手机屏幕速聊」两种方式，换角色会自动生成新的角色 ID 和请求体 JSON。
> 下面的 Part 1 / Part 2（深链、直连 API）是旧版参考，页面里不再提供入口；手机端请直接用 Part 2.5。
>
> **Worker 存储以 D1 为准**：新部署请绑定 `nano_db`，不要再建 `PUSH_KV`（本文后面出现的 KV 章节仅用于旧版排错）。
> 仍在使用 `nano-test-ceshi` / `peek-test.nano315.online` 的，请直接删除旧 Worker 和 KV，否则会继续收到 Bark 推送和 KV 额度邮件。

本仓库已内置 Web 侧支持：

| 文件 | 作用 |
| --- | --- |
| `js/screen-share.js` | 新增 `ScreenShare.commentText(info, text)`：让角色点评一段屏幕文本 |
| `js/keep-alive.js` | 新增 `NanoKeepAlive.setNowPlaying()`：用保活音频把点评显示到锁屏 / 灵动岛 |
| `js/ios-bridge.js` | 解析深链参数，把快捷指令送来的文本交给角色 / 写进聊天 |
| `ios-setting.html` | 图形化生成接口地址、令牌与请求体 JSON（在 查手机 → 设置 → **窥屏** 打开） |
| `docs/ios-shortcuts.md` | 本文档 |

---

## 前置条件

1. **HTTPS 部署**：Nano 必须跑在 `https://` 上（PWA、剪贴板、通知都需要）。
2. **装到主屏**：Safari 打开 → 分享 → 添加到主屏幕，之后以独立 App 形态运行。
3. **配置主 API**：在 API 页填好 接口地址 / Key / 模型。识图或长文本模型效果更好。
4. **生成参数**：打开 `ios-setting.html`（手机 → 设置 → 窥屏），
   它会根据你选的角色和 API 配置，生成下面要用到的 **深链** 和 **请求体 JSON**。

---

## Part 1 — 方式 A：截图发 /peek（推荐，能真正识图）

快捷指令只负责「截图 → 压缩 → Base64 → POST 到 Worker」，模型看到的是**整张图片**，不是 OCR 文字。
以 `ios-setting.html`（手机 → 设置 → 窥屏）页面上的步骤为准，下面是同一套流程。

> 旧版 Part 1 用的是「从图像中提取文本 + 打开深链」。它只能让模型读文字，
> 而且 iOS 会打开 Safari 而不是主屏 PWA，所以现在不推荐；已配置旧版的请按下面改成图片。

### 快捷指令步骤

1. 打开「快捷指令」App → 右上角 **+** 新建，命名「窥屏」。
2. 添加 **截屏**。
3. 添加 **调整图像大小**：宽度 `900`，高度留空（自动）。
4. 添加 **转换图像**：格式 `JPEG`，质量 `0.7`。
5. 添加 **Base64 编码**，把「换行」设为 **无**。
6. 添加 **获取 URL 内容**：
   - 地址：`https://你的 worker 域名/peek`
   - 方法：`POST`
   - 头部：`X-Peek-Token` = 窥屏页里的令牌
   - 请求体：选 **JSON**，添加字段：
     - `chatId` = 角色 ID
     - `appId` = 窥屏页的站点 ID
     - `image` = 先输入 `data:image/jpeg;base64,`，后面紧跟蓝色的 Base64 变量（中间不要有空格或换行）
7. 添加 **获取字典值**：从「URL 的内容」取 `reply`。
8. 添加 **显示提醒** / **显示通知**，内容只放 `reply`。

**不要**再用「文本」动作手拼 JSON：图片 Base64 很长，手拼很容易多出换行/引号，Worker 会直接解析失败。

### 运行效果

运行后：TA 会弹出对**画面内容**的点评（能说出图里有什么）；回到 Nano 打开对应角色私聊，这一轮的截图和回复会自动补进来。
如果只能回复“看不到图片”，检查主 API 模型是否支持图片输入，以及 `image` 字段是否以 `data:image/jpeg;base64,` 开头。

### 触发方式（更顺手）

- **轻点背面**：设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → 选「窥屏」。
- **个人自动化**：快捷指令 → 自动化 → 新建（打开某 App / 特定时间 / 专注模式）→ 运行快捷指令。
  iOS 15.4+ 可关闭「运行前询问」。
- **共享表单**：在快捷指令设置里开启「在共享表单中显示」，可从其它 App 分享文本/图片给它。

### 深链参数说明

深链只用于兼容旧版；新版请直接 POST `/peek`。

| 参数 | 含义 |
| --- | --- |
| `nanoScreen` | 旧版：屏幕识别文本；Nano 会调用主 API 让角色点评 |
| `nanoScreenReply` | 旧版：直接把这段文字作为角色消息写进聊天 |
| `nanoChat` | 角色 ID（省略则用最近一次会话） |
| `nanoName` | 角色名（可选） |

---

## Part 2 — 方式 B：快捷指令直连 API（可弹通知）

快捷指令自己 POST 到你的接口拿回复，再回传 Nano；也可以先弹通知。适合想在快捷指令里直接看到回复的场景。

### 1. 把文本发给模型

添加动作 **获取 URL 内容**：

- 网址：`https://你的接口/v1/chat/completions`
- 方法：`POST`
- 头部：
  - `Authorization` = `Bearer <你的 Key>`
  - `Content-Type` = `application/json`
- 请求体：选 **文件** → 引用一个 **文本** 动作，内容用 `ios-setting.html` 生成的 JSON，把 `{{屏幕文本}}` 换成 OCR 变量。示例：

  ```json
  {
    "model": "你的模型",
    "messages": [
      { "role": "system", "content": "你是「小柒」。用你的人设随口点评。" },
      { "role": "user", "content": "这是用户手机屏幕上的一段内容，用你的人设随口点评 2~3 句：\n{{屏幕文本}}" }
    ],
    "max_tokens": 800,
    "temperature": 0.9
  }
  ```

### 2. 取出回复

添加 **获取字典值**：`choices` → 第 1 项 → `message` → `content`。

### 3. 显示

- 想要通知：添加 **显示通知**，内容放上一步的回复。
- 想写进聊天：添加 **打开 URL**，用「方式 B 回传深链」，把 `{{模型回复}}` 换成回复变量：

  ```
  https://你的域名/index.html?nanoScreenReply={{模型回复}}&nanoChat=<角色ID>&nanoName=<角色名>
  ```

> 安全性：方式 B 会把 API Key 明文存在快捷指令里，并可能被 iCloud 同步。更安全的做法是方式 A，或让 Key 只留在服务端（见下方「服务端代理」）。

### 服务端代理（可选，Key 不落在手机）

如果不想把 Key 放进快捷指令，可在你的服务器 / Cloudflare Worker（本仓库有 `push-worker/`）加一个 `/screen` 接口：
接收 `{ text }`，用服务端保存的 Key 调模型，返回纯文本。快捷指令 POST 到 `https://你的域名/screen` 即可，Key 不出服务器。

---

## Part 2.5 — 屏幕速聊（快捷指令 + 服务端，任意 App 内连续对话）

这是「窥屏」体验最好的一种：**不用打开 Nano**，在任意 App 里双击「辅助触控」跑快捷指令，
截屏发到你的服务端，角色回复直接弹在系统窗口里，你还能在那个窗口继续打字，来回连续对话；
等你回到 Nano，这几轮会**按顺序自动合并**进该角色唯一的聊天。

它的关键是：**模型 Key 只存在服务端**，快捷指令里不放 Key；对话轮次先暂存在服务端，App 回到前台再拉取合并。

### 架构

```
辅助触控双击 → 快捷指令(截屏) → POST 你的服务端 /peek
        → 服务端用保存的 Key 调主模型 → 返回角色回复
        → 快捷指令用「显示提醒」弹出，可继续「要求输入」循环
        → 轮次暂存在服务端 → Nano 回到前台 GET /peek/pending 合并 → POST /peek/ack
```

### 服务端（本仓库 `push-worker/`）

已内置这些路由（Cloudflare Worker）：

| 路由 | 作用 |
| --- | --- |
| `POST /peek` | 令牌校验 → 收 `{chatId, appId?, token?, text?, image?}`（`system` 可省略）→ 用当前角色人设 + 最近上下文 + 服务端保存的主 API 调模型 → 返回 `{ok, reply, text, name}`（`reply` 带角色名前缀，`text` 是干净回复），并把这一轮暂存；若已配置 VAPID 且 App 已订阅，会顺带用 Web Push 推一条通知 |
| `GET /peek/pending?chatId=&token=` | App 拉取暂存轮次 `{ok, turns:[{user, char, ts}]}` |
| `POST /peek/ack` | App 合并完后清空暂存 |

> **点通知打开的是「添加到主屏幕」的 Nano，不是 Safari。** iOS 里只有 Web Push 通知能唤起已安装的主屏 PWA（`sw.js` 的 `notificationclick` 会聚焦/冷启动 App）。所以想在手机上「啪一下就在主屏 Nano 里看到」，就让 `/peek` 顺手发一条推送：Worker 会自动生成 / 读取 `VAPID_*`，在 Nano 的 **设置 → 其他 → Web Push** 点一次「开启」即可，之后点通知就进 App。

### 部署 `push-worker`（自建，约 10 分钟）

> 给普通用户看的完整版（更啰嗦、带排错）在 **[self-deploy-worker.md](self-deploy-worker.md)**；下面是精简版。

#### 0. 准备

- 一个 **Cloudflare 账号**（免费版够玩）；
- **Node.js 18+**；
- 本仓库（至少要有 `push-worker` 目录）。

> **每个人自己部署时，必须改掉 `wrangler.toml` 里作者的东西**：
> - 删除或替换 `routes` 里的自定义域名（`nanopush.nano315.online` 不是你的）；
> - 把 `[[d1_databases]]` 的 `database_id` 换成你自己的 D1，`binding` 保持 `nano_db`；
> - 不需要 Supabase / 定时任务就删掉对应块；不要删除 D1，也不要再绑定 `PUSH_KV`。

#### 1. 安装 wrangler 并登录

```bash
npm i -g wrangler
wrangler login
```

第一次会打开浏览器，授权你的 Cloudflare 账号。

#### 2. 进入 worker 目录并装依赖

```bash
cd push-worker
npm install
```

#### 3. 新建你自己的 D1（不要再用 KV）

```bash
wrangler d1 create nano-db-你的名字
```

把返回的 `database_id` 填进 `wrangler.toml`。新部署不需要创建 `PUSH_KV`；旧 KV 绑定会让 Cloudflare 继续按 KV 1,000 写/天计费，并触发额度邮件。

最小可用的 `wrangler.toml` 长这样（直接复制，改成你的名字和 D1 ID）：

```toml
name = "nano-push-yourname"
main = "src/index.js"
compatibility_date = "2025-01-01"
workers_dev = true

[[d1_databases]]
binding = "nano_db"
database_name = "nano-db-你的名字"
database_id = "你的database_id"
```

说明：

- `nano_db` 这个 binding 名不要改，代码里写死了；
- Worker 第一次运行会自动在 D1 里建表，不需要手动执行 SQL；
- 不需要自定义域名就先不写 `routes`；
- 想用自己的域名，再加 `routes`，并在 Cloudflare 里绑定域名。

#### 4. 设置 secrets

私用（只给自己玩）：

```bash
wrangler secret put PEEK_TOKEN
# 填窥屏页显示的 pk_... 令牌
```

公用（给其他人玩）：

```bash
wrangler secret put PEEK_PUBLIC
# 填 1
```

可选：

```bash
wrangler secret put PUSH_TOKEN
# 想保护 /send、/schedule 就设一个；不设则这些接口不校验
```

VAPID **可以不配**：Worker 第一次访问 `/vapid` 时会自动生成一对密钥并存进 D1（`kv` 表）。想固定密钥再配：

```bash
wrangler secret put VAPID_SUBJECT   # 例如 mailto:you@example.com
wrangler secret put VAPID_PUBLIC
wrangler secret put VAPID_PRIVATE
```

**模型 API 不需要单独配**：Nano 打开聊天 / 保存窥屏配置时会把主 API 同步到 Worker，`/peek` 直接复用。

#### 5. 部署

```bash
wrangler deploy
```

记下输出里的地址，形如：

```text
https://nano-push-yourname.xxxx.workers.dev
```

#### 6. 引入 Nano（一个地址，两套功能）

打开 **查手机 → 设置 → 窥屏 → 手机上玩 → 服务端地址**：

1. 填你的 Worker 地址；
2. 如果你在第 4 步设了 `PUSH_TOKEN`，在下面的「Web Push 的 PUSH_TOKEN」填同一个值；没设就留空；
3. 点 **保存配置**。

保存会同时写入：

- `nano_peek_url`：给窥屏用；
- `nano_push_endpoint`：给 Web Push 用；
- 换地址时会清掉旧的 `nano_push_vapid`，避免新 Worker 用旧公钥。

然后：

- **窥屏**：页面会重新生成「接口地址 / 令牌 / 请求体 JSON」，按上面的快捷指令搭建；
- **Web Push**：去 **设置 → 其他 → Web Push**，点 **开启 / 重新订阅**。它会自动请求新 Worker 的 `/vapid` 拿公钥，再 `/subscribe` 订阅；
- **iOS**：必须把 Nano「添加到主屏幕」；Web Push 需要 iOS 16.4+；
- 从旧 Worker 切到新 Worker 后，一定要点一次 **重新订阅**，旧订阅不会自动迁移。

#### Web Push 和窥屏是同一个 Worker 吗？

是同一个 Worker，但走不同路由、不同密钥：

| 功能 | 路由 | 认证 | 主要数据 |
| --- | --- | --- | --- |
| 窥屏 / 屏幕速聊 | `/peek`、`/peek/persona`、`/peek/pending`、`/peek/ack` | `PEEK_TOKEN`，或公用模式下的每用户令牌 | 人设、API、轮次、截图 |
| Web Push | `/vapid`、`/subscribe`、`/send`、`/schedule` | `/vapid`、`/subscribe` 公开；`/send`、`/schedule` 用 `PUSH_TOKEN` | 订阅、定时任务 |

两者共用同一个 D1 数据库（绑定名 `nano_db`）：

- 窥屏每轮大约 1 次写 + 1 次读；
- Web Push 的订阅和定时任务也会读写 D1；
- **每个人自己部署 = 各自 D1 / 各自 VAPID / 各自免费额度**；
- **公用一个 Worker = 用你的 D1 额度**，但模型 API 仍然是每个人自己的。

| 方式 | 模型费用 | D1 / Worker 费用 | 适合 |
| --- | --- | --- | --- |
| 公用一个 Worker（`PEEK_PUBLIC=1`） | 每个用户自己的 API | 站长承担 | 朋友多、不想折腾 |
| 每个人自己部署 | 自己的 API | 自己的 Cloudflare 免费额度 | 想隔离数据 / 不想帮别人付 D1 |
| 只给自己用（不设 `PEEK_PUBLIC`） | 自己 | 自己 | 最省心 |

`PEEK_TOKEN` 未设置时窥屏接口放行（仅建议本地调试）；生产务必设置，或者用 `PEEK_PUBLIC=1` 做公用模式。

### 公用部署（PEEK_PUBLIC）与 D1 费用

先澄清：这里没有「公钥」。公用指的是 **一个 Worker 接受多个人的令牌**，每个人的数据按令牌哈希隔离。部署分两步：设置 `PEEK_PUBLIC`，再重新部署。

#### 方式 A：命令行（推荐）

```bash
cd push-worker
wrangler secret put PEEK_PUBLIC
# 提示输入值时填：1
wrangler deploy
```

#### 方式 B：Cloudflare 控制台

1. 打开 **Cloudflare Dashboard → Workers & Pages → 你的 Worker**。
2. 进入 **Settings → Variables and Secrets**。
3. 点 **Add**：
   - Type：**Secret**（或 Text）
   - Name：`PEEK_PUBLIC`
   - Value：`1`
4. 保存后点 **Deploy**。

#### 公用模式的行为

- 接受任意长度 ≥ 8 的令牌（`pk_...` 即可），不再要求等于 `PEEK_TOKEN`；
- 把令牌哈希进 D1 分区（`appId + 令牌哈希`），每个人的暂存轮次、人设、API、owner 都互相隔离；
- 每个人仍然用自己 Nano 里配置的主 API，**不会花你的模型额度**；
- `/peek/pending` 也按令牌分区，别人拿不到你的消息；
- 公用模式只作用于 `/peek*`，不会把 `/auto*` 后台主动消息一起公开。

#### 会花 D1 吗？会，但花的是 Cloudflare 额度，不是模型额度

Cloudflare 免费版大致是（以官网当前价格为准）：

| 项目 | 免费额度 |
| --- | --- |
| Workers 请求 | 100,000 次/天 |
| D1 读取 | 500 万行/天 |
| D1 写入 | 100,000 行/天 |
| D1 存储 | 5 GB |

> 仓库默认的 `wrangler.toml` 绑定的是 `nano_db`，业务代码走 D1，不再按 KV 的 1,000 写/天算。
> 只有旧版 Worker 或你手动绑定了 `PUSH_KV` 才会走 KV；新部署请不要再建 `PUSH_KV`。
> KV 免费额度是 100,000 读/天、1,000 写/天、1 GB 存储，聊天 + 窥屏 + Web Push 很容易打满，所以已经不推荐。

每轮窥屏大概消耗：

- 1 次 `/peek` 请求（Worker 请求 +1）
- 1 行 D1 写入（暂存这一轮）
- App 拉取时 1 行 D1 读 + 1 行 D1 写（清空）
- 人设 / API / 上下文同步一次约写 9 行；聊天侧 6 小时内不会重复，窥屏页每次点「保存配置」会写一次
- 截图只增加存储，不增加写入次数；每个聊天只保留最近 2 张，7 天过期

D1 免费版 **10 万行写入/天** 大约能撑几万轮窥屏，保守可带 100~300 个活跃用户；重度循环会少一些。
如果误绑了旧版 KV，则只有 1,000 写/天，只够 10~30 个活跃用户。

超了怎么办：

- **Workers Paid**：约 $5/月，包含更多请求和 D1 读写（具体看 Cloudflare 官网）；
- **每个人自己部署一个免费 Worker**：最省钱，教程就在上面「部署 push-worker（自建）」；
- **平时关掉 `PEEK_PUBLIC`**，需要给别人玩时再打开；
- 在 Cloudflare 给 `/peek` 加 **Rate Limiting**，限制每个 IP / 路径的频率；
- 缩短快捷指令的「重复」次数，减少无意义的轮次。

> 注意：公用模式只能防「不同令牌之间串数据」，防不了「令牌被主动泄露」。令牌相当于密码，不要发到公开群聊里。
> 公用模式消耗的是你的 Cloudflare Worker / D1 额度（不是模型额度）；上面的免费额度和限流建议就是给这种情况准备的。

### Nano 侧

在 **查手机 → 设置 → 窥屏 → 手机上玩 → 服务端地址** 里：填「服务端地址」、点「保存配置」。
保存时会把**当前选中的角色人设、最近聊天上下文、主 API**一起同步到 Worker，快捷指令里不用再贴人设或 Key。
之后 `js/ios-bridge.js` 会在 App 启动和回到前台时自动拉取；打开对应角色私聊时，`js/chat-core.js` 会再把本机暂存的轮次按时间顺序合并进去。两者都是幂等的，不会重复。

### 快捷指令搭建（照着这个顺序做）

> 下面按你习惯的「第一阶段：截屏发图 / 第二阶段：循环速聊」写。
> 不同 iOS 版本的动作名可能略有差异：`获取 URL 内容` = Get Contents of URL，`获取字典值` = Get Dictionary Value。
> 快捷指令名字随便取，比如「窥屏速聊」。

#### 准备：先从窥屏页拿 4 个值

打开 **查手机 → 设置 → 窥屏 → 手机上玩**：

- **角色 ID**：页面「角色 ID」那一行，例如 `c1234567890`；
- **接口地址**：例如 `https://nanopush.nano315.online/peek`；
- **令牌**：`pk_...`；
- **站点 ID（appId）**：页面「站点 ID」那一行，例如 `app_1abc2def`。

换角色后只有 `chatId` 会变；`appId`、令牌、接口地址不变。每次换角色重新复制一次页面上的 `chatId`，别用旧 ID。

#### 第一阶段：截屏发图（开局偷袭）

1. 打开快捷指令，新建，命名「窥屏速聊」。
2. 搜索添加 **截屏**。
3. 搜索添加 **调整图像大小**：宽度填 `900`，高度留空（自动）。
   - iPhone 原图很大，不压缩的话 Base64 经常超过 4MB，Worker 不会保存这张图，私聊里就只看到评论、没有截图。
4. 搜索添加 **转换图像**：格式选 **JPEG**，质量 `0.7`。
   - 如果你跳过这一步，第 6 步的 `image` 前缀要改成 `data:image/png;base64,`，因为「截屏」默认是 PNG。
5. 搜索添加 **Base64 编码**，点开箭头，把「换行」设为 **无**。
6. 搜索添加 **获取 URL 内容**：
   - 地址：`接口地址`
   - 点开 `>`，方法选 **POST**
   - 头部：添加 `X-Peek-Token`，值填 `令牌`
   - 请求体选 **JSON**，添加字段：
     - 键 `chatId`，值填 `角色 ID`
     - 键 `appId`，值填 `站点 ID`
     - 键 `image`，值填 `data:image/jpeg;base64,`，后面紧跟蓝色的 **Base64 已编码** 变量（中间不要有空格或换行）
   - `appId` 不是必须的，但加上后即使 App 还没同步过 owner，Worker 也能把轮次存到正确分区。
7. 搜索添加 **获取字典值**：从「URL 的内容」里获取键 `reply` 的值。
8. 搜索添加 **显示提醒**：
   - 内容只放上一步的 `reply` 变量。
   - **不要再写「TA说：」再拼 `reply`**：新版 `reply` 已经自动带「角色名」前缀，否则会变成「TA说：「角色名」……」。
9. 运行一次测试：应该弹出「角色名 + 点评」。回到 Nano 打开这个角色的私聊，截图和评论会自动补进来。

#### 第二阶段：循环速聊（无限对线）

10. 搜索添加 **重复**：次数设置为 `10`（或你想要的次数）。
11. 把下面第 12~19 步全部拖进「重复」里面。
12. 添加 **要求输入**：提示词写「回复：」，打开「允许多行」。
13. 添加 **如果**：条件设置为 `请求输入` **是** `退出`。
14. 在「如果」下面添加 **停止执行此快捷指令**（打「退出」就结束）。
15. 点「如果」里面的 **添加否则**（Add Else）。
16. 在「否则」下面添加 **获取 URL 内容**（用来发文字）：
    - 地址：`接口地址`
    - 方法：**POST**
    - 头部：`X-Peek-Token` = `令牌`
    - 请求体选 **JSON**，添加字段：
      - 键 `chatId`，值填 `角色 ID`
      - 键 `appId`，值填 `站点 ID`
      - 键 `text`，值插入前面的 **请求输入** 变量
    - **不需要再加一个「文本」动作手拼 JSON**。用 JSON 字段时，Shortcuts 会自动处理引号和换行；手拼 `{"text":"..."}` 遇到换行或英文引号容易把 JSON 弄坏。
17. 添加 **获取字典值**：从「URL 的内容」里获取键 `reply` 的值。
18. 添加 **显示提醒**：内容只放 `reply`。
19. **结束如果** 和 **结束重复** 都是系统自带的：确保「结束如果」在「否则」后面、和「如果」左对齐，位置在「重复」里面；「结束重复」在所有动作最下面。

#### 你原来的流程需要改的地方

- `image` 前缀：你写的是 `data:image/jpeg;base64,`，但「截屏」默认是 PNG。要么加「转换图像 → JPEG」（推荐），要么把前缀改成 `data:image/png;base64,`。
- 建议加「调整图像大小 900 + 转换 JPEG」：否则 Base64 太大，Worker 不会存图，私聊里只有评论没有截图。
- JSON 里建议加 `appId`：不加也能用，但依赖 owner 同步；换角色、换设备或刚部署时容易不同步。
- 第二阶段的「文本」动作可以删掉：直接用「获取 URL 内容 → 请求体 JSON → 字段 text」更稳。
- 「显示提醒」不要再写「TA说：」+ `reply`：新版 `reply` 已经带「角色名」。
- 如果你把令牌贴到过公开聊天、截图或视频里，建议换一个令牌（见下面「令牌泄露怎么办」）。

> **你现在这套已经能跑**，不改也能继续收到回复。上面这些是「更稳、弹窗更干净、截图也能进私聊」的升级项。
> 最少要记住一条：**换角色时更新 `chatId`**。
- 每次换角色，`chatId` 要换成当前角色的；`appId`、令牌、接口地址不变。旧快捷指令不会自动改。

#### 令牌泄露怎么办

如果令牌被发到公开群 / 截图里：

1. 在窥屏页的浏览器控制台执行：
   ```js
   localStorage.removeItem('nano_peek_token'); location.reload();
   ```
   刷新后会生成新令牌。
2. 把新令牌填回快捷指令的头部和 JSON。
3. 如果你用的是私用模式（设置了 `PEEK_TOKEN`），还要把 Worker 的 `PEEK_TOKEN` 也改成新令牌并重新部署：
   ```bash
   wrangler secret put PEEK_TOKEN
   wrangler deploy
   ```
4. 公用模式（`PEEK_PUBLIC=1`）不需要改 Worker，只需更新自己的快捷指令；旧令牌最多还能读到旧暂存轮次，等 7 天 TTL 过期。

> **弹窗里显示角色名**：重新部署 Worker 后，`/peek` 返回的 `reply` 会自动带上「角色名」前缀，所以快捷指令的 **显示提醒** 会直接显示角色名，不用改快捷指令。
> 回传聊天时用的是干净的 `text` / 暂存轮次，不会把名字重复写进角色气泡。
> 点通知打开的 Nano 快速回复弹窗也会显示角色名：优先用通知携带的名字，其次读最近聊天和角色库。
> Web Push / 屏幕共享通知的标题也会使用角色名，不再只显示「窥屏」或「TA」。

> **为什么私聊里看不到消息？** 旧版只把 `nano_peek_chat` 当成拉取目标，而且在窥屏页换角色时不会更新它；快捷指令发的又是另一个 `chatId`，两边对不上，轮次就一直躺在服务端。现在：
> - 窥屏页换角色会立刻记住角色 ID，并维护 `nano_peek_chats` 列表；
> - App 回到前台会按列表逐个拉取，**先落到本机**再清空服务端；
> - 打开对应角色私聊时，`chat-core.js` 会把暂存的「你 + 角色」轮次按时间顺序合并进去；
> - 当前私聊开着时，也会收到 `NANO_PEEK_UPDATED` 立即合并。
>
> 如果仍不同步：确认快捷指令 JSON 里的 `chatId` 与窥屏页显示的「角色 ID」完全一致；确认 `appId` / `token` 是同一套（直接重新复制页面上的 JSON 最稳）；然后打开一次该角色私聊。

### 弹窗出现但没回复 / Worker 日志里没有 API 调用

按顺序检查：

1. **先打开一次 Nano 聊天**：Worker 需要先拿到主 API。新版会在聊天启动/切角色时自动同步；
   也可以在「窥屏 → 手机上玩 → 服务端地址」点一次「保存配置」。
2. **看快捷指令的「显示提醒」内容**：新版 `/peek` 在失败时也会把原因写进 `reply`，
   例如「服务端还没有模型 API」。如果还是空白，说明快捷指令没取到 `reply` 字段。
3. **确认请求真的到了 Worker**：Cloudflare → Worker → Logs，看有没有 `POST /peek`。
   没有请求 = 快捷指令地址/网络不对；有请求但没上游调用 = Worker 还没拿到 API 配置。
4. **不想用快捷指令**：在电脑 Chrome / Edge 上用 App 内的「看屏幕」共享真实屏幕；
   iPhone 网页端没有录屏接口，只能用「屏幕速聊」快捷指令截屏。

### 触发

设置 → 辅助功能 → 触控 → 辅助触控 → 轻点两下 → 选这个快捷指令。首次运行允许「截屏 / 访问网络 / 显示提醒」。

> 隐私：截图经你的服务端转发给模型；Worker 会暂存这一轮的文本和截图（每个聊天只保留最近 2 张），7 天过期，App 拉取并 ack 后清空。

---

## Part 2.6 — 现实桥：让 TA 看你正在用的真实 App

可以，而且不用改服务端：**真实 App 的画面只能靠「截屏 / OCR」，不能靠网页去查手机 App 列表**。
最稳的玩法是「App 打开时自动截图」，而不是让 TA 自己点开 App。

### 玩法 A：打开某个 App 时，TA 自动看一眼（推荐）

在「快捷指令 → 自动化」里建一条个人自动化：

1. 新建自动化 → **App** → 选择你想让 TA 看的 App（微信、小红书、B 站……）→ **已打开**。
2. 勾选 **立即运行**（iOS 15.4+ 可关闭「运行前询问」）。
3. 添加动作：
   - **等待** 1~2 秒（等 App 界面加载出来）；
   - **截屏**；
   - **Base64 编码**（关闭换行）；
   - **获取 URL 内容**：POST 到 `https://你的worker/peek`，请求体用窥屏页生成的截图 JSON（把 Base64 变量插进去）。
4. 保存。以后你每次打开这个 App，TA 都会自动看到当前画面，并在回到 Nano 后把点评合并进私聊。

> 一次自动化只能绑定一个 App。想覆盖多个 App，就复制几条自动化，或在同一条里用「如果」判断当前 App。
>
> 如果 POST 到 `/peek` 的 JSON 里带上 `image`（Base64 截图），回到 Nano 后截图会作为私聊里的图片消息出现，后面跟 TA 的评论。

### 玩法 B：TA 想看哪个 App，你一键带她看

TA 不能在网页里直接执行「打开 App」。现实做法是：

1. 做一个「现实桥」快捷指令，第一个动作是 **从菜单中选取**，菜单项写「微信 / 小红书 / 设置 / …」。
2. 每个分支：**打开 App**（或 **打开 URL** 填 App 的 URL Scheme）→ **等待** 2 秒 → **截屏** → **Base64** → POST `/peek`。
3. 把这个快捷指令放到「轻点背面」或「辅助触控」。
4. TA 在聊天里说「我想看你微信」，你双击背面 → 菜单选微信 → 她会收到截图并点评。

> 为什么不能全自动？iOS 的快捷指令不能在后台读另一个 App 的屏幕，也不能根据 Nano 里的一条消息自动去点开 App。
> 要做到「TA 说完 → 手机自己打开 App → 截图」需要原生 App + App Intent 常驻桥；纯网页 + 快捷指令做不到。
> 但「App 打开时自动截图」已经把「你正常用手机」变成 TA 的实时素材，体验最接近现实桥。

### 和 Nano 自带「查手机」的区别

- **查手机**：看的是 Nano 里模拟的手机界面（角色手机、聊天记录、相册等），数据在 Nano 内部。
- **现实桥**：看的是你 iPhone 上真实 App 的截屏，走快捷指令 + `/peek`，只在你授权运行时发生。

---

**纯快捷指令开不了灵动岛。** 灵动岛 / 锁屏实时活动是 iOS 的 **Live Activity**，只能由原生 App 用 **ActivityKit** 创建和更新。因此需要一个小 App（可以把你现有的 Web 前端用 `WKWebView` 套壳，逻辑复用）。

### 3.0 捷径：用保活音频把 TA 的点评放进灵动岛（无需原生 App）

你提到的「假装播放一段无声音频来保活」——**可行**，而且本仓库已经在用（`js/keep-alive.js`）：
它让一段完全静音的音频循环播放，并设置 `navigator.mediaSession.metadata`，于是 iOS 会把这个页面当成一个**真实的媒体播放器**，
在 **锁屏 / 控制中心 / 灵动岛** 的「正在播放」位置显示 标题 / 艺术家 / 封面 + 播放控制。

所以：**把「点评」写进 MediaSession 元数据，就能在灵动岛（媒体播放位）看到**：

- 标题 = 角色名，艺术家 = 最新一句点评，封面 = 角色头像。
- 新版已加 `NanoKeepAlive.setNowPlaying({ title, artist, artwork })`，
  `screen-share.js` / `ios-bridge.js` 在点评到达时已自动调用它。
- 想要更主动地控制，在页面里调用即可：

  ```js
  NanoKeepAlive.setNowPlaying({ title: '小柒', artist: '你在看什么呢…', artwork: 'icons/icon-512.png' });
  // 恢复默认（回到「Nano 保活中」）
  NanoKeepAlive.clearNowPlaying();
  ```

**它和真·Live Activity 的区别（重要）：**

| | 保活音频（MediaSession） | 原生 Live Activity |
| --- | --- | --- |
| 出现在灵动岛 | 会（媒体播放位，像音乐 App 的迷你窗） | 会（自定义布局） |
| 能显示什么 | 仅 标题 / 艺术家 / 封面 一行文本 + 播放控制 | 任意布局、多行、按钮、气泡 |
| 交互 | 只有 播放 / 暂停 | 可放自定义 `Button(intent:)` |
| 前提 | 必须有（静音）音频在播放，通常要「保活」已开启、或用户先触摸过页面 | 需要原生 App |
| 生命周期 | 音频被系统掐断就消失 | 约 8 小时活跃 + 数小时锁屏 |

> 结论：**不想写原生 App，就用保活音频 + `setNowPlaying`，TA 的点评能在灵动岛/锁屏出现**；
> 想要自定义界面（气泡、按钮、多行），才需要下面的原生 ActivityKit。

原生方案完整链路：

```
轻点背面 → 快捷指令(截图+OCR+POST) → 得到回复
        → 调 App Intent（后台执行）→ App 更新 Live Activity
        → 灵动岛显示「角色 + 一句点评」→ 点开 App 继续聊
```

### 3.1 环境

- Xcode 15+，iOS 16.1+（灵动岛需要 iPhone 14 Pro 及以上；其它机型显示在锁屏）。
- 准备 Bundle ID，例如 `com.you.nano`。

### 3.2 新建工程与扩展

1. Xcode → File → New → Project → **App**（SwiftUI，命名 `Nano`）。
2. 再新建一个 **Widget Extension**（命名 `NanoWidget`），勾选 **Include Live Activity**。
3. 在 App target 的 **Signing & Capabilities** 里确认已启用 **Push Notifications**（用推送更新时需要）。
4. 两个 target 的 `Info.plist` 都加入：
   ```xml
   <key>NSSupportsLiveActivities</key><true/>
   ```
   如需高频更新（推送频繁）再加：
   ```xml
   <key>NSSupportsLiveActivitiesFrequentUpdates</key><true/>
   ```

### 3.3 共享属性（App 与 Widget 共用）

`NanoActivityAttributes.swift`（两个 target 都要加入成员资格）：

```swift
import ActivityKit

struct NanoActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var name: String        // 角色名
        var saying: String      // 最新一句点评
        var avatar: String?     // 头像 URL（可空）
    }
    var title: String = "Nano"
}
```

### 3.4 灵动岛 / 锁屏视图（Widget 扩展）

`NanoWidgetBundle.swift`：

```swift
import WidgetKit
import SwiftUI
import AppIntents

@main
struct NanoWidgetBundle: WidgetBundle {
    var body: some Widget { NanoLiveActivity() }
}

struct NanoLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NanoActivityAttributes.self) { context in
            // 锁屏 / 通知中心
            VStack(alignment: .leading, spacing: 6) {
                Text(context.state.name).font(.headline)
                Text(context.state.saying).font(.body)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.6))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 4) {
                        Text(context.state.name).font(.caption).bold()
                        Text(context.state.saying).font(.footnote).lineLimit(2)
                    }
                }
            } compactLeading: {
                Text("◆").foregroundStyle(.pink)
            } compactTrailing: {
                Text(context.state.name.prefix(4)).font(.caption2)
            } minimal: {
                Text("◆").foregroundStyle(.pink)
            }
            .keylineTint(.pink)
        }
    }
}
```

> iOS 17+ 可在 Live Activity 视图里加 `Button(intent: SomeAppIntent())` 做「换一句 / 停下」等交互按钮；
> 但 **没有文本输入框**，要打字就点灵动岛 → 深链打开 App。

### 3.5 App 侧：开始 / 更新活动

`LiveActivityManager.swift`：

```swift
import ActivityKit

@available(iOS 16.1, *)
enum LiveActivityManager {
    static func start(name: String, saying: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attrs = NanoActivityAttributes()
        let state = NanoActivityAttributes.ContentState(name: name, saying: saying)
        _ = try? Activity.request(
            attributes: attrs,
            content: .init(state: state, staleDate: nil),
            pushType: .token      // 需要服务端推送更新时用 .token
        )
    }

    static func update(name: String, saying: String) async {
        let state = NanoActivityAttributes.ContentState(name: name, saying: saying)
        for activity in Activity<NanoActivityAttributes>.activities {
            await activity.update(.init(state: state, staleDate: nil))
        }
    }

    static func end() async {
        for activity in Activity<NanoActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
```

### 3.6 让快捷指令驱动它：App Intent

`ShowNanoCommentIntent.swift`（加进 App target 即可，快捷指令会自动发现）：

```swift
import AppIntents

struct ShowNanoCommentIntent: AppIntent {
    static var title: LocalizedStringResource = "显示 Nano 点评"
    static var openAppWhenRun: Bool = false   // 关键：后台执行，不把你从当前 App 拽走

    @Parameter(title: "角色名") var name: String
    @Parameter(title: "点评内容") var saying: String

    func perform() async throws -> some IntentResult {
        if #available(iOS 16.1, *) {
            if Activity<NanoActivityAttributes>.activities.isEmpty {
                LiveActivityManager.start(name: name, saying: saying)
            } else {
                await LiveActivityManager.update(name: name, saying: saying)
            }
        }
        return .result()
    }
}
```

在快捷指令里，方式 B 拿到回复后，加一个 **「显示 Nano 点评」** 动作（能搜到上面的 App Intent），
把角色名和回复变量填进去即可，**无需把 App 拉到前台**。

### 3.7 服务端推送更新（可选，最省电）

用 APNs 直接更新灵动岛，不必每次唤起 App：

1. App 用 `pushType: .token` 启动活动，并监听 `activity.pushTokenUpdates`，把 token 上报到你的服务器
   （可复用本仓库 `push-worker/`）。
2. 服务器向 APNs 发送请求：
   - `apns-topic`: `<BundleID>.push-type.liveactivity`
   - `apns-push-type`: `liveactivity`
   - `apns-priority`: `5`（或 `10`）
   - payload 示例（更新）：
     ```json
     {
       "aps": {
         "timestamp": 1700000000,
         "event": "update",
         "content-state": { "name": "小柒", "saying": "你在看什么呢…" }
       }
     }
     ```
   - 首次创建用 `"event": "start"`，结束用 `"event": "end"`。

> APNs 的 JWT / HTTP2 细节与 Apple 官方一致，具体以 Apple 文档为准。

### 3.8 复用现有前端

把 Nano 前端放进去（例如 `WKWebView` 加载你的站点或打包的资源），原生层只需：
- 提供一个 JS Bridge，把 `startNanoLiveActivity(name, saying)` 暴露给网页；
- 或用原生收发 API，再更新 Live Activity。
这样人设、世界书、记忆、聊天记录都继续用现有实现。

---

## Part 4 — 限制与隐私

- **不是悬浮窗**：iOS 没有通用悬浮窗。最接近的是「画中画（PiP）」，但 PiP 里只有播放/暂停控件，不能自由交互聊天，只能单向显示。
- **不能实时窥屏**：快捷指令靠你手动触发（或自动化事件），做不到后台连续读屏。
- **灵动岛有生命周期上限**：Live Activity 活跃时长有限、结束后锁屏还会保留一段时间即被系统回收，**不是永久常驻**，以官方文档为准。
- **机型限制**：灵动岛仅 iPhone 14 Pro 及以上；其余机型只显示在锁屏。
- **存储隔离**：iOS 上「主屏安装的 PWA」和「Safari 标签页」的本地存储可能相互隔离。若深链在 Safari 打开而不是 PWA，可能读不到聊天数据——此时用方式 B 的「显示通知」最稳，或确保深链真的进入了已安装的 PWA。
- **隐私**：截屏可能包含聊天记录、验证码等敏感内容，请自行判断是否发送给第三方模型；方式 B 会明文保存 Key，注意安全。
- **审核**：这类「常驻窥屏 + 悬浮」用途在 App Store 审核偏灰，自用建议侧载分发。

---

## 快速自检

- [ ] 站点是 HTTPS，已添加到主屏
- [ ] 主 API（含识图/长文本模型）配置可用
- [ ] `ios-setting.html` 能读到角色与接口信息
- [ ] 方式 A：轻点背面 → TA 点评并写进聊天
- [ ] 方式 B：快捷指令能拿到 `content` 并弹通知
- [ ] （可选）灵动岛：原生 App 已启用 Live Activities，App Intent 能被快捷指令搜到
