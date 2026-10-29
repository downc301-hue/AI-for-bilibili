# CHANGELOG

## v0.9.4 — 2026-10-29

### 品牌设置面板（新增）
- Web UI 左上角品牌名称/Logo 完全可定制，无需改代码
- 首次访问自动弹出引导弹窗，老用户可从概览页 chip / 设置 tab / 顶栏小编辑图标随时进入
- 内置 15 个主流 AI 品牌真实 Logo（`logo/` 目录），支持上传自定义图片
- 全部前端 localStorage 存储，零后端依赖
- 品牌图标从 `public/mascot/` 立绘改为 `logo/` 真实品牌 Logo
- 后端新增 `/logo/*` 路由 + `LOGO_ALIAS` 映射表，前端只用英文路径，磁盘可存中文文件名

### 前端视觉统一
- 所有 card 标题前的 iconfont 图标全部清除，视觉对齐
- 按钮/tab/快捷操作等功能性图标保留
- iconfont CDN 换为阿里新地址 `//at.alicdn.com/t/c/font_5245637_fw16dqjm5ek.css`
- 品牌设置面板 emoji 全部替换为 iconfont 图标（icon-theme / icon-edit / icon-seedance / icon-link / icon-refresh / icon-check）

### 风控修复
- 评论 state 验证接口从错误的 `/x/v2/reply/message?mode=3` 改为 `/x/v2/reply/wbi/main`（遍历公开评论列表）
- 找不到 rpid 或 state≠0 判定为假成功，exit(7) 退出码，whale-log 记录 fakeSuccess/verifiedState
- 带图评论假成功自动降级为纯文字发送，避免整条丢失

### 颜文字自动追加
- `KAOMOJI_POOL` 26 个精选颜文字，三条评论路径（关键词/模板/AI）统一自动追加

### 引流策略
- 非主人视频评论必须 @ 主人，主人自身视频评论移除 @ 主人

### 运维
- `ecosystem.config.cjs` 清理原作者 Linux 硬编码路径，cwd 改为 `__dirname`
- 每日投币从 idle 分支移到主循环开头，天天必跑

---

## 2026-10-29 账号保护：每日探活 + 风控熔断

- follow-await 新增 comment-guard 熔断机制，不再完全停评
- 逻辑：每天自动重置，允许发 1 条评论探活；如果被控（exit≠0 或 fakeSuccess）→ 今日剩余评论全部跳过 → 次日自动恢复探活
- 熔断状态存 `~/.doubao-bot/comment-guard.json`，按日期自动轮转
- 原因：10-28 20:10 起连续评论被控，state=14/17 风控频繁触发，先保护账号