# Getting Started

这一页从一个 Eval 运行到可查看、可分享的 Report。完整 API 见 [Eval](feature/eval/README.md)、[Experiments](feature/experiments/README.md) 与 [Reports](feature/reports/README.md)。

## 安装

~~~sh
pnpm add -D niceeval
pnpm exec niceeval init
~~~

<code>init</code> 创建项目入口和配置示例。使用 TypeScript 的项目建议采用 ESM；CLI 可以装载 ESM 或 CommonJS 宿主下的 TypeScript 文件。

## 写一个 Eval

在 <code>evals/greeting.ts</code> 中定义一次检查：

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

值、行为、Sandbox 和 Judge 检查都会形成 Attempt-local assertion 数据。断言无法取得必需材料时显示为 <code>unavailable</code>，不会按通过或零分处理。

## 选择运行配置

Experiment 选择 Eval、Agent 和本次调度条件。把配置放在 <code>experiments/</code>，再运行：

~~~sh
pnpm exec niceeval exp
~~~

每个选中的 Experiment 建立一个 Run。Run 的 expected slots 是本次分母；每个 slot 最终采用 executed、carried 或 accepted Attempt。

命令结束时显示 Invocation receipt，其中包含 <code>runIds</code>。receipt 很小：详细的 Verdict、用量、计时、conversation 和 diff 都在停稳 Record 中。

## 查看一次运行

~~~sh
pnpm exec niceeval show --run <run-id>
pnpm exec niceeval view --run <run-id>
~~~

默认 Record root 为 <code>&lt;project&gt;/.niceeval/record/</code>。<code>show</code> 和 <code>view</code> 通过 Record reader、normalizer、Sample 和 ReportInput 读取它。它们不从目录时间猜测“最近结果”，也不在浏览器内读取 Record 文件。

若要选择每个 Experiment 最后完成的 Run，使用：

~~~sh
pnpm exec niceeval show --latest
~~~

<code>--latest</code> 只考虑带 <code>completedAt</code> 的 Run。没有完成 Run 时，改用明确的 <code>--run</code>。

## 读懂状态

Sample 保留完整分母。样本状态（Sample slot state）说明每个 slot 是下列哪一种：

| 状态 | 含义 |
|---|---|
| <code>included</code> | 有合法 Member，能读取其采用的 Attempt。 |
| <code>not-recorded</code> | expected slot 没有 Member。 |
| <code>invalid</code> | Member、Attempt 或引用违反核心规则。 |
| <code>excluded</code> | 选择器在既有 Sample 上排除了该 slot。 |

通道状态与 slot 状态分开。页面需要的 channel 若未采集，会显示 <code>unavailable</code>；当前 reader 不支持时显示 <code>unsupported</code>；损坏时显示具名 issue。

## 编辑与再次查看

Record 是可人工编辑的事实数据集。停止 session 与 active reader 后，可以修改 Attempt-owned channel 数据；下一次 analysis projector 和 Report 会读取新值。export 只在 Record 读取/build 阶段持有 reader，释放后的执行和写站不访问 Record。

不要在 writer 或 reader lease 存续时编辑目录。Record 不保存编辑事务、历史副本或全局格式整数。

## 导出静态报告站

~~~sh
pnpm exec niceeval view --run <run-id> --out ./report-site
~~~

export 包含页面、组件宿主数据、精确 runtime、下载项和资源。生成后的站点可离线打开，不需要源 Record 或之后安装 NiceEval。

## 接进 CI

在 CI 中运行同一条 <code>niceeval exp</code> 命令。进程退出状态结合 Invocation completion 和 Verdict；机器调用方可使用 <code>--json</code> 获取当前进程反馈与最后的 receipt，再按 <code>runIds</code> 读取需要的事实。

## 接着读

- [Record](feature/record/README.md)
- [Sample](feature/sample/README.md)
- [Reports CLI](feature/reports/README.md)
- [缓存与携带](feature/experiments/cache.md)
- [Assertions](feature/assertions/README.md)
