// 报告的元素树与双面组件基座(docs/feature/reports/architecture.md「报告树与两个宿主」)。
//
// 报告函数返回的树不是「React 树」,只是 { type, props } 节点 —— 标准 react
// jsx-runtime 产的元素恰好就是这个形状。本文件是基础实现:零 react 运行时依赖
// (只有类型层的 `import type`,编译后擦除);text 宿主遍历渲染不需要 react-dom,
// web 宿主(web.ts)才真正 import react。渲染面是纯同步函数:零 IO、零 await ——
// 计算全部发生在报告函数体里,可达百 MB 的 artifact 永远不进渲染路径。

import type { ReactNode } from "react";
import type { AttemptLocator } from "../results/locator.ts";
import { DEFAULT_REPORT_LOCALE, type ReportLocale } from "./locale.ts";

// ───────────────────────── 节点形状 ─────────────────────────

/** 标准 jsx-runtime 元素形状;text 宿主只认 type / props,不管 $$typeof。 */
export interface ReportElement {
  type: unknown;
  props: Record<string, unknown>;
  key?: unknown;
}

/** 报告树节点:元素、文本、数组 / Fragment 的儿子们,或渲染为空的空值。 */
export type ReportNode = ReportElement | string | number | boolean | null | undefined | ReportNode[];

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

// ───────────────────────── 双面组件 ─────────────────────────

/** 挂 faces 的私有键:text 宿主与树校验靠它识别双面组件。 */
export const COMPONENT_FACES: unique symbol = Symbol.for("niceeval.report.faces");

export interface TextContext {
  /** 可用列宽;Row 分栏后变窄。 */
  width: number;
  /** chrome 文案的 locale(verdict 词、注脚、占位符);默认 "en",show 输出不变。 */
  locale: ReportLocale;
  /** 容器组件渲染 children 用,宽度显式传递。 */
  render(node: ReportNode, width?: number): string;
  /** 下钻命令,通证据室:`niceeval show @<locator>`。 */
  attemptCommand(locator: AttemptLocator): string;
}

export interface WebContext {
  /** 证据室深链,同 view 的 attempt 路由(`#/attempt/@<locator>`,单段、不透明)。 */
  attemptHref(locator: AttemptLocator): string;
  /** chrome 文案的 locale;官方组件渲染面经上下文读取,宿主外默认 "en"。 */
  locale: ReportLocale;
}

export interface ComponentFaces<P, R = P> {
  /**
   * 可选的数据解析面:把声明式 props(selection + 计算选项)在渲染前解析成纯数据 props(R)。
   * 宿主的 {@link resolveReportTree} 在 build 之后、validate / render 之前调用它——这是整条
   * 管线里唯一允许 await / IO 的组件级步骤;渲染面(web / text)只看已解析的 R,保持同步、零 IO。
   * 不实现 resolve 时 R = P,组件被当作纯数据组件直接渲染。
   */
  resolve?(props: P): Promise<R>;
  /** 真 React JSX 在这个面里;返回静态可渲染的 ReactNode。只看已解析的 R。 */
  web(props: R, ctx: WebContext): ReactNode;
  text(props: R, ctx: TextContext): string;
}

/**
 * 双面组件的产物:可直接用于 JSX(React 把它当函数组件调用,走 web 面),
 * text 宿主经 COMPONENT_FACES 调 text 面。R(解析后 props 形态)在存储边界抹成 any——
 * 树遍历只按 ComponentFaces 的结构调用 resolve / web / text,不需要在类型层追踪 R。
 */
export type ReportComponent<P> = ((props: P) => ReactNode) & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [COMPONENT_FACES]: ComponentFaces<P, any>;
  displayName?: string;
};

// web 面的环境上下文:web 宿主渲染前设好;宿主之外(组件直接嵌进用户 React 应用)
// 用默认值 —— attemptHref 默认 view 的 attempt 路由格式(自定义组件显式调 ctx.attemptHref
// 时总有去处);官方组件的「宿主里自动接证据室」只在宿主上下文激活时发生,
// 宿主外不传 attemptHref 就是纯展示,不发明断链。
//
// URL 格式取 `#/attempt/${locator}`:AttemptLocator 本身已经是 `@` 前缀的不透明短串
// (如 "@1x7f3q9"),原样嵌进路径段就得到 `#/attempt/@1x7f3q9`——与 docs/feature/reports/view.md「用
// Reports 积木重建 view」定稿的单段路由逐字一致,不额外拆分或去掉 `@`。
const DEFAULT_WEB_CONTEXT: WebContext = {
  attemptHref: (locator) => `#/attempt/${locator}`,
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

/** 官方组件的装配用:宿主上下文激活时才把 ctx.attemptHref 当默认下钻。 */
export function isHostWebContextActive(): boolean {
  return activeWebContext !== null;
}

/**
 * 定义一个双面组件:faces 两键必填 —— 少实现一个面编译不过,配对是结构义务。
 * 基础实现不 import react;产物以可调用组件的形状兼容 React 渲染。
 */
export function defineComponent<P, R = P>(faces: ComponentFaces<P, R>): ReportComponent<P> {
  if (typeof faces?.web !== "function" || typeof faces?.text !== "function") {
    throw new Error(
      "defineComponent requires both faces: { web(props, ctx), text(props, ctx) }. " +
        "Every report component must render in both hosts (niceeval view and niceeval show).",
    );
  }
  // 直接调用路径:把组件当普通 React 组件嵌进用户自己的页面时走这里,web 面只接收数据形态
  // props(R)。带 resolve 的组件若拿 selection 形态 props 走这条裸路径,web 面会缺 data ——
  // 这类组件只有经宿主的 resolveReportTree 解析后才安全渲染;纯数据 props 一直可以裸嵌。
  const component = ((props: P) =>
    faces.web(props as unknown as R, activeWebContext ?? DEFAULT_WEB_CONTEXT)) as ReportComponent<P>;
  component[COMPONENT_FACES] = faces;
  return component;
}

export function facesOf(type: unknown): ComponentFaces<unknown> | undefined {
  if (typeof type !== "function") return undefined;
  return (type as Partial<ReportComponent<unknown>>)[COMPONENT_FACES] as ComponentFaces<unknown> | undefined;
}

// ───────────────────────── 数据解析(渲染前唯一的 await 边界)─────────────────────────

/**
 * 报告 build 之后、树校验与 text/web 渲染之前的解析遍历:把声明式数据组件(实现了
 * `faces.resolve` 的双面组件,如 selection 形态的 MetricScatter)的 props
 * 就地换成算好的数据形态 props(三个实体列表没有 `resolve` 面,不经这一步——它们的 `items`
 * 由报告作者在 `build()` 里直接 `await .data(selection)` 备好)。计算发生在这里(唯一允许
 * await 的组件级步骤,连同报告函数体自己的 `build()`),两个渲染面
 * 之后都只看已解析的树、保持同步零 IO。遍历形状与 {@link validateReportTree} /
 * {@link renderNodeToText} 一致:
 *
 * - 同层数组兄弟并行解析(`Promise.all`),保持原始顺序 / keys;
 * - 双面组件带 resolve 的:调 `faces.resolve(props)` 换 props(有 children 再递归解析);
 * - 双面组件无 resolve 的(Row / Col / Section / RunOverview…):只递归 children,自身 props
 *   原样保留(title / className 等不能动);
 * - 普通函数组件:同步调用展开,展开结果继续解析(与 validate / render 对函数组件的处理一致);
 * - 字符串 intrinsic(<div>):原样返回,交给随后的 validateReportTree 报同一条错误。
 *
 * resolver 跑完后,树里已没有函数组件 / 未解析 props;validate / render 里对这两者的分支在
 * 正常管线下是 no-op,但保留着——手搭树直接调 validate / render(不过 resolver)的低层用法仍需要。
 */
export async function resolveReportTree(node: ReportNode): Promise<ReportNode> {
  if (node === null || node === undefined || typeof node === "boolean") return node;
  if (typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return Promise.all(node.map(resolveReportTree));
  if (!isReportElement(node)) return node;
  const { type, props } = node;
  // 字符串 intrinsic:不在这里报错,让 resolve 后的 validateReportTree 抛统一的那条。
  if (typeof type === "string") return node;
  if (type === REACT_FRAGMENT) {
    const children = await resolveReportTree(props.children as ReportNode);
    return { ...node, props: { ...props, children } };
  }
  const faces = facesOf(type);
  if (faces) {
    if (typeof faces.resolve === "function") {
      const resolvedProps = { ...((await faces.resolve(props)) as Record<string, unknown>) };
      if (resolvedProps.children !== undefined) {
        resolvedProps.children = await resolveReportTree(resolvedProps.children as ReportNode);
      }
      return { ...node, props: resolvedProps };
    }
    // 无 resolve 的容器 / 数据组件:只解析 children,自身 props 原样保留。
    const children = await resolveReportTree(props.children as ReportNode);
    return { ...node, props: { ...props, children } };
  }
  if (typeof type === "function") {
    // 普通函数组件:调用展开,展开结果整体替换本节点后继续解析。
    const expanded = (type as (p: unknown) => ReportNode)(props);
    return resolveReportTree(expanded);
  }
  return node;
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

/**
 * 渲染前树校验:页面树里只放双面组件、排版原语与普通组合函数,字符串 intrinsic
 * (<div>)报错、指名组件路径。这是运行时校验而非编译期(标准 JSX 下 TS 把一切
 * JSX 表达式统一成 JSX.Element);两个宿主渲染前跑同一遍 —— 不做单侧宽容,否则
 * 对着 view 写的页面到 show 才炸。校验只下钻 children(children 就是报告树);
 * 普通函数组件调用展开(渲染面纯同步,重复调用无副作用)。
 */
export function validateReportTree(node: ReportNode, path: string[] = []): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") return;
  if (Array.isArray(node)) {
    for (const child of node) validateReportTree(child, path);
    return;
  }
  if (!isReportElement(node)) return;
  const { type, props } = node;
  if (typeof type === "string") {
    const where = path.length > 0 ? ` (in ${path.join(" > ")})` : "";
    throw new Error(
      `Raw HTML <${type}> has no terminal face; use <Text>, layout primitives, or a defineComponent component.${where}`,
    );
  }
  if (type === REACT_FRAGMENT) {
    validateReportTree(props.children as ReportNode, path);
    return;
  }
  const label = componentLabel(type);
  if (facesOf(type)) {
    // 双面组件是校验的信任边界之内的叶子,但 children 仍是报告树的一部分
    validateReportTree(props.children as ReportNode, [...path, label]);
    return;
  }
  if (typeof type === "function") {
    // 普通函数组件 = 用户拿函数组合页面片段:调用展开继续校验
    const expanded = (type as (p: unknown) => ReportNode)(props);
    validateReportTree(expanded, [...path, label]);
    return;
  }
  const where = path.length > 0 ? ` (in ${path.join(" > ")})` : "";
  throw new Error(`Unsupported node type ${label} in report tree.${where}`);
}

// ───────────────────────── text 渲染 ─────────────────────────

export interface TextRenderOptions {
  /** 终端可用列宽;默认 80。 */
  width?: number;
  /** 下钻命令的生成;宿主注入,默认 `niceeval show @<locator>`(真实可跑的 CLI 语法)。 */
  attemptCommand?: (locator: AttemptLocator) => string;
  /** chrome 文案的 locale;默认 "en"(`niceeval show` 现有输出不变)。 */
  locale?: ReportLocale;
}

export function createTextContext(options?: TextRenderOptions): TextContext {
  const width = Math.max(20, options?.width ?? 80);
  const locale = options?.locale ?? DEFAULT_REPORT_LOCALE;
  // 默认下钻命令:AttemptLocator 是 `@` 前缀的不透明短串,`niceeval show @<locator>` 是
  // show/index.ts 已实现的真实 CLI 语法(见该文件 `@<locator>` 位置参数解析),不需要
  // 反查 eval id 再拼一条近似命令。
  const attemptCommand = options?.attemptCommand ?? ((locator: AttemptLocator) => `niceeval show ${locator}`);
  const make = (w: number): TextContext => ({
    width: w,
    locale,
    attemptCommand,
    render(node, childWidth) {
      return renderNodeToText(node, childWidth === undefined ? this : make(Math.max(10, childWidth)));
    },
  });
  return make(width);
}

/** text 宿主的遍历渲染:双面组件走 text 面,普通函数调用展开,块之间以换行相接。 */
export function renderNodeToText(node: ReportNode, ctx: TextContext): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node
      .map((child) => renderNodeToText(child, ctx))
      .filter((text) => text.length > 0)
      .join("\n");
  }
  if (!isReportElement(node)) return "";
  const { type, props } = node;
  if (typeof type === "string") {
    // 校验先行会拦住;这里兜底同一条错误,渲染路径自身也不宽容
    throw new Error(
      `Raw HTML <${type}> has no terminal face; use <Text>, layout primitives, or a defineComponent component.`,
    );
  }
  if (type === REACT_FRAGMENT) return renderNodeToText(props.children as ReportNode, ctx);
  const faces = facesOf(type);
  if (faces) return faces.text(props, ctx);
  if (typeof type === "function") {
    return renderNodeToText((type as (p: unknown) => ReportNode)(props), ctx);
  }
  return "";
}
