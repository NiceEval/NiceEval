# Testsets —— CLI 反馈模型

装了别人的题之后，命令行要能回答三个问题：我现在有哪些题、它们要什么环境、我这次比的是不是同一张卷。契约形状见 [Library](library.md)。

## `niceeval testset`

```sh
niceeval testset                        # 列出已引用的测试集
niceeval testset swe-memory             # 一个测试集的详情:题数、分区、环境需求
```

它是只读命令：装载 `niceeval.config.ts`、跑发现，不碰 agent、不建沙箱、不写 `.niceeval/`。

```sh
niceeval testset
```

```text
testsets (2)
  swe-memory       40 evals  ·  v1.4.0  ·  sha256-3f9c1a  ·  needs 1 environment
  team-regression   6 evals  ·  (local) ·  sha256-88e0d4
local evals/       12 evals

Run `niceeval testset <id>` to see groups and environment requirements.
```

```sh
niceeval testset swe-memory
```

```text
swe-memory  ·  40 evals  ·  v1.4.0  ·  sha256-3f9c1a
跨会话记忆能力的 40 道题
https://github.com/someone/swe-memory

groups
  swe-memory/recall      24 evals   tags: recall, memory
  swe-memory/summarize   16 evals   tags: memory

environments
  python-3.9-astropy     8 evals    ✓ mapped (docker: ghcr.io/me/astropy-3.9:1)
  node-22-monorepo       4 evals    ✗ missing

1 environment profile 没有映射。在 sandbox spec 的 environments 表里补上,
或摊开测试集给的推荐值:environments: { ...sweMemory.environmentHints.docker }
```

`✗ missing` 是这条命令存在的主要理由：跑别人的题最先撞的墙就是环境，这个墙应该在跑之前、用一条只读命令看到，而不是在第一个 attempt 启动时。

## `niceeval list`

`list` 的每行加来源列，`--testset <id>` 只看某个来源：

```sh
niceeval list --testset swe-memory
```

```text
swe-memory/recall/multi-session   swe-memory   recall, memory
swe-memory/recall/summarize       swe-memory   recall, memory
```

不带 `--testset` 时本地题的来源列显示 `local`。

## `niceeval exp`

跑法不变：位置参数仍然只有 eval id 前缀这一种语义，测试集贡献的题的 id 前缀就是测试集 id，天然可选：

```sh
niceeval exp                       # 按各 experiment 的 benchmark / evals 跑
niceeval exp swe-memory            # 再收窄到这个测试集的题
niceeval exp swe-memory/recall     # 收窄到一个分区
```

**没有 `--benchmark` flag**。卷面是可签入的配置，写在 experiment 文件里；CLI 只选择「跑哪些 eval」和「怎么跑」，这条[输入模型](../../cli.md)不为测试集破例。

`--dry` 的计划头把卷面身份说清：

```sh
niceeval exp compare --dry
```

```text
plan: 240 attempts · 40 evals × 2 configs · runs 3
benchmark memory-v1 · bm:sha256-7a41c9 · swe-memory@sha256-3f9c1a
compare/codex     swe-memory/recall/multi-session
compare/claude    swe-memory/recall/multi-session
…
```

两个 config 共用一行 benchmark 身份，就是「同一张卷」这件事在计划阶段的可见证据。

## 错误反馈

### 缺环境映射

选中的题声明了 profile、sandbox spec 的 `environments` 表没有这一项时，启动期退出。报错要点出**是谁要的**——消费者没写过这个 profile，光报 id 无从下手：

```text
Missing environment mapping: node-22-monorepo
  required by 4 evals from testset `swe-memory` (e.g. swe-memory/recall/monorepo-a)
  your sandbox spec (docker) maps: python-3.9-astropy

Next: add it to environments in your sandbox spec, or spread the testset's hint:
  environments: { ...sweMemory.environmentHints.docker }
Run `niceeval testset swe-memory` to see all environment requirements.
```

### 测试集 id 碰撞

```text
Testset id collision: `swe-memory`
  from @someone/swe-memory (niceeval.config.ts testsets[0])
  from local directory evals/swe-memory/ (3 evals)

Two sources would produce ids under the same namespace.
Next: rename the local directory, or alias the testset.
```

碰撞不按加载顺序静默决定谁赢：两边都是用户写下的声明，猜任何一边都会让某个人的 eval id 悄悄改掉。

### 指纹与 `pin` 不匹配

```text
Benchmark memory-v1 pinned to bm:sha256-7a41c9, resolved to bm:sha256-2d0b55.
  swe-memory  sha256-3f9c1a → sha256-c71e88  (题目内容变化)
  selection   40 evals → 42 evals            (新增 swe-memory/recall/nested-a, …)

Scores across this change are not comparable.
Next: update `pin` in benchmarks/memory-v1.ts after reviewing the diff,
or pin the testset to the previous version in package.json.
```

报错分行说清指纹为什么变——题目内容变了和选题集合变了是两件事，前者作废旧分数，后者只是卷面变宽。人要据此决定更新 `pin` 还是回退版本，光给两个哈希做不了这个决定。

### `benchmark` 与 `evals` 同时出现

```text
experiments/codex.ts sets both `benchmark` and `evals`.
A run compares one set of evals; two sources of truth would silently disagree.
Next: drop `evals`, or drop `benchmark` and inline the selection.
```

### 题库变了但没写 `pin`

不是错误，是运行结束时的一条诊断——这次的分数和上次的不可比，人应该知道：

```text
⚠ swe-memory changed since the last snapshot (sha256-3f9c1a → sha256-c71e88).
  Earlier results for this benchmark are not comparable and appear as a separate
  version on the report. Add `pin` to benchmarks/memory-v1.ts to make this a hard stop.
```

## 相关阅读

- [Library](library.md) —— `defineTestset` / `defineBenchmark` 与环境映射写法。
- [Architecture](architecture.md) —— 指纹算法与发现流程。
- [Experiments CLI](../../feature/experiments/cli.md) —— `exp` 的选择器、输出形态与退出码的现有契约。
- [错误与警告反馈](../../error-feedback.md) —— 报错必带下一步的仓库级规则。
</content>
