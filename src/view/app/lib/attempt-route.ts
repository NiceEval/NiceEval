// attempt 级 hash 深链:`#/attempt/@<locator>`(docs/feature/reports/view.md「打开与收窄」)。
// 路由参数就是不透明的 AttemptLocator(src/results/locator.ts),由 loader 注入到每条
// result 上;这里只做纯解析 / 格式化 / 匹配,不碰 location / history,方便单测。与报告槽
// DEFAULT_WEB_CONTEXT.attemptHref(src/report/tree.ts)同一格式,两条深链来源互通。
// hash 目前只有这一种路由:tab 切换是纯组件 state,旧版 modal 深链走 ?modal= 查询参数,互不占用。
//
// AttemptLocator 的编码/解码本体住在 src/results/locator.ts,但那个模块顶层 import 了
// node:crypto(encodeAttemptLocator 用于生成 locator),不能被这个浏览器打包的 app/ 目录
// 静态 import——这里只需要「像不像一个 locator」的轻量语法校验,不需要真校验 scheme/body
// 长度(那是 reader 建索引时的事,view 前端拿到的 locator 恒来自可信的 loader 注入)。

import type { AttemptLocator, ViewResult, ViewSnapshot } from "../types.ts";

export const ATTEMPT_HASH_PREFIX = "#/attempt/";

/** locator 串的最小形状:`@` + 至少一个 base36 字符(scheme 字符 + body)。 */
const LOCATOR_SHAPE = /^@[0-9a-z]+$/;

/** AttemptLocator → 可分享的 hash:locator 本身就是路由参数,原样拼在前缀后面,不需要分段编码。 */
export function formatAttemptHash(locator: AttemptLocator): string {
  return `${ATTEMPT_HASH_PREFIX}${locator}`;
}

/**
 * hash → AttemptLocator;不是本路由 / 形状不像 locator 返回 null(由调用方决定 warn 与否)。
 * 只做前缀 + 粗粒度字符集校验,不重新实现 decodeAttemptLocator 的 scheme/body 长度校验——
 * 那份权威校验属于 src/results/locator.ts,这里刻意保持浏览器打包安全(不引入 node:crypto)。
 */
export function parseAttemptHash(hash: string): AttemptLocator | null {
  if (!hash.startsWith(ATTEMPT_HASH_PREFIX)) return null;
  const rest = hash.slice(ATTEMPT_HASH_PREFIX.length);
  if (!LOCATOR_SHAPE.test(rest)) return null;
  return rest as AttemptLocator;
}

/** 在全部快照(含历史)里找 locator 指向的 attempt;旧格式烘焙的数据没有 locator,自然找不到。 */
export function resolveAttemptLocator(snapshots: ViewSnapshot[], locator: AttemptLocator): ViewResult | null {
  for (const snapshot of snapshots) {
    for (const result of snapshot.results ?? []) {
      if (result.locator === locator) return result;
    }
  }
  return null;
}

/** 深链定位不到时的提示(console.warn 用,英文);页面照常渲染,不开空 modal。 */
export function unresolvedAttemptWarning(hash: string): string {
  return (
    `[niceeval view] Ignoring attempt link "${hash}": no matching attempt in this view ` +
    `(snapshot not loaded, attempt not found, or the data was baked without a locator).`
  );
}
