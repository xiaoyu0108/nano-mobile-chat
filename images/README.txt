把你的照片 / 图片都放在这个目录（images/），页面里用「相对路径」引用即可。

例：
  images/avatar.jpg         头像
  images/bg.jpg             聊天背景 / 全局背景（appBg）
  images/phone/1.jpg        查手机用的照片，可以再建子目录分类

怎么引用（所有页面都在根目录，所以相对路径到处都能用）：
  <img src="images/avatar.jpg">
  background-image: url("images/bg.jpg");
  全局背景（localStorage 里的 appBg）写：url("images/bg.jpg")

注意事项：
1. 大小写必须和真实文件名完全一致（部署到 Linux 服务器区分大小写，写错就是 404）。
2. 不要用 C:/... 这种本地绝对路径；也不要用以 / 开头的路径（网站放子目录部署会 404）。
3. 文件名不要带空格和中文，需要时用 - 或 _。中文名会变成 %E4%B8%AD... 这种转义，容易出错。
4. 单张建议 ≤ 300KB、长边 1600px 左右，手机加载更快（sw.js 不做静态缓存，每次都会重新请求）。
5. 如果要喂给 AI 做头像/图片处理，图片必须放在这里（同源）；跨域图片会让 canvas 取不到像素。
