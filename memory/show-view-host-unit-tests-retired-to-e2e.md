# show/view 宿主单测退役：用法错误矩阵归 E2E，report 组件数据测试保留

**裁决（2026-07-28，用户定案）**

1. `src/show/show.test.ts` 与 `src/view/view-report.test.ts` 整体删除。它们是六个月跟改率排行前二
   （42/44、35/37），2026-07-24 治理（`89ba8e64`）后仍回到头部；断言面（用法错误文案、外壳
   viewData 结构、选择收窄）与 `e2e/report.md` §4/§5 在真实产物上的验收大面积重叠。
2. 用法错误矩阵（locator 语法/未命中/混用、`--history`/`--stats` 互斥矩阵、多 `--exp` 校验、
   `--grep`/`--expand` 组合、`--report` 装载失败、view `--record`/`--run`）整体挪到
   `e2e/report/scripts/verify-usage-errors.ts`：这些错误发生在模型调用之前，在 e2e 里零 token 成本，
   且对 `evidence.resultsRoot` 只读（排在 verifyReadback 之前，见 e2e.ts 顺序规则）。
3. 唯一 e2e 覆盖不了的是 dev server 的模块重载语义（namespaced import 不复用陈旧模块，
   长驻进程内第二次装载读新内容）——三条测试搬进 `src/view/data.test.ts`，不随文件删除。
4. 覆盖规范同批重写：`unit/reports.md` 的「show 终端宿主」类别收窄为文案纯函数
   （verdictReasonLine / showCommand，`render.test.ts` / `command.test.ts`），
   「范围 × 切片正交」改名「对照口径」只留 deltaRows/stabilityRows 数据面，
   「view 数据装载」收窄为 data.test.ts 实际证明的数据层语义；e2e/report.md §4 新增
   「用法错误矩阵」条目并重写边界段。

**曾选方案 / 否决理由**

- 全删 report 组件测试（attempt-components / compute / validate），这块只留 e2e：否决——聚合口径的
  正确性需要确定性 verdict 图案 fixture（如同一 eval 内恰好 2/3 通过、各题 attempt 数不同），真实模型
  只能造恒败/恒错（deliberate-fail/error），造不出确定性混合图案；e2e 验的是「各出口口径一致」，
  聚合算法整体换错时所有出口一致地错、e2e 全绿。「数字是对的」全仓库只有 unit 的区分力 fixture 在证明。
- 砍 attempt-components.test.tsx 的「纯形状断言」：实查后取消——该文件断言面全是 `*Data` 计算结果与
  错误对象，DOM/排版早在 07-24 治理中归了 e2e，没有可砍的形状断言。

**依据**

churn.md 口径下治理后新窗口（07-24 起 33 个 src commit）里 show/report 测试仍居头部，但逐 commit
核对多为契约重设计合法同批；真正的纯跟改证据在历史上的 `report.test.ts`（30 次变更 1 次同批改覆盖
规范）等四个已删文件。下一个观察窗口从本次裁决起算，头部应换人。
