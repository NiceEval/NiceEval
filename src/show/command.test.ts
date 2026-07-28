// cases: docs/engineering/testing/unit/reports.md
// 「show 终端宿主的选择、时间轴与文案」——show 专属的索引命令拼装(showCommand)与其余页索引文案
// (otherPagesText):拼出的是可复现命令文本这个数据契约本身,不是终端渲染的哪个位置,断言面是
// 返回字符串的内容与包含关系。

import { describe, expect, it } from "vitest";
import { showCommand } from "./command.ts";
import { otherPagesText } from "./render.ts";

describe("其余页索引与索引命令上下文", () => {
  const pages = [
    { id: "overview", title: { en: "Overview", "zh-CN": "总览" } },
    { id: "exam", title: { en: "Exam", "zh-CN": "成绩单" } },
  ];

  it("只列未渲染的页,索引命令保留当前 --record / --report 与位置参数,复制即可复现下一层视图", () => {
    // 渲染的是 overview,其余页索引只含 exam 一行——与「渲染初始页 + 尾部附其余页索引」
    // 的行为一致(docs/feature/reports/show/reports.md Case 2)。
    const text = otherPagesText({
      otherPages: pages.filter((p) => p.id !== "overview"),
      command: { patterns: [], record: "tmp/published-record", report: "reports/site.tsx" },
      locale: "zh-CN",
    });
    expect(text).toContain("其余页：");
    expect(text).toContain("niceeval show --record tmp/published-record --report reports/site.tsx --page exam");
    expect(text).toContain("成绩单");
    expect(text).not.toContain("总览");
    expect(text).not.toContain("--page overview");
  });

  it("showCommand 按序携带位置参数与 --exp / --record / --report / --page", () => {
    expect(
      showCommand({ patterns: ["memory/swelancer"], experiment: "dev-e2b", report: "reports/site.tsx", page: "exam" }),
    ).toBe("niceeval show memory/swelancer --exp dev-e2b --report reports/site.tsx --page exam");
  });
});
