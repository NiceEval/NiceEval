// Plain execute functions, deliberately transport-agnostic: the same functions back
// the tool defs used by the HTTP server and the in-process official Agent factory,
// so a passing Eval on one entry point is directly comparable to the same Eval on another.

const weatherBank: Record<string, { tempC: number; condition: string }> = {
  北京: { tempC: 26, condition: "晴" },
  上海: { tempC: 29, condition: "多云" },
  广州: { tempC: 32, condition: "雷阵雨" },
};

export function getWeather(input: { city: string }): { city: string; tempC: number; condition: string; summary: string } {
  const weather = weatherBank[input.city] ?? { tempC: 24, condition: "晴" };
  return {
    city: input.city,
    tempC: weather.tempC,
    condition: weather.condition,
    summary: `${input.city}当前${weather.condition}，气温 ${weather.tempC}°C。`,
  };
}

const MATH_CHARS = /^[\d+\-*/().\s]+$/;

export function calculate(input: { expression: string }): { expression: string; result: number } {
  const expr = input.expression.trim();
  if (!MATH_CHARS.test(expr)) throw new Error(`只支持四则运算表达式，收到：${input.expression}`);
  const result = Function(`"use strict"; return (${expr});`)() as unknown;
  if (typeof result !== "number" || !Number.isFinite(result)) throw new Error(`无法计算：${input.expression}`);
  return { expression: expr, result };
}

// ───────────────────── 共享断言契约的文件工具（内存实现，非落盘） ─────────────────────
// Direct Agent 没有 Sandbox（profile 声明 sandboxUnavailable: true），契约只要求产生
// 真实的 file_write / file_edit / shell ToolMatch 帧，不要求落盘。这三个工具用模块内
// 内存文件表承载真实执行：事件流里的 operation 由这些真实工具的返回结果经协议帧归一
// 而来，不伪造 StreamEvent。每个 HTTP 请求各建一张表，重跑与并发 Eval 不会互相污染。
// 种子文件等价于共享 Eval 在沙箱实现里的 t.sandbox.writeText 播种（Direct Agent 路径
// 由 profile 跳过那段），让真实模型的调用序列与 profile 的 calls 对齐。
const CONTRACT_SEED = {
  "assertion-contract-edit.txt": "before-assertion-contract-926\n",
  "assertion-contract-delete.txt": "delete-me\n",
} as const;

export function createContractFileTools() {
  const contractFiles = new Map<string, string>(Object.entries(CONTRACT_SEED));

  return {
    async writeFile(input: { path: string; content: string }): Promise<{ ok: true; path: string }> {
      contractFiles.set(input.path, input.content);
      return { ok: true, path: input.path };
    },

    async editFile(input: {
      path: string;
      oldText: string;
      newText: string;
    }): Promise<{ ok: true; path: string; replaced: number }> {
      const current = contractFiles.get(input.path);
      if (current === undefined) throw new Error(`${input.path} not found`);
      const replaced = current.split(input.oldText).length - 1;
      if (replaced === 0) throw new Error(`oldText not found in ${input.path}`);
      contractFiles.set(input.path, current.split(input.oldText).join(input.newText));
      return { ok: true, path: input.path, replaced };
    },

    async runShell(input: { command: string }): Promise<{ ok: true; stdout: string }> {
      const command = input.command.trim();
      const rm = command.match(/^rm\s+(\S+)$/);
      if (rm) {
        contractFiles.delete(rm[1]!);
        return { ok: true, stdout: "" };
      }
      const echo = command.match(/^echo\s+(.+)$/);
      if (echo) return { ok: true, stdout: echo[1]!.trim() };
      throw new Error(`unsupported contract shell command: ${input.command}`);
    },
  };
}
