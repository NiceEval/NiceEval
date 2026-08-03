/**
 * 生成 attempt 内跨 execution、timing、source 与 diff 的同一轮身份 token。
 *
 * 新写入只使用本函数；主会话使用 `turn<N>`，额外会话使用
 * `session<K>/turn<N>`。旧 artifact 在展示/读取边界使用 `normalizeTurnLabel`，不回写落盘值。
 */
export function formatTurnLabel(sessionIndex: number, turnIndex: number): string {
  return sessionIndex === 1 ? `turn${turnIndex}` : `session${sessionIndex}/turn${turnIndex}`;
}

/** 把旧 artifact 的坐标标签归一成当前展示格式；其它 opaque label 原样保留。 */
export function normalizeTurnLabel(label: string): string {
  const match = /^s([1-9]\d*)\/t([1-9]\d*)$/.exec(label);
  return match === null ? label : formatTurnLabel(Number(match[1]), Number(match[2]));
}
