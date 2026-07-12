// captureEvalSource 的单测(定稿见 docs/feature/results/architecture.md「sources.json」)。
// 覆盖:哈希确定性、path 相对 root 计算、CRLF/BOM 归一化行为、与 results/source-hash.ts
// 算法保持一致(两处哈希必须逐字节相同,见 eval-source.ts 顶部注释)。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashEvalSource, normalizeEvalSource } from "../results/source-hash.ts";
import { captureEvalSource } from "./eval-source.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-eval-source-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("captureEvalSource", () => {
  it("computes a deterministic sha256 for the same file content", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const file = join(root, "evals", "weather.eval.ts");
    await writeFile(file, "export default { id: 'weather' };\n", "utf-8");

    const first = await captureEvalSource(file, { root });
    const second = await captureEvalSource(file, { root });

    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a path relative to the given root, using forward slashes", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals", "nested"), { recursive: true });
    const file = join(root, "evals", "nested", "weather.eval.ts");
    await writeFile(file, "x\n", "utf-8");

    const captured = await captureEvalSource(file, { root });

    expect(captured.path).toBe("evals/nested/weather.eval.ts");
  });

  it("defaults root to process.cwd() when omitted", async () => {
    const root = await makeRoot();
    const cwdBefore = process.cwd();
    process.chdir(root);
    try {
      // 用 chdir 之后的 process.cwd() 拼绝对路径:mkdtemp 返回的 root 与 chdir 后的
      // process.cwd() 在 macOS 上可能因 /var → /private/var 的符号链接解析而不是同一字符串,
      // 直接比较 root 会因这条无关的平台差异误报,不是本函数要覆盖的行为。
      const file = join(process.cwd(), "weather.eval.ts");
      await writeFile(file, "x\n", "utf-8");
      const captured = await captureEvalSource(file);
      expect(captured.path).toBe("weather.eval.ts");
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it("normalizes CRLF to LF so cross-platform checkouts hash identically", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const lfFile = join(root, "evals", "lf.eval.ts");
    const crlfFile = join(root, "evals", "crlf.eval.ts");
    const body = "line one\nline two\nline three\n";
    await writeFile(lfFile, body, "utf-8");
    await writeFile(crlfFile, body.replace(/\n/g, "\r\n"), "utf-8");

    const lf = await captureEvalSource(lfFile, { root });
    const crlf = await captureEvalSource(crlfFile, { root });

    expect(crlf.content).toBe(lf.content);
    expect(crlf.sha256).toBe(lf.sha256);
  });

  it("strips a UTF-8 BOM from the captured content", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const withBom = join(root, "evals", "bom.eval.ts");
    const withoutBom = join(root, "evals", "no-bom.eval.ts");
    await writeFile(withBom, "﻿export default {};\n", "utf-8");
    await writeFile(withoutBom, "export default {};\n", "utf-8");

    const a = await captureEvalSource(withBom, { root });
    const b = await captureEvalSource(withoutBom, { root });

    expect(a.content).toBe(b.content);
    expect(a.content.startsWith("﻿")).toBe(false);
    expect(a.sha256).toBe(b.sha256);
  });

  it("matches results/source-hash.ts's normalize+hash algorithm exactly", async () => {
    const root = await makeRoot();
    const file = join(root, "weather.eval.ts");
    const raw = "export default {};\r\n// comment\r\n";
    await writeFile(file, raw, "utf-8");

    const captured = await captureEvalSource(file, { root });

    expect(captured.content).toBe(normalizeEvalSource(raw));
    expect(captured.sha256).toBe(hashEvalSource(normalizeEvalSource(raw)));
  });

  it("rejects two files with different content by producing different hashes", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const fileA = join(root, "evals", "a.eval.ts");
    const fileB = join(root, "evals", "b.eval.ts");
    await writeFile(fileA, "content a\n", "utf-8");
    await writeFile(fileB, "content b\n", "utf-8");

    const a = await captureEvalSource(fileA, { root });
    const b = await captureEvalSource(fileB, { root });

    expect(a.sha256).not.toBe(b.sha256);
  });
});
