# Codex Plugin SessionStart 在 Docker/live 高并发下偶发不进入 session

## 现象

2026-08-13，PR #47 的 Docker batch（run `31677175664`，attempt 2）里，Codex CLI
0.144.1 的 `plugin-hook` 共运行 9 次：`plugin-reuse` 8 次中 2 次失败，独立 `plugin`
1 次也失败；独立 Experiment 随后的外层重跑通过。三次失败都只有 SessionStart sentinel
缺失，其它断言全部通过。

公开 `niceeval show <locator> --execution` 证据一致：

- `hook-demo@niceeval-e2e-plugins` 为 `installed: true`、`enabled: true`，版本 `0.1.0`；
- cache 里的 `hooks.json` 存在；
- `codex exec` 带 `--dangerously-bypass-hook-trust`，Turn 正常完成并回复 `ok`；
- 当前 session rollout 文件存在，但没有 `NICEEVAL_HOOK_SENTINEL_926` developer message；
- 失败不只发生在复用波次，不能只用 marketplace/plugin 旧状态解释。

## 已排除与根因

这不是 Eval selector、模型回复或插件安装文件断言的问题；放宽 sentinel 断言会丢掉
“hook 真实执行”的契约。也不能仅凭 CI 时序认定为 CPU/并发压力。

同日用官方 Codex CLI 0.144.1、相同 fixture 与固定 Git commit，在隔离的临时
`CODEX_HOME` 做了两组 16 路并行最小复现：一组 local marketplace，一组 Git
marketplace。两组共 32 次 SessionStart 全部进入 session。这个结果只说明竞态在本机没有
命中，不能反证竞态不存在。

对比 OpenAI Codex 官方源码 tag `rust-v0.144.1` 与 `rust-v0.146.0` 后确认根因在
`codex-rs/hooks/src/engine/command_runner.rs`：0.144.1 启动 hook 子进程后向其 stdin 写
SessionStart JSON；若 `echo` 已先正常退出，写入返回 `BrokenPipe`，旧实现会 kill/封口为失败，
已经产生的 stdout 因而不会进入模型上下文。CI 高负载扩大了这个很窄的时序窗口。0.146.0
明确只忽略 `ErrorKind::BrokenPipe`，其它 stdin 写错误仍失败，正好修复这条竞态。

NiceEval 因此在配置 `plugins` 时选择 Codex CLI 0.146.0；未配置 Plugin 的官方预制基线仍用
已经发布的 0.144.1，由 staged installer 只给 Plugin 场景补齐修复版本。不能把 fixture 改成
先读 stdin 再 `echo` 来规避：那只让测试避开竞态，真实第三方 hook 仍会丢。

## 同批确认的独立 Adapter bug

Adapter 原先先覆盖 `~/.codex/config.toml`，再用 `plugin list` 找旧安装。覆盖会先抹掉
`[plugins.*]` 声明，使旧 cache 安装不可见；后续 add 即使成功，也可能留下旧版本参与
active version 选择。修法是：在覆盖配置前按旧声明先卸同名 Plugin、再无条件摘同名
marketplace，然后写新配置并安装声明版本。这修复复用收敛，但不能拿来解释独立新沙箱的
SessionStart 缺失。

保留 standalone hook 执行 owner，并从公开执行证据比较有效 config、hook discovery 与进程
启动结果；不要把 assertion-failed 当 setup retry，也不要把 timeout/模型成功当作 hook 成功。
