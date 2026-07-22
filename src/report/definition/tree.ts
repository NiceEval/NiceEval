// 报告的元素树、组件模型与 resolve 管线(docs/feature/reports/architecture.md「组件模型」
// 「报告树与两个宿主」、docs/feature/reports/library/layout.md)。
//
// 报告函数返回的树不是「React 树」,只是 { type, props } 节点 —— 标准 react
// jsx-runtime 产的元素恰好就是这个形状。本文件是基础实现:零 react 运行时依赖
// (只有类型层的 `import type`,编译后擦除);text 宿主遍历渲染不需要 react-dom,
// web 宿主(web.ts)才真正 import react。管线固定为 装载 → resolve(组合展开 + spec 取数,
// 同层并行保声明序,按「同引用 input + 深相等 spec」记忆化)→ validate(两面资格)→
// render(纯同步)。渲染面是纯同步函数:零 IO、零 await —— 可达百 MB 的 artifact
// 只在 resolve 阶段被懒加载,永远不进渲染路径。

import type { ReactNode } from "react";
import type { AttemptLocator } from "../../results/locator.ts";
import type { AttemptEvidence } from "../../results/attempt-evidence.ts";
import type { Results, Scope } from "../../results/types.ts";
import { DEFAULT_REPORT_LOCALE, type ReportLocale } from "../model/locale.ts";
import type { ReportInput } from "../model/types.ts";
import type { ReportMeta } from "./report.ts";
import type { PanelMode } from "../model/panel.ts";

// ───────────────────────── 当前页判别(PageContext) ─────────────────────────

/** scope-input page 的当前页上下文:消费宿主选择的 Scope,没有 locator/evidence。 */
export interface ScopePageContext {
  id: string;
  input: "scope";
}

/** attempt-input page 的当前页上下文:按 locator 消费一份 AttemptEvidence。 */
export interface AttemptPageContext {
  id: string;
  input: "attempt";
  locator: AttemptLocator;
  evidence: AttemptEvidence;
}

/**
 * 当前渲染中的页判别联合(docs/feature/reports/library/shell.md「行为约束」、
 * library/attempt-detail.md「page 输入与 spec / data 形态」)。经 ComposeContext.page 与
 * ResolveContext.page 双双可见:组合组件靠它读当前页 id 与输入分支;attempt 叶子组件靠它
 * 取省略 input 时的缺省 evidence。
 */
export type PageContext = ScopePageContext | AttemptPageContext;

// ───────────────────────── 节点形状 ─────────────────────────

/** 标准 jsx-runtime 元素形状;text 宿主只认 type / props,不管 $$typeof。 */
export interface ReportElement {
  type: unknown;
  props: Record<string, unknown>;
  key?: unknown;
}

/**
 * 报告树节点,形状穷尽(docs/feature/reports/library/layout.md「树的节点」):
 * 元素、数组 / Fragment(展平保序),或条件渲染的空分支(渲染为空)。
 * 裸字符串与数字**不是**节点——自由文本必须经 <Text> 携带,树校验遇到时按完整用户反馈拒绝。
 */
export type ReportNode = ReportElement | readonly ReportNode[] | null | undefined | boolean;

// react/jsx-runtime 的 Fragment 是注册符号,跨 react 版本稳定;不 import react 也认得它
const REACT_FRAGMENT = Symbol.for("react.fragment");

function isReportElement(node: unknown): node is ReportElement {
  return (
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    "type" in node &&
    "props" in node &&
    typeof (node as ReportElement).props === "object"
  );
}

// ───────────────────────── 组件模型 ─────────────────────────

/** 挂 faces 的私有键:管线与树校验靠它识别双面组件。 */
export const COMPONENT_FACES: unique symbol = Symbol.for("niceeval.report.faces");
/** 挂组合函数的私有键:resolve 阶段靠它识别组合组件。 */
export const COMPONENT_COMPOSE: unique symbol = Symbol.for("niceeval.report.compose");
/** Tabs / Tab 的结构角色标记:树校验的配对规则靠它,不 import primitives(避免环)。 */
export const COMPONENT_ROLE: unique symbol = Symbol.for("niceeval.report.role");
/**
 * children 是不透明值(自由文本 / CSS 字符串)而非报告树的组件标记(Text / Style):
 * resolve 与 validate 不下钻它们的 children——那是组件自己的 props,不是树。
 */
export const COMPONENT_RAW_CHILDREN: unique symbol = Symbol.for("niceeval.report.rawChildren");

export interface TextContext {
  /** 可用列宽;Row 分栏后变窄。 */
  width: number;
  /** chrome 文案的 locale(verdict 词、注脚、占位符);默认 "en",show 输出不变。 */
  locale: ReportLocale;
  /** 容器组件渲染 children 用,宽度显式传递。 */
  render(node: ReportNode, width?: number): string;
  /**
   * 下钻命令,通 attempt-input page:`niceeval show @<locator>`。当前报告没有声明
   * attempt-input page 时不存在——宿主不生成假命令,locator 只是文本(architecture.md
   * 「Attempt 详情是一张参数化 page」)。
   */
  attemptCommand?(locator: AttemptLocator): string;
  /**
   * 组索引一类「按实验收窄」命令的生成;宿主注入以携带完整上下文(--results / --report /
   * --page 与位置参数),默认 `niceeval show --exp <id>`。非契约字段,官方组件内部用。
   */
  experimentCommand(experimentIdPrefix: string): string;
  /**
   * `Section` text 面的框线传输能力(docs/feature/reports/library/layout.md「区域框」):
   * `"boxed"` 时画区域框,`"plain"` 时降级为无框文本。宿主按真实 TTY / NO_COLOR 探测结果
   * 注入;省略时默认 `"plain"`——不假设有终端,保证现有(未显式声明能力的)调用方行为不变。
   * 是否真的画框还要再叠加宽度下限,那份判断只在 `panel.ts` 里做一次。
   */
  panelMode: PanelMode;
}

export interface WebContext {
  /**
   * attempt-input page 深链,同 view 的 attempt 路由(`#/attempt/@<locator>`,单段、不透明)。
   * 当前报告没有声明 attempt-input page 时不存在——宿主不生成空 href 或假链接,locator 只是
   * 文本(architecture.md「Attempt 详情是一张参数化 page」)。
   */
  attemptHref?(locator: AttemptLocator): string;
  /** chrome 文案的 locale;官方组件渲染面经上下文读取,宿主外默认 "en"。 */
  locale: ReportLocale;
}

/** 双面组件解析面的上下文:宿主注入的数据来源;props 显式给出 input 时以 props 为准。 */
export interface ResolveContext {
  input: ReportInput;
  /** 当前页判别;attempt 叶子组件省略 input 时从这里的 attempt 分支取缺省 evidence。 */
  page: PageContext;
}

/** 组合组件的上下文:宿主 Scope、结果根完整读取面与规范化后的报告声明。 */
export interface ComposeContext {
  /** 宿主注入的 Scope。 */
  scope: Scope;
  /** 结果根完整读取面;历史视图从这里自行挑 Snapshot[]。 */
  results: Results;
  /** 规范化后的报告声明,只读(docs/feature/reports/library/layout.md「自定义组件」)。 */
  report: ReportMeta;
  /** 当前页判别:scope 分支只有 id;attempt 分支带 locator + evidence。 */
  page: PageContext;
}

export interface ComponentFaces<P, R = P> {
  /**
   * 组件唯一的异步 / IO 面:把作者写下的 props 规范化成渲染 props(R)。宿主管线在
   * resolve 阶段调用它,按「同引用 input + 深相等 spec」在一次页渲染内记忆化;
   * 渲染面(web / text)只看已解析的 R,保持同步、零 IO。不实现 resolve 时 R = P。
   */
  resolve?(props: P, context: ResolveContext): R | Promise<R>;
  /** 真 React JSX 在这个面里;返回静态可渲染的 ReactNode。只看已解析的 R。 */
  web(props: R, ctx: WebContext): ReactNode;
  text(props: R, ctx: TextContext): string;
}

/**
 * 报告组件的产物:可直接用于 JSX。双面组件当普通 React 组件调用时走 web 面(只接受
 * 数据形态 props);组合组件只在报告管线内展开,宿主外直接渲染报错。R 在存储边界抹成 any——
 * 树遍历只按 ComponentFaces 的结构调用 resolve / web / text,不需要在类型层追踪 R。
 */
export type ReportComponent<P> = ((props: P) => ReactNode) & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [COMPONENT_FACES]?: ComponentFaces<P, any>;
  [COMPONENT_COMPOSE]?: (props: P, ctx: ComposeContext) => ReportNode | Promise<ReportNode>;
  [COMPONENT_ROLE]?: "tabs" | "tab";
  [COMPONENT_RAW_CHILDREN]?: true;
  displayName?: string;
};

// web 面的环境上下文:web 宿主渲染前设好;宿主之外(组件直接嵌进用户 React 应用)
// 用默认值——没有 attemptHref,组件显式传 prop 才产生外部链接(architecture.md
// 「Attempt 详情是一张参数化 page」:没有 target 时 locator 只是文本,不生成假 href)。
const DEFAULT_WEB_CONTEXT: WebContext = {
  locale: DEFAULT_REPORT_LOCALE,
};
let activeWebContext: WebContext | null = null;

/** web 宿主用:在给定 WebContext 下同步渲染(React 静态渲染本身是同步的)。 */
export function runWithWebContext<T>(ctx: WebContext, fn: () => T): T {
  const prev = activeWebContext;
  activeWebContext = ctx;
  try {
    return fn();
  } finally {
    activeWebContext = prev;
  }
}

/** 函数形态:组合组件,只装配已有组件,可以异步;ctx 携带 scope / results / report。 */
export function defineComponent<P>(
  compose: (props: P, context: ComposeContext) => ReportNode | Promise<ReportNode>,
): ReportComponent<P>;
/** 对象形态:双面组件,自己渲染;text 与 web 两面必填,可选 resolve 承担取数。 */
export function defineComponent<P, R = P>(faces: ComponentFaces<P, R>): ReportComponent<P>;
export function defineComponent<P, R = P>(
  input: ComponentFaces<P, R> | ((props: P, context: ComposeContext) => ReportNode | Promise<ReportNode>),
): ReportComponent<P> {
  if (typeof input === "function") {
    const component = ((_props: P): ReactNode => {
      throw new Error(
        `Compose component ${componentDisplayName(input) ?? "(anonymous)"} can only render inside the report pipeline ` +
          "(niceeval show / view, or renderReportToText / renderReportToStaticHtml): it assembles other components " +
          "and needs the host context (scope, results, report). To embed in your own React page, compute data with " +
          "the *Data functions and render the pure components from niceeval/report/react instead.",
      );
    }) as ReportComponent<P>;
    component[COMPONENT_COMPOSE] = input;
    if (componentDisplayName(input)) component.displayName = componentDisplayName(input);
    return component;
  }
  if (typeof input?.web !== "function" || typeof input?.text !== "function") {
    throw new Error(
      "defineComponent requires both faces: { web(props, ctx), text(props, ctx) } (resolve is optional). " +
        "Every report component must render in both hosts (niceeval view and niceeval show); " +
        "define the missing face, or pass a compose function to assemble existing components instead.",
    );
  }
  const faces = input;
  // 直接调用路径:把组件当普通 React 组件嵌进用户自己的页面时走这里,web 面只接收数据形态
  // props(R)。带 resolve 的组件若拿 spec 形态 props 走这条裸路径,web 面会缺 data ——
  // 这类组件只有经宿主的 resolveReportTree 解析后才安全渲染;纯数据 props 一直可以裸嵌。
  const component = ((props: P) =>
    faces.web(props as unknown as R, activeWebContext ?? DEFAULT_WEB_CONTEXT)) as ReportComponent<P>;
  component[COMPONENT_FACES] = faces as ComponentFaces<P, unknown>;
  return component;
}

function componentDisplayName(fn: unknown): string | undefined {
  const named = fn as { displayName?: string; name?: string };
  return named.displayName || named.name || undefined;
}

export function facesOf(type: unknown): ComponentFaces<unknown> | undefined {
  if (typeof type !== "function") return undefined;
  return (type as ReportComponent<unknown>)[COMPONENT_FACES];
}

export function composeOf(
  type: unknown,
): ((props: unknown, ctx: ComposeContext) => ReportNode | Promise<ReportNode>) | undefined {
  if (typeof type !== "function") return undefined;
  return (type as ReportComponent<unknown>)[COMPONENT_COMPOSE] as
    | ((props: unknown, ctx: ComposeContext) => ReportNode | Promise<ReportNode>)
    | undefined;
}

function roleOf(type: unknown): "tabs" | "tab" | undefined {
  if (typeof type !== "function") return undefined;
  return (type as ReportComponent<unknown>)[COMPONENT_ROLE];
}

function hasRawChildren(type: unknown): boolean {
  return typeof type === "function" && (type as ReportComponent<unknown>)[COMPONENT_RAW_CHILDREN] === true;
}

// ───────────────────────── 深相等(记忆化的 spec 比较)─────────────────────────

/**
 * resolve 记忆化的深相等:只递归比较可序列化值(普通对象 / 数组 / 原始值);
 * 函数与 Metric / Dimension / NumericAxis 一类携带函数的实例按引用比较——
 * 共享计算的成立条件是引用同一实例,引用不同的等价定义只是各算一次,不构成错误。
 */
export function deepEqualSpec(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualSpec(item, (b as unknown[])[i]));
  }
  const protoA = Object.getPrototypeOf(a);
  const protoB = Object.getPrototypeOf(b);
  if ((protoA !== Object.prototype && protoA !== null) || (protoB !== Object.prototype && protoB !== null)) {
    return false; // 非纯对象(类实例等)按引用比较,=== 已在开头判过
  }
  const keysA = Object.keys(a as Record<string, unknown>).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  );
  const keysB = Object.keys(b as Record<string, unknown>).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  );
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => deepEqualSpec((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ───────────────────────── resolve 管线 ─────────────────────────

interface MemoEntry {
  input: unknown;
  spec: unknown;
  result: Promise<unknown>;
}

/** 一次页渲染内的记忆化缓存:键 = 计算函数引用 → (同引用 input + 深相等 spec) 命中。 */
export class ResolveMemo {
  private readonly entries = new Map<unknown, MemoEntry[]>();

  fetch(fn: unknown, input: unknown, spec: unknown, compute: () => Promise<unknown>): Promise<unknown> {
    let list = this.entries.get(fn);
    if (!list) this.entries.set(fn, (list = []));
    for (const entry of list) {
      if (entry.input === input && deepEqualSpec(entry.spec, spec)) return entry.result;
    }
    const result = compute();
    list.push({ input, spec, result });
    return result;
  }
}

/** resolveReportTree 的环境:宿主注入的 Scope / 读取面 / 规范化声明 / 当前页判别。 */
export interface ResolveEnv {
  scope: Scope;
  results: Results;
  report: ReportMeta;
  /** 当前渲染的页:scope 分支只有 id;attempt 分支带 locator + evidence。 */
  page: PageContext;
  /** 一次页渲染一份;跨页共享缓存时由宿主显式传同一实例。 */
  memo?: ResolveMemo;
}

/** 官方 spec 组件在 resolve 内取数的记忆化入口;经内部扩展的 ResolveContext 传递。 */
export interface InternalResolveContext extends ResolveContext {
  /** 按 (计算函数引用, 同引用 input, 深相等 options) 记忆化地调用计算函数。 */
  memoFetch<T>(dataFn: unknown, input: unknown, options: unknown, compute: () => Promise<T>): Promise<T>;
}

/** 组件 resolve 里安全取记忆化入口:经宿主管线时在场,手工直调 resolve 时退化为直接计算。 */
export function memoFetchOf(ctx: ResolveContext): InternalResolveContext["memoFetch"] {
  const internal = ctx as Partial<InternalResolveContext>;
  return internal.memoFetch ?? (async (_fn, _input, _options, compute) => compute());
}

function illegalNodeError(type: unknown, path: string[]): Error {
  const where = path.length > 0 ? ` (in ${path.join(" > ")})` : "";
  if (typeof type === "string") {
    return new Error(
      `Report trees cannot contain raw HTML <${type}>${where}. Every node must render in both hosts (niceeval show and niceeval view), and raw HTML has no text face. ` +
        "Use <Text> for free text, the layout primitives (<Row>/<Col>/<Section>/<Table>), or move the markup into the web face of a defineComponent component.",
    );
  }
  const label = componentLabel(type);
  return new Error(
    `${label} is not a report component${where}: plain functions and React components cannot join a report tree because the hosts cannot render them in both faces. ` +
      "Wrap it with defineComponent — a compose function defineComponent((props, ctx) => tree) to assemble existing components, " +
      "or an object form defineComponent({ resolve?, text, web }) to render itself.",
  );
}

function bareTextError(value: string | number, path: string[]): Error {
  const where = path.length > 0 ? ` (in ${path.join(" > ")})` : "";
  const preview = typeof value === "string" ? JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value) : String(value);
  return new Error(
    `Report trees cannot contain a bare ${typeof value} (${preview})${where}: free text needs an explicit carrier for terminal line-wrapping and HTML escaping. ` +
      "Wrap it in <Text>…</Text>.",
  );
}

/**
 * 管线的 resolve 阶段:递归展开组合组件(以 (props, ctx) 调用并 await 返回树)、执行双面
 * 组件的解析面;同层 sibling 并行取数且不改变节点顺序;带 resolve 的组件按「同引用 input +
 * 深相等 spec」记忆化。非法节点(React 组件、未经 defineComponent 的普通函数、任意 HTML
 * intrinsic)在展开遇到时立即以完整用户反馈拒绝,不为非法节点取数。
 */
export async function resolveReportTree(node: ReportNode, env: ResolveEnv): Promise<ReportNode> {
  const memo = env.memo ?? new ResolveMemo();
  const composeCtx: ComposeContext = { scope: env.scope, results: env.results, report: env.report, page: env.page };
  return resolveNode(node, { memo, composeCtx }, []);
}

interface ResolveState {
  memo: ResolveMemo;
  composeCtx: ComposeContext;
}

async function resolveNode(node: ReportNode | string | number, state: ResolveState, path: string[]): Promise<ReportNode> {
  if (node === null || node === undefined || typeof node === "boolean") return node;
  if (typeof node === "string" || typeof node === "number") {
    // 裸字符串在 validate 阶段以带指引的完整反馈拒绝;这里先如实透传,不为它取数。
    return node as unknown as ReportNode;
  }
  if (Array.isArray(node)) {
    const resolved = await Promise.all(node.map((child) => resolveNode(child as ReportNode, state, path)));
    // resolve 重建的 children 数组对 React 是动态列表(JSX 静态 children 的免 key 待遇随重建
    // 丢失);声明序即身份,给缺 key 的元素补声明位 key,免得 web 面渲染刷 key 警告。
    return resolved.map((child, i) =>
      isReportElement(child) && (child.key === undefined || child.key === null)
        ? ({ ...child, key: `.nre-${i}` } as ReportElement)
        : child,
    );
  }
  if (!isReportElement(node)) return node;
  const { type, props } = node;
  if (type === REACT_FRAGMENT) {
    const children = await resolveNode(props.children as ReportNode, state, path);
    return { ...node, props: { ...props, children } };
  }
  const compose = composeOf(type);
  if (compose) {
    // 组合组件不记忆化:它只装配、不承担取数;数据层的去重由其内部 *Data 调用经 memoFetch 命中。
    const expanded = await compose(props, state.composeCtx);
    return resolveNode(expanded, state, [...path, componentLabel(type)]);
  }
  const faces = facesOf(type);
  if (faces) {
    if (typeof faces.resolve === "function") {
      const resolveFn = faces.resolve;
      const input = ((props as { input?: unknown }).input as ReportInput | undefined) ?? state.composeCtx.scope;
      const ctx: InternalResolveContext = {
        input,
        page: state.composeCtx.page,
        memoFetch: <T,>(dataFn: unknown, dataInput: unknown, options: unknown, compute: () => Promise<T>) =>
          state.memo.fetch(dataFn, dataInput, options, compute) as Promise<T>,
      };
      const resolved = await state.memo.fetch(resolveFn, input, props, async () =>
        resolveFn(props, ctx),
      );
      const resolvedProps = { ...(resolved as Record<string, unknown>) };
      if (resolvedProps.children !== undefined) {
        resolvedProps.children = await resolveNode(resolvedProps.children as ReportNode, state, [
          ...path,
          componentLabel(type),
        ]);
      }
      return { ...node, props: resolvedProps };
    }
    // 无 resolve 的容器 / 纯数据组件:只解析 children,自身 props 原样保留(title / className 不能动)。
    if (hasRawChildren(type)) return node; // Text / Style 的 children 是不透明值,不是树
    const children = await resolveNode(props.children as ReportNode, state, [...path, componentLabel(type)]);
    return { ...node, props: { ...props, children } };
  }
  // 非法节点:HTML intrinsic、React 组件、未经 defineComponent 的普通函数 —— 立即拒绝,不取数。
  throw illegalNodeError(type, path);
}

// ───────────────────────── 树校验 ─────────────────────────

function componentLabel(type: unknown): string {
  if (typeof type === "string") return `<${type}>`;
  if (typeof type === "function") {
    const name = (type as { displayName?: string; name?: string }).displayName || (type as { name?: string }).name;
    return name ? `<${name}>` : "<anonymous component>";
  }
  if (type === REACT_FRAGMENT) return "<>";
  return `<${String(type)}>`;
}

function directChildElements(children: unknown): ReportElement[] {
  const out: ReportElement[] = [];
  const visit = (node: unknown): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (isReportElement(node)) {
      if (node.type === REACT_FRAGMENT) {
        visit(node.props.children);
        return;
      }
      out.push(node);
      return;
    }
    out.push(node as never);
  };
  visit(children);
  return out;
}

/**
 * 管线的 validate 阶段:确保展开后树中每个组件都有 text 和 web 两面。校验只看节点资格,
 * 不限定树形:根节点可以是单个组件、Col 或 Tabs,宿主不强制任何最外层容器。
 * 裸字符串 / 数字、HTML intrinsic、无两面资格的函数都以完整用户反馈拒绝;
 * Tabs / Tab 的结构配对(空 Tabs、游离 Tab、非 Tab 直接子节点)也在这里校验。
 */
export function validateReportTree(node: ReportNode, path: string[] = [], insideTabs = false): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    throw bareTextError(node, path);
  }
  if (Array.isArray(node)) {
    for (const child of node) validateReportTree(child, path, insideTabs);
    return;
  }
  if (!isReportElement(node)) {
    if (typeof node === "object" && node !== null && (node as { kind?: unknown }).kind === "report") {
      const where = path.length > 0 ? ` (in ${path.join(" > ")})` : "";
      throw new Error(
        `A defineReport(...) product is not a report node${where}: the shell cannot nest. ` +
          "Put the page content (a tree or component) here, and keep defineReport for the file's default export only.",
      );
    }
    return;
  }
  const { type, props } = node;
  if (type === REACT_FRAGMENT) {
    validateReportTree(props.children as ReportNode, path, insideTabs);
    return;
  }
  if (typeof type === "string") throw illegalNodeError(type, path);
  const label = componentLabel(type);
  const role = roleOf(type);
  if (role === "tab" && !insideTabs) {
    const where = path.length > 0 ? ` (in ${path.join(" > ")})` : "";
    throw new Error(
      `<Tab> can only be a direct child of <Tabs>${where}. Wrap sibling views in <Tabs><Tab title="…">…</Tab></Tabs>, or drop the <Tab> wrapper if you only have one view.`,
    );
  }
  if (role === "tabs") {
    const children = directChildElements(props.children);
    const nonTab = children.find((child) => roleOf(child.type) !== "tab");
    if (nonTab !== undefined) {
      throw new Error(
        `<Tabs> only accepts <Tab> as direct children (found ${
          isReportElement(nonTab) ? componentLabel(nonTab.type) : typeof nonTab
        } in ${[...path, label].join(" > ")}). Move the content inside a <Tab title="…">, or lift it out of <Tabs>.`,
      );
    }
    if (children.length === 0) {
      throw new Error(
        `<Tabs> needs at least one <Tab> child (in ${[...path, label].join(" > ")}). Add <Tab title="…">…</Tab>, or remove the empty <Tabs>.`,
      );
    }
    for (const tab of children) {
      validateReportTree((tab.props as { children?: ReportNode }).children, [...path, label, componentLabel(tab.type)], false);
    }
    return;
  }
  const faces = facesOf(type);
  if (faces) {
    // 双面资格:无类型 JS 输入可能绕过 defineComponent 的定义期校验,这里再拦一遍
    if (typeof faces.web !== "function" || typeof faces.text !== "function") {
      const missing = typeof faces.web !== "function" ? "web" : "text";
      throw new Error(
        `${label} is missing its ${missing} face${path.length > 0 ? ` (in ${path.join(" > ")})` : ""}: every component in a report tree must render in both hosts (niceeval show and niceeval view). Define both { text, web } in defineComponent.`,
      );
    }
    // 双面组件是校验的信任边界之内的叶子,但 children 仍是报告树的一部分
    // (Text / Style 除外:它们的 children 是不透明的自由文本 / CSS 字符串)
    if (!hasRawChildren(type)) validateReportTree(props.children as ReportNode, [...path, label], false);
    return;
  }
  if (composeOf(type)) {
    // 正常管线下 resolve 已把组合组件展开;手搭树直接 validate 时如实指出它还没展开
    throw new Error(
      `${label} is a compose component and must be expanded by the resolve pipeline before validation. ` +
        "Render through defineReport + niceeval show/view (or renderReportToText/renderReportToStaticHtml).",
    );
  }
  throw illegalNodeError(type, path);
}

// ───────────────────────── text 渲染 ─────────────────────────

export interface TextRenderOptions {
  /** 终端可用列宽;默认 80。 */
  width?: number;
  /** 下钻命令的生成;宿主注入,默认 `niceeval show @<locator>`(真实可跑的 CLI 语法)。 */
  attemptCommand?: (locator: AttemptLocator) => string;
  /** 组索引命令的生成;宿主注入以携带 --results / --report / --page 等上下文。 */
  experimentCommand?: (experimentIdPrefix: string) => string;
  /** chrome 文案的 locale;默认 "en"(`niceeval show` 现有输出不变)。 */
  locale?: ReportLocale;
  /** `Section` 的框线传输能力;默认 `"plain"`,由宿主按真实 TTY / NO_COLOR 探测结果注入。 */
  panelMode?: PanelMode;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/@-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function createTextContext(options?: TextRenderOptions): TextContext {
  const width = Math.max(20, options?.width ?? 80);
  const locale = options?.locale ?? DEFAULT_REPORT_LOCALE;
  // 没有默认值:当前报告没有声明 attempt-input page 时不存在下钻命令——宿主(report.ts /
  // web.ts 的渲染入口)据规范化 definition 是否有 attempt page 决定要不要注入生成器,
  // 这里只透传调用方给的值(architecture.md「Attempt 详情是一张参数化 page」)。
  const attemptCommand = options?.attemptCommand;
  const experimentCommand =
    options?.experimentCommand ?? ((prefix: string) => `niceeval show --exp ${shellQuote(prefix)}`);
  const panelMode = options?.panelMode ?? "plain";
  const make = (w: number): TextContext => ({
    width: w,
    locale,
    attemptCommand,
    experimentCommand,
    panelMode,
    render(node, childWidth) {
      return renderNodeToText(node, childWidth === undefined ? this : make(Math.max(10, childWidth)));
    },
  });
  return make(width);
}

/** text 宿主的遍历渲染:双面组件走 text 面,块之间以换行相接。只吃已 resolve + validate 的树。 */
export function renderNodeToText(node: ReportNode, ctx: TextContext): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") {
    // 校验先行会拦住;渲染路径自身也不宽容
    throw bareTextError(node, []);
  }
  if (Array.isArray(node)) {
    return node
      .map((child) => renderNodeToText(child, ctx))
      .filter((text) => text.length > 0)
      .join("\n");
  }
  if (!isReportElement(node)) return "";
  const { type, props } = node;
  if (typeof type === "string") throw illegalNodeError(type, []);
  if (type === REACT_FRAGMENT) return renderNodeToText(props.children as ReportNode, ctx);
  const faces = facesOf(type);
  if (faces) return faces.text(props, ctx);
  throw illegalNodeError(type, []);
}
