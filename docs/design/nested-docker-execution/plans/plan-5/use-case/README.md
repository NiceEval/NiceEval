# Use Case：NiceEval-Eval 真实 nested Docker dogfood

## 前提

候选 NiceEval 必须以已构建包安装到 NiceEval-Eval，不能因相邻目录而直接读取源码。
真实模型运行与托管 Provider 费用在执行前取得当次授权。验收只使用安装后的 CLI、Provider 公开
doctor 和 `niceeval show`，不读取 `.niceeval/` 私有文件、Incus 数据库或 snapshot 内容。

自托管 reference run 使用 NixOS 上的 Incus VM Provider。deployment 预留四条 4 GiB Docker data
allocation 和独立 cleanup reserve，并注册一个满足 `docker/v1 + dedicated-kernel/v1` 的 Sandbox template。

## 公开 preflight

```bash
pnpm exec niceeval sandbox provider doctor incus
pnpm exec niceeval sandbox provider doctor incus --probe
pnpm exec niceeval exp install/v0.12.0 install/db-gpt --dry
pnpm exec niceeval exp harness/v0.12.0 harness/terminal-bench/regex-log --dry
```

doctor 必须显示 execution domain、四条可用 reservation、4 GiB quota、verified artifact 与零个 unknown
orphan。`--probe` 的 allocation 创建和销毁都有公开 receipt，且 active Eval allocation 数量不变。
dry run 显示 exact Docker requirement 已由 Incus capability满足，不调用模型。

## 冷运行与真实并发

在两个 shell 几乎同时运行：

```bash
pnpm exec niceeval exp install/v0.12.0 install/db-gpt \
  --max-concurrency 4 --sandbox-setup-cache=use --rerun all
```

```bash
pnpm exec niceeval exp harness/v0.12.0 harness/terminal-bench/regex-log \
  --max-concurrency 4 --sandbox-setup-cache=use --rerun all
```

live 面必须同时出现两条已经进入 Attempt 的成员，而不是一条全局 profile error。每条 Attempt 内公开
命令证明 `docker info`、`docker run` 与 `docker compose` 使用 sandbox-private daemon。两条真实 Eval
都产生模型结果、Assertion/Score 与 sealed Run。

保存 CLI 给出的两个 Run ID，再分别查看：

```bash
pnpm exec niceeval show --run <install-run-id>
pnpm exec niceeval show --run <harness-run-id>
```

`show` 必须呈现 Sandbox create/ready、setup replay、Agent、Eval test、destroy 与最终 score。
不允许用 Record 私有文件补齐 cache、allocation 或 cleanup 证据。

## warm 运行

输入不变时重复相同两条 `niceeval exp` 命令。为了证明真实执行而不是沿用旧 Attempt，继续使用
`--rerun all`。公开 activity 必须把 eligible setup 从 `replay` 变成 `hit`，同时 Agent 与 Eval test 仍
真实执行。比较 cold/warm 的 sandbox create、setup 与总 elapsed，warm 必须有可量化改善。

warm clone 启动后再检查 A/B 隔离：新 Attempt 的 Docker object inventory、workspace marker、volume、
secret marker 与 daemon event 中均没有冷运行私有内容。共享 OCI digest 或 BuildKit cache hit可以出现，
但不能伪装成共享 container 或 writable volume。

## 强杀与重启

用一个不涉及额外模型费用的公开探测 fixture 分别在 create、ready、command 与 destroy 阶段强杀 CLI。
重新运行 doctor 和 `niceeval sandbox list --orphans`。旧 generation 应被 fence，实例和磁盘最终 absent，
reservation 回到四条；对应 Run 显示 environment incomplete，不会自动重新发送模型请求。

宿主重启重复同一 fixture。重启后 committed artifact 可继续命中，所有旧 in-flight allocation先回收。
`/data/niceeval-dind-pool.img` 的 metadata、mtime 与 mount 状态保持不变。

## 通过条件

- 两个真实 Eval 并发进入 Attempt，并各自产生模型结果和 score；
- cold 是 replay，warm 是 hit，且 warm elapsed 改善；
- 每条 allocation 的 Docker data 是 4 GiB，daemon 与 writable state彼此隔离；
- 普通完成、`SIGKILL` 与宿主重启后都没有 orphan、lease 或 capacity 泄漏；
- doctor 没有改变不属于自己的 allocation；
- 任一失败都没有触发宿主 socket、DinD 或较弱 Provider fallback。
