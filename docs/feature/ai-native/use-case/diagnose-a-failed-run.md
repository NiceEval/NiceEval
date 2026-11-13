# 让 agent 诊断一条失败的结果

## 用户目标

一次运行里有几条没有通过。用户想知道原因在被测系统、评估用例还是运行条件，
并且希望 agent 的归因可以由自己用同样的命令复核。

## 起始状态

仓库已经接入 NiceEval 并有一次已发布的 Run。用户没有授权 agent 修改任何文件。
本篇是预期用法，输出均为预期结果。

## 完整路径

1. 用户提出只读请求。 {#ask}

   ```text
   昨晚那次跑的结果里 deploy-config 失败了，帮我看看为什么，先别改东西。
   ```

   预期结果：agent 经项目指引读到 `INDEX.md`，选择只读诊断的路由，并确认这次不修改项目、不重跑。

2. agent 定位到具体的 Attempt。 {#locate}

   ```sh
   pnpm exec niceeval run list
   pnpm exec niceeval show --run <run-id>
   ```

   预期结果：agent 找到那次 Run，并从结果里取得失败 Attempt 的 locator。

3. agent 逐层读公开证据。 {#evidence}

   ```sh
   pnpm exec niceeval show @<locator> --assertions
   pnpm exec niceeval show @<locator> --execution
   ```

   预期结果：断言明细指出哪一条决定了 Verdict；执行轨迹给出 agent 当时实际调用的工具与命令。
   需要稳定的机器数据时，agent 改用 `niceeval query discover` 与固定请求。

4. agent 给出归因。 {#attribute}

   预期结果：agent 说明失败属于被测系统行为、评估用例的判据、Adapter 映射，还是 Provider、凭据与生命周期。
   每个判断后面跟着产生该证据的命令。它不提出“放宽断言让结果变绿”的建议，除非证据表明断言拒绝了任务允许的结果。

## 结果

用户得到一段归因和一组命令，逐条执行能看到 agent 引用的同一份证据。项目文件与历史结果没有变化。

| 情形 | 用户看到的结果与下一步 |
|---|---|
| 公开命令读不到需要的证据 | agent 说明这是 NiceEval 的呈现缺口并停止推断，不去读 `.niceeval/` 或实现源码 |
| 结果是 `errored` 而不是 `failed` | agent 按执行错误处理，报告失败阶段与错误摘要，不把它当成零分 |
| 用户随后授权修复 | agent 修产生错误的那一层，并只复验受影响的范围 |

## 相关契约

- [Inspection CLI](../../inspection/cli.md)：`show` 的各个切片与标记含义。
- [Run CLI](../../run/cli.md)：`run list`。
- [Format](../format.md)：项目指引里关于只读公开结果的规则。
