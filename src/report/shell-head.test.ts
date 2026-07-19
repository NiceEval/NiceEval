// cases: docs/engineering/unit-tests/reports/cases.md
// 覆盖登记行:外壳 head 通道的白名单/宿主单例/attrs/children/scheme 分流装载校验,
// 与 scripts {src} 外链拒绝。
// defineReport 是装载校验的第一期(shell.md「校验分两期」),全部用例不落盘、不进渲染。

import { describe, expect, it } from "vitest";

import type { Scope } from "../results/index.ts";
import { buildReportMeta, defineReport } from "./report.ts";

const emptyScope = { snapshots: [] } as unknown as Scope;

describe("defineReport head 通道(装载校验)", () => {
  it("tag 白名单是 meta/link/script/style,白名单外装载报错;title 指引到 title 字段", () => {
    expect(() => defineReport({ content: null, head: [{ tag: "base", attrs: {} } as never] })).toThrow(
      /not allowed/,
    );
    expect(() => defineReport({ content: null, head: [{ tag: "title", attrs: {} } as never] })).toThrow(
      /"title" field/,
    );
    expect(() => defineReport({ content: null, head: [{ tag: "iframe", attrs: {} } as never] })).toThrow(
      /meta.*link.*script.*style/,
    );
  });

  it("宿主自有单例:meta charset 与 meta name=viewport 装载报错", () => {
    expect(() => defineReport({ content: null, head: [{ tag: "meta", attrs: { charset: "utf-8" } }] })).toThrow(
      /owned by the host shell/,
    );
    expect(() =>
      defineReport({ content: null, head: [{ tag: "meta", attrs: { name: "Viewport", content: "x" } }] }),
    ).toThrow(/owned by the host shell/);
  });

  it("children:meta/link 不收;script children 含 </script> 装载报错(该上下文无法转义)", () => {
    expect(() =>
      defineReport({ content: null, head: [{ tag: "link", attrs: { rel: "icon" }, children: "x" } as never] }),
    ).toThrow(/void element/);
    expect(() =>
      defineReport({
        content: null,
        head: [{ tag: "script", children: 'document.write("</script>")' }],
      }),
    ).toThrow(/cannot be escaped/);
    expect(() =>
      defineReport({ content: null, head: [{ tag: "style", children: "</StYlE>" }] }),
    ).toThrow(/cannot be escaped/);
  });

  it("attrs:值只收 string 或 true(裸布尔属性);非法属性名装载报错", () => {
    expect(() =>
      defineReport({ content: null, head: [{ tag: "script", attrs: { async: 1 } as never }] }),
    ).toThrow(/string or true/);
    expect(() =>
      defineReport({ content: null, head: [{ tag: "meta", attrs: { 'bad name"': "x" } }] }),
    ).toThrow(/attribute name/);
    expect(() =>
      defineReport({
        content: null,
        head: [{ tag: "script", attrs: { async: true, "data-project": "p1", src: "https://cdn.example/x.js" } }],
      }),
    ).not.toThrow();
  });

  it("src/href 按 scheme 分流:http(s) 外链与本地相对路径合法;protocol-relative 与其它 scheme 装载报错", () => {
    expect(() =>
      defineReport({ content: null, head: [{ tag: "link", attrs: { rel: "icon", href: "./favicon.svg" } }] }),
    ).not.toThrow();
    expect(() =>
      defineReport({ content: null, head: [{ tag: "script", attrs: { src: "//cdn.example/x.js" } }] }),
    ).toThrow(/protocol-relative/);
    expect(() =>
      defineReport({ content: null, head: [{ tag: "script", attrs: { src: "data:text/javascript,1" } }] }),
    ).toThrow(/scheme other than http/);
    expect(() =>
      defineReport({ content: null, head: [{ tag: "link", attrs: { rel: "icon", href: "../up.svg" } }] }),
    ).toThrow(/".." segments/);
    expect(() =>
      defineReport({ content: null, head: [{ tag: "link", attrs: { rel: "icon", href: "/abs.svg" } }] }),
    ).toThrow(/absolute paths/);
  });

  it("scripts/styles 的 {src} 只收本地路径:外链装载报错并给出 head 写法", () => {
    expect(() => defineReport({ content: null, scripts: [{ src: "https://cdn.example/x.js" }] })).toThrow(
      /Declare third-party external tags in "head"/,
    );
    expect(() => defineReport({ content: null, styles: [{ src: "//fonts.example/a.css" }] })).toThrow(
      /Declare third-party external tags in "head"/,
    );
  });

  it("规范化:省略 head 恒为空数组,声明原样进产物;head 是注入资产,不进 ctx.report", () => {
    expect(defineReport({ content: null }).head).toEqual([]);
    const head = [
      { tag: "script" as const, attrs: { async: true as const, src: "https://cdn.example/x.js" } },
      { tag: "script" as const, children: "window.x = 1;" },
    ];
    const definition = defineReport({ content: null, head });
    expect(definition.head).toEqual(head);
    expect(buildReportMeta(definition, emptyScope)).not.toHaveProperty("head");
  });
});
