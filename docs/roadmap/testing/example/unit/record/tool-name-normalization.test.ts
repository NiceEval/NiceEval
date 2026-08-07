// cases: docs/engineering/testing/unit/adapters.md
import { describe, expect, it } from "vitest";
import { normalizeToolName } from "../../../../../../src/o11y/tool-names.ts";

// 本单元只证明 NiceEval 自有的确定性基表：normalizeToolName 只计算旁边的规范
// `tool: ToolName` 分类，不覆盖也不丢失事件原始 `name`——返回 "unknown" 只表示
// 这条名称进不了规范分类；原始名由 adapter E2E 在 StreamEvent.operation.name 上证明。
describe("normalizeToolName 的规范 ToolName 映射", () => {
  it("把确定性复合别名映射为 NiceEval 的规范工具名", () => {
    expect(normalizeToolName("read_file")).toBe("file_read");
    expect(normalizeToolName("command_execution")).toBe("shell");
    expect(normalizeToolName("web_search")).toBe("web_search");
  });

  it("匹配工具名时忽略大小写", () => {
    expect(normalizeToolName("BASH")).toBe("shell");
    expect(normalizeToolName("Read_File")).toBe("file_read");
  });

  it("不认识的名称返回 unknown，不猜测为另一个规范工具", () => {
    expect(normalizeToolName("application_search")).toBe("unknown");
  });

  it("search/run 等裸单字动词不猜成系统工具，留给确知 transcript 词汇的 parser 显式 opt-in", () => {
    expect(normalizeToolName("search")).toBe("unknown");
    expect(normalizeToolName("run")).toBe("unknown");
  });
});
