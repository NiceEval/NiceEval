# 设计裁决:「公开 API 够不够用户重建内置报告」由 fixture 能编译过证明,不由输出比对证明

**裁决**:证明「公开 barrel 导出了用户重建内置报告所需的全部 API」,只需要一份 fixture **能通过 `pnpm run typecheck`**。不写内置报告与其拷贝的输出比对。

**曾选方案**:`src/report/built-in-user-parity.test.tsx`(643 行)。机制是把内置报告逐字复制一份到 `test/fixtures/report/*-public-copy.tsx`(只改 import 路径:内部相对路径 → `src/report/index.ts` 公开 barrel;以及 `export const X` → `export default`),然后跑 4 个场景 × 文本/网页两面 × 中英双语,断言两者输出相等。

**否决理由**:

1. **它比对的是一个东西和它自己的拷贝**。`diff` 过两个文件:JSX 主体一字不差。所以"parity"恒成立,唯一能失败的方式是**有人改了内置报告忘了改夹具**——这是教科书式的改名检测器(change-detector),抓不到任何 bug,只在每次重构时收税。ExperimentComparison 那次重构里,这个文件吃了 34 行纯机械改名,其中还包括**正则里匹配其它文件源码文本的字符串**。
2. **它想证明的那件事,在夹具能编译过的那一刻就证完了**。夹具从公开 barrel import 了 `Col` / `ExperimentList` / `MetricScatter` / `costUSD` / `passRate` / `defineReport`——这些名字只要有一个没导出,`typecheck` 直接红。输出比对没有额外证明力。
3. **它顺带重测了别处已经测过的东西**:两级聚合数值、verdict 折叠、locator 格式(全在 `src/report/report.test.ts` 直接测 `compute.ts`)、散点空态(在 `react/render.test.tsx` 和 `dual-render.test.tsx` 各测了一遍)。

**保留**:文件里唯一真实的一条是 resolve-once 的 spy 测试(每个 `.data()` 只被调一次、两次 locale 渲染不重算)——它守护「渲染面是纯的、零 IO」,且注释记录了一个真陷阱(`Object.assign` 会快照函数引用,所以必须 spy `ExperimentList.data` 而不是 `compute.experimentListData`)。

同类反模式(**grep 源码文本当测试**)在同一文件里还有两处:`readFileSync(src/show/index.ts)` + 正则匹配它的源码文本来断言"宿主选对了报告"、grep `report.ts`/`web.ts` 有没有出现字符串 `"ExperimentComparison"`。这是 lint 规则穿了测试的马甲,改个局部变量名就红,而它们声称守护的行为在 `show.test.ts` / `view-report.test.ts` 里已有真实的行为测试。

规则已升格进 [`docs/engineering/unit-tests/README.md`](../docs/engineering/unit-tests/README.md)「不写的测试」。出处见 [[test-budget-inverted-pyramid]]。
