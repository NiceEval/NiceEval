// Eval 源码的归一化与哈希:discovery 时的捕获(src/runner/eval-source.ts)与证据重建
// (annotated-source.ts 的完整源码树装配)必须对同一份源码算出同一个 SHA-256,
// 所以归一化规则与哈希算法只住这一处 —— 两侧各自 import,不各写一份可能跑偏的实现。
//
// 只做归一化 + 哈希,不碰文件系统:住在 results/ 而不是 shared/,是因为 shared/ 的既有约定
// 是"环境无关、vite 前端直接打包"(见 shared/verdict.ts、shared/aggregate.ts 的注释),
// node:crypto 在浏览器打包下不成立;results/ 已经是纯 Node 库(writer.ts / open.ts 也用
// node:fs),多一个 node:crypto 不破坏任何边界。runner 已经单向依赖 results(reporters/
// artifacts.ts 用 createWriter),所以 src/runner/eval-source.ts 反过来 import 这里
// 不新增循环依赖。

import { createHash } from "node:crypto";

/**
 * 归一化 eval 源码文本:去 UTF-8 BOM、把 CRLF / CR 统一成 LF。
 * 幂等——已归一化的文本再跑一次结果不变,所以 capture 时归一化一次、重建时可以放心再跑一次,
 * 两处算出的 SHA-256 恒相同。不做其它改写(不 trim 行尾空白、不折叠空行):
 * 行号是断言 SourceLoc 的锚,任何改变行结构的归一化都会让映射错位。
 */
export function normalizeEvalSource(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 对(已归一化的)源码文本算 SHA-256 十六进制摘要。 */
export function hashEvalSource(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
