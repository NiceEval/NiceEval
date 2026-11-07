# 失败分类链:实验分类器前移到 adapter 之前(遮蔽风险裁决)

- **裁决**(2026-07-24):turn 失败分类链的决议序定为**抛出点 → 实验分类器 → adapter 分类器 → 保守兜底 → 受理证据门**,首个非 `undefined` 定案。契约单源 `docs/feature/error-classification/architecture.md#分类链`。
- **曾选方案(初稿)**:adapter 排在实验分类器之前(理由:adapter 离协议更近)。**否决理由**(评审发现):链是「先到先得」而两个通道回答的轴不同——adapter 对连接类错误给出 `{retryable: true, reason: "network"}` 这类纯时间轴答案时,实验分类器永远问不到;受理证据门只救时间轴(mid-turn 必有 agent 事件,强制降不可重试),scope 停在缺省 `"attempt"`,止损闸落不下——「中途死亡的共享隧道被逐 attempt 反复撞」这个功能旗舰场景恰好失效,全靠 adapter 自律返回 `undefined` 撑着。前移后由结构保证:实验分类器按自家坐标(host)过滤,特异性高于协议通用形状,两者同时认领的失败恰是 scope 该赢的场景;adapter 认领的协议短语(如 `ACME_QUEUE_FULL`)不会带实验坐标,反向遮蔽不成立。
- **曾选方案 2**:按轴合并(时间轴 adapter 权威、scope 允许后续通道补充)。**未采纳理由**:「先到先得」的单值决议最简单可预测,重排已消除遮蔽,为残余理论场景引入按轴合并的复杂度不值。
- **实现状态**:契约已落 docs(architecture/README/library/use-case/eval 覆盖规范,2026-07-24),实现随 `plan/runner-dispatch-spine-refactor.md` B3 节点执行。
