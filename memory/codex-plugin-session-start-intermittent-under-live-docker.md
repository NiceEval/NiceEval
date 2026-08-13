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

## 已排除与尚未定论

这不是 Eval selector、模型回复或插件安装文件断言的问题；放宽 sentinel 断言会丢掉
“hook 真实执行”的契约。也不能仅凭 CI 时序认定为 CPU/并发压力。

同日用官方 Codex CLI 0.144.1、相同 fixture 与固定 Git commit，在隔离的临时
`CODEX_HOME` 做了两组 16 路并行最小复现：一组 local marketplace，一组 Git
marketplace。两组共 32 次 SessionStart 全部进入 session。该反证说明单纯“0.144.1
一定漏 hook”或“并发一定触发”都不成立；Docker/live provider/Runner 生命周期的组合条件
仍需由后续 CI 与更窄实验裁决。

## 同批确认的独立 Adapter bug

Adapter 原先先覆盖 `~/.codex/config.toml`，再用 `plugin list` 找旧安装。覆盖会先抹掉
`[plugins.*]` 声明，使旧 cache 安装不可见；后续 add 即使成功，也可能留下旧版本参与
active version 选择。修法是：在覆盖配置前按旧声明先卸同名 Plugin、再无条件摘同名
marketplace，然后写新配置并安装声明版本。这修复复用收敛，但不能拿来解释独立新沙箱的
SessionStart 缺失。

后续若 CI 仍漏 hook，应保留 standalone hook 执行 owner，并从公开执行证据比较失败/成功
时的有效 config、hook discovery 与进程启动结果；不要把 assertion-failed 当 setup retry，
也不要把 timeout/模型成功当作 hook 成功。
