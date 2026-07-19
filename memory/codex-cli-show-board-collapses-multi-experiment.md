---
name: codex-cli-show-board-collapses-multi-experiment
description: "裸 `niceeval show`(无位置参数)在仓库有多个 experiment 时按实验组折叠成组级汇总表,不逐条列 Eval id;`board.includes(evalId)` 这种'少排用例不能全绿'检查在多 experiment 仓库里必然假阴性,要改用 `show --page attempts`"
metadata:
  type: infra-bug
---

**现象**:`e2e/repos/codex-cli` 的 `scripts/verify.ts`(前一位 agent 搭好的脚手架)用例二
写的是 `sh("pnpm exec niceeval show")` 后对 `EXPECTED_EVALS`(`coding-task`/`session`/…)逐个
`board.includes(id)`。本仓库有 5 个 experiment 文件(baseline/mcp/plugin/skill/configfile,
按 docs/engineering/e2e-ci/README.md「仓库自治」的设计,每个 experiment 配一份不同的
agent 挂载,不能合并成一个)。真机跑 `pnpm exec niceeval exp --force` 全部 5 个实验后,
`pnpm exec niceeval show` 的输出是:

```
Experiment group   Experiments   Evals   Pass rate   Eval results   Total cost   Last run
baseline                     1       3        100%   3 passed             $0.12   ...
configfile                   1       1        100%   1 passed             $0.22   ...
mcp                          1       1        100%   1 passed             $0.03   ...
plugin                       1       1        100%   1 passed           $0.0068   ...
skill                        1       1        100%   1 passed             $0.05   ...
```

字面量 `"coding-task"` 完全不出现——`AssertionError: show 榜单缺少 coding-task` 必现,不是 flake。
只跑单个 experiment(如只跑 `baseline`)时,同一条裸 `show` 命令会展开成逐 Eval 视图
(`✓ passed coding-task ... ✓ passed session ... ✓ passed usage`),字面量都在。

**根因**:`docs-site/zh/reference/cli.mdx`:「不带位置参数时显示按实验组分区的默认比较报告」
——这是为了跨 experiment/config 比较设计的,组数越多,报告的粒度天然从「逐 Eval」收缩到
「组级 pass rate + 总数」,不是随机抖动或 bug。`e2e/repos/codex-sdk`(已验证绿的姊妹仓库)的
`verify.ts` 用同一套 `board.includes(id)` 写法从未踩到这个坑,原因是它只有**一个** experiment
(`experiments/codex-sdk.ts`,省略 `evals` 字段 = 全选),组数=1 时报告不折叠,这份参考实现
恰好绕开了多 experiment 场景。

**修法**:把 `sh("pnpm exec niceeval show")` 换成 `sh("pnpm exec niceeval show --page attempts")`
——这一页是逐 attempt 的扁平列表(`✓ @locator · evalId · experimentGroup · duration · cost`),
不随 experiment 组数折叠,`EXPECTED_EVALS` 里每个 id 都会作为子串出现。修在
`e2e/repos/codex-cli/scripts/verify.ts`。

**适用场景**:任何用「裸 `show` 输出里搜 Eval id 子串」来验证「应发现的 Eval 都真的跑了」的
仓库,只要该仓库有 ≥2 个 experiment(不同 agent 挂载配置各自成组的设计在 sandbox 组里很常见,
见 docs/engineering/e2e-ci/adapters/codex-cli.md 的 5-experiment 拆法),都要用
`--page attempts` 而不是裸 `show`;`verification.md` 的参考写法(用例二)本身是按单 experiment
场景写的,照抄到多 experiment 仓库前先确认组数。
