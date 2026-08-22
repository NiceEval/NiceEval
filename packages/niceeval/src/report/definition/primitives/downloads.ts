// Download 载荷与 Host 闭包收集器(内部模块,不进 niceeval/report 公共出口)。
//
// 职责边界:
// - 作者面只把已关闭的 { path, mediaType, bytes } 放进 <Download file={...}>;双面渲染
//   (primitives.tsx)只做形状校验并给出 text/web 链接,绝不改写 bytes。
// - Host 在 resolveReportTree 之后调用本模块的 `collectDownloads`,按声明序遍历已 resolve
//   树,把每个 Download 实例的 props.file 复制成 revision 自己的字节并冻结返回;路径冲突、
//   数量/字节限额与最终路由仍由 execution 层拥有。收集器不认识 generic semantic node,
//   只认「元素的 type 是 Download 组件」这一条身份。
// - 跨重复安装包:元素身份按同一进程内组件函数引用比较(`el.type === Download`);
//   Host 必须用与 resolve 同一份安装的 niceeval 模块做收集,这正是闭包检查的既有前提。

import { Fragment, type ReportElement, type ReportNode } from "../tree.ts";
import { Download as DownloadComponent } from "../primitives.tsx";

/** 已关闭的下载文件:真实 bytes 原样保留,由 Host 在 closure 阶段复制进 revision。 */
export interface DownloadFile {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/**
 * 收集器产出的闭包下载:bytes 是 Host 自己的防御性副本,与作者 props 解耦——
 * revision 不保留作者对象引用,也不保留组件函数。
 */
export interface ClosedDownload {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

const REACT_ELEMENT_MARKERS = new Set<symbol>([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
]);

function isElement(node: unknown): node is ReportElement {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
  const candidate = node as Partial<ReportElement>;
  return (
    typeof candidate.$$typeof === "symbol" &&
    REACT_ELEMENT_MARKERS.has(candidate.$$typeof) &&
    typeof candidate.props === "object" &&
    candidate.props !== null &&
    !Array.isArray(candidate.props)
  );
}

/** 下载载荷的形状校验:path / mediaType 是字符串,bytes 是真实 Uint8Array。 */
export function assertDownloadFile(file: DownloadFile): DownloadFile {
  if (
    typeof file.path !== "string" ||
    typeof file.mediaType !== "string" ||
    !(file.bytes instanceof Uint8Array)
  ) {
    throw new Error("Download.file requires string path, string mediaType, and Uint8Array bytes.");
  }
  return file;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/**
 * 遍历一次已 resolve 的报告树,按声明序收集全部 <Download file> 的闭包字节。
 * 遍历只认元素结构(数组 / Fragment 展开、ReportElement 的 props.children 下钻),
 * 不调用任何组件函数、不读 Sample、不经过 generic semantic node;每个 payload
 * 都经 assertDownloadFile 校验并复制 bytes,返回冻结数组。空树返回空数组。
 *
 * @internal Host-only:Host 在 resolve 后、形成 revision 前调用;公共 niceeval/report
 * 入口不得 re-export 这个函数(下载收集是 Host 闭包职责,不是作者 API)。
 */
export function collectDownloads(node: ReportNode): readonly ClosedDownload[] {
  const out: ClosedDownload[] = [];
  const visit = (current: ReportNode): void => {
    if (current === null || current === undefined || typeof current === "boolean") return;
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (typeof current === "string" || typeof current === "number" || typeof current === "bigint") return;
    if (!isElement(current)) return;
    if (current.type === Fragment) {
      visit(current.props.children as ReportNode);
      return;
    }
    if (current.type === DownloadComponent) {
      const file = assertDownloadFile((current.props as { file?: unknown }).file as DownloadFile);
      const closed: ClosedDownload = Object.freeze({
        path: file.path,
        mediaType: file.mediaType,
        bytes: copyBytes(file.bytes),
      });
      out.push(closed);
      // Download 没有报告树 children:file 是全部数据,不继续下钻。
      return;
    }
    visit(current.props.children as ReportNode);
  };
  visit(node);
  return Object.freeze(out);
}
