// cases: docs/engineering/testing/unit/reports.md
// 「resolve 与组合组件」「定义入口」「外部数据快照与确定性」「Composition 的展开与缓存」
//
// 断言面是 resolve 后的 props.data、Source.compute 调用次数与抛错文案——不经浏览器。

import { describe, expect, it } from "vitest";

import type { Sample } from "../../record/index.ts";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import {
  defineComponent,
  resolveReportTree,
  validateReportTree,
  ResolveMemo,
  type ReportElement,
  type ReportNode,
} from "./tree.ts";
import { buildReportMeta, defineReport } from "./report.ts";
import { defineComposition, defineSource, type Source } from "../source.ts";
import { Col, Text } from "./primitives.tsx";

function resolveEnv(scope: Sample, data?: Readonly<Record<string, unknown>>) {
  const { results } = emptyScopeAndResults();
  const definition = defineReport(<Col />);
  return {
    scope,
    results:
      scope.runs.length > 0
        ? ({
            experiments: [],
            unreadable: [],
            latest: () => scope,
            current: () => scope,
          } as unknown as typeof results)
        : results,
    report: buildReportMeta(definition, scope),
    page: { id: "main", input: "scope" as const },
    memo: new ResolveMemo(),
    data,
  };
}

async function resolve(node: ReportNode, scope: Sample = scopeOf([]), data?: Readonly<Record<string, unknown>>) {
  const resolved = await resolveReportTree(node, resolveEnv(scope, data));
  validateReportTree(resolved);
  return resolved as ReportElement;
}

type SinkContent = { n: number };
type SinkProps =
  | { data: SinkContent; source?: never; input?: never; className?: string }
  | { source: Source<Sample, SinkContent>; data?: never; input?: Sample; className?: string };

const Sink = defineComponent<SinkProps, { data: SinkContent; className?: string }>({
  dimensions: () => ({}),
  web: ({ data }) => <span data-n={data.n} />,
  text: ({ data }) => `n=${data.n}`,
});
Sink.displayName = "Sink";

describe("定义入口", () => {
  it("defineSource 保留传入对象引用,缺 name/compute 给完整反馈", () => {
    const def = { name: "t", compute: async () => 1 };
    expect(defineSource(def)).toBe(def);
    expect(() => defineSource({ name: "", compute: async () => 1 })).toThrow(/non-empty source name/);
    expect(() =>
      defineSource({ name: "t", compute: undefined as unknown as () => Promise<number> }),
    ).toThrow(/requires compute/);
  });

  it("defineComposition 保留 expand,缺函数给完整反馈;宿主外直接调用报错", () => {
    const expand = async () => <Text>x</Text>;
    const composition = defineComposition(expand);
    expect(composition.expand).toBe(expand);
    expect(() => defineComposition(undefined as never)).toThrow(/requires an expand/);
    expect(() => composition({})).toThrow(/only render inside the NiceEval report resolve pipeline/);
  });

  it("defineComponent 缺一面给完整反馈", () => {
    expect(() =>
      defineComponent({ web: () => null } as never),
    ).toThrow(/requires both faces/);
  });
});

describe("resolve 与组合组件 · source/data", () => {
  it("source 形态与「先 compute 再传 data」严格等价", async () => {
    const scope = scopeOf([]);
    let calls = 0;
    const source = defineSource({
      name: "eq",
      compute: async (input: Sample) => {
        calls += 1;
        return { n: input.runs.length + 7 };
      },
    });
    const content = await source.compute(scope);
    const fromSource = await resolve(<Sink source={source} />, scope);
    const fromData = await resolve(<Sink data={content} />, scope);
    expect(fromSource.props.data).toEqual(content);
    expect(fromData.props.data).toEqual(content);
    expect(fromSource.props.source).toBeUndefined();
    expect(calls).toBe(2); // 一次手工 + 一次管线
  });

  it("显式 input 覆盖 page 注入;省略时用 page input", async () => {
    const pageScope = scopeOf([]);
    const other = Object.assign(scopeOf([]), { __tag: "other" });
    const seen: unknown[] = [];
    const source = defineSource({
      name: "input-override",
      compute: async (input: Sample) => {
        seen.push(input);
        return { n: seen.length };
      },
    });
    await resolve(<Sink source={source} />, pageScope);
    await resolve(<Sink source={source} input={other} />, pageScope);
    expect(seen[0]).toBe(pageScope);
    expect(seen[1]).toBe(other);
  });

  it("同时给 source 与 data 按完整用户反馈拒绝", async () => {
    const source = defineSource({ name: "both", compute: async () => ({ n: 1 }) });
    await expect(
      resolve(
        // @ts-expect-error 互斥
        <Sink source={source} data={{ n: 2 }} />,
      ),
    ).rejects.toThrow(/both `source` and `data`/);
  });

  it("同层 sibling 并行取数且输出保序", async () => {
    let active = 0;
    let maxActive = 0;
    const mk = (n: number) =>
      defineSource({
        name: `p-${n}`,
        compute: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 20));
          active -= 1;
          return { n };
        },
      });
    const tree = await resolve(
      <Col>
        <Sink source={mk(1)} />
        <Sink source={mk(2)} />
        <Sink source={mk(3)} />
      </Col>,
    );
    expect(maxActive).toBeGreaterThan(1);
    const children = tree.props.children as Array<{ props: { data: { n: number } } }>;
    expect(children.map((c) => c.props.data.n)).toEqual([1, 2, 3]);
  });
});

describe("Composition 的展开与缓存", () => {
  it("ctx.resolve 与同页 source= 命中同一缓存,只算一次", async () => {
    let calls = 0;
    const source = defineSource({
      name: "shared",
      compute: async () => {
        calls += 1;
        return { n: 42 };
      },
    });
    const Comp = defineComposition(async (_props: object, ctx) => {
      const data = await ctx.resolve(source);
      return (
        <Col>
          <Sink data={data} />
          <Sink source={source} />
        </Col>
      );
    });
    const tree = await resolve(<Comp />);
    expect(calls).toBe(1);
    const children = tree.props.children as Array<{ props: { data: { n: number } } }>;
    expect(children.map((c) => c.props.data.n)).toEqual([42, 42]);
  });

  it("缓存的是 Promise:并发只算一次,失败广播给两者", async () => {
    let calls = 0;
    const source = defineSource({
      name: "fail-once",
      compute: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("boom");
      },
    });
    const Comp = defineComposition(async () => (
      <Col>
        <Sink source={source} />
        <Sink source={source} />
      </Col>
    ));
    await expect(resolve(<Comp />)).rejects.toThrow(/boom/);
    expect(calls).toBe(1);
  });

  it("同一 Composition 用在两处各展开一次,内部 ctx.resolve 仍共享 Source 缓存", async () => {
    let expands = 0;
    let computes = 0;
    const source = defineSource({
      name: "inner",
      compute: async () => {
        computes += 1;
        return { n: 1 };
      },
    });
    const Comp = defineComposition(async () => {
      expands += 1;
      return <Sink source={source} />;
    });
    await resolve(
      <Col>
        <Comp />
        <Comp />
      </Col>,
    );
    expect(expands).toBe(2);
    expect(computes).toBe(1);
  });

  it("ctx.resolve(source, input) 与组件 source=+input= 命中同一缓存", async () => {
    const pageScope = scopeOf([]);
    const other = Object.assign(scopeOf([]), { __tag: "other" });
    let calls = 0;
    const source = defineSource({
      name: "explicit-input",
      compute: async () => {
        calls += 1;
        return { n: 99 };
      },
    });
    const Comp = defineComposition(async () => (
      <Col>
        <Sink source={source} input={other} />
      </Col>
    ));
    const Handwritten = defineComposition(async (_props, ctx) => {
      const data = await ctx.resolve(source, other);
      return <Sink data={data} />;
    });
    await resolve(
      <Col>
        <Comp />
        <Handwritten />
      </Col>,
      pageScope,
    );
    expect(calls).toBe(1);
  });

  it("expand 同步返回也被 await", async () => {
    const Comp = defineComposition((_props: object, ctx) => {
      expect(ctx.data).toEqual({});
      expect(ctx.report.title).toBeDefined();
      return <Text>sync</Text>;
    });
    const tree = await resolve(<Comp />);
    expect(tree.props.children).toBe("sync");
  });
});

describe("外部数据快照与确定性", () => {
  it("缺省 ctx.data 是空对象;注入快照冻结且两次 resolve 同值", async () => {
    const snapshot = { budgets: { a: 1 }, nested: { x: true } };
    const seen: unknown[] = [];
    const Comp = defineComposition((_props: object, ctx) => {
      seen.push(ctx.data);
      expect(Object.isFrozen(ctx.data)).toBe(true);
      expect(Object.isFrozen((ctx.data as { nested: object }).nested)).toBe(true);
      return <Text>{JSON.stringify(ctx.data)}</Text>;
    });
    const a = await resolve(<Comp />, scopeOf([]), snapshot);
    const b = await resolve(<Comp />, scopeOf([]), snapshot);
    expect(seen[0]).toEqual(snapshot);
    expect(a.props.children).toBe(b.props.children);
    const Bare = defineComposition((_props: object, ctx) => {
      expect(ctx.data).toEqual({});
      return <Text>ok</Text>;
    });
    await resolve(<Bare />);
  });
});
