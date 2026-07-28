# 默认政策：证明优先还是复用优先

本页只比较用户心智，不比较 hash 算法。
两套候选都生成同一份 `ReconciliationPlan`，计划列出每个 Evidence 槽位的状态与原因。
分歧只发生在系统无法证明相同、也没有观察到变化时。

## 模型 A：证明优先

一句话规则：

> 只有能证明仍满足当前 Requirement 的 Evidence 才沿用；未知默认派发。

| 计划状态 | 默认动作 |
|---|---|
| manifest 相同且资格门通过 | 沿用 |
| 已观察到相关 delta | 派发 |
| 依赖为 opaque | 派发 |
| Evidence 缺失或不是可信终态 | 派发 |
| 精确原因已有人工授权 | 沿用并记录授权 |

### 用户怎样放宽

用户先从计划中选择一个精确原因，再授权本次沿用：

```bash
niceeval exp compare/codex --accept source:evals/share/prompts.ts
niceeval exp compare/codex --accept condition:flags.webSearch
niceeval exp compare/codex --accept sandbox:recipe
niceeval exp compare/codex --accept opaque:resource.memory-corpus
```

授权只覆盖当前计划中与 selector 匹配的 old → new delta 或 opaque 原因。
同一路径、字段或资源下一次出现新变化时，不自动通过。

### 优点与风险

- 漏声明依赖时倾向多跑，不会静默采信旧结果。
- Hook、动态 import 与外部状态的风险会在日常计划中持续可见。
- observer 短暂失败可能导致昂贵重跑。
- 用户为了格式变化、已知稳定的外部资源或开发期 Hook 需要频繁授权。

## 模型 B：复用优先

一句话规则：

> 已观察到相关变化才使 Evidence 失效；未知默认沿用并标注未证明。

| 计划状态 | 默认动作 |
|---|---|
| manifest 相同且资格门通过 | 沿用 |
| 已观察到相关 delta | 派发 |
| 依赖为 opaque | 沿用并标注 unverified |
| Evidence 缺失或不是可信终态 | 派发 |
| 用户要求复验 | 派发 |

### 用户怎样收紧

用户可以按 verdict、Eval 或依赖原因要求本次重跑：

```bash
niceeval exp compare/codex --rerun failed
niceeval exp compare/codex --rerun eval:memory/recall
niceeval exp compare/codex --rerun resource:memory-corpus
niceeval exp compare/codex --rerun sandbox:setup
niceeval exp compare/codex --rerun all
```

`--rerun` 只改变当前 Invocation。
长期需要重跑的维度应补成 condition、resource identity 或声明式 recipe，不能依赖操作者每次记得加 flag。

### 优点与风险

- 接近当前“指纹没变就沿用”的成本与速度。
- observer 故障和暂时不可解析的依赖不会造成重跑风暴。
- 漏声明依赖会静默沿用，用户必须知道框架没观测到什么。
- CI 若忘记显式收紧，可能把旧 Evidence 当成当前结论。

## 两套模型都不允许的动作

以下行为不是默认严松之争：

- 缺失 Evidence 不能通过授权凭空产生。
- `errored`、`skipped` 等不可信终态不能变成可沿用 Evidence。
- secret 明文不能进入计划、selector、manifest 或授权记录。
- `--accept path:**` 一类永久 glob ignore 不存在。
- `--rerun` 和 `--accept` 都不能改写 Evidence 的真实执行来源。

## `.env` URL 为什么不能靠默认政策解决

同一个 `NMEM_URL` 变化至少有三种含义：

| 意图 | 正确角色 | 系统观察 |
|---|---|---|
| 新隧道仍通向同一资源 | connection | URL 不进身份；resource identity 未变 |
| URL 指向另一套被测实现 | condition | URL 的安全摘要变化 |
| URL 未知地指向某个可变后端 | connection + opaque resource | 无法证明后端是否相同 |

前两种应由声明解决，不应每轮靠 CLI 猜。
第三种才暴露默认政策的真实分歧：证明优先派发，复用优先沿用并标注 unverified。

## 暂定推荐

本方案暂时推荐产品默认采用**证明优先**，原因是错误沿用会静默改变报告含义，而多跑会显式增加成本。
本推荐不是定稿；选择复用优先时，必须保证 CLI、Run 与报告都持续显示 unverified Evidence，
不能把未知沿用渲染成与 proven Evidence 相同。

不建议让每个 Experiment 自由选择默认政策。
同一仓库混用两套默认会让 `niceeval exp` 的含义随文件变化，CI 也无法从命令本身判断风险方向。
