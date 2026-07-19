// 进程级、内存态的"待审批"表——HITL(human-in-the-loop)审批的唯一状态存储。
//
// 写入方只有一处:agent.ts 里的 canUseTool,遇到需要审批的工具调用时把 resolver 存进来,
// 然后 await 一个 Promise<boolean>。server.ts 的 POST /api/chat/approve 路由是唯一的
// 读取/消费方:按 toolUseId 找到 resolver、调用它、删掉这条记录。
export const pendingApprovals = new Map<string, (approved: boolean) => void>();
