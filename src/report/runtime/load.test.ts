// cases: docs/engineering/testing/unit/reports.md
// 「外壳与页面装载」：报告模块按文件所属项目的 tsconfig 编译 JSX，不受调用进程 cwd 影响。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadReportFile } from "./load.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("报告文件项目边界", () => {
  it("跨 cwd 装载 TSX 时使用报告旁的 react-jsx tsconfig", async () => {
    const root = await mkdtemp(join(process.cwd(), ".niceeval-report-load-"));
    roots.push(root);
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "react-jsx", module: "NodeNext", moduleResolution: "NodeNext" } }),
    );
    await writeFile(
      join(root, "report.tsx"),
      `import { Col, defineReport } from "../src/report/index.ts";\n` +
        `export default defineReport(() => <Col>foreign cwd</Col>);\n`,
    );

    const report = await loadReportFile("/", join(root, "report.tsx"));
    expect(report.kind).toBe("report");
    expect(report.pages).toHaveLength(1);
    expect(() => report.pages[0]!.render({} as never)).not.toThrow();
  });
});
