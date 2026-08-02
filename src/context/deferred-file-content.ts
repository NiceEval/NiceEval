const DEFERRED_FILE_CONTENT: unique symbol = Symbol("niceeval.deferredFileContent");

/**
 * `t.sandbox.file(path)` 产生的延迟证据引用。它不是字符串；AssertionCollector
 * 在 finalize 阶段读取 Sandbox 内容后，再把真实文本交给 ValueAssertion。
 */
export interface DeferredFileContent {
  readonly [DEFERRED_FILE_CONTENT]: true;
}

/** @internal 只由 TestContext 构造；公开作者面只导出 DeferredFileContent 类型。 */
export class FileRef implements DeferredFileContent {
  readonly [DEFERRED_FILE_CONTENT] = true as const;

  constructor(readonly path: string) {}
}
