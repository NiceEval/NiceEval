# CLI 参考

`niceeval` 的命令行。设计目标:运行配置可签入、可复现;真正执行 eval 时必须通过 `experiments/` 里的 experiment。

> 本篇描述 CLI 的目标模型和当前约定。若代码实现与这里的设计不一致,应进一步讨论并决定是修代码、修设计,还是记录为明确的阶段性差异。

## 两类参数:`exp` 选择「怎么跑」,后续位置参数筛「哪些 eval」

执行 eval 时先选 experiment,再可选地用 eval id 前缀缩小范围:

- `niceeval exp [组|配置]` = 跑**哪个运行配置**。agent、model、flags、runs、预算等都来自 experiment 文件。
- `niceeval exp [组|配置] [eval id 前缀...]` = 在该 experiment 下只跑部分 eval。这个位置参数只筛 eval,不是 agent 名、URL 或模型。
- flags 只做调度级临时覆盖,例如 `--runs`、`--max-concurrency`、`--timeout`。`--agent` / `--model` 不覆盖 experiment;要换 agent 或 model,新增或复制一个 experiment 文件。沙箱后端同理不接受 CLI 覆盖——写在 experiment(或 config)的 `sandbox` 字段里。

```sh
niceeval exp <实验组|配置> <选哪些 eval> <flag:调度覆盖>
#             └怎么跑┘       └eval filter┘   └可选覆盖┘
```

裸 `niceeval weather` 不会运行;要写成 `niceeval exp local weather` 或 `niceeval exp compare weather`。这样结果始终带 experiment 身份,能复现也能在 `niceeval view` 里按配置对比。

## 命令

```sh
niceeval exp [组|配置] [pattern...]  # 跑实验:全部 / 一组 / 单个配置;可再用 eval id 前缀过滤
niceeval init                # 生成 evals/ 与 niceeval.config.ts;在 AGENTS.md 写入/刷新 niceeval-agent-rules 托管区块(指向随包 docs-site,区块外内容不动)
niceeval list                # 只列出发现到的 eval,不运行
niceeval clean               # 删除 .niceeval/ 历史运行工件
niceeval watch               # 监听文件变化,改即重跑(规划中)
niceeval view [结果目录|summary.json]  # 起本地 web 查看器并打开浏览器,读 .niceeval/ 历史运行出图
```

`exp` 运行结束后(含 `--quiet`)在 stdout 打出本次 `summary.json` 的路径(`Structured results: .niceeval/<run>/summary.json`),这是 agent 反馈闭环的入口:coding agent 直接读结构化结果与各 attempt 的工件,不解析人类向的流式输出。

实验 = 可签入的运行配置(哪个 agent/几次/预算)。**一文件一配置,一文件夹一组可对比实验**(`niceeval exp <组>` 跑整组)。详见 [Experiments](experiments.md)。

`pattern` 是 `exp` 命令后的 eval id 前缀过滤,可多个。匹配规则:`id === pattern` 或 `id` 以 `pattern + "/"` 开头(精确或目录前缀):

```sh
niceeval exp                 # 跑 experiments/ 下全部实验
niceeval exp local weather   # 在 local 实验里跑 weather 或 weather/*
niceeval exp local weather/brooklyn  # 在 local 实验里跑单个 eval
niceeval exp compare fixtures/ billing/  # 在 compare 组里跑多个前缀,并集
```

## 选择被测对象(agent,写进 experiment)

```sh
niceeval exp <组|配置>             # agent / model 来自 experiments/<组|配置>.ts
```

agent、model、feature flags、sandbox 后端都属于 experiment,不是临时 CLI flag。要连你自己的服务,写一个 agent adapter,再在 experiment 里引用它;URL 和鉴权是 adapter / experiment 的私有配置,不是位置参数。沙箱型 agent 在哪跑(docker / vercel / e2b / 三方)写在 experiment(或 config)的 `sandbox` 字段里,用 `dockerSandbox()` / `vercelSandbox()` / `e2bSandbox()`(从 `niceeval/sandbox` 导入)——没有默认值,没写就在起沙箱时直接报错。

## 调度

```sh
niceeval exp compare --runs <n>               # 临时覆盖每个 eval 的 runs
niceeval exp compare --early-exit             # 先过一次即停其余(默认开)
niceeval exp compare --no-early-exit          # 关掉,要完整通过率分布
niceeval exp compare --max-concurrency <n>    # 并发上限
niceeval exp compare --timeout <ms>           # 单 eval 超时
niceeval exp compare --force                  # 忽略指纹缓存,全量重跑
niceeval exp compare --tag <tag>              # 按单个标签过滤
```

不带 `--force` 时,续跑携带的基线是跨全部历史 run、每 `(experimentId, evalId)` 取最新一份(`src/view/loader.ts` 的 `loadLatestResultsPerEval`):上次 passed 且 fingerprint 匹配的直接携入新 summary,只真跑失败/errored/缺失的。所以「补齐一组实验」就是重跑 `niceeval exp <组>` 本身。注意带 eval-id 位置参数时,summary 只含本次计划内的 eval——补跑别用位置参数,否则产出部分快照(见 memory 的 rerun-with-eval-filter-partial-snapshot)。

## 评分与退出

```sh
niceeval exp compare --strict     # soft 低于阈值也判红(CI 用)
niceeval exp compare --budget <usd>           # 整轮估算成本上限,累计超了就停止派发新 attempt
```

沙箱型里跑什么校验命令、跑不跑,是 `test(t)` 里的普通代码:`t.sandbox.runCommand` 跑命令,`t.check(result, commandSucceeded())` 断言退出码。

退出码按 **eval 级折叠**判定(与报表/view 同一口径,`foldEvalOutcome`:任一 attempt 通过 → 该 eval 通过,对齐 `runs`+`earlyExit` 吸收抖动的语义):折叠后仍有 `failed`(含 `--strict` 下 soft 未达标而改判的)或 `errored` 的 eval → 非零;全部 eval `passed` / `skipped` 时返回 `0`。注意 `summary.json` 顶层的 `passed/failed/errored` 是 attempt 级原始计数,消费方判"全绿"要自行按 eval 折叠。`failed` 与 `errored` 在报告里分开统计。

每个 eval 的 token 用量与估算成本会出现在控制台和 `summary.json`,跨 agent 对比即得「质量 × 成本」。详见 [Observability](observability.md#用量与成本token--计费)。

## 查看结果

```sh
niceeval view                         # 起本地 web,自动打开浏览器,读 .niceeval/
niceeval view .niceeval/<run>/summary.json
niceeval view --port 4317             # 固定端口;被占用时向后找可用端口
niceeval view --no-open               # 只启动服务并打印 URL(适合远端 shell / CI)
niceeval view --out site              # 目录式静态导出,不启动服务(index.html + 查看器工件)
niceeval clean                        # 清掉这些历史运行结果
```

每次 `exp` 运行会写 `.niceeval/<timestamp>/summary.json` 与 attempt 级 JSON 工件;`view` 启动本地服务后默认用系统浏览器打开 URL,并直接读这些结构化工件。当前查看器先提供 Next.js evals 风格的密集榜单:按 experiment 聚合、可排序、可搜索、可展开看单个 eval attempt 的断言/错误/用量。结果保存格式见 [Results Format](results-format.md)。

## 输出

```sh
niceeval exp compare --junit <path>           # 写 JUnit XML
niceeval exp compare --quiet                  # 只出最终汇总
```

## 干跑

```sh
niceeval exp compare --dry        # 只发现、不真正调用 agent / LLM
```

`--dry` 用来检查发现和过滤是否如预期,不烧 token。

## 环境变量

```sh
# agent 的 API key(按 adapter 决定读哪个)
ANTHROPIC_API_KEY=sk-ant-...        # claude-code / 直连
OPENAI_API_KEY=sk-...               # codex / 直连
BUB_API_KEY=...                     # bub
AI_GATEWAY_API_KEY=...              # 经网关的变体

# 沙箱后端认证(auto 探测用)
VERCEL_API_TOKEN=...                # 用 vercel sandbox
VERCEL_TEAM_ID=...                  # Vercel team
# 都没有 → 自动用本地 docker

# 评判模型(LLM-as-judge)
# 复用上面对应 vendor 的 key,或在 config 里单独指定
NICEEVAL_JUDGE_MODEL=...            # config / eval 未指定 judge.model 时的兜底(没有内置默认模型)

# 调度项(标志 > 环境变量 > config > 内置默认,见下节)
NICEEVAL_RUNS=3                     # 对应 --runs
NICEEVAL_MAX_CONCURRENCY=4          # 对应 --max-concurrency
NICEEVAL_TIMEOUT=600000             # 对应 --timeout(毫秒)
NICEEVAL_BUDGET=5                   # 对应 --budget(美元)

# CLI 输出语言
NICEEVAL_LANG=en                    # en / zh-CN;覆盖系统 locale
NICEEVAL_LOCALE=zh-CN               # NICEEVAL_LANG 未设置时生效
```

CLI 文案默认跟随 `NICEEVAL_LANG` / `NICEEVAL_LOCALE`、`LC_ALL` / `LC_MESSAGES` / `LANG`。检测到 `zh` 使用 `zh-CN`,检测到其它语言使用 `en`;都没有时默认 `zh-CN`。这只影响 CLI / runtime 输出,不改变 eval 结果里的机器字段,也不翻译 LLM judge prompt。

## 配置优先级

同一项调度配置的覆盖顺序(高 → 低):

```text
CLI 标志  →  环境变量  →  niceeval.config.ts  →  内置默认
```

例:`--max-concurrency 4` 压过 config 里的 `maxConcurrency: 8`。agent / model / flags 不走 CLI 覆盖,复制 experiment 文件修改。

## 典型用法

下面每行都先选 experiment,再可选 eval id 前缀:

```sh
# 本地开发:零云依赖评一个 coding agent
ANTHROPIC_API_KEY=sk-ant-... niceeval exp local fixtures/

# 衡量稳定性:跑 10 次看通过率,不早停
niceeval exp local fixtures/button --runs 10 --no-early-exit

# 评已部署服务的会话质量(URL 是 agent / experiment 私事)
niceeval exp prod-smoke weather billing

# CI:严格模式 + JUnit
niceeval exp ci --strict --junit .niceeval/junit.xml

# 只看会发现什么,不烧钱
niceeval exp compare --dry
```

## 相关阅读

- [Getting Started](getting-started.md) —— 从安装到第一次运行。
- [Runner](runner.md) —— 这些标志背后的调度语义。
- [Config](concepts.md#配置词汇) —— `niceeval.config.ts` 字段。
