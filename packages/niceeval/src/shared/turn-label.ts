/**
 * 生成 attempt 内跨 execution、timing、source 与 diff 的同一轮身份 token。
 *
 * 新写入只使用本函数；主会话使用 `turn<N>`，额外会话使用
 * `session<K>/turn<N>`。旧 artifact 在展示/读取边界使用 `normalizeTurnLabel`，不回写落盘值。
 */
export function formatTurnLabel(sessionIndex: number, turnIndex: number): string {
  return sessionIndex === 1 ? `turn${turnIndex}` : `session${sessionIndex}/turn${turnIndex}`;
}

/** Current durable turn identity: main session is implicit and every index is a positive safe integer. */
export function isCanonicalTurnLabel(label: string): boolean {
  const main = /^turn([1-9]\d*)$/.exec(label);
  if (main !== null) return Number.isSafeInteger(Number(main[1]));
  const additional = /^session([1-9]\d*)\/turn([1-9]\d*)$/.exec(label);
  if (additional === null) return false;
  const sessionIndex = Number(additional[1]);
  const turnIndex = Number(additional[2]);
  return sessionIndex >= 2 &&
    Number.isSafeInteger(sessionIndex) &&
    Number.isSafeInteger(turnIndex);
}

/** 把旧 artifact 的坐标标签归一成当前展示格式；其它 opaque label 原样保留。 */
export function normalizeTurnLabel(label: string): string {
  const legacyMatch = /^s([1-9]\d*)\/t([1-9]\d*)$/.exec(label);
  if (legacyMatch !== null) {
    return formatTurnLabel(Number(legacyMatch[1]), Number(legacyMatch[2]));
  }
  return label;
}
