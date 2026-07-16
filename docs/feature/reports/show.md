# `niceeval show` —— 在终端读结果

`niceeval show` 不运行 eval，只读取结果根。它适合在 shell 或 coding agent 循环里快速回答三个问题：哪一题失败、失败的实际值是什么、下一步该看哪份证据。

## 从榜单下钻到 attempt

```sh
niceeval show                              # 当前结果的默认 ExperimentComparison
niceeval show memory/swelancer             # 按 eval id 前缀收窄
niceeval show @1qrdcfq8                    # 打开一个 attempt 的诊断首页
niceeval show @1qrdcfq8 --eval             # 断言标回 eval 源码
niceeval show @1qrdcfq8 --execution        # 对话与工具调用；可关联时附 OTel 时间
niceeval show @1qrdcfq8 --timing           # 有界诊断时间树：生命周期、hook、命令、轮次与 OTel
niceeval show @1qrdcfq8 --timing=full      # 逐节点展开同一棵完整时间树
niceeval show @1qrdcfq8 --diff             # workspace 改动摘要
niceeval show @1qrdcfq8 --diff=path/to.ts  # 某个文件的完整 diff
niceeval show memory/swelancer --history   # 这个 eval 的真实执行历史
```

榜单中的 `@<locator>` 是 attempt 的稳定引用。它必须带 `@`，既不是数组下标也不是文件路径。把 locator 复制给后续命令，便可从汇总数字回到同一次执行的证据。

## 按任务读分篇

| 任务 | 页面 |
|---|---|
| 读裸 `show` 的默认榜单：组索引、单组详情、Result 摘要口径 | [默认报告的 text 面](show/default-report.md) |
| 从 locator 打开失败诊断首页（含 errored 的基础设施错误） | [失败诊断首页](show/attempt.md) |
| 把断言与轮次标回 eval 源码 | [`--eval`](show/eval-source.md) |
| 看 agent 每轮说了什么、调了什么工具 | [`--execution`](show/execution.md) |
| 分析整个 attempt 的时间花在哪 | [`--timing`](show/timing.md) |
| 核对 agent 实际改了哪些文件 | [`--diff`](show/diff.md) |
| 渲染自定义报告：单页、多页与 `--page` 的操作步骤 | [`--report` 的单页与多页](show/reports.md) |

## 选择结果范围

```sh
niceeval show --run tmp/published-results
niceeval show --experiment dev-e2b           # 整个可比组
niceeval show --experiment dev-e2b/codex-e2b
niceeval show memory/swelancer --experiment dev-e2b/codex-e2b
niceeval show --report reports/exam.tsx
niceeval show --report reports/site.tsx --page exam
```

`--run` 改变结果根，`--experiment` 和 eval id 位置参数在其中收窄 Scope；`--experiment` 按路径段匹配 id 前缀，因此 `--experiment dev-e2b` 选中整个可比组但不会误中 `dev-e2b-next`。收窄完成后默认报告才按组分区，位置参数仍只表示 eval id 前缀。`--report` 用自定义报告替换榜单，但 attempt locator 的下钻命令保持不变；单页、多页与 `--page` 的逐 case 操作步骤见 [`--report` 分篇](show/reports.md)。`--history` 是内置时间轴，与 `--report` 互斥。

## 无匹配与不可读结果

漏写 locator 的 `@` 时，输入按 eval id 前缀处理并明确报无匹配，不做模糊猜测：

```text
$ niceeval show 1qrdcfq8
No results matched: 1qrdcfq8. Evals with results: memory/agent-037-updatetag-cache, memory/swelancer-manager-proposals
```

扫描结果根时，可读快照照常参与报告；未完成、损坏或 schema 不兼容的快照会列出原因。完全没有可读结果时命令非零退出，并对带 `producer.version` 的旧格式给出对应版本的 `npx niceeval@<version> show --run <root>` 建议。

## 相关阅读

- [Reports Library](library.md) —— `--report` 文件怎样写。
- [Results](../results/README.md) —— show 读取的文件和 artifact。
- [Agent 反馈闭环](../../../docs-site/zh/guides/agent-feedback-loop.mdx) —— 在 AI 自迭代中组合这些命令。
