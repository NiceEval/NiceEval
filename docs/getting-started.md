# Getting Started

这一页从一个 Eval 运行到可审阅、可搬运的 canonical Record。完整 API 见 [Eval](feature/eval/README.md)、[Experiments](feature/experiments/README.md)、[Inspection](feature/inspection/README.md) 与 [Insight](feature/insight/README.md)。

## 安装

~~~sh
pnpm add -D niceeval
pnpm exec niceeval init
~~~

`init` 创建项目入口和配置示例。使用 TypeScript 的项目建议采用 ESM；CLI 可以装载 ESM 或 CommonJS 宿主下的 TypeScript 文件。

## 写一个 Eval

在 `evals/greeting.ts` 中定义一次检查：

~~~ts
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  async test(t) {
    const turn = await t.send("用一句话介绍 NiceEval");
    t.check(turn.message, includes("NiceEval"));
  },
});
~~~

值、行为、Sandbox 和 Judge 检查都会形成 Attempt-local assertion 数据。断言无法取得必需材料时显示为 `unavailable`，不会按通过或零分处理。

## 选择运行配置

Experiment 选择 Eval、Agent 和本次调度条件。把配置放在 `experiments/`，再运行：

~~~sh
pnpm exec niceeval exp
~~~

每个选中的 Experiment 建立一个 Run。Run 的 expected slots 是本次分母；每个 slot 最终连接到精确 Attempt：实际执行形成 origin，沿用或显式采用形成 reference。

命令结束时显示 Invocation receipt，其中包含 `createdRunIds` 与 `publicationCutoff`。receipt 很小：详细的 Verdict、用量、计时、conversation 和 diff 都在 Record 中。

## 查看一次运行

~~~sh
pnpm exec niceeval view --run <run-id>
~~~

项目内唯一 canonical Record 是 `<project>/.niceeval/record.sqlite`。Run 创建和每个已发布 Attempt 都立即进入它，不等待
Run 收口。不要读取其中的内部结构，也不要从应用代码 import Record reader / writer。`view` 由内部 source adapter 和
Inspection operations 读取它，不从文件时间猜测“最近结果”。

要让 AI 或自动化发现可查询的已封口事实，使用：

~~~sh
pnpm exec niceeval query discover
~~~

不带 selector 的 `view` 打开默认 overview。`query discover` 先返回 compact bootstrap；再以 operation request 查询 sealed facts。旧结果不会被删除；需要查看精确历史时使用 receipt 中的 `--run` 或 locator。

## 读懂状态

Inspection operation 保留 selection 已建立的完整分母：`--run` 使用具名 Run 的完整 expected slots，默认 selection 只把身份仍
匹配当前目标的 slots 纳入结果。selection audit 说明每个已选 slot 是下列哪一种：

| 状态 | 含义 |
|---|---|
| `included` | 有合法 Member，能读取其采用的 Attempt。 |
| `not-recorded` | expected slot 没有 Member。 |
| `invalid` | Member、Attempt 或引用违反核心规则。 |
| `excluded` | Inspection selector 在既有 Run 上排除了该 slot。 |

Attachment 状态与 slot 状态分开。页面需要的 Attachment 若未采集，会显示 `unavailable`；当前 reader 不支持时显示 `unsupported`；损坏时显示具名 issue。

## 编辑与再次查看

Record 是已发布 Run facts 的持久事实集。`query` 与 `view` 使用短 reader 读取固定 cutoff，可以和 writer 并发，也能读取
`active` Run 与已经 publication 的 Attempt。

每个 query result 在关闭 reader 后不再访问 Record。Insight 只保留一个完整 private generation；需要不同事实时发布新 Run
或在 View 中确认 refresh。

canonical database 只由 Host 修改。不要手工编辑或拼接 SQLite main/WAL 文件。受控 CLI 退出会自动关闭 writer、truncate WAL
并以内建只读路径验证；成功后 `.niceeval/record.sqlite` 自身就是可搬运 artifact。

## 分享封口事实

~~~sh
cp .niceeval/record.sqlite ./release.record.sqlite
pnpm exec niceeval view --record ./release.record.sqlite
~~~

只复制一次受控 CLI 成功退出后的 canonical 文件，不复制运行中的 WAL 或 private staging。接收方把外部文件作为 hostile import：
current NiceEval 会在只读打开时验证精确 schema、SQLite 完整性和领域不变量；旧 schema 或损坏文件会整体拒绝，并要求原项目
用 current NiceEval 重新运行。这个 artifact 不承诺业务脱敏。

## 接进 CI

在 CI 中运行同一条 `niceeval exp` 命令。进程退出状态结合 Invocation completion 和 Verdict；
机器调用方使用 `query` 的 `niceeval.query/v1` document 读取已停稳结果，不打开 Record 私有文件或 reader API。

## 接着读

- [Record](feature/run/README.md)
- [Inspection](feature/inspection/README.md)
- [Insight](feature/insight/README.md)
- [缓存与携带](feature/experiments/cache.md)
- [Assertions](feature/assertions/README.md)
