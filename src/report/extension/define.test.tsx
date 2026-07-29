// cases: docs/engineering/testing/unit/reports.md
// defineRenderer 双面协议
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { Col } from "../definition/primitives.tsx";
import { defineReport } from "../definition/report.ts";
import { createTextContext, facesOf, renderNodeToText, validateReportTree } from "../definition/tree.ts";
import {
  collectRendererAssetDeclarations,
  defineRenderer,
  materializeRendererAssets,
} from "./index.ts";
import { emptyScopeAndResults } from "../components/scope.harness.ts";

interface MatrixValue {
  readonly rows: readonly (readonly number[])[];
}

const Matrix = defineRenderer<MatrixValue, { title?: string }>(
  {
    assets: {
      styles: ["./matrix.css"],
      scripts: ["./matrix.enhance.js"],
    },
    text(value, options) {
      const header = options.title ? `${options.title}\n` : "";
      return header + value.rows.map((row) => row.join("\t")).join("\n");
    },
    web(value, options) {
      return (
        <div data-matrix-title={options.title ?? ""} data-matrix-rows={value.rows.length}>
          {value.rows.map((row, rowIndex) => (
            <div key={rowIndex} data-row={row.join(",")} />
          ))}
        </div>
      );
    },
  },
  import.meta.url,
);

describe("defineRenderer 双面协议", () => {
  it("缺 text 或 web 在定义期按完整用户反馈拒绝", () => {
    expect(() => defineRenderer({ web: () => null } as never)).toThrow(/both faces/);
    expect(() => defineRenderer({ text: () => "" } as never)).toThrow(/both faces/);
    expect(() =>
      defineRenderer({
        text: () => "",
        web: () => null,
      }),
    ).not.toThrow();
  });

  it("非法 asset 路径在定义期按完整用户反馈拒绝", () => {
    expect(() =>
      defineRenderer({
        text: () => "",
        web: () => null,
        assets: { styles: ["../escape.css"] },
      }),
    ).toThrow(/no "\.\." segments/);
    expect(() =>
      defineRenderer({
        text: () => "",
        web: () => null,
        assets: { scripts: ["https://cdn.example/x.js"] },
      }),
    ).toThrow(/external URL/);
  });

  it("Promise 与非可序列化 props 在渲染期按完整用户反馈拒绝", () => {
    const Probe = defineRenderer<{ n: number }>({
      text: (value) => String(value.n),
      web: (value) => <span>{value.n}</span>,
    });
    const faces = facesOf(Probe) as {
      text: (props: unknown, ctx: unknown) => string;
    };
    const ctx = createTextContext();
    expect(() => faces.text({ value: Promise.resolve({ n: 1 }) }, ctx)).toThrow(/Promise/);
    const withFn = { value: { n: 1 }, fn: () => 0 };
    expect(() => faces.text(withFn, ctx)).toThrow(/non-serializable/);
  });

  it("text 与 web 各消费同一份 value + options,不经 Source 取数", () => {
    const value: MatrixValue = { rows: [[1, 0], [0, 1]] };
    const props = { value, title: "Confusion" };
    const faces = facesOf(Matrix) as {
      text: (p: typeof props, ctx: ReturnType<typeof createTextContext>) => string;
      web: (p: typeof props, ctx: { locale: "en"; dimension: (h: string) => never }) => unknown;
    };
    const text = faces.text(props, createTextContext());
    expect(text).toBe("Confusion\n1\t0\n0\t1");

    const webCtx = {
      locale: "en" as const,
      dimension: (handle: string): never => {
        throw new Error(`unexpected dimension query: ${handle}`);
      },
    };
    const web = faces.web(props, webCtx) as { props: { "data-matrix-title": string } };
    expect(web.props["data-matrix-title"]).toBe("Confusion");
  });

  it("接入 validateReportTree 与 renderNodeToText,与 defineComponent 同树资格", () => {
    const tree = (
      <Col>
        <Matrix value={{ rows: [[9]] }} title="Probe" />
      </Col>
    );
    expect(() => validateReportTree(tree)).not.toThrow();
    expect(renderNodeToText(tree, createTextContext())).toContain("Probe");
    expect(renderNodeToText(tree, createTextContext())).toContain("9");
  });

  it("只收集页面上实际出现的 renderer 资产,未使用组件不进清单", () => {
    const tree = (
      <Col>
        <Matrix value={{ rows: [[1]] }} />
      </Col>
    );
    const decls = collectRendererAssetDeclarations(tree);
    expect(decls).toHaveLength(1);
    expect(decls[0]?.styles).toEqual(["./matrix.css"]);
    expect(decls[0]?.scripts).toEqual(["./matrix.enhance.js"]);
    expect(decls.some((d) => d.styles.includes("./unused.css"))).toBe(false);
  });

  it("CSS / JS 按内容哈希去重且输出顺序确定:styles 先于 scripts,同类保首次出现序", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niceeval-renderer-assets-"));
    const cssPath = join(dir, "shared.css");
    const jsPath = join(dir, "shared.js");
    const cssBytes = new TextEncoder().encode(".x{color:red}");
    const jsBytes = new TextEncoder().encode("console.log('x')");
    await writeFile(cssPath, cssBytes);
    await writeFile(jsPath, jsBytes);

    const moduleUrl = fileURLToPath(new URL(`file://${dir}/renderer.tsx`));
    const decls = [
      {
        moduleUrl,
        styles: ["./shared.css", "./shared.css"],
        scripts: ["./shared.js", "./shared.js"],
      },
      {
        moduleUrl,
        styles: ["./shared.css"],
        scripts: [],
      },
    ];

    const readFile = vi.fn(async (abs: string) => {
      if (abs === cssPath) return cssBytes;
      if (abs === jsPath) return jsBytes;
      throw new Error(`unexpected read: ${abs}`);
    });

    const materialized = await materializeRendererAssets(decls, readFile);
    expect(materialized.styles).toHaveLength(1);
    expect(materialized.scripts).toHaveLength(1);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(materialized.styles[0]?.path).toMatch(/^assets\/[a-f0-9]{64}\.css$/);
    expect(materialized.scripts[0]?.path).toMatch(/^assets\/[a-f0-9]{64}\.js$/);
  });

  it("text 渲染路径不物化 web assets", async () => {
    const definition = defineReport(() => (
      <Col>
        <Matrix value={{ rows: [[2, 3]] }} />
      </Col>
    ));
    const materializeSpy = vi.spyOn(await import("./assets.ts"), "materializeRendererAssets");
    const { renderReportToText } = await import("../runtime/text.ts");
    const output = await renderReportToText(definition, emptyScopeAndResults());
    expect(output).toContain("2");
    expect(materializeSpy).not.toHaveBeenCalled();
    materializeSpy.mockRestore();
  });
});

describe("niceeval/report/extension 公共子路径", () => {
  it("可从子路径导入 defineRenderer 并创建双面组件", async () => {
    const mod = await import("niceeval/report/extension");
    expect(typeof mod.defineRenderer).toBe("function");
    const Demo = mod.defineRenderer({
      text: (value: { n: number }) => String(value.n),
      web: (value: { n: number }) => <span>{value.n}</span>,
    });
    const faces = facesOf(Demo) as {
      text: (props: { value: { n: number } }, ctx: ReturnType<typeof createTextContext>) => string;
    };
    expect(faces.text({ value: { n: 3 } }, createTextContext())).toBe("3");
  });
});
