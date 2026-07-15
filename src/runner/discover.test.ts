// discoverEvals 的 eval 源码捕获:同一文件(数组默认导出)共享一份 CapturedEvalSource,
// 内容/路径/哈希与 captureEvalSource() 直接调出来的一致(定稿见 docs/concepts.md「标注 Eval 源码」)。

import { describe, expect, it, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverEvals } from "./discover.ts";
import { captureEvalSource } from "./eval-source.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-discover-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("discoverEvals · 源码捕获", () => {
  it("单个默认导出:source 与 captureEvalSource() 直接调出来的一致(路径/内容/哈希)", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const file = join(root, "evals", "hello.eval.ts");
    await writeFile(file, 'export default {\n  test() {},\n};\n', "utf-8");

    const evals = await discoverEvals(root);
    expect(evals).toHaveLength(1);
    const expected = await captureEvalSource(file, { root });
    expect(evals[0]!.source).toEqual(expected);
    expect(evals[0]!.source.path).toBe("evals/hello.eval.ts");
  });

  it("数组默认导出:多个 eval 共享同一份 CapturedEvalSource 引用(同哈希,同一个文件只读一次)", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const file = join(root, "evals", "batch.eval.ts");
    await writeFile(
      file,
      "export default [\n  { test() {} },\n  { test() {} },\n];\n",
      "utf-8",
    );

    const evals = await discoverEvals(root);
    expect(evals.map((e) => e.id)).toEqual(["batch/0000", "batch/0001"]);
    expect(evals[0]!.source).toBe(evals[1]!.source); // 同一份引用,不是内容相等的两份拷贝
    expect(evals[0]!.source.sha256).toHaveLength(64);
  });

  it("keyed record 默认导出:业务 key 进入 id，按 key 字典序稳定排列并共享源码引用", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const file = join(root, "evals", "issues.eval.ts");
    await writeFile(
      file,
      "export default {\n  '25901': { test() {} },\n  '15193': { test() {} },\n};\n",
      "utf-8",
    );

    const evals = await discoverEvals(root);
    expect(evals.map((e) => e.id)).toEqual(["issues/15193", "issues/25901"]);
    expect(evals[0]!.source).toBe(evals[1]!.source);
  });

  it("空 keyed record 合法且不产生 eval", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    await writeFile(join(root, "evals", "empty.eval.ts"), "export default {};\n", "utf-8");

    await expect(discoverEvals(root)).resolves.toEqual([]);
  });

  it.each(["", ".", "..", "a/b", "a\\b", "line\nbreak"])(
    "keyed record 拒绝非法业务 key %j",
    async (key) => {
      const root = await makeRoot();
      await mkdir(join(root, "evals"), { recursive: true });
      await writeFile(
        join(root, "evals", "bad.eval.ts"),
        `export default Object.fromEntries([[${JSON.stringify(key)}, { test() {} }]]);\n`,
        "utf-8",
      );

      await expect(discoverEvals(root)).rejects.toThrow(/Invalid keyed eval dataset key/);
    },
  );

  it("keyed record 的每个值都必须是 EvalDef", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    await writeFile(join(root, "evals", "bad-value.eval.ts"), "export default { issue: {} };\n", "utf-8");

    await expect(discoverEvals(root)).rejects.toThrow(/must map to an EvalDef with test/);
  });

  it("CRLF 源码归一化后哈希与 LF 版本一致(discovery 侧与 collectSources/annotated-source 共用归一化)", async () => {
    const rootLf = await makeRoot();
    const rootCrlf = await makeRoot();
    await mkdir(join(rootLf, "evals"), { recursive: true });
    await mkdir(join(rootCrlf, "evals"), { recursive: true });
    const body = "export default {\n  test() {},\n};\n";
    await writeFile(join(rootLf, "evals", "a.eval.ts"), body, "utf-8");
    await writeFile(join(rootCrlf, "evals", "a.eval.ts"), body.replace(/\n/g, "\r\n"), "utf-8");

    const [lf] = await discoverEvals(rootLf);
    const [crlf] = await discoverEvals(rootCrlf);
    expect(lf!.source.sha256).toBe(crlf!.source.sha256);
    expect(crlf!.source.content).toBe(body); // 归一化后不含 \r
  });
});
