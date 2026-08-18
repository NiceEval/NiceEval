import type { Agent } from "../types.ts";

/**
 * DeepSeek Harness adapter 的 TDD 构造期 sentinel。
 *
 * 当前只固定公开工厂名；不伪造 CLI ensure、安装、事件或 send 行为。
 */
export function deepSeekHarnessAgent(): Agent {
  throw new Error(
    "DeepSeek Harness adapter is not implemented (niceeval/adapter:deepSeekHarnessAgent)",
  );
}
