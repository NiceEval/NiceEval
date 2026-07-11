// provider 无关的 provisioning 退避重试:createProvider()(resolve.ts)对每个内置
// provider 的 create() 套这一层。只有各 provider 自己的 classifyProvisionError 判为
// 可重试(目前仅 rate_limit)的错误才会退避重试;其它错误第一次就抛出。

import { isRetryableProvisionError, type SandboxProvisionErrorKind } from "./errors.ts";

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;

/** 指数退避 + 全抖动(0.5x~1.5x),避免同一批被限流的 create() 同时醒来再次撞限流。 */
function delayFor(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt * (0.5 + Math.random());
}

export async function withProvisionRetry<T>(
  create: () => Promise<T>,
  classify: (e: unknown) => SandboxProvisionErrorKind,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await create();
    } catch (e) {
      if (!isRetryableProvisionError(classify(e)) || attempt >= MAX_ATTEMPTS - 1) throw e;
      await new Promise((resolve) => setTimeout(resolve, delayFor(attempt)));
    }
  }
}
