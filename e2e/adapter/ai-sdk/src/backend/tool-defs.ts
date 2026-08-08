// AI SDK tool definitions shared by the HTTP server entry point. `calculate` carries
// `needsApproval: true` — the one HITL surface this repo exercises across transports.
// The three file tools (file_write / file_edit / shell) are the shared assertion contract's
// coding surface: they are executed against an in-memory file table (see tools.ts), so the
// contract's ToolMatch assertions read genuine tool execution through the real protocol
// path without a Sandbox (direct agent, profile declares sandboxUnavailable).
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { calculate, createContractFileTools, getWeather } from "./tools.ts";

export const SYSTEM_PROMPT = `
你是一个乐于助人的中文 AI 助手。

规则：
1. 需要实时天气时，调用 get_weather，并用工具返回的数据作答；不要凭空编造天气。
2. 需要精确计算时，调用 calculate，把表达式交给它算，不要心算。
3. 需要创建或修改文件时，用 file_write（创建/覆盖）与 file_edit（精确替换文本）工具，
   不要用 shell 命令写文件。
4. 需要运行 shell 命令（删除文件、打印输出等）时，调用 shell 工具。
5. 普通闲聊不要调用任何工具。回复保持中文、友好、简洁。
`.trim();

export function buildTools(): ToolSet {
  const contractFiles = createContractFileTools();
  return {
    get_weather: tool({
      description: "查询某个城市的当前天气。需要实时天气时调用。",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: async (input: { city: string }) => getWeather(input),
    }),
    calculate: tool({
      description: "计算一个四则运算表达式(支持 + - * / 和括号)。需要精确计算时调用。",
      inputSchema: z.object({ expression: z.string().min(1) }),
      // HITL surface: the SDK pauses the tool loop and emits a tool-approval-request;
      // execute only runs after the caller resolves it (approve/deny).
      needsApproval: true,
      execute: async (input: { expression: string }) => calculate(input),
    }),
    file_write: tool({
      description: "在工作目录创建或覆盖一个文件。内容精确写入，父目录自动创建。",
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async (input: { path: string; content: string }) => contractFiles.writeFile(input),
    }),
    file_edit: tool({
      description: "把工作目录某个文件里的 oldText 全部替换为 newText。oldText 不存在时报错。",
      inputSchema: z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }),
      execute: async (input: { path: string; oldText: string; newText: string }) => contractFiles.editFile(input),
    }),
    shell: tool({
      description: "在工作目录运行一条 shell 命令（bash -c），返回 stdout。删除文件或打印输出时用。",
      inputSchema: z.object({ command: z.string().min(1) }),
      execute: async (input: { command: string }) => contractFiles.runShell(input),
    }),
  };
}
