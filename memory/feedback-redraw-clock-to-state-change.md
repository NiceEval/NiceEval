# 设计裁决:human dashboard 重画时钟从 spinner setInterval 改为状态变化驱动

**裁决**(2026-07-13,`plan/exp-output-feedback-models.md` 落地):human profile 的 dashboard 重画不再由一个固定周期的 `setInterval` 驱动。改为「reducer 产出的真实状态变化 + coordinator 按 tick 给的重画机会」共同驱动:coordinator 通过可注入 `FeedbackIO` 的 clock 定期(默认 250ms)给渲染层一次「可以重画了」的机会,渲染层自己判断"这一帧渲染出的文本是否与上一帧相同",相同则不写;elapsed 最多每秒变化一次,整体最多 4fps。存活性由持续增长的 elapsed 与静态 `●` 符号证明,不再需要旋转动画。永久事件(plan / failure / diagnostic / summary)完全独立于这个 tick 节奏,由 coordinator 保证 clear → append → redraw 的严格顺序。

**曾选方案**:旧实现 `src/runner/reporters/live.ts` 用一个 80ms 的 `setInterval` 作为唯一重画时钟(`SPINNER` 帧数组驱动一个旋转符号),每次 tick 无条件重画整张状态表——不管有没有真实状态变化,也不管这段时间内有没有其它模块往 stderr 写过东西。

**否决理由**:这个模型把"有没有新信息"和"该不该重画"耦合成了同一件事,而驱动力(定时器)恰恰不知道状态有没有变化。代价不只是空耗——它是两个独立滚屏 bug 的根因:
- [[live-overflow-redraw-appends-frames]]:行数超过终端高度时,固定周期的 `\x1B[nA` 回跳量不够,每次 tick 都以"追加"落地一份新表。
- [[live-raw-stderr-write-desyncs-redraw]]:任何绕过 `draw()` 自身回调路径的裸写(sandbox teardown 失败、budget 诊断、reporter 抛错、docker/vercel 的 provider 提示……)都会让下一次 timer 触发的重画基于错误的 `drawnLines` 假设,越滚越多。

两次修复都只是在"定时器无条件重画 + 假设自己独占终端"这个模型上打补丁(截断行数、订阅一个外部裸写通知再清屏),没有改变根本假设。本次重构把假设换掉:状态源(`RunFeedbackState`)与渲染时机(tick 机会)显式拆开,`FeedbackCoordinator` 是唯一允许触碰终端的协调者,下层模块一律经 `sink.ts` 转发诊断,不再存在"绕开渲染层自己的回调路径裸写"这条路,滚屏的物理成因(回跳量与真实光标位置不一致)被从源头消除,而不是靠更精细的截断/订阅逻辑去追着补。

**适用场景**:任何"要不要重画"的判断,判据必须是"状态是否变化",时钟只能提供"检查一下有没有变化"的节流机会,不能被当成唯一驱动力——否则动画帧和真实信息会被混为一谈,还会制造出与底层裸写竞态的脆弱假设(见上面两条关联条目)。同一类问题的根治方式是建立"状态源 + 单一协调者 + 下层一律转发"的边界,不是给现有的裸写/回跳逻辑打第三个补丁。

关联:[[live-overflow-redraw-appends-frames]]、[[live-raw-stderr-write-desyncs-redraw]](旧模型下的两次滚屏 bug,均已修但停留在补丁层面)、[[feedback-profile-replaces-tty-detection]](同一次重构的另一半设计裁决:反馈 profile 怎么选)。
