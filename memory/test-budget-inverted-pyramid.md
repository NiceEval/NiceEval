# 设计裁决:测试预算按「静默出错的代价」分配,不按代码量或好测程度

**裁决**:判定层(评分/断言/缓存键/调度)必须有直接测试;展示层测薄可以接受。行覆盖率不作为指标,也不作为验收依据。落成 [`docs/engineering/unit-tests/README.md`](../docs/engineering/unit-tests/README.md)。

**曾选方案(未明说、但事实上在执行的)**:哪儿好测测哪儿。结果是纯函数密集、断言好写的模块被反复加测试,而难测的核心一直裸奔。

**否决理由 —— 2026-07-13 全套件审计的实测数据**:

| 目录 | 源码行 | 测试行 | 比例 |
|---|---|---|---|
| `results/` | 2,456 | 2,241 | **0.91** |
| `show/` + `report/` | 7,756 | 4,036 | ~0.52 |
| `runner/` | 2,748 | 743 | 0.27 |
| `sandbox/` | 1,641 | 153 | 0.09 |
| **`scoring/`** | **805** | **0** | **0** |
| **`expect/`** | **187** | **0** | **0** |

一个 eval 工具,**把结果读出来、画出来**的部分测到 0.91,**判断对错**的部分测到 0。具体地,以下全是零命中(grep 整个套件):

- `runEvals`(`src/runner/run.ts`,421 行:两级信号量并发、earlyExit 中断去重、budget 记账、carry/resume 合并)。`src/runner/run.test.ts` 那 50 行测的是 `judgeProbeTargets`——一个 15 行的正则辅助函数。
- `computeVerdict`(`src/scoring/verdict.ts`)——passed/failed/errored/skipped 的判定本身。
- `src/runner/fingerprint.ts`(112 行,缓存键)。**静默出错风险最高的一处**:它错了不报错,只是把陈旧结果当成刚跑出来的报给用户。
- `src/o11y/derive.ts`(304 行,`deriveRunFacts`)——每一条基于事实的用户断言都读它。

反直觉之处在于:这不是"测试写得不够多"。套件里 90%+ 的测试**质量是好的**(有真实回归锁、有 memory 出处、几乎没有 mock 剧场),问题纯粹是**指向了错的代码**。所以修法不是"补测试",而是先明确谁必须测——否则下一轮补测试还是会补到好测的那一层去。

覆盖率数字会掩盖这件事:展示层 0.9 / 判定层 0 的套件,整体算出来是个体面的数,但它比整体均匀 0.5 的套件危险得多。这是拒绝把行覆盖率作为指标的直接理由。

配套发现见 [[vitest-collects-agent-worktree-copies]](45% 的测试是幽灵)和 [[parity-test-compares-source-to-its-own-copy]](最大的单个无效测试文件)。
