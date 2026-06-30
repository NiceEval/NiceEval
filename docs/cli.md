# CLI 参考

`fasteval` 的命令行。设计目标:零配置能跑(`npx fasteval` 发现并运行一切),需要时每个调度行为都有标志可调。

> 设计阶段文档,描述目标 CLI 形状。

## 两类参数:位置参数选「哪些」,flag 选「怎么跑」

整个 CLI 只有两类输入,分清它们就不会困惑:

- **位置参数** = 跑**哪些** eval。它是 **eval id 前缀过滤器**,从 `evals/<路径>.eval.ts` 推导的 id 上做前缀匹配。**它不是 agent 名、也不是怎么跑的 flag。**
- **flag** = **怎么**跑、对着**哪个** agent 跑(`--agent` / `--sandbox`、并发、超时…)。

```sh
fasteval  <选哪些 eval>  <flag:对着哪个 agent / 怎么跑>
#          └ 位置参数 ┘   └────────────── flag ──────────────┘
```

`weather` 和 `fixtures/` 都是位置参数(id 前缀),是**同一种东西**;它们配不同的 flag,只是因为这两批 eval 用的 agent 种类不同,跟位置参数无关。

## 命令

```sh
fasteval [pattern...]        # 发现并运行(默认命令)
fasteval exp [组|配置]        # 跑实验:全部 / 一组(文件夹,互为对照)/ 单个配置(见 experiments.md)
fasteval init                # 生成 evals/ 与 fasteval.config.ts
fasteval list                # 只列出发现到的 eval,不运行
fasteval clean               # 删除 .fasteval/ 历史运行工件
fasteval watch               # 监听文件变化,改即重跑(= run --watch)
fasteval view [结果目录|summary.json]  # 起本地 web 查看器并打开浏览器,读 .fasteval/ 历史运行出图
```

实验 = 可签入的运行配置(哪些 agent/几次/预算)。**一文件一配置,一文件夹一组可对比实验**(`fasteval exp <组>` 跑整组);单文件内也可用 `agent: [...]` 数组随手扇出。详见 [Experiments](experiments.md)。

`pattern`(位置参数)是 id 前缀过滤,可多个。匹配规则:`id === pattern` 或 `id` 以 `pattern + "/"` 开头(精确或目录前缀):

```sh
fasteval                     # 全部
fasteval weather             # id 为 weather 或以 weather/ 开头(weather/*)
fasteval weather/brooklyn    # 单个
fasteval fixtures/ billing/  # 多个前缀,并集
```

## 选择被测对象(agent,用 flag)

```sh
fasteval --agent <name>           # 按名字选一个 agent(自实现的 / 内置的 claude-code、bub、codex …)
fasteval --sandbox <backend>      # docker / vercel / auto / <三方>(沙箱型 agent 在哪跑)
fasteval --model <tier>           # 覆盖 agent 模型(opus / vendor/model?reasoningEffort=high)
fasteval --model-policy <p>       # agent-default | fasteval-default
```

`--agent` 是选连接的**唯一** flag,覆盖 eval 里没写死 `agent` 时的默认连接,让同一批 eval 换着对象跑。要连你自己的服务,写一个 agent 让它读 env / config,而不是从 CLI 传 url。

## 调度

```sh
fasteval --runs <n>               # 每个 eval 跑 n 次取通过率(默认 1)
fasteval --early-exit             # 先过一次即停其余(默认开)
fasteval --no-early-exit          # 关掉,要完整通过率分布
fasteval --max-concurrency <n>    # 并发上限
fasteval --timeout <ms>           # 单 eval 超时
fasteval --force                  # 忽略指纹缓存,全量重跑
fasteval --tag <tag>              # 按标签过滤(可重复)
```

## 评分与退出

```sh
fasteval --strict                 # soft 低于阈值也判红(CI 用)
fasteval --validation <mode>      # vitest | none(沙箱型)
fasteval --scripts build,lint     # 沙箱型额外要跑的 npm scripts
fasteval --budget <usd>           # 整轮估算成本上限,累计超了就停止派发新 attempt
```

退出码:有 `failed` → 非零;`--strict` 下有 `scored` → 也非零;否则 `0`。

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

默认运行会写 `.fasteval/<timestamp>/summary.json` 与 `results.jsonl`;`view` 启动本地服务后默认用系统浏览器打开 URL,并直接读这些结构化工件。当前查看器先提供 Next.js evals 风格的密集榜单:按 experiment 聚合、可排序、可搜索、可展开看单个 eval attempt 的断言/错误/用量。

## 输出

```sh
fasteval --json                   # 机器可读结果到 stdout
fasteval --junit <path>           # 写 JUnit XML
fasteval --verbose                # 流式打印 t.log
fasteval --quiet                  # 只出最终汇总
fasteval --no-report              # 跳过报告器
fasteval --copy-files <mode>      # none | changed | all,把生成文件拷进工件
```

## 干跑与冒烟

```sh
fasteval --dry                    # 只发现、不真正调用 agent / LLM
fasteval --smoke                  # 最小冒烟:验证 agent / sandbox / key 配好了
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

同一项配置的覆盖顺序(高 → 低):

```text
CLI 标志  →  环境变量  →  fasteval.config.ts  →  内置默认
```

例:`--max-concurrency 4` 压过 config 里的 `maxConcurrency: 8`。

## 典型用法

位置参数和 flag 顺序无所谓,下面每行末尾标出哪个是位置参数(选哪些 eval):

```sh
# 本地开发:零云依赖评一个 coding agent       位置参数: fixtures/
ANTHROPIC_API_KEY=sk-ant-... fasteval --agent claude-code --sandbox docker fixtures/

# 衡量稳定性:跑 10 次看通过率,不早停        位置参数: fixtures/button
fasteval --agent claude-code --runs 10 --no-early-exit fixtures/button

# 评已部署服务的会话质量(URL 是 agent 私事) 位置参数: weather billing
AGENT_URL=https://agent.example.com fasteval --agent weather-bot weather billing

# CI:严格模式 + JUnit(无位置参数 = 跑全部)
fasteval --strict --junit .fasteval/junit.xml

# 只看会发现什么,不烧钱
fasteval --dry --list
```

## 相关阅读

- [Getting Started](getting-started.md) —— 从安装到第一次运行。
- [Runner](runner.md) —— 这些标志背后的调度语义。
- [Config](concepts.md#配置词汇) —— `fasteval.config.ts` 字段。
