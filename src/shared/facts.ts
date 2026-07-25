// fact(key, value) 的共享校验与归属写入实现。三处声明了 fact() 的上下文——
// AgentContext(src/agents/types.ts)、SandboxHookContext(src/sandbox/types.ts)、
// ExperimentHookContext(src/runner/types.ts)——运行时各自绑定不同的目标 Record
// (attempt 级 facts 累加器 / experiment 级 facts 累加器),归属由调用方按当前作用域
// 决定,不是本函数的职责;本函数只管「这次调用合不合法」与「写进哪个 Record」。
// key 词法、value 标量、同 key 后写覆盖三条规则单源
// docs/feature/record/architecture.md#facts运行事实。

/** fact() 接受的标量取值;与三处 ctx.fact() 签名、AttemptRecord.facts / SnapshotMeta.facts 同型。 */
export type FactValue = string | number | boolean;

const FACT_KEY_PATTERN = /^[a-z0-9._-]{1,64}$/;

/**
 * 校验一次 `fact(key, value)` 调用并写入 `target`(同一作用域内同 key 后写覆盖先写)。
 * 校验失败按三段式抛错(现象/依据/下一步,见 docs/error-feedback.md)。
 */
export function recordFact(target: Record<string, FactValue>, key: string, value: FactValue): void {
  if (!FACT_KEY_PATTERN.test(key)) {
    throw new Error(
      `fact() rejected key ${JSON.stringify(key)}: fact keys must match /^[a-z0-9._-]{1,64}$/ ` +
        `(lowercase letters, digits, '.', '_', '-', 1-64 characters). ` +
        `Rename the key to match the pattern and call fact() again.`,
    );
  }
  const valueType = typeof value;
  if (valueType !== "string" && valueType !== "number" && valueType !== "boolean") {
    const got = value === null ? "null" : Array.isArray(value) ? "array" : valueType;
    throw new Error(
      `fact(${JSON.stringify(key)}, …) rejected its value: fact values must be a scalar ` +
        `(string | number | boolean), got ${got}. ` +
        `Pass a scalar, or JSON.stringify() structured data before calling fact().`,
    );
  }
  target[key] = value;
}
