import { describe, expect, it } from "vitest";
import { createCodexThreadEventStream } from "../../../../../src/agents/sdk-streams.ts";

// regression: 060a6a05（Codex SDK command_execution 没有规范 tool，calledTool("shell")
// 静默失配）。转换算法定位在 createCodexThreadEventStream 的 handleToolItem——
// 本矩阵直接喂真实 ThreadEvent 形状，不抄一张别名表冒充转换器。
describe("Codex ThreadEvent 工具项 → 规范 ToolName（createCodexThreadEventStream）", () => {
  it("command_execution 的 started/completed 携带规范 tool: shell", () => {
    const stream = createCodexThreadEventStream();
    const started = stream.add({
      type: "item.started",
      item: { id: "cmd-1", type: "command_execution", command: "ls -la" },
    });
    expect(started).toMatchObject([
      {
        type: "operation.started",
        operationId: "cmd-1",
        operation: { kind: "tool", name: "command_execution", input: { command: "ls -la" }, tool: "shell" },
      },
    ]);

    const completed = stream.add({
      type: "item.completed",
      item: { id: "cmd-1", type: "command_execution", exit_code: 0 },
    });
    expect(completed).toMatchObject([
      {
        type: "operation.finished",
        operationId: "cmd-1",
        kind: "tool",
        output: { exit_code: 0 },
        status: "completed",
      },
    ]);
  });

  it("mcp_tool_call 按 Codex 别名表归一：bash → shell、file_change → file_edit", () => {
    const stream = createCodexThreadEventStream();
    const bash = stream.add({
      type: "item.started",
      item: { id: "mcp-1", type: "mcp_tool_call", server: "github", tool: "bash", arguments: {} },
    });
    expect(bash).toMatchObject([
      {
        type: "operation.started",
        operationId: "mcp-1",
        operation: { kind: "tool", name: "github.bash", input: {}, tool: "shell" },
      },
    ]);

    const patch = stream.add({
      type: "item.started",
      item: { id: "mcp-2", type: "mcp_tool_call", tool: "file_change", arguments: {} },
    });
    expect(patch).toMatchObject([
      {
        type: "operation.started",
        operationId: "mcp-2",
        operation: { kind: "tool", name: "file_change", tool: "file_edit" },
      },
    ]);
  });

  it("认不出的域内工具名规范化为 unknown，不猜测成别的规范名", () => {
    const stream = createCodexThreadEventStream();
    const events = stream.add({
      type: "item.started",
      item: { id: "mcp-3", type: "mcp_tool_call", tool: "some_future_type", arguments: {} },
    });
    expect(events).toMatchObject([
      {
        type: "operation.started",
        operationId: "mcp-3",
        operation: { kind: "tool", name: "some_future_type", tool: "unknown" },
      },
    ]);
  });

  it("web_search → web_search；file_change 补丁类只在 completed 落一对 called/result", () => {
    const stream = createCodexThreadEventStream();
    const search = stream.add({
      type: "item.started",
      item: { id: "web-1", type: "web_search", query: "niceeval" },
    });
    expect(search).toMatchObject([
      {
        type: "operation.started",
        operationId: "web-1",
        operation: { kind: "tool", name: "web_search", input: { query: "niceeval" }, tool: "web_search" },
      },
    ]);

    const patch = stream.add({
      type: "item.completed",
      item: {
        id: "fc-1",
        type: "file_change",
        changes: [{ path: "src/app.ts", kind: "edit" }],
      },
    });
    expect(patch).toMatchObject([
      {
        type: "operation.started",
        operationId: "fc-1#0",
        operation: { kind: "tool", name: "file_change", tool: "file_edit" },
      },
      {
        type: "operation.finished",
        operationId: "fc-1#0",
        kind: "tool",
        output: { path: "src/app.ts", kind: "edit" },
        status: "completed",
      },
    ]);
  });

  it("未知 item 类型不产任何事件，不把流里没定义的帧硬映射成工具", () => {
    const stream = createCodexThreadEventStream();
    expect(stream.add({ type: "item.started", item: { id: "x-1", type: "turn_start" } })).toEqual([]);
    expect(stream.add({ type: "item.completed", item: { id: "x-2", type: "response.done" } })).toEqual([]);
  });
});
