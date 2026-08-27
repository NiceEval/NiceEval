import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 仓库守护:根 INIT.md 是 AI 接入指引的唯一原本,产品站把它按 https://niceeval.com/INIT.md
// 原样发出去,靠的是 apps/site/public/INIT.md 这个符号链接。链接一旦断掉(被替换成普通文件、
// 或指错路径),两份就开始各自演化,而站上发的那份会停在被替换的那一刻——静默,
// 因为普通文件同样能构建成功、同样能访问。
const ROOT = resolve(import.meta.dirname, "../..");
const LINK = join(ROOT, "apps/site/public/INIT.md");

describe("产品站发出去的 INIT.md 与仓库根同源", () => {
  it("apps/site/public/INIT.md 是指向根 INIT.md 的符号链接", () => {
    // 断言"是链接"而不是"内容相同":内容比对在被替换成同内容副本的那一刻是绿的,
    // 恰好放过了漂移开始的那一刻——之后每次改根 INIT.md 都会悄悄拉开差距。
    expect(
      lstatSync(LINK).isSymbolicLink(),
      "apps/site/public/INIT.md 不是符号链接;恢复:ln -sf ../../../INIT.md apps/site/public/INIT.md",
    ).toBe(true);
    expect(readlinkSync(LINK)).toBe("../../../INIT.md");
  });

  it("链接读得到内容", () => {
    // 指向不存在的路径时 readlink 仍然返回那个字符串,只有读内容才会炸。
    expect(readFileSync(LINK, "utf8")).toBe(readFileSync(join(ROOT, "INIT.md"), "utf8"));
  });
});
