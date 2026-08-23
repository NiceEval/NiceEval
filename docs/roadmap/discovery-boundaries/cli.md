# Eval 发现边界 —— CLI

本方向不新增 CLI 命令或 flag。niceeval list、niceeval check、niceeval exp --dry 与普通 niceeval exp 都消费同一份 discovery transaction。

## 人类输出

niceeval list 为每条 Eval 同时显示 package owner、定义文件和该文件负责的范围：

```text
EVAL                         SOURCE           DEFINITION                     SCOPE
checkout                     project:evals    checkout.eval.ts               this file
payroll                      project:evals    payroll/eval.ts                 payroll/ directory
terminal/parse-csv           terminal-bench   terminal/parse-csv/eval.tsx     terminal/parse-csv/ directory
```

单文件定义的 SCOPE 写 `this file`。目录定义显示其负责的相对目录，不展示 `folder-entry-owns-descendants` 等机器 reason。

错误同时显示 package owner、定义文件与已经确定的范围。发现失败不输出部分成功列表，也不把一个子定义静默标成 skipped。

## JSON

list --json 的每条 Eval 增加与 Library 相同的 discovery 字段：

```ts
interface ListedEval {
  readonly id: string;
  readonly discovery: EvalDiscovery;
}
```

dry plan 为每条 selected Eval 保留相同字段，使用户能将计划的 Eval 追溯到同一 root、entry 与 cutoff。JSON 中的 root、entry、directory 和 id 都是逻辑相对路径或 mount，不能包含宿主绝对路径、package cache 路径或 symlink target。

失败 JSON 使用结构化 diagnostic：

```ts
interface DiscoveryDiagnostic {
  readonly code: DiscoveryFailureCode;
  readonly root: EvalDiscoveryRoot;
  readonly entry?: string;
  readonly cutoff?: EvalDiscoveryCutoff;
  readonly message: string;
}
```

## exit code 与 dry 边界

| 情况 | exit code | 资源边界 |
| --- | --- | --- |
| 完整发现、list、check 或 dry 计划 | 0 | 不创建 Sandbox、Agent、Run 或 provider cache |
| CLI 参数、root 配置、entry 名称、root overlap 或 symlink entry 无效 | 2 | 在 module import 前终止 |
| 目录读取、module import、export decode、source capture 或 race 失败 | 1 | 不产生部分 discovery 或运行计划 |

dry 进行真实 discovery、模块 import、definition decode、source capture 和 link。它不 dispatch Attempt 或创建 Sandbox。Eval module 的顶层代码仍会执行，dry 不是第三方 Eval 的安全预览。

## 并发与审计

discovery 不占 Attempt 并发位。根可以并行读取，但 entry module 按稳定 entry 顺序恰好装载一次；最终输出按稳定 Eval id 排列，绝不按 I/O 完成顺序排列。

每次命令持有一个 frozen discovery snapshot。发现期间 root、entry、realpath 或已捕获 source 发生变化时，以 discovery.raced 失败，而不混合两个文件系统时刻的结果。

niceeval show 只展示完成运行的 Attempt。发现 provenance 的审计入口是 list、check 和 dry；它们不递归列出被 folder entry 拦下的所有普通资产。
