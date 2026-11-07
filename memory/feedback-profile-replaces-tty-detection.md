# 设计裁决:退役 `--quiet`,`--output human/agent/ci` 取代 TTY/非 TTY 二分

**裁决**(2026-07-13,`plan/exp-output-feedback-models.md` 落地):`niceeval exp` 的终端反馈不再用「`stderr` 是不是 TTY」直接当产品模式,也不再用 `--quiet` 同时表达"AI 需要什么"和"CI 需要什么"两种不同的需求。改为显式的 `--output human|agent|ci` 三选一 profile;默认 `--output auto` 只做环境侦测(显式值 → `stderr` 是 TTY → CI 环境变量存在 → 非 TTY 兜底为 agent),三种 profile 只改变反馈,不改变选择/调度/判定/artifact/退出码;`--quiet` flag、`QuietReporter` 与相关 i18n 整体删除,不保留兼容 alias 或第四种反馈语义。

**曾选方案**:旧实现是两条独立、语义含混的分支叠加:
1. `stderr.isTTY` 直接决定用 `Live`(动态 ANSI dashboard)还是 `Console`(逐行流式输出)reporter——把"传输能力"(有没有 TTY)当成了"消费者是谁"的信号。
2. `--quiet` flag 叠加在这上面,企图同时压低给人看和给机器看的输出量,实际只做到"进度流照常裸写 stderr,结果流被摘空"(见 [[quiet-progress-result-stream-asymmetry]])——某个 attempt errored 时控制台零输出,和"还在跑"无法区分。

**否决理由**:TTY 是传输能力,不是消费者身份。同一个"非 TTY"环境下,coding agent 需要的是"低频存活信号 + 失败 locator + 下一步命令"的稳定 ASCII envelope,CI 需要的是"单一有序 stdout 事件流 + 精确 JSON/JUnit + 统一退出码语义",这两种需求的形状完全不同——不是同一份"安静一点的 Console 输出"改个措辞就能同时满足的。`--quiet` 用一个布尔开关同时压低两种需求,结果两边都没做对:这不是实现 bug,是模型本身建错了。`stderr.isTTY` 同理有两个方向的错判风险:被管道捕获的显式 `--output human`(如 `| cat`)不该悄悄退化成 agent 语义(profile 是显式选择,永远不被传输能力覆盖,只在没有 TTY 时退化成 human 的纯追加文案,仍是 human 的措辞与结束摘要);CI 环境里没有 TTY 也不该被误判成 agent(CI 需要自己的稳定字段名和统一退出码语义,不是 agent 的 ASCII envelope)。修法是把"谁在消费输出"提升为一等的显式选择,环境侦测(`auto`)只是这个选择的默认值来源,不是选择本身。

**适用场景**:任何"要不要输出某种反馈"的设计,先问"消费者是谁"(人 / AI / CI),再问"这个环境能不能支持我优先选的形式"(TTY 能力只回答第二个问题);把两者合并成一个二元开关(TTY 判断)或一个笼统的降噪开关(`--quiet`),大概率会把至少一种消费者的真实需求阉割掉,而且会在"降噪"和"结果流完整性"之间制造出使用者看不见的不对称。

关联:[[quiet-progress-result-stream-asymmetry]](`--quiet` 的具体不对称 bug,`--quiet` 整体退役后这条历史记录作废但保留,作为"半静默比全静默更误导"的复盘材料)、[[live-who-key-mismatch-freezes-rows]] / [[live-rows-fold-experiment-variants]] / [[live-carry-row-shows-waiting-forever]](旧 Live/TTY 模型下的展示层 bug,新模型下由反馈层自己的 `AttemptRef` / `AttemptKey` 身份类型与 `RunFeedbackPlan` 从源头消除同类风险,而不是逐个打补丁)、[[feedback-redraw-clock-to-state-change]](同一次重构的另一半设计裁决:重画时钟怎么选)。
