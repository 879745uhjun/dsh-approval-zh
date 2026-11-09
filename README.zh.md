# dsh-approval-zh

自动把 **DeepSeek Harness（DSH）审批提示里的英文说明**翻译成中文。

它只改“显示文案”，**不改变审批结果**：原来要你点的“允许一次 / 拒绝”，现在仍然由你决定；插件不会自动批准、自动拒绝，也不会替你做任何决定。

[English](README.md) | 中文

## 效果

审批提示原本长这样：

```text
允许本次操作使用 danger-full-access 权限：plugin_manager {"action":"list_plugins","limit":50}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.
```

安装后变成：

```text
允许本次操作使用 danger-full-access 权限：plugin_manager {"action":"list_plugins","limit":50}。配置文件更改会在会话之间保留；已安装的 Host 代码在工作区沙箱之外运行。
```

中文前缀、工具名、JSON 参数和权限模式都会原样保留。

## 它做什么

- 监听 Host 的 `approval/request` 瀑布事件，在请求发给浏览器之前改写 `displayReason`（没有时改写 `reason`）。
- 只翻译英文部分，保留：
  - 中文提示前缀，例如“允许本次操作使用 danger-full-access 权限：”；
  - 工具名，例如 `plugin_manager`、`ops_bash`；
  - JSON / 命令参数、反引号代码、URL、Windows 路径、`danger-full-access` 等模式名。
- 内存缓存相同文案，避免每次审批都请求翻译。
- 先请求匿名 Bing 端点；如果它超过 `llmDelayMs` 还没返回或直接失败，会同时用**当前会话的模型**翻译，谁先成功用谁，另一个立即取消。这样 Bing 慢或不可用时不会一直显示英文。
- 两条通道都失败时**显示原文并继续审批**，不会阻塞、不会拒绝调用。
- 不会修改 `approval/asked` / `approval/decided` 审计记录；审计里仍是原始英文。

## 安装

### 方式一：当前 DSH 的插件管理

1. 把本目录放到本机任意位置，例如 `D:\plugins\dsh-approval-zh`。
2. 在 DSH 插件页选择“从本地目录安装”，或让 Agent 调用：

   ```text
   plugin_manager install_bundle target=<本目录的绝对路径>
   ```

3. 按提示重启 DSH（Host 插件通常需要重启后加载）。

### 方式二：命令行

```sh
dsh plugin --profile desktop add "D:\plugins\dsh-approval-zh"
```

`desktop` 是桌面版保留的 profile 名；Web/TUI 请换成对应 profile。

安装后确认：

- 插件页出现 `dsh-approval-zh`；
- 下一次审批提示的英文说明变成中文。

## 配置

在 profile 的 `cordis.patch.yml` 里按行 id `dsh-approval-zh` 覆盖配置：

```yaml
- id: dsh-approval-zh
  config:
    enabled: true
    target: zh-Hans
    timeoutMs: 8000
    llmDelayMs: 1200
    useLlm: true
    translateReason: true
    translateDisplayReason: true
    debug: false
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；设为 `false` 后完全不加载监听器。 |
| `target` | `zh-Hans` | 目标语言，传给翻译端点。 |
| `timeoutMs` | `8000` | 整次翻译（Bing + 模型竞速）的总超时；超时显示原文。 |
| `llmDelayMs` | `1200` | Bing 超过这个时间还没返回时，启动当前会话模型一起翻译。 |
| `useLlm` | `true` | 是否允许用当前会话模型兜底；设为 `false` 则只走 Bing。 |
| `maxTextChars` | `4000` | 超过此长度的文案不翻译，直接显示原文。 |
| `translateReason` | `true` | 没有 `displayReason` 时，翻译 `reason` 兜底。 |
| `translateDisplayReason` | `true` | 翻译审批卡片实际显示的 `displayReason`。 |
| `debug` | `false` | 输出加载和翻译失败日志（不含原文内容）。 |
| `glossary` | `{}` | 额外术语替换，例如 `{ "Host": "Host" }`。 |

## 隐私

- 优先把**需要翻译的那段审批说明**发送到 Microsoft Edge 的匿名翻译端点（`edge.microsoft.com`），不需要账号或 API Key。
- 如果 Bing 超过 `llmDelayMs` 未返回或失败，同一段文本会发给**当前会话使用的模型**做兜底翻译；这会消耗少量模型 token。把 `useLlm` 设为 `false` 可关闭。
- 不会发送文件内容、完整会话、凭据或工具执行结果。
- 只是显示层改写；原始审批理由仍保存在 DSH 的审计日志里。
- 如果不想联网，把 `enabled` 设为 `false` 即可；插件没有本地模型。

## 已知限制

- 优先使用 `edge.microsoft.com`；Bing 慢或失败时会自动用当前会话模型兜底。只有两者都失败（或设置 `useLlm: false` 且 Bing 不可用）才显示英文原文。
- Bing 超过 `llmDelayMs` 会触发模型翻译，可能产生少量 token 费用和额外 1–3 秒延迟。
- 只翻译审批卡片的标题/说明；命令正文、工具详情面板、按钮文字跟随 DSH 自身的界面语言设置，不在本插件范围内。
- 不翻译代码、JSON、路径、URL 和工具名；这些内容保持原样是有意设计。
- 翻译会增加最多 `timeoutMs` 的显示延迟；命中缓存后基本无感。
- 已经打开的审批弹窗不会追溯更新；更新插件源码后，如果行为仍是旧版，重启一次 DSH 以清除已加载的 Host 模块缓存。

## 开发

```sh
node test/translate.test.js   # 单元测试，无需网络
node test/live.mjs            # 真实请求一次翻译端点
```

代码结构：

- `index.js`：Cordis 插件入口，注册 `approval/request` 前置监听器。
- `lib/translate.js`：前缀拆分、技术片段保护、匿名翻译、缓存与术语修正。
- `test/translate.test.js`：纯函数与请求改写测试。

## License

MIT
