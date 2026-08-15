import {
  REPORT_FRAGMENT_MARKER,
  reportElement,
  type AuthorReportNode,
  type ReportElement,
} from "./author/element.ts";

/** Package-owned React-compatible fragment marker; it never imports React. */
export const Fragment = REPORT_FRAGMENT_MARKER;

/**
 * The automatic JSX runtime for Report source.  It retains an element until
 * the Host is executing the Page/compose callback, where supported intrinsic
 * tags and function components are closed into data-only semantic nodes.
 */
export function jsx(type: unknown, rawProps: unknown, key?: unknown): ReportElement {
  const props = copyProps(rawProps);
  return reportElement(type, props, key);
}

/** Multiple JSX children share the same Report element semantics. */
export const jsxs = jsx;

/** Development JSX carries source metadata which Report author nodes ignore. */
export function jsxDEV(
  type: unknown,
  props: unknown,
  key: unknown,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): AuthorReportNode {
  return jsx(type, props, key);
}

function copyProps(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || value === undefined) return Object.freeze({});
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Report JSX props must be an object");
  }
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("Report JSX props cannot contain symbol fields");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("Report JSX props cannot contain accessors or hidden fields");
    }
    copy[key] = descriptor.value;
  }
  return Object.freeze(copy);
}

/** TypeScript JSX declarations for `jsxImportSource: "niceeval/report"`. */
export namespace JSX {
  export type Element = AuthorReportNode;
  export interface ElementChildrenAttribute {
    readonly children: {};
  }
  export interface IntrinsicAttributes {
    readonly key?: string | number | bigint;
  }
  type ContentProps = {
    readonly children?: AuthorReportNode;
    readonly className?: string;
  };

  type HeadProps = {
    readonly children?: AuthorReportNode;
  };

  type StyleProps = {
    readonly children?: string;
    readonly asset?: Uint8Array | Readonly<{ readonly bytes: Uint8Array }>;
    readonly media?: string;
    readonly type?: "text/css";
  };

  /** Only Host-closable elements are available to Report JSX. */
  export interface IntrinsicElements {
    readonly a: ContentProps & { readonly href: string };
    readonly article: ContentProps;
    readonly aside: ContentProps;
    readonly blockquote: ContentProps;
    readonly code: ContentProps;
    readonly details: ContentProps;
    readonly div: ContentProps;
    readonly em: ContentProps;
    readonly footer: ContentProps;
    readonly h1: ContentProps;
    readonly h2: ContentProps;
    readonly h3: ContentProps;
    readonly h4: ContentProps;
    readonly h5: ContentProps;
    readonly h6: ContentProps;
    readonly header: ContentProps;
    readonly head: HeadProps;
    readonly li: ContentProps;
    readonly link: {
      readonly href: string;
      readonly hreflang?: string;
      readonly rel: "alternate" | "author" | "canonical" | "license";
      readonly title?: string;
      readonly type?: string;
    };
    readonly main: ContentProps;
    readonly meta: {
      readonly content?: string;
      readonly itemprop?: string;
      readonly name?: string;
      readonly property?: string;
    };
    readonly ol: ContentProps;
    readonly p: ContentProps;
    readonly pre: ContentProps;
    readonly section: ContentProps;
    readonly small: ContentProps;
    readonly span: ContentProps;
    readonly strong: ContentProps;
    readonly style: StyleProps;
    readonly summary: ContentProps;
    readonly ul: ContentProps;
  }
}
