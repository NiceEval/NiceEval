/**
 * 生成 attempt 内跨 execution、timing、source 与 diff 的同一轮身份 token。
 *
 * 标签是落盘契约的一部分：主会话使用 `turn<N>`，额外会话使用
 * `session<K>/turn<N>`。读取历史 artifact 时不要重新调用本函数迁移已有标签。
 */
export function formatTurnLabel(sessionIndex: number, turnIndex: number): string {
  return sessionIndex === 1 ? `turn${turnIndex}` : `session${sessionIndex}/turn${turnIndex}`;
}
