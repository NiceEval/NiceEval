import { describe, expect, it } from "vitest";
import { normalizeToolName } from "../../../../../../src/o11y/tool-names.ts";

// cases: docs/engineering/testing/unit/adapters.md
// 本单元只证明 NiceEval 自己拥有的确定性规范名映射；真实 Codex SDK 接线由 adapter E2E 拥有。
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
    expect(normalizeToolName("search")).toBe("unknown");
  });
});
