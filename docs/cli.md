# CLI 参考

`fasteval` 的命令行。设计目标:运行配置可签入、可复现;真正执行 eval 时必须通过 `experiments/` 里的 experiment。

> 设计阶段文档,描述目标 CLI 形状。

## 两类参数:`exp` 选择「怎么跑」,后续位置参数筛「哪些 eval」

执行 eval 时先选 experiment,再可选地用 eval id 前缀缩小范围:

- `fasteval exp [组|配置]` = 跑**哪个运行配置**。agent、model、flags、runs、预算等都来自 experiment 文件。
- `fasteval exp [组|配置] [eval id 前缀...]` = 在该 experiment 下只跑部分 eval。这个位置参数只筛 eval,不是 agent 名、URL 或模型。
- flags 只做调度级临时覆盖,例如 `--runs`、`--sandbox`、`--max-concurrency`、`--timeout`。`--agent` / `--model` 不覆盖 experiment;要换 agent 或 model,新增或复制一个 experiment 文件。

```sh
fasteval exp <实验组|配置> <选哪些 eval> <flag:调度覆盖>
#             └怎么跑┘       └eval filter┘   └可选覆盖┘
```

裸 `fasteval weather` 不会运行;要写成 `fasteval exp local weather` 或 `fasteval exp compare weather`。这样结果始终带 experiment 身份,能复现也能在 `fasteval view` 里按配置对比。

## 命令

```sh
fasteval exp [组|配置] [pattern...]  # 跑实验:全部 / 一组 / 单个配置;可再用 eval id 前缀过滤
fasteval init                # 生成 evals/ 与 fasteval.config.ts
fasteval list                # 只列出发现到的 eval,不运行
fasteval clean               # 删除 .fasteval/ 历史运行工件
fasteval watch               # 监听文件变化,改即重跑(规划中)
fasteval view [结果目录|summary.json]  # 起本地 web 查看器并打开浏览器,读 .fasteval/ 历史运行出图
```

实验 = 可签入的运行配置(哪个 agent/几次/预算)。**一文件一配置,一文件夹一组可对比实验**(`fasteval exp <组>` 跑整组)。详见 [Experiments](experiments.md)。

`pattern` 是 `exp` 命令后的 eval id 前缀过滤,可多个。匹配规则:`id === pattern` 或 `id` 以 `pattern + "/"` 开头(精确或目录前缀):

```sh
fasteval exp                 # 跑 experiments/ 下全部实验
fasteval exp local weather   # 在 local 实验里跑 weather 或 weather/*
fasteval exp local weather/brooklyn  # 在 local 实验里跑单个 eval
fasteval exp compare fixtures/ billing/  # 在 compare 组里跑多个前缀,并集
```

## 选择被测对象(agent,写进 experiment)

```sh
fasteval exp <组|配置>             # agent / model 来自 experiments/<组|配置>.ts
fasteval --sandbox <backend>      # docker / vercel / auto / <三方>(沙箱型 agent 在哪跑)
```

agent、model、feature flags 属于 experiment,不是临时 CLI flag。要连你自己的服务,写一个 agent adapter,再在 experiment 里引用它;URL 和鉴权是 adapter / experiment 的私有配置,不是位置参数。

## 调度

```sh
fasteval exp compare --runs <n>               # 临时覆盖每个 eval 的 runs
fasteval exp compare --early-exit             # 先过一次即停其余(默认开)
fasteval exp compare --no-early-exit          # 关掉,要完整通过率分布
fasteval exp compare --max-concurrency <n>    # 并发上限
fasteval exp compare --timeout <ms>           # 单 eval 超时
fasteval exp compare --force                  # 忽略指纹缓存,全量重跑
fasteval exp compare --tag <tag>              # 按标签过滤(可重复)
```

## 评分与退出

```sh
fasteval exp compare --strict     # soft 低于阈值也判红(CI 用)
fasteval exp compare --budget <usd>           # 整轮估算成本上限,累计超了就停止派发新 attempt
```

沙箱型里跑什么校验命令、跑不跑,是 `test(t)` 里的普通代码:`t.sandbox.runCommand` 跑命令,`t.check(result, commandSucceeded())` 断言退出码。

退出码:有 `outcome=failed`(含 `--strict` 下 soft 未达标而改判的)→ 非零;否则 `0`。

每个 eval 的 token 用量与估算成本会出现在控制台和 `summary.json`,跨 agent 对比即得「质量 × 成本」。详见 [Observability](observability.md#用量与成本token--计费)。

## 查看结果

```sh
fasteval view                         # 起本地 web,自动打开浏览器,读 .fasteval/
fasteval view .fasteval/<run>/summary.json
fasteval view --port 4317             # 固定端口;被占用时向后找可用端口
fasteval view --no-open               # 只启动服务并打印 URL(适合远端 shell / CI)
fasteval view --out .fasteval/report.html  # 导出静态 HTML,不启动服务
fasteval clean                        # 清掉这些历史运行结果
```

每次 `exp` 运行会写 `.fasteval/<timestamp>/summary.json` 与 `results.jsonl`;`view` 启动本地服务后默认用系统浏览器打开 URL,并直接读这些结构化工件。当前查看器先提供 Next.js evals 风格的密集榜单:按 experiment 聚合、可排序、可搜索、可展开看单个 eval attempt 的断言/错误/用量。

## 输出

```sh
fasteval exp compare --json                   # 机器可读结果到 stdout
fasteval exp compare --junit <path>           # 写 JUnit XML
fasteval exp compare --verbose                # 流式打印 t.log
fasteval exp compare --quiet                  # 只出最终汇总
fasteval exp compare --no-report              # 跳过报告器
fasteval exp compare --copy-files <mode>      # none | changed | all,把生成文件拷进工件
```

## 干跑与冒烟

```sh
fasteval exp compare --dry        # 只发现、不真正调用 agent / LLM
fasteval exp compare --smoke      # 最小冒烟:验证 agent / sandbox / key 配好了
```

`--dry` 用来检查发现和过滤是否如预期,不烧 token;`--smoke` 用来在长跑前确认环境通了。

## 环境变量

```sh
# agent 的 API key(按 adapter 决定读哪个)
ANTHROPIC_API_KEY=sk-ant-...        # claude-code / 直连
OPENAI_API_KEY=sk-...               # codex / 直连
BUB_API_KEY=...                     # bub
AI_GATEWAY_API_KEY=...              # 经网关的变体

# 沙箱后端认证(auto 探测用)
VERCEL_TOKEN=...                    # 用 vercel sandbox
VERCEL_OIDC_TOKEN=...               # CI/CD OIDC
# 都没有 → 自动用本地 docker

# 评判模型(LLM-as-judge)
# 复用上面对应 vendor 的 key,或在 config 里单独指定

# CLI 输出语言
FASTEVAL_LANG=en                    # en / zh-CN;覆盖系统 locale
FASTEVAL_LOCALE=zh-CN               # FASTEVAL_LANG 未设置时生效
```

CLI 文案默认跟随 `FASTEVAL_LANG` / `FASTEVAL_LOCALE`、`LC_ALL` / `LC_MESSAGES` / `LANG`。检测到 `zh` 使用 `zh-CN`,检测到其它语言使用 `en`;都没有时默认 `zh-CN`。这只影响 CLI / runtime 输出,不改变 eval 结果里的机器字段,也不翻译 LLM judge prompt。

## 配置优先级

同一项调度配置的覆盖顺序(高 → 低):

```text
CLI 标志  →  环境变量  →  fasteval.config.ts  →  内置默认
```

例:`--max-concurrency 4` 压过 config 里的 `maxConcurrency: 8`。agent / model / flags 不走 CLI 覆盖,复制 experiment 文件修改。

## 典型用法

下面每行都先选 experiment,再可选 eval id 前缀:

```sh
# 本地开发:零云依赖评一个 coding agent
ANTHROPIC_API_KEY=sk-ant-... fasteval exp local fixtures/

# 衡量稳定性:跑 10 次看通过率,不早停
fasteval exp local fixtures/button --runs 10 --no-early-exit

# 评已部署服务的会话质量(URL 是 agent / experiment 私事)
fasteval exp prod-smoke weather billing

# CI:严格模式 + JUnit
fasteval exp ci --strict --junit .fasteval/junit.xml

# 只看会发现什么,不烧钱
fasteval exp compare --dry
```

## 相关阅读

- [Getting Started](getting-started.md) —— 从安装到第一次运行。
- [Runner](runner.md) —— 这些标志背后的调度语义。
- [Config](concepts.md#配置词汇) —— `fasteval.config.ts` 字段。
