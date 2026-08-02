import type { ChatModelAdapter, ThreadAssistantMessagePart } from "@assistant-ui/react";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// assistant-ui ChatModelAdapter:把后端(server.ts)原样透传的 Claude Agent SDK
// `SDKMessage` SSE 流解析成 assistant-ui 的 content parts,每帧 yield 完整累积
// 的 content 数组(text 逐 token 增长,tool-call 带 args/result)。解析逻辑移植
// 自本目录旧版手写实现,已验证正确,尤其是块表按 index 键的约定(见下)。

// 服务器透传帧 = SDKMessage ∪ 一种传输层帧(query() 之外的服务器错误)。
type ServerFrame = SDKMessage | { type: "server_error"; message: string };

// 必须跟 agent.ts 里 canUseTool 判断用的字符串完全一致:后端决定"要不要真的
// 拦下来问",前端决定"要不要在这个工具气泡上画审批按钮"。
export const GATED_TOOL_NAME = "mcp__demo-tools__calculate";

// 会话续接:session_id 从 system/init 和 result 消息里拿,下一轮随请求带回
// (SDK 落盘在 ~/.claude/projects,服务端零会话状态)。模块级维护,跨 run 存活。
let sessionId: string | undefined;

// ── HITL 审批状态 ──────────────────────────────────────────────────────────
// assistant-ui 的 tool-call part 没有"参数已收齐、等人审批"这个槽位,所以审批
// 状态单独放一个模块级外部 store(按 toolUseId 键),工具气泡组件用
// useSyncExternalStore 订阅。SSE 流在审批等待期间一直开着,run() 的生成器挂在
// reader.read() 上自然阻塞,不需要 assistant-ui 的 requires-action 机制。

export type ApprovalState = "pending" | "decided" | "denied";

const approvalStates = new Map<string, ApprovalState>();
const approvalListeners = new Set<() => void>();

function setApprovalState(toolUseId: string, state: ApprovalState) {
  // denied 是终态(permission_denied 之后可能还跟着一条 is_error 的
  // tool_result,不能把 ⛔ 降级成普通失败气泡)。
  if (approvalStates.get(toolUseId) === "denied" && state !== "denied") return;
  approvalStates.set(toolUseId, state);
  for (const listener of approvalListeners) listener();
}

export function subscribeApprovals(listener: () => void): () => void {
  approvalListeners.add(listener);
  return () => approvalListeners.delete(listener);
}

export function getApprovalState(toolUseId: string): ApprovalState | undefined {
  return approvalStates.get(toolUseId);
}

export function respondApproval(toolUseId: string, approved: boolean) {
  setApprovalState(toolUseId, "decided");
  // 审批走独立端点,resolve 服务端内存里挂着的 Promise(见 server.ts +
  // pending-approvals.ts),原来那条 /api/chat 的 SSE 流随后自己继续。
  void fetch("/api/chat/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolUseId, approved }),
  });
}

// ── SDKMessage → content parts 累积 ────────────────────────────────────────

type Cell =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      id: string; // tool_use 块的 id,同时也是审批用的 toolUseId
      toolName: string;
      argsText: string; // input_json_delta 的 partial_json 逐段攒在这里
      args?: Record<string, unknown>; // content_block_stop 时 JSON.parse 的结果
      result?: string;
      isError?: boolean;
    }
  | { kind: "error"; text: string };

// content_block 在流式协议里按 index 定位:start 认识块类型,delta 逐段补内容,
// stop 收尾。注意 index 只在"当前这条 assistant 子消息"里唯一,而且每一帧
// stream_event 包装消息的 uuid 都不同(不能拿 uuid 当块的 key!),所以块表按
// index 键、在 message_start 时清空。cells 数组跨子消息累积不清。
type BlockState =
  | { kind: "text"; cell: Extract<Cell, { kind: "text" }> }
  | { kind: "reasoning"; cell: Extract<Cell, { kind: "reasoning" }> }
  | { kind: "tool_use"; cell: Extract<Cell, { kind: "tool" }> }
  | { kind: "other" };

type ClaudeStreamEvent =
  | { type: "message_start" }
  | { type: "content_block_start"; index: number; block: ClaudeContentBlock }
  | { type: "content_block_delta"; index: number; delta: ClaudeContentDelta }
  | { type: "content_block_stop"; index: number };

type ClaudeContentBlock =
  | { type: "text" }
  | { type: "thinking" }
  | { type: "tool_use"; id: string; name: string }
  | { type: "other" };

type ClaudeContentDelta =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "input_json_delta"; partialJson: string }
  | { type: "other" };

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseStreamEvent(value: unknown): ClaudeStreamEvent | undefined {
  const event = recordOf(value);
  if (!event || typeof event.type !== "string") return undefined;
  if (event.type === "message_start") return { type: "message_start" };
  if (event.type === "content_block_stop") {
    return typeof event.index === "number" ? { type: "content_block_stop", index: event.index } : undefined;
  }
  if (event.type === "content_block_start") {
    const block = recordOf(event.content_block);
    if (typeof event.index !== "number" || !block || typeof block.type !== "string") return undefined;
    if (block.type === "text") return { type: "content_block_start", index: event.index, block: { type: "text" } };
    if (block.type === "thinking") return { type: "content_block_start", index: event.index, block: { type: "thinking" } };
    if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      return { type: "content_block_start", index: event.index, block: { type: "tool_use", id: block.id, name: block.name } };
    }
    return { type: "content_block_start", index: event.index, block: { type: "other" } };
  }
  if (event.type === "content_block_delta") {
    const delta = recordOf(event.delta);
    if (typeof event.index !== "number" || !delta || typeof delta.type !== "string") return undefined;
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return { type: "content_block_delta", index: event.index, delta: { type: "text_delta", text: delta.text } };
    }
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      return { type: "content_block_delta", index: event.index, delta: { type: "thinking_delta", thinking: delta.thinking } };
    }
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      return { type: "content_block_delta", index: event.index, delta: { type: "input_json_delta", partialJson: delta.partial_json } };
    }
    return { type: "content_block_delta", index: event.index, delta: { type: "other" } };
  }
  return undefined;
}

class TurnState {
  readonly cells: Cell[] = [];
  readonly blocks = new Map<number, BlockState>();
  readonly toolCells = new Map<string, Extract<Cell, { kind: "tool" }>>();

  toolCell(toolUseId: string): Extract<Cell, { kind: "tool" }> {
    let cell = this.toolCells.get(toolUseId);
    if (!cell) {
      // 正常流程 tool_use 块先到;这里只是兜底(比如 resume 场景丢了 start 帧)。
      cell = { kind: "tool", id: toolUseId, toolName: "?", argsText: "" };
      this.toolCells.set(toolUseId, cell);
      this.cells.push(cell);
    }
    return cell;
  }

  pushError(text: string) {
    this.cells.push({ kind: "error", text });
  }

  // 每次 yield 都从 cells 重建全新的 parts 数组:assistant-ui 要求"每次 yield
  // 完整累积的 content",且 part 对象全新才能触发更新。
  toParts(): ThreadAssistantMessagePart[] {
    return this.cells.map((cell): ThreadAssistantMessagePart => {
      switch (cell.kind) {
        case "text":
          return { type: "text", text: cell.text };
        case "reasoning":
          return { type: "reasoning", text: cell.text };
        case "error":
          return { type: "text", text: `错误: ${cell.text}` };
        case "tool":
          return {
            type: "tool-call",
            toolCallId: cell.id,
            toolName: cell.toolName,
            args: (cell.args ?? {}) as Record<string, never>,
            argsText: cell.argsText,
            ...(cell.result !== undefined ? { result: cell.result } : {}),
            ...(cell.isError !== undefined ? { isError: cell.isError } : {}),
          };
      }
    });
  }
}

function handleStreamEvent(state: TurnState, rawEvent: unknown): boolean {
  const event = parseStreamEvent(rawEvent);
  if (!event) return false;
  switch (event.type) {
    case "message_start":
      // 新的一条 assistant 子消息开始,index 从 0 重新数,清掉上一条的块表。
      state.blocks.clear();
      return false;
    case "content_block_start": {
      const blockKey = event.index;
      const block = event.block;
      if (block.type === "text") {
        const cell = { kind: "text" as const, text: "" };
        state.cells.push(cell);
        state.blocks.set(blockKey, { kind: "text", cell });
      } else if (block.type === "thinking") {
        const cell = { kind: "reasoning" as const, text: "" };
        state.cells.push(cell);
        state.blocks.set(blockKey, { kind: "reasoning", cell });
      } else if (block.type === "tool_use") {
        const cell = { kind: "tool" as const, id: block.id, toolName: block.name, argsText: "" };
        state.cells.push(cell);
        state.toolCells.set(block.id, cell);
        state.blocks.set(blockKey, { kind: "tool_use", cell });
      } else {
        state.blocks.set(blockKey, { kind: "other" });
      }
      return true;
    }
    case "content_block_delta": {
      const blockKey = event.index;
      const blockState = state.blocks.get(blockKey);
      if (!blockState) return false;
      if (blockState.kind === "text" && event.delta.type === "text_delta") {
        blockState.cell.text += event.delta.text;
        return true;
      }
      if (blockState.kind === "reasoning" && event.delta.type === "thinking_delta") {
        blockState.cell.text += event.delta.thinking;
        return true;
      }
      if (blockState.kind === "tool_use" && event.delta.type === "input_json_delta") {
        blockState.cell.argsText += event.delta.partialJson;
        return true;
      }
      return false;
    }
    case "content_block_stop": {
      const blockKey = event.index;
      const blockState = state.blocks.get(blockKey);
      if (blockState?.kind !== "tool_use") return false;
      const cell = blockState.cell;
      let parsed: unknown = {};
      try {
        parsed = cell.argsText.trim() ? JSON.parse(cell.argsText) : {};
      } catch {
        parsed = { _raw: cell.argsText };
      }
      cell.args =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { _raw: cell.argsText };
      // gated 工具的 input 收齐后进入待审批态,工具气泡上画 允许/拒绝 按钮。
      if (cell.toolName === GATED_TOOL_NAME && cell.result === undefined) {
        setApprovalState(cell.id, "pending");
      }
      return true;
    }
    default:
      return false;
  }
}

function handleFrame(state: TurnState, frame: ServerFrame): boolean {
  switch (frame.type) {
    case "system":
      if (frame.subtype === "init") sessionId = frame.session_id;
      // 'system' 下还盖着 status/hook_started 等一堆 subtype,这里只关心拒绝。
      if (frame.subtype === "permission_denied") {
        setApprovalState(frame.tool_use_id, "denied");
        state.toolCell(frame.tool_use_id);
        return true;
      }
      return false;
    case "stream_event":
      return handleStreamEvent(state, frame.event);
    case "user": {
      // 工具结果以 user 消息里的 tool_result 块回来。
      const content = frame.message.content;
      if (!Array.isArray(content)) return false;
      let changed = false;
      for (const block of content) {
        if (typeof block !== "object" || block === null || (block as { type?: string }).type !== "tool_result") continue;
        const toolResult = block as {
          tool_use_id: string;
          is_error?: boolean;
          content?: string | Array<{ type?: string; text?: string }>;
        };
        const cell = state.toolCell(toolResult.tool_use_id);
        cell.result = toolResultText(toolResult.content);
        cell.isError = toolResult.is_error;
        setApprovalState(toolResult.tool_use_id, "decided");
        changed = true;
      }
      return changed;
    }
    case "assistant":
      if (frame.error) {
        state.pushError(String(frame.error));
        return true;
      }
      return false;
    case "result":
      sessionId = frame.session_id;
      if (frame.is_error) {
        const errors =
          "errors" in frame && Array.isArray(frame.errors) && frame.errors.length > 0
            ? frame.errors.join("; ")
            : `agent turn failed: ${frame.subtype}`;
        state.pushError(errors);
        return true;
      }
      return false;
    case "server_error":
      state.pushError(frame.message);
      return true;
    default:
      return false;
  }
}

function toolResultText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

// 手读 SSE:逐行切 `data: ` 帧,每帧一个 JSON。EventSource 只支持 GET,
// 所以这里用 fetch + ReadableStream 自己解析。
async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerFrame, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data: ")) continue;
      yield JSON.parse(line.slice("data: ".length)) as ServerFrame;
    }
  }
}

export const claudeAgentAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    // 后端协议一次只收一条新消息,历史靠 sessionId resume 找回,所以这里只取
    // 最后一条 user 消息的文本,不重放整个 messages 数组。
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const message = lastUser?.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (!message) return;

    const state = new TurnState();
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, sessionId }),
        // abortSignal 透传给 fetch:assistant-ui 的停止按钮(cancelRun)会中断
        // SSE 连接,服务端在 req close 时 interrupt 这一轮 query()。
        signal: abortSignal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      for await (const frame of readSseFrames(res.body)) {
        if (handleFrame(state, frame)) {
          yield { content: state.toParts() };
        }
      }
    } catch (err) {
      if (abortSignal.aborted) return;
      state.pushError(err instanceof Error ? err.message : String(err));
      yield { content: state.toParts() };
    }
  },
};
