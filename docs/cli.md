# CLI 参考

`fastevals` 的命令行。设计目标:零配置能跑(`npx fastevals` 发现并运行一切),需要时每个调度行为都有标志可调。

> 设计阶段文档,描述目标 CLI 形状。

## 两类参数:位置参数选「哪些」,flag 选「怎么跑」

整个 CLI 只有两类输入,分清它们就不会困惑:

- **位置参数** = 跑**哪些** eval。它是 **eval id 前缀过滤器**,从 `evals/<路径>.eval.ts` 推导的 id 上做前缀匹配。**它不是 agent 名、也不是怎么跑的 flag。**
- **flag** = **怎么**跑、对着**哪个** agent 跑(`--agent` / `--sandbox`、并发、超时…)。

```sh
fastevals  <选哪些 eval>  <flag:对着哪个 agent / 怎么跑>
#          └ 位置参数 ┘   └────────────── flag ──────────────┘
```

`weather` 和 `fixtures/` 都是位置参数(id 前缀),是**同一种东西**;它们配不同的 flag,只是因为这两批 eval 用的 agent 种类不同,跟位置参数无关。

## 命令

```sh
fastevals [pattern...]        # 发现并运行(默认命令)
fastevals exp [组|配置]        # 跑实验:全部 / 一组(文件夹,互为对照)/ 单个配置(见 experiments.md)
fastevals init                # 生成 evals/ 与 fastevals.config.ts
fastevals list                # 只列出发现到的 eval,不运行
fastevals watch               # 监听文件变化,改即重跑(= run --watch)
fastevals view [结果目录|summary.json]  # 起本地 web 查看器,读 .fastevals/ 历史运行出图
```

实验 = 可签入的运行配置(哪些 agent/几次/预算)。**一文件一配置,一文件夹一组可对比实验**(`fastevals exp <组>` 跑整组);单文件内也可用 `agent: [...]` 数组随手扇出。详见 [Experiments](experiments.md)。

`pattern`(位置参数)是 id 前缀过滤,可多个。匹配规则:`id === pattern` 或 `id` 以 `pattern + "/"` 开头(精确或目录前缀):

```sh
fastevals                     # 全部
fastevals weather             # id 为 weather 或以 weather/ 开头(weather/*)
fastevals weather/brooklyn    # 单个
fastevals fixtures/ billing/  # 多个前缀,并集
```

## 选择被测对象(agent,用 flag)

```sh
fastevals --agent <name>           # 按名字选一个 agent(自实现的 / 内置的 claude-code、bub、codex …)
fastevals --sandbox <backend>      # docker / vercel / auto / <三方>(沙箱型 agent 在哪跑)
fastevals --model <tier>           # 覆盖 agent 模型(opus / vendor/model?reasoningEffort=high)
fastevals --model-policy <p>       # agent-default | fastevals-default
```

`--agent` 是选连接的**唯一** flag,覆盖 eval 里没写死 `agent` 时的默认连接,让同一批 eval 换着对象跑。要连你自己的服务,写一个 agent 让它读 env / config,而不是从 CLI 传 url。

## 调度

```sh
fastevals --runs <n>               # 每个 eval 跑 n 次取通过率(默认 1)
fastevals --early-exit             # 先过一次即停其余(默认开)
fastevals --no-early-exit          # 关掉,要完整通过率分布
fastevals --max-concurrency <n>    # 并发上限
fastevals --timeout <ms>           # 单 eval 超时
fastevals --force                  # 忽略指纹缓存,全量重跑
fastevals --tag <tag>              # 按标签过滤(可重复)
```

## 评分与退出

```sh
fastevals --strict                 # soft 低于阈值也判红(CI 用)
fastevals --validation <mode>      # vitest | none(沙箱型)
fastevals --scripts build,lint     # 沙箱型额外要跑的 npm scripts
fastevals --budget <usd>           # 整轮估算成本上限,累计超了就停止派发新 attempt
```

退出码:有 `failed` → 非零;`--strict` 下有 `scored` → 也非零;否则 `0`。

每个 eval 的 token 用量与估算成本会出现在控制台和 `summary.json`,跨 agent 对比即得「质量 × 成本」。详见 [Observability](observability.md#用量与成本token--计费)。

## 查看结果

```sh
fastevals view                         # 起本地 web,读 .fastevals/
fastevals view .fastevals/<run>/summary.json
fastevals view --port 4317             # 固定端口;被占用时向后找可用端口
fastevals view --out .fastevals/report.html  # 导出静态 HTML,不启动服务
```

默认运行会写 `.fastevals/<timestamp>/summary.json` 与 `results.jsonl`;`view` 直接读这些结构化工件。当前查看器先提供 Next.js evals 风格的密集榜单:按 agent/model 聚合、可排序、可搜索、可展开看单个 eval attempt 的断言/错误/用量。

## 输出

```sh
fastevals --json                   # 机器可读结果到 stdout
fastevals --junit <path>           # 写 JUnit XML
fastevals --verbose                # 流式打印 t.log
fastevals --quiet                  # 只出最终汇总
fastevals --no-report              # 跳过报告器
fastevals --copy-files <mode>      # none | changed | all,把生成文件拷进工件
```

## 干跑与冒烟

```sh
fastevals --dry                    # 只发现、不真正调用 agent / LLM
fastevals --smoke                  # 最小冒烟:验证 agent / sandbox / key 配好了
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
```

## 配置优先级

同一项配置的覆盖顺序(高 → 低):

```text
CLI 标志  →  环境变量  →  fastevals.config.ts  →  内置默认
```

例:`--max-concurrency 4` 压过 config 里的 `maxConcurrency: 8`。

## 典型用法

位置参数和 flag 顺序无所谓,下面每行末尾标出哪个是位置参数(选哪些 eval):

```sh
# 本地开发:零云依赖评一个 coding agent       位置参数: fixtures/
ANTHROPIC_API_KEY=sk-ant-... fastevals --agent claude-code --sandbox docker fixtures/

# 衡量稳定性:跑 10 次看通过率,不早停        位置参数: fixtures/button
fastevals --agent claude-code --runs 10 --no-early-exit fixtures/button

# 评已部署服务的会话质量(URL 是 agent 私事) 位置参数: weather billing
AGENT_URL=https://agent.example.com fastevals --agent weather-bot weather billing

# CI:严格模式 + JUnit(无位置参数 = 跑全部)
fastevals --strict --junit .fastevals/junit.xml

# 只看会发现什么,不烧钱
fastevals --dry --list
```

## 相关阅读

- [Getting Started](getting-started.md) —— 从安装到第一次运行。
- [Runner](runner.md) —— 这些标志背后的调度语义。
- [Config](concepts.md#配置词汇) —— `fastevals.config.ts` 字段。
