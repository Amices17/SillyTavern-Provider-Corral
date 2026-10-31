# SillyTavern-Provider-Corral

**中文** | [English](README.en.md)

按模型圈上游的「围栏」：每个模型按自己的规则命中一个**上游围栏**——勾了哪几家就只准走哪几家，**越栏不贷**；单选 = 死钉那家（限流/不可用也不换，报错拉倒），多选 = 栏内交给 OpenRouter 自行分配。围栏参数以 `provider.order` / `allow_fallbacks` / `provider.quantizations` 注入所有 OpenRouter 请求——限流时 OpenRouter 自动按你的顺序换下一家，酒馆全程无感。

内置快照 **117 家**（2026-10-31 拉取），并会实时刷新官方目录，酒馆自带的硬编码列表里缺的新家这里都有。

## 功能

- **官方实时目录**：拉取 `https://openrouter.ai/api/v1/providers`，24 小时缓存；拉取失败回退内置快照并标注「离线或未刷新」，60 秒后自动重试（不会丢已有选择）。
- **可搜索勾选列表**：已选计数 + 一键清空；已选项按优先级置顶并编号，↑↓ 调整顺序；目录里没有的家可以手填 slug（选中项即使不在目录里也始终显示，回车也能添加）。
- **三种路由模式**：
  - **按序优先尝试**（`order` + `allow_fallbacks: true`）——第一家限流/宕机时 OpenRouter 自动切下一家，**这是解决限流的核心开关**；
  - **仅允许列表内**（`only` + `allow_fallbacks: false`）——列表外一律不用；
  - **不注入**——沿用酒馆原生「模型提供商」选择。
- **量化位数限制**：`provider.quantizations`（选项动态读取酒馆原生下拉，与酒馆版本保持一致）。
- **按模型规则（卡片式编辑器）**：点「＋ 添加规则」逐条配置——模型匹配串 + 模式下拉 + 该规则专属的提供商勾选（独立搜索 / 手填 slug / 优先级排序 / 清空），自上而下第一条命中生效，随「保存设置」一次落盘。
- **原生下拉同步**：官方目录全量追加进酒馆自带的「模型提供商」下拉（`#openrouter_providers_chat` / `#openrouter_providers_text`），不开本面板也能选到新家。
- **跨设备迁移**：一键导出 / 导入配置 JSON，电脑配好拷到手机（Termux）即用。
- **文本补全侧注入**（默认关）：同时作用于 `text-completions` 请求，仅在文本补全模式使用 OpenRouter 时开启。

## 安装

酒馆 → 右上角 **扩展程序** → **安装扩展程序** → 粘贴本仓库 Git URL → **Install**（手机 Termux 酒馆同样操作）：

```
https://github.com/Amices17/SillyTavern-Provider-Corral
```

装完刷新页面，面板在 **扩展程序** 设置区的「OpenRouter 上游围栏」抽屉里。`auto_update: true`，酒馆会随仓库更新自动升级。

手动安装（开发）：把本目录（含 `manifest.json`）放到酒馆的
`public/scripts/extensions/third-party/SillyTavern-Provider-Corral/`（全局，刷新即生效），
或 `data/<用户名>/extensions/SillyTavern-Provider-Corral/`（用户级，需重启酒馆服务生效）。

> **二选一**：手动安装过就别再走 Git URL 安装（反之亦然），两处并存会重复加载；换安装方式前先删掉旧目录。

## 使用

1. 聊天补全来源选 **OpenRouter**（中转站 key 填在 OpenRouter 密钥位同样适用）。
2. 打开面板 → 勾选想要的提供商（顺序即优先级）→ 模式选 **按序优先尝试** → 保存。
3. 之后每条 OpenRouter 请求都会携带 `provider: { order: [...], allow_fallbacks: true }`，哪家限流 OpenRouter 自己换，不再报错打断你。

按模型规则：面板里点「＋ 添加规则」逐条配置即可，各字段含义如下（导出配置中的 `modelRules` 与之同构）：

```json
[
  { "pattern": "xiaomi/mimo*", "mode": "only", "providers": ["makora", "xiaomi"] },
  { "pattern": "anthropic/*", "mode": "order", "providers": ["anthropic", "claude-on-aws"] },
  { "pattern": "cheap-*", "mode": "off", "providers": [] }
]
```

- `pattern` 大小写不敏感；含 `*` 按通配匹配，不含 `*` 按命名空间前缀匹配；
- `mode` 取 `inherit`（跟随全局）/ `only` / `order` / `off`（该模型跳过注入）；
- `providers` 留空则继承全局列表；
- 全局「启用路由注入」关闭时，所有按模型规则一并失效（总闸门）。

## 隐私与安全

**无泄露风险，可放心公开仓库 + Git URL 安装：**

- **零密钥**：插件不读取、不存储、不发送任何 API 密钥；OpenRouter 目录是无需认证的公开端点。
- **唯一外部请求**：`https://openrouter.ai/api/v1/providers`（官方公开目录，明文 HTTPS）。
- **零遥测**：无统计、无埋点、无第三方域名。
- **配置内容**：仅含 provider slug 列表、模式开关和模型规则，均为非敏感数据；存于酒馆本地 `settings.json` 的扩展设置区，不随 Git 传播。
- 打开浏览器控制台即可审计全部网络请求。

## 工作原理

酒馆链路（release 分支源码）：

1. 前端 `public/scripts/openai.js` 生成时发送 `generate_data.provider` / `use_fallback`；
2. 后端 `src/endpoints/backends/chat-completions.js` 的 OpenRouter 分支拼装：
   ```js
   bodyParams['provider'] = {
       allow_fallbacks: request.body.allow_fallbacks ?? true,
       order: request.body.provider ?? [],
   };
   ```
3. 本插件在浏览器侧包装 `window.fetch`，对 `chat-completions` 的 OpenRouter 请求改写 body（`provider` / `allow_fallbacks` / `quantizations`），并把官方目录追加进原生下拉——不改酒馆源码、不依赖后端插件。

## 已知限制

- `service_tier` 不注入：酒馆后端按白名单重建请求体，顶层未知字段会被丢弃，纯前端注入无效。
- 本插件只改路由参数，不参与生成重试；跨「不同 API 来源」（如 OpenRouter ↔ DeepSeek 官方）的后备需要连接配置层面的方案。
- 酒馆升级若调整端点路径或 body 字段名，需同步微调 `index.js` 中的 `GENERATE_URL_RE` 与字段映射（锁了 `minimum_client_version`）。

## License

MIT