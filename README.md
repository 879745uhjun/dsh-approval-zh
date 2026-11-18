# dsh-approval-zh

Automatically translate **English approval prompt text** and **`ask_user_question` cards** in DeepSeek Harness (DSH) into Chinese.

It changes display text only. It **never changes an approval outcome or an answer**: the same prompt still asks you to allow or reject, and question options keep their original English labels as answer values. The plugin never auto-approves or auto-denies anything.

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

An `ask_user_question` card:

```text
Which repo?
1. It's private — I'll provide a token or make it public
   Anonymous requests can't read private repos; a read-only PAT would let me clone and summarize it.
```

becomes Chinese in the question and description while the option label stays English:

```text
你说的是哪个仓库？
1. It's private — I'll provide a token or make it public
   匿名请求无法读取私有仓库；一个只读 PAT 可以让我克隆并总结它。
```

## What it does

- Listens to the Host `approval/request` waterfall and rewrites `displayReason` (or the `reason` fallback) before the request is forwarded to the browser.
- Listens to `user-questions/request` and translates the question, optional header, and option descriptions; **option labels are intentionally preserved** because they are returned to the model as answer values.
- Translates only the English part while protecting:
  - localized Chinese prefixes such as `允许本次操作使用 danger-full-access 权限：`;
  - tool names such as `plugin_manager` and `ops_bash`;
  - JSON/command arguments, inline code, URLs, Windows paths, and sandbox mode names.
- Caches identical text in memory, and skips text with nothing worth translating (already Chinese, or a tool name plus JSON arguments) at zero cost.
- Starts with the anonymous Bing endpoint. If it is slower than `llmDelayMs` or fails, the current session model races it; the first successful translation wins and the other request is aborted.
- If both paths fail, shows the original text and lets the approval continue. It never blocks or denies a call.
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

### From GitHub

```sh
dsh plugin --profile desktop add github:879745uhjun/dsh-approval-zh
```

Reload the Web UI page after installing.

## Configuration

Override the row with id `dsh-approval-zh` in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-approval-zh
  config:
    enabled: true
    target: zh-Hans
    timeoutMs: 8000
    displayWaitMs: 4000
    llmDelayMs: 1200
    useLlm: true
    minProseChars: 3
    translateReason: true
    translateDisplayReason: true
    translateUserQuestions: true
    debug: false
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; `false` loads no listener. |
| `target` | `zh-Hans` | Target language passed to the translation endpoint. |
| `timeoutMs` | `8000` | Hard deadline; cancels every in-flight request. |
| `displayWaitMs` | `4000` | Display budget: the approval card waits at most this long, then shows the original text. Clamped to `≤ timeoutMs`. |
| `llmDelayMs` | `1200` | Start the current-session model if Bing has not answered by then. |
| `useLlm` | `true` | Allow the current-session model as fallback; `false` uses Bing only. |
| `maxTextChars` | `4000` | Text longer than this is left untranslated. |
| `minProseChars` | `3` | Skip when the text has fewer translatable letters once code, JSON, and tool names are removed. A 2-letter word such as `OK` is skipped by design. |
| `translateReason` | `true` | Translate the `reason` fallback when `displayReason` is absent. |
| `translateDisplayReason` | `true` | Translate the `displayReason` rendered by the approval card. |
| `translateUserQuestions` | `true` | Translate `ask_user_question` questions, headers, and option descriptions; option labels stay unchanged. |
| `debug` | `false` | Log load and failure events (never the source text). |
| `glossary` | `{}` | Extra term replacements. |

## Latency

The approval card is blocking: it does not render until the translation settles.

| Case | Card delay | Request sent |
| --- | --- | --- |
| Already Chinese | 0 ms | no |
| Tool name + JSON only | 0 ms | no (`minProseChars`) |
| Identical text cached | ≈0 ms | no |
| Bing healthy (measured 0.16–0.9 s here) | 0.2–1 s | 1 anonymous request |
| Bing slow (> `llmDelayMs`) | 1.2 s + model 1–3 s ≈ 2–4 s | anonymous + 1 model request |
| Both channels fail or hang | `displayWaitMs` (4 s), then original text | yes, cut off by the budget |

Normal cost is **0.2–1 s per approval**; the worst case is capped at `displayWaitMs` (4 s) instead of the former 8 s. Set `enabled: false` or lower `displayWaitMs` to remove the delay entirely.

Resilience (0.2.2): a single dropped Bing connection is retried once immediately; reasons longer than 300 characters start the model channel at 0.4 s instead of 1.2 s; the failure cooldown dropped from 60 s to 15 s so one network blip cannot lock a prompt out of translation for a minute.

> **Behaviour change (0.2.1):** with `useLlm: false` or no model service, Bing is the only channel and it is **now** bounded by `displayWaitMs` too. In 0.2.0 and earlier that mode had no Bing deadline, so a hung network waited for `timeoutMs`. This is intentional; there is no separate switch back to the old behaviour.

## Privacy

- Sends only the approval or question text that needs translation to Microsoft Edge's anonymous translation endpoint (`edge.microsoft.com`). No account or API key is required.
- If Bing is slower than `llmDelayMs` or fails, the same text is sent to the model already used by the current session as a fallback; this consumes a small number of model tokens. Set `useLlm: false` to disable.
- Does not send file contents, full sessions, credentials, or tool results.
- The original English reason remains in DSH's audit log; only the browser display is rewritten.
- Set `enabled: false` to disable all network access.

## Limitations

- Prefers `edge.microsoft.com`; if it is slow or unavailable, the current-session model is used. Only when both fail (or `useLlm: false` and Bing is unavailable) is the English text shown.
- A slow Bing response can trigger a model call, adding a small token cost and 1–3 seconds of latency.
- Only approval and question-card display text is translated. Command bodies, the tool-detail panel, and button labels follow DSH's own locale setting.
- Question-card option **labels** stay in English because they are returned to the model as answer values; only the question, header, and option descriptions are translated.
- Code, JSON, paths, URLs, and tool names are intentionally not translated.
- Translation adds up to `timeoutMs` of display latency; cached prompts are effectively instant.
- An already-open approval prompt is never updated retroactively. If a source update still behaves like the old version, restart DSH to clear the loaded Host module cache.

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
