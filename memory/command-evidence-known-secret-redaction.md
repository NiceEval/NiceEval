# `show --timing` / `--execution` 会泄漏命令里显式注入的凭据

## 现象

Adapter 或 Sandbox hook 把 MCP HTTP header、stdio env、API key 等值拼进 shell heredoc / argv 时，`niceeval show @<locator> --timing` 与 `--timing=full` 会显示该命令的前 160 个字符；非零退出后，`--execution` 还会显示命令、stdout/stderr，Attempt error 与 Agent event 也可能重复同一值。`--json` / `--expand` 消费相同 artifact，因此不是只修 text renderer 就能关闭的洞。

## 根因

`withCommandTiming()` 把原 script/argv 直接交给 `commandDisplay()`，旧实现所谓“脱敏”只有截断，没有 secret provenance。展示层既不知道哪个子串是凭据，也无法从 `Authorization` / `token` / `api_key` 等自由文本键名可靠推断；在 renderer 上补正则会漏掉自定义字段、编码形态和错误/event 旁路，也会误伤普通输出。

## 修法与适用范围

- `CommandOptions.sensitiveValues` 由真正知道值的 Adapter / hook 在命令调用处显式登记；集合只驻留当前 Attempt 内存，不落 artifact、不进指纹，也不改变 provider 收到的原命令或调用方拿到的 stdout/stderr。
- Runner 记录命令时先按值做最长优先精确替换，再截断 display；失败命令的 stdout/stderr 同步替换。最终 Result 封口再扫描 timing、commands、events/trace、retryAttempts、diagnostics、assertions 与 `AttemptError`，使 `--timing[=full]`、`--execution [--expand]`、网页和 JSON 共用一条已脱敏数据边界。
- 四个公开 `run*` 方法都经过包装；checked 方法的 `SandboxCommandExitError.result` 也登记失败命令证据。Proxy 必须继续继承 provider capability，不能因安全包装丢失 reuse/root 等私有能力。
- 官方 Codex/Claude MCP 把 HTTP header value 与 stdio env value 登记；Hermes/OpenClaw 配置 heredoc及各内置 coding-agent 运行时 API key 同样登记。
- 这不是自由文本 scanner：调用方没有登记的值、先编码/拆分却没登记对应形态、provider 原生日志、修复前旧 artifact 都不在保证内。读取端不得用 key-name regex 猜测，也不得声称能够清洗历史记录。

修法落点：`src/sandbox/types.ts`、`src/sandbox/redaction.ts`、`src/runner/attempt.ts`、`src/runner/timing.ts` 与官方 `src/agents/*` Adapter。回归使用纯合成敏感值，不读取真实环境凭据。
