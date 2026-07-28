import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 仓库守护:官方 stylesheet(src/report/assets/styles.css)的 niceeval-* 类名与组件实际
// 发射的类名必须对得上。两侧各写一套时类型系统一次都拦不住——CSS 规则打不到任何元素
// 不报错,组件少一条规则也不报错,症状只在浏览器里露出来(横滚失效、缩进塌掉、状态色消失)。
// 2026-07 SourceView 从专用件改成原语后就这样断过一次:CSS 停在旧类名,组件发新类名,
// 整块带标注源码在 attempt 详情里失去密度、横滚与状态染色,而 typecheck 与全部单测都是绿的。
//
// 两个方向都查:
//   1. 死 CSS —— 规则引用了没有任何发射方的类。带台账(REMOVED_COMPONENT_ORPHANS):
//      台账里的是「专用件换原语」时留下的旧类,只许变少;新增一条就红。
//   2. 无规则 —— attempt 详情各区块发射的字面类必须至少有一条规则,例外要在
//      STRUCTURAL_HOOKS_WITHOUT_RULES 里写明理由。
// 类名契约的正文在 docs/feature/reports/components/attempt-detail/presentation.md。

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CSS_PATH = join(REPO_ROOT, "src/report/assets/styles.css");

/** 已被移除的专用件留下的 CSS 类(AttemptSource/AttemptList/DeltaTable/Scoreboard/Metric* 等)。
 *  只许变少:清掉对应规则后把类名从这里删掉。 */
const REMOVED_COMPONENT_ORPHANS: readonly string[] = JSON.parse(
  readFileSync(join(REPO_ROOT, "test/unit/report-css-orphans.json"), "utf-8"),
) as string[];

/** attempt 详情各区块的类名族:这些前缀下的类全是结构类,两个方向都必须对齐。 */
const ATTEMPT_DETAIL_FAMILIES = [
  "niceeval-source-",
  "niceeval-conversation",
  "niceeval-waterfall",
  "niceeval-diff-",
  "niceeval-callout",
  "niceeval-copy-block",
  "niceeval-attempt-summary",
  "niceeval-usage-table",
] as const;

/** 只作为定制挂钩存在、不需要自己的规则的类,逐条写清为什么。 */
const STRUCTURAL_HOOKS_WITHOUT_RULES: Record<string, string> = {
  "niceeval-conversation-entry-summary": "布局由 .niceeval-conversation-entry > summary 给,这里只留挂钩",
  "niceeval-copy-block-summary": "布局由 .niceeval-copy-block > summary 给,这里只留挂钩",
  "niceeval-diff-group": "组间距由 .niceeval-diff-view 的 flex gap 给",
  "niceeval-diff-patch-ln-old": "两列排版与配色都由 .niceeval-diff-patch-ln 给,左右侧只留挂钩",
  "niceeval-diff-patch-ln-new": "同 niceeval-diff-patch-ln-old",
};

/** styles.css 选择器里引用到的全部 niceeval-* 类。 */
function cssClasses(css: string): Set<string> {
  const out = new Set<string>();
  let depth = 0;
  let selector = "";
  for (const ch of css) {
    if (ch === "{") {
      if (depth === 0) {
        for (const m of selector.matchAll(/\.(niceeval[\w-]*)/g)) out.add(m[1]!);
        selector = "";
      }
      depth++;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      selector = "";
    } else if (depth === 0) {
      selector += ch;
    } else if (depth === 1) {
      // @media / @supports 内的一层嵌套规则
      selector += ch;
      if (ch === ";") selector = "";
    }
  }
  return out;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|js)$/.test(entry)) out.push(p);
  }
  return out;
}

interface Emitted {
  /** 代码里写全了的类名。 */
  literal: Set<string>;
  /** 模板拼接的前缀(`niceeval-source-line--${tone}` → `niceeval-source-line--`)。 */
  prefixes: string[];
}

function emittedClasses(): Emitted {
  const literal = new Set<string>();
  const prefixes: string[] = [];
  const files = [
    ...sourceFiles(join(REPO_ROOT, "src/report")).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")),
    ...sourceFiles(join(REPO_ROOT, "src/view")).filter((f) => !f.endsWith(".test.ts") && !f.includes("client-dist")),
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(/(niceeval-[\w-]*)/g)) {
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 2);
      if (after === "${") prefixes.push(m[1]!);
      else literal.add(m[1]!);
    }
  }
  return { literal, prefixes };
}

function isEmitted(cls: string, emitted: Emitted): boolean {
  if (emitted.literal.has(cls)) return true;
  return emitted.prefixes.some((prefix) => prefix.length > "niceeval-".length && cls.startsWith(prefix));
}

describe("官方 stylesheet 与组件类名对齐", () => {
  const css = readFileSync(CSS_PATH, "utf-8");
  const referenced = [...cssClasses(css)].sort();
  const emitted = emittedClasses();

  it("CSS 不引用没有发射方的类(旧专用件台账只许变少)", () => {
    const orphans = referenced.filter((cls) => cls !== "niceeval-report" && !isEmitted(cls, emitted));
    const unexpected = orphans.filter((cls) => !REMOVED_COMPONENT_ORPHANS.includes(cls));
    expect(unexpected, "这些 CSS 类没有任何组件发射:改名了就同步规则,不再需要就删规则").toEqual([]);

    const stale = REMOVED_COMPONENT_ORPHANS.filter((cls) => !orphans.includes(cls));
    expect(stale, "台账里这些类已经不是孤儿了,从 report-css-orphans.json 删掉").toEqual([]);
  });

  it("attempt 详情各区块发射的类都有规则", () => {
    const inFamily = (cls: string) => ATTEMPT_DETAIL_FAMILIES.some((prefix) => cls.startsWith(prefix));
    const missing = [...emitted.literal]
      .filter((cls) => inFamily(cls) && !referenced.includes(cls))
      .filter((cls) => !(cls in STRUCTURAL_HOOKS_WITHOUT_RULES))
      .sort();
    expect(missing, "这些类在 DOM 里但 stylesheet 没有规则:补规则,或写进 STRUCTURAL_HOOKS_WITHOUT_RULES 说明理由").toEqual(
      [],
    );
  });

  it("SourceView 的每一档行状态都有染色规则", () => {
    // tone 由 SourceLineTone 穷尽(source-view.tsx),每档都要有整行浅染 + 左缘
  it("Waterfall 的每一个分类色槽都有条段规则", () => {
    // 槽数由 KIND_SLOTS 穷尽(primitives/waterfall.tsx),kind 散列进来的每一槽都要有背景
    // (docs/feature/reports/components/primitives/waterfall.md「类别与着色」)。缺一槽时
    // 落到那槽的类别在条上没有颜色,而 typecheck 与全部单测仍是绿的。
    for (const slot of [0, 1, 2, 3, 4]) {
      expect(referenced, `缺 .niceeval-span-kind-${slot} 的规则`).toContain(`niceeval-span-kind-${slot}`);
    }
  });

    // (docs/feature/reports/components/sources/attempt-source.md「行状态」)。
    for (const tone of ["send", "passed", "gate-fail", "soft-fail", "unavailable"]) {
      expect(referenced, `缺 .niceeval-source-line--${tone} 的规则`).toContain(`niceeval-source-line--${tone}`);
    }
  });
});
