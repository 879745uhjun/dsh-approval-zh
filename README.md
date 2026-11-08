# dsh-approval-zh

Automatically translate **English approval prompt text** in DeepSeek Harness (DSH) into Chinese.

It changes display text only. It **never changes an approval outcome**: the same prompt still asks you to allow or reject, and the plugin never auto-approves or auto-denies anything.

English | [中文](README.zh.md)

## Before / after

Before:

```text
允许本次操作使用 danger-full-access 权限：plugin_manager {"action":"list_plugins","limit":50}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.
```

After:

```text
允许本次操作使用 danger-full-access 权限：plugin_manager {"action":"list_plugins","limit":50}。配置文件更改会在会话之间保留；已安装的 Host 代码在工作区沙箱之外运行。
```

The Chinese prefix, tool names, JSON arguments, and sandbox mode names are preserved.

## What it does

- Listens to the Host `approval/request` waterfall and rewrites `displayReason` (or the `reason` fallback) before the request is forwarded to the browser.
- Translates only the English part while protecting:
  - localized Chinese prefixes such as `允许本次操作使用 danger-full-access 权限：`;
  - tool names such as `plugin_manager` and `ops_bash`;
  - JSON/command arguments, inline code, URLs, Windows paths, and sandbox mode names.
- Caches identical text in memory.
- On timeout, network failure, or a malformed response, shows the original text and lets the approval continue. It never blocks or denies a call.
- Does not modify `approval/asked` / `approval/decided` audit records; they keep the original English reason.

## Install

### From the DSH plugin manager

1. Put this directory anywhere on the machine, for example `D:\plugins\dsh-approval-zh`.
2. Use “install from local directory” on the Plugins page, or ask the agent to call:

   ```text
   plugin_manager install_bundle target=<absolute path to this directory>
   ```

3. Restart DSH when prompted. Host plugins usually load at startup.

### CLI

```sh
dsh plugin --profile desktop add "D:\plugins\dsh-approval-zh"
```

`desktop` is the reserved profile of the desktop app; use the matching profile for Web/TUI.

## Configuration

Override the row with id `dsh-approval-zh` in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-approval-zh
  config:
    enabled: true
    target: zh-Hans
    timeoutMs: 3000
    translateReason: true
    translateDisplayReason: true
    debug: false
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; `false` loads no listener. |
| `target` | `zh-Hans` | Target language passed to the translation endpoint. |
| `timeoutMs` | `3000` | Per-request timeout; the original text is shown on timeout. |
| `maxTextChars` | `4000` | Text longer than this is left untranslated. |
| `translateReason` | `true` | Translate the `reason` fallback when `displayReason` is absent. |
| `translateDisplayReason` | `true` | Translate the `displayReason` rendered by the approval card. |
| `debug` | `false` | Log load and failure events (never the source text). |
| `glossary` | `{}` | Extra term replacements. |

## Privacy

- Sends only the approval sentence that needs translation to Microsoft Edge's anonymous translation endpoint (`edge.microsoft.com`). No account or API key is required.
- Does not send file contents, full sessions, credentials, or tool results.
- The original English reason remains in DSH's audit log; only the browser display is rewritten.
- Set `enabled: false` to disable all network access.

## Limitations

- Requires network access to `edge.microsoft.com`; otherwise the English text is shown.
- The anonymous endpoint may rate-limit or change its protocol; failures fall back to the original text.
- Only the approval title/description is translated. Command bodies, the tool-detail panel, and button labels follow DSH's own locale setting.
- Code, JSON, paths, URLs, and tool names are intentionally not translated.
- Translation adds up to `timeoutMs` of display latency; cached prompts are effectively instant.

## Development

```sh
node test/translate.test.js   # unit tests, no network
node test/live.mjs            # one real request to the translation endpoint
```

- `index.js`: Cordis entry point and `approval/request` listener.
- `lib/translate.js`: prefix splitting, technical-span protection, anonymous translation, cache, and glossary.
- `test/translate.test.js`: pure-function and request-rewrite tests.

## License

MIT
