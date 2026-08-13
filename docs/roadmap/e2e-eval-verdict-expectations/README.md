# Eval E2E Verdict 期望

## 用户需要

Eval 与 Assertion 的确定性 E2E 已经把真正的判分写在 Eval 内，Vitest owner 常只剩下同一组机械工作：

- 运行安装后 candidate 的 `niceeval exp --rerun all --json`；
- 检查进程退出码与 invocation completion；
- 从 NDJSON 中按 `Experiment × Eval` 身份找到终局事件；
- 检查 `passed`、`failed` 或 `errored` Verdict。

这些步骤应当有一个 Repo-local 薄封装。每个 owner 仍保留原生 Vitest 文件、标题、完整 argv 与独立 expected，
但不再重复项目副本、artifact、NDJSON 过滤和唯一性检查。

## 核心心智

Verdict 期望属于一次 E2E 证明，不属于 Eval 产品定义。

同一 Eval 可以被多个 Experiment、Agent、model、flags 或运行条件选择。`passed`、`failed` 与 `errored`
是具体 `Experiment × Eval` 运行坐标的公开结果，不是 Eval 脱离运行条件后恒定的属性。

测试正文使用一个 Repo-local `expectEvalRun()`，显式声明 invocation 与全部预期终局：

```ts
// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-values

import { test } from "vitest";
import { expectEvalRun } from "./support.ts";

test("值 Match Eval 以 passed 终态完成", () =>
  expectEvalRun({
    caseId: "values",
    argv: ["exp", "assertion-values", "--rerun", "all", "--json"],
    exitCode: 0,
    completion: "completed",
    outcomes: [{
      experimentId: "assertion-values",
      evalId: "assertion-values",
      verdict: "passed",
      attempts: 1,
    }],
  }));
```

`expectEvalRun()` 只组合当前 Repo 已有的 `createE2EContext()`、`ProcessReceipt.ndjson<ExpEvent>()`
与原生 Vitest `expect`。它不从 candidate、Eval metadata 或结果 Record 推导 expected。

## 薄封装的职责

`expectEvalRun()` 固定完成以下机械检查：

1. 在该 owner 的独占项目副本中运行调用点给出的逐字 argv；
2. 检查调用点显式给出的 exit code 与 invocation completion；
3. 严格读取 NDJSON，并取得全部带 locator 的 `event: "eval"` 终局事件；
4. 按 `experimentId + evalId` 比较完整 expected 集合，缺少、重复或多出一项都失败；
5. 比较每项的 `verdict` 与 `attempts`；
6. 失败时附上原始 `ProcessReceipt.diagnostic()`；
7. 返回原始 receipt 与 typed events，供 owner 继续写本场景独有的公开结果断言。

它不隐藏以下内容：

- 完整 `niceeval` argv；
- exit code 与 completion；
- Experiment ID、Eval ID、Verdict 与 attempts；
- `failed` / `errored` 场景的具名原因；
- owner 独有的 `show`、JUnit、execution、timing、资源终结或浏览器断言。

一个预期 `errored` 的 owner 不能只以 `verdict: "errored"` 收尾。它还要从返回的原始事件或公开读回中
检查具名 phase、reason、failure fact 或其它能排除“加载失败、Runner 崩溃也算通过”的稳定事实。

## 不把期望注解到 Eval

不新增 `@expectPass()`、`@expectFail()`、`@expectError()`，也不在 `defineEval()` 增加
`expectedVerdict` 或借用 `metadata` 保存 E2E 期望。

原因如下：

- 当前入口是 `export default defineEval({...})` 表达式。TypeScript 不能用 decorator 修饰 export assignment；
  对该形状执行当前编译器的语义检查会得到 `TS1206: Decorators are not valid here`。
- 把语法改成 class 只为获得 decorator 会扭曲 Eval 的函数式作者面。改成
  `expectPass(defineEval({...}))` 则要求测试工具包装或代理带私有品牌且已冻结的 `EvalDefinition`，让 candidate
  discovery 依赖测试设施。
- Eval `metadata` 会落入 Record，并参与 Attempt fingerprint。测试期望进入这里会改变产品 provenance 与复用身份，
  也违反 metadata 只承载 Experiment 谓词或 Reporter 消费的业务维度这一边界。
- 同一 Eval 在不同 Experiment 下可以有不同终局。把期望放在 Eval 上无法表达这一坐标，或会迫使 Eval 复制成多份。
- `expectError` 会把所有 `errored` 根因压成一类；这会让预期的 Judge unavailable 与意外加载错误、进程错误或 cleanup
  错误混在一起。
- 让通用 Vitest 自动扫描 Eval 注解会把 owner、标题、argv 和 expected 从原生测试文件搬进第二套 discovery / registry，
  与现行“真实场景 Repo + 原生结果断言”边界相反。

Vitest 自己的 `context.annotate()` 只给已经运行的测试追加 reporter metadata；`test.extend()` 只扩展 fixture；
`test.fails` 会反转任意测试失败。三者都不能表达 NiceEval 的具名 Verdict 终局，也不能替代这里的结果比较。

## 调研收据

在当前 checkout 中：

| 观察 | 读数 |
| --- | ---: |
| E2E 原生测试文件 | 47 |
| E2E Eval 源文件 | 79 |
| 直接检查 Verdict 的 E2E 文件 | 28 |
| 只做一次 `exp`、receipt 与 Verdict 检查的 owner | 6 |
| 上述 6 个 `e2e/eval/test/*.test.ts` 总行数 | 223 |
| 上述文件重复声明本地 `ExpEvent` 的次数 | 6 |
| 上述文件的 `expect()` 调用 | 19 |

这说明重复是真实的，但适用面窄：纯 Verdict 薄 owner 集中在 `e2e/eval/`。CLI、Report、Runner、Lifecycle
与 live Adapter 中的 Verdict 通常只是更长用户结果的一处检查，不能被一个 Pass / Fail / Error 注解替代。

仓库已有一个局部先例：`e2e/adapter/local-protocol/test/` 的五个 owner 文件各自只保留原生标题，
机械运行与 `evalId/verdict` 映射留在同 Repo 的 `support.ts`。本方向沿用“Repo-local support”边界，
但要求完整 argv 与 expected 继续出现在 owner 调用点，不把领域动作藏进 kind 到命令的映射。

按上面的调用形状，六个 owner 正文可从每个 35–47 行降到约 14–18 行；计入一份共享 support 后，
预计该组净行数下降约 35%–45%。这是静态减量预算，不是实现验收结果。

## 范围

- 只服务同一场景 Repo 内重复的 `exp --json` 终局读取。
- 每个稳定结果仍有自己的 `*.test.ts`、首行 owner 与原生 Vitest 标题。
- `--run <file>` 与 `-t <title>` 的单项重跑保持不变。
- 多 Eval 运行由 `outcomes` 完整列出，不默认“没写的都是 passed”。
- 不从 Verdict 自动推导 exit code、completion 或 failure reason。
- 不把终局检查函数上移到 `@niceeval/testkit`；只有第二个独立 Repo 出现完全相同的稳定机械协议并满足 Testkit
  准入门时，才另行评审共享。
- 不替换包含多个公开动作、读面或资源生命周期收据的原生 E2E 正文。

## 验收

该薄封装只有同时满足以下条件才算交付：

- 六个现有 Eval owner 的用户命题、owner、标题、argv 与 expected 仍能在各自文件一屏读完；
- 每个 owner 仍可按 Repo、文件和标题独立运行；
- expected Verdict 写错、漏写一个 Eval、额外运行一个 Eval 或返回重复终局事件时，测试确定失败；
- `errored` owner 的错误原因被改成另一条根因时，测试确定失败；
- 相同 candidate 通过 Eval Repo 的可靠性接管门；
- 不改变 `niceeval` 公共 API、Eval fingerprint、Record、根 E2E runner 或 Testkit；
- owner 文件加 support 的净代码量至少减少 30%，否则保留原生写法。

## 入口

- [E2E 测试正文](../../engineering/testing/e2e/README.md#单边界-e2e) —— argv、动作与 expected 的现行归属。
- [Eval E2E owner](../../engineering/testing/e2e/eval.md) —— 首批适用的六个稳定结果。
- [官方 Testkit](../../engineering/testing/testkit.md) —— 机械设施与领域 expected 的边界。
- [测试作者面决策](../../design/user-readable-testing/DECISION.md) —— 不建立第二套 Behavior / World / DSL 的既有裁决。
