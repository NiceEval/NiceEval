# Goals

G1：不同应用与 Agent 使用同一 Match、三值求值、collection 与受管评分路径，领域字段属于消费者。

G2：合取约束同一事实。评分只读取确定性命中的材料，保留输入顺序和原始身份。

G3：缺失事实保留 unavailable，完整零命中不发送模型请求。消费者不执行 evaluator。

G4：一条声明登记一个 Assertion；gate、score、停止控制与模型生命周期复用现有 owner。

G5：普通便捷方法返回精确 Boolean handle，核心 closeQA 返回精确 measurement handle；Pass 不取得 score 能力。

G6：已有工具和事件的范围、vector cut、partial 与 occurrence 判定不变；新增机制可用于这些事实。
