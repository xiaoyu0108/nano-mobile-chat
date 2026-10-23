# 自己部署 Nano Worker（窥屏 + Web Push）

这份教程是给 **普通用户** 看的：不用改 Nano 源码，只要部署一个自己的 Cloudflare Worker，然后把它填进 Nano。
部署完成后：

- 窥屏 / 屏幕速聊走你自己的 Worker；
- Web Push 也走你自己的 Worker；
- 数据、KV、VAPID 都是你自己的；
- 模型 API 仍然用你自己在 Nano 里配置的那套。

> 如果你不想折腾，直接用作者的默认 Worker 也能玩。
> 默认地址是 `https://nanopush.nano315.online`，Nano 里不用改。
> 只有当你经常遇到「额度不足 / 反应慢 / 想和朋友隔离数据」时，再按这份教程换成自己的。

---

## 0. 先选一种方式

| 方式 | 你要做什么 | 模型费用 | Worker / KV 费用 | 适合 |
| --- | --- | --- | --- | --- |
| 用作者的默认 Worker | 什么都不用部署，Nano 里保持默认地址 | 你自己的 API | 作者承担 | 先试试、朋友少 |
| 自己部署 Worker | 按下面步骤做一次 | 你自己的 API | 你自己的 Cloudflare 免费额度 | 想隔离数据、常用、和朋友一起玩 |
| 作者开公用模式 | 作者设置 `PEEK_PUBLIC=1` | 每个用户自己的 API | 作者承担 | 朋友多、不想折腾 |

> 公用模式下，作者的模型 API **不会**被使用；每个人必须自己配置主 API。
> 作者承担的是 Cloudflare Worker / KV 的免费额度。

---

## 1. 准备

你需要：

1. 一个 **Cloudflare 账号**（免费注册，不用买域名）；
2. **Node.js 18 或更高版本**（安装时一路下一步即可）；
3. 能打开终端（Windows 用 PowerShell，Mac 用 Terminal）；
4. Nano 的仓库地址：
   `https://github.com/xiaoyu0108/nano-mobile-chat`

> 不需要买服务器，也不需要会写代码。下面命令可以逐行复制。

检查 Node.js 是否装好：

```bash
node -v
npm -v
```

能显示版本号（例如 `v20.x.x`）就可以继续。

---

## 2. 拿到代码

### 方式 A：用 git 克隆（推荐）

```bash
git clone https://github.com/xiaoyu0108/nano-mobile-chat.git
cd nano-mobile-chat/push-worker
```

### 方式 B：下载 ZIP

1. 打开 `https://github.com/xiaoyu0108/nano-mobile-chat`
2. 点绿色 **Code → Download ZIP**
3. 解压
4. 在终端进入解压后的 `push-worker` 目录

后面的命令都在 `push-worker` 目录里执行。

> 如果仓库是私有的，别人打不开：把 `push-worker` 文件夹打包发给对方，或者把仓库设为公开。

---

## 2.5 只用手机部署（没有电脑）

可以，但只能用 **Cloudflare 网页控制台**，不能跑 `wrangler`。
手机上不要直接粘贴 `src/index.js`：它带 `import` 依赖，控制台会报错。要用已经打包好的单文件版：

```text
https://raw.githubusercontent.com/xiaoyu0108/nano-mobile-chat/main/push-worker/dist/index.js
```

步骤：

1. 手机浏览器打开 `https://dash.cloudflare.com/`，登录。
2. **Workers & Pages → Create → Worker**，起名（例如 `nano-push-你的名字`），点 **Deploy**。
3. 进入 Worker → **Edit code / Quick Edit**，把默认代码全部删掉。
4. 打开上面的 `dist/index.js` 链接，全选复制，粘贴进代码编辑器 → **Save and Deploy**。
5. 建 KV：
   - **Storage & Databases → KV → Create namespace**，名字 `PUSH_KV`；
   - 回到 Worker → **Settings → Bindings → Add → KV Namespace**；
   - **Variable name 必须填 `PUSH_KV`**，选择刚建的命名空间。
6. **Settings → Variables and Secrets → Add**：
   - `PEEK_PUBLIC` = `1`（Text 或 Secret 都可以）
   - 可选：`PUSH_TOKEN` = 一个随机字符串；如果设了，Nano 里也要填同一个
7. 不需要 D1；如果代码报 `env.nano_db` 相关错误，忽略 / 删除 D1 绑定即可，代码会回退到 KV。
8. 打开 `https://你的worker.workers.dev/vapid`，返回 `key` 就成功。
9. 回到 Nano 填地址，步骤见下面第 8 节。

> 手机控制台的代码编辑器比较挤，124KB 的单文件粘贴可能会卡。如果实在粘贴不进去，用电脑，或者用手机浏览器开 GitHub Codespaces 在终端里跑 `wrangler`。

> `dist/index.js` 是从当前 `src/index.js` 打包出来的单文件，路由和作者 Worker 完全一致（`/peek`、`/peek/pending`、`/vapid`、`/subscribe`）。不要改路由名，也不要把 KV 绑定名从 `PUSH_KV` 改掉，否则 Nano 会连不上。

---

## 3. 安装 wrangler 并登录 Cloudflare

```bash
npm i -g wrangler
wrangler login
```

`wrangler login` 会打开浏览器，点 **Allow** 授权你的 Cloudflare 账号。

如果提示 `wrangler: command not found`：

- 确认 Node.js 已安装；
- 关掉终端重新打开；
- Mac 可以试 `sudo npm i -g wrangler`。

---

## 4. 建一个你自己的 KV 命名空间

```bash
wrangler kv namespace create PUSH_KV
```

输出里会有一行类似：

```text
id = "abcd1234efgh5678"
```

把这个 `id` 复制下来，下一步要填。

---

## 5. 改 `wrangler.toml`

用记事本 / VS Code 打开 `push-worker/wrangler.toml`。

### 你必须改的

1. `name` 改成你自己的名字，避免和作者重名：
   ```toml
   name = "nano-push-你的名字"
   ```
2. 把作者的 KV id 换成你刚才创建的：
   ```toml
   kv_namespaces = [
     { binding = "PUSH_KV", id = "你刚才的ID" }
   ]
   ```
3. **删掉作者的 `routes`**：
   ```toml
   # 删除这一段，或者改成你自己的域名
   routes = [
     { pattern = "nanopush.nano315.online", custom_domain = true },
     { pattern = "music.nano315.online", custom_domain = true }
   ]
   ```
   不删的话，部署会报域名不属于你。
4. **删掉作者的 D1**（如果你不打算自己建 D1）：
   ```toml
   # 删除这一段
   [[d1_databases]]
   binding = "nano_db"
   database_name = "nano-db"
   database_id = "8dba16fd-5976-4c57-a5cd-7313dc49c858"
   ```
   删掉后代码会自动使用 KV，不影响窥屏和 Web Push。

### 最小可用版本

如果你不想一点点改，直接把 `wrangler.toml` 整个换成：

```toml
name = "nano-push-你的名字"
main = "src/index.js"
compatibility_date = "2025-01-01"
workers_dev = true

kv_namespaces = [
  { binding = "PUSH_KV", id = "你刚才的ID" }
]
```

`PUSH_KV` 这个名字不要改，代码里写死了。

### 想带更多人：保留 D1

上面的最小配置用 KV，免费额度大约只能带 10~30 个活跃用户。
想带更多人，可以自己建一个 D1：

```bash
wrangler d1 create nano-db-你的名字
```

把返回的 `database_id` 填进 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "nano_db"
database_name = "nano-db-你的名字"
database_id = "你的database_id"
```

`binding` 必须保持 `nano_db`。Worker 第一次运行会自动建 `kv` 表，不需要手动执行 SQL。

### 可选

- `[triggers] crons = ["*/5 * * * *"]`：定时主动消息 / 提醒。不需要可以删掉，减少请求。
- `[vars] INCLUDE_LEGACY_MARKET`：共享集市旧数据开关，留着不影响。
- Supabase：不配置也能用，共享集市会回退到 KV。
- 如果你用 **Bark** 推送，在 `[vars]` 里加一行，让通知点开时回到你的 Nano：
  ```toml
  [vars]
  APP_URL = "https://你的-nano-地址/"
  ```
  Web Push 不需要这个，`sw.js` 会用相对路径打开。

---

## 6. 设置密钥

### 6.1 窥屏：二选一

**方案 A：公用模式（最省事，推荐个人自建也用这个）**

```bash
wrangler secret put PEEK_PUBLIC
# 输入：1
```

效果：

- 接受每个人浏览器生成的 `pk_...` 令牌；
- 数据按「站点 + 令牌哈希」隔离；
- 不需要把 Worker 的令牌和页面令牌手动对齐。

**方案 B：固定令牌（更私密）**

```bash
wrangler secret put PEEK_TOKEN
# 输入：窥屏页显示的 pk_... 令牌
```

效果：

- 只有这个令牌能调用 `/peek`；
- 你在 Nano 窥屏页看到的令牌必须和它完全一致；
- 换令牌时两边都要改。

> 个人自己用，方案 A 更省事；如果你要把 Worker 地址发给别人但又不想任何人用，选方案 B 并保管好令牌。

### 6.2 Web Push：可选

```bash
wrangler secret put PUSH_TOKEN
# 想保护 /send、/schedule 就设一个；不设则这两个接口不校验
```

如果设了 `PUSH_TOKEN`，后面在 Nano 的「服务端地址」下面也要填同一个值。

### 6.3 VAPID：可以不配

Worker 第一次访问 `/vapid` 会自动生成一对 VAPID 密钥并存进 KV。

想固定密钥再配：

```bash
wrangler secret put VAPID_SUBJECT   # 例如 mailto:you@example.com
wrangler secret put VAPID_PUBLIC
wrangler secret put VAPID_PRIVATE
```

### 6.4 模型 API：不用配

Nano 打开聊天或保存窥屏配置时，会把你的主 API（地址 / Key / 模型）同步到 Worker。
`/peek` 直接复用它，不需要在 Worker 里再填一遍。

---

## 7. 部署

```bash
wrangler deploy
```

成功后会输出一个地址，形如：

```text
https://nano-push-你的名字.xxxx.workers.dev
```

复制这个地址。

先在浏览器打开：

```text
https://你的地址/vapid
```

应该返回类似：

```json
{"ok":true,"key":"B..."}
```

能看到 `key` 就说明 Worker 正常。

---

## 8. 填进 Nano

### 8.1 窥屏 + Web Push 共用地址

打开：

**查手机 → 设置 → 窥屏 → 手机上玩 → 服务端地址**

1. 把你刚才的 Worker 地址填进去；
2. 如果你在第 6.2 步设了 `PUSH_TOKEN`，在下面的「Web Push 的 PUSH_TOKEN」填同一个值；没设就留空；
3. 点 **保存配置**。

保存会同时写入：

- `nano_peek_url`：窥屏用；
- `nano_push_endpoint`：Web Push 用；
- 换地址时会清掉旧的 VAPID 公钥，避免新 Worker 用旧公钥。

### 8.2 更新窥屏快捷指令

保存后，窥屏页会显示新的：

- 接口地址
- 令牌
- 角色 ID
- 站点 ID（appId）
- 截图 / 回话 JSON

把这些重新填进快捷指令。旧快捷指令里的地址还是作者的 Worker，不会自动改。

### 8.3 开启 Web Push

打开：

**设置 → 其他 → Web Push**

点 **开启 / 重新订阅**。

它会：

1. 自动请求你 Worker 的 `/vapid` 拿公钥；
2. 向浏览器申请通知权限；
3. 订阅并 POST 到 `/subscribe`。

成功后显示「已开启」。

> iOS 需要 **iOS 16.4+**，并且 Nano 必须「添加到主屏幕」。
> 如果你之前用的是作者的 Worker，换到自己的 Worker 后一定要点一次 **重新订阅**，旧订阅不会自动迁移。

---

## 9. 验证

1. **Worker 正常**：浏览器打开 `/vapid` 能看到 `key`。
2. **窥屏正常**：运行快捷指令，能收到角色回复；回到 Nano 私聊能看到这一轮。
3. **Web Push 正常**：设置 → 其他 → Web Push 显示「已开启」；可以让 Worker 发一条测试推送，或等下一次窥屏回复的推送。
4. **看日志**：Cloudflare Dashboard → Workers & Pages → 你的 Worker → Logs，能看到 `POST /peek`、`POST /subscribe`。

---

## 10. 常见问题

### `wrangler: command not found`

- 没装 Node.js，或装完没重开终端；
- 重新执行 `npm i -g wrangler`。

### `wrangler login` 打不开浏览器

复制终端里的链接，手动在浏览器打开，完成授权。

### 部署报 `routes` / 域名错误

你还在用作者的 `routes`。把 `wrangler.toml` 里的 `routes` 整段删掉，或用你自己的域名。

### 部署报 KV `namespace not found`

`kv_namespaces[0].id` 还是作者的，换成你自己 `wrangler kv namespace create PUSH_KV` 返回的 id。

### 窥屏提示 `unauthorized`

- 你用了方案 B（`PEEK_TOKEN`），但快捷指令里的令牌和 Worker 不一致；
- 重新复制窥屏页令牌，更新快捷指令；
- 或者改用方案 A（`PEEK_PUBLIC=1`）。

### Web Push 点了没反应

按顺序检查：

1. Nano 是否「添加到主屏幕」；
2. iOS 是否 16.4+；
3. 浏览器/系统通知权限是否允许；
4. 换过 Worker 后是否点了「重新订阅」；
5. 浏览器打开 `你的Worker/vapid` 是否有 `key`；
6. Cloudflare 日志里有没有 `POST /subscribe`。

### 窥屏有回复，但私聊没有

- 确认快捷指令里的 `chatId` 是当前角色 ID；
- 换角色后要重新复制一次窥屏页的 JSON；
- 打开该角色私聊，`chat-core.js` 会自动合并；
- 仍不同步就看 Cloudflare 日志里有没有 `POST /peek`。

### 截图太大，私聊里只有评论没有图

Worker 单张只保存约 4MB。快捷指令里加：

- 调整图像大小：宽度 900；
- 转换图像：JPEG 0.7；
- 再做 Base64。

---

## 11. 费用与能带多少人

Cloudflare 免费版大致是（以官网当前价格为准）：

| 项目 | 免费额度 |
| --- | --- |
| Workers 请求 | 100,000 次/天 |
| KV 读取 | 100,000 次/天 |
| KV 写入 | 1,000 次/天 |
| KV 存储 | 1 GB |

### 每轮窥屏大概消耗

- 1 次 `/peek` 请求；
- 1 次 KV 写（暂存这一轮）；
- App 拉取时 1 次 KV 读 + 1 次 KV 写（清空）；
- 人设 / API / 上下文同步一次约 9 个 key，聊天侧 6 小时内不重复；
- 截图只占存储，不额外增加写入次数。

### 估算

> 下面的数字是 **纯 KV 自建**（本教程的最小配置，删掉了 D1）的情况。

免费版的瓶颈是 **1,000 次写入/天**：

- 每轮约 2 次写入；
- 大约能撑 **300~500 轮对话/天**；
- 如果每个活跃用户每天聊 10~20 轮，大约 **10~30 个活跃用户**；
- 如果每人每天只发几条，能到 **50+**；
- 如果有人一直跑「重复 50」的快捷指令，几个人就可能把当天额度跑完。

Web Push 的订阅和定时任务也会读写 KV，所以不要按「刚好 1,000」算，留一半余量。

### 作者的默认 Worker 能带多少人

要看你部署时有没有保留 **D1**：

**情况 A：保留仓库默认的 D1 绑定（`wrangler.toml` 里的 `nano_db`）**

- 代码会把 KV 操作切到 D1，不按 KV 的 1,000 写/天算；
- D1 免费版大致是 **500 万行读/天、10 万行写/天、5 GB 存储**（以官网为准）；
- 每轮窥屏约 2 行写，理论上能到 **几万轮/天**；
- Workers 免费版 100,000 请求/天，大约也是 **几万轮/天**；
- 实际还会受 CPU、D1 延迟、其他功能（集市 / 自动消息 / TTS 代理）影响；
- **保守估计：100~300 个活跃用户**，重度循环会少一些。

**情况 B：删掉了 D1，纯 KV 自建（本教程默认）**

- 按上面的 KV 额度算：**10~30 个活跃用户**；
- 想带更多人，可以保留 D1 或升级 Workers Paid。

**Workers Paid（约 $5/月）**：额度大很多，可以带更多，具体看 Cloudflare 官网。

建议作者：

1. 先开 `PEEK_PUBLIC=1`，默认让大家用你的 Worker；
2. 在 Cloudflare 看 **D1 或 KV** 的用量（看你绑定的是哪个），接近 70%~80% 时提醒重度用户换自己的；
3. 给 `/peek` 加 Rate Limiting，防止有人刷；
4. 公开给很多人前，考虑 Workers Paid，或者直接发这份自建教程；
5. 如果自己用的是 D1 版本，自建教程里删掉 D1 的用户容量会小一些，这是正常的。

> 公用模式下，模型费用是每个用户自己的 API，不会花作者的钱。
> 作者承担的是 Worker / KV 额度。

---

## 12. 安全提醒

- 令牌相当于密码，不要发到公开群聊 / 截图 / 视频里；
- 如果泄露：
  ```js
  localStorage.removeItem('nano_peek_token'); location.reload();
  ```
  刷新窥屏页会生成新令牌，然后更新快捷指令；
- 私用模式（`PEEK_TOKEN`）还要同步改 Worker 的 `PEEK_TOKEN` 并重新部署；
- 公用模式（`PEEK_PUBLIC=1`）只需要更新自己的快捷指令；
- 截图会经 Worker 暂存，7 天过期，App 拉取后清空；每个聊天只保留最近 2 张；
- 不要把带 `token` 的 JSON 发到公开地方。
