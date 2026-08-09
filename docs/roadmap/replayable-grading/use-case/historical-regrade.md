# 对历史 Run 使用当前 GradingDefinition

## 普通路径

先查看计划：

```sh
niceeval grade --run run_01J8KQ --dry
```

Runner 从该 Run 的 SampleManifest 取得 Eval ID，并在当前 checkout 做 declarative link discovery。
历史 Record 里的源码与 link 只用于比较，不会被执行。

计划显示哪些 entry 可以复用旧 Grading、哪些需要新判，以及哪些 Execution graph 与当前 required Ref 不兼容。

```text
8 reusable grading results
3 to grade
1 incompatible · required ref "auditTurn" is missing
```

确认后运行：

```sh
niceeval grade --run run_01J8KQ
```

命令创建 `gr_...` GradingRun。
它不会修改 `run_01J8KQ` 的 default GradingRun，也不会把历史 Claim 标成旧版本或删除。

## 选择结果

```sh
niceeval show --run run_01J8KQ --grading-run gr_01K4M2
niceeval view --run run_01J8KQ --grading-run gr_01K4M2
```

不传 `--grading-run` 时，读面继续使用 Run 自己的 default GradingRun。
系统不按时间自动选择 `gr_01K4M2`。

## 强制重新评分

相同 grader 再运行时，默认复用 eligible Grading。
要绕过 reuse 并重新执行确定性 grading，显式使用：

```sh
niceeval grade --run run_01J8KQ --force
```

该命令只强制新建 Grading。
它不会重新执行 Agent，也不会把新分数写回旧 Grading。

## 当前 definition 缺失

当前 checkout 没有目标 Eval、组合入口或 grading module 时，entry 是 `grading-definition-unavailable`。
Runner 不搜索同名文件，也不从 Record 归档源码执行代码。

切回包含当前 declarative link 的 checkout，或恢复对应 Eval definition 后重试。

## private rubric 缺失

历史 Claim 仍可读，但新 GradingRun 必须重新证明当前 private input digest。
文件缺失时 entry 是 `grading-input-unavailable`，旧 fingerprint 不能绕过检查。

这时报告分别显示历史可读性和当前复核能力。
