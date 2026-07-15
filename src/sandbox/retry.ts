// provider 无关的 provisioning 退避重试:createProvider()(resolve.ts)对每个内置
// provider 的 create() 套这一层。只有各 provider 自己的 classifyProvisionError 判为
// 可重试的错误才会退避重试;其它错误第一次就抛出。防泄漏的两道防线
// (见 docs/feature/sandbox/architecture.md「Provisioning 失败与重试」)中,这里承担
// 「重试前对账」;kill-on-failure 在各 provider 的 create() 内部。

import { isRejectedProvisionError, isRetryableProvisionError, type SandboxProvisionErrorKind } from "./errors.ts";
import { t } from "../i18n/index.ts";
import { reportActivity, reportDiagnostic } from "../runner/feedback/sink.ts";
import type { ScopedFeedback } from "../types.ts";

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;

/** 指数退避 + 全抖动(0.5x~1.5x),避免同一批被限流的 create() 同时醒来再次撞限流。 */
function delayFor(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt * (0.5 + Math.random());
}

/**
 * 调用方(resolve.ts)持有的并发槽位的临时归还/收回。不认调用方用的是不是 Effect —— 只要求
 * 两个 async 方法,保持这层 provider 无关。
 */
export interface ProvisionSlot {
  release(): Promise<void>;
  reacquire(): Promise<void>;
}

export async function withProvisionRetry<T>(
  create: () => Promise<T>,
  classify: (e: unknown) => SandboxProvisionErrorKind,
  slot?: ProvisionSlot,
  feedback?: ScopedFeedback,
  /**
   * 对账钩子:按 provision token 检索远端、销毁可能已创建的实例。提供时**每次重试前都执行**,
   * 不区分拒绝类还是歧义类——被重试的 create() 闭包跨多个请求,一个 429 可能来自实例已创建
   * 之后的初始化请求,分类不保证远端没有实例。对账排在退避睡眠之后(紧跟失败发出的检索大概率
   * 同样被限流);对账抛错即放弃重试、抛回原始 create 错误。没有对账通道的 provider 不传——
   * 歧义类第一次抛出:宁可判死一个 attempt,不留一台计费的无主实例
   * (见 docs/feature/sandbox/architecture.md)。
   */
  reconcile?: () => Promise<void>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await create();
    } catch (e) {
      const kind = classify(e);
      if (!isRetryableProvisionError(kind) || attempt >= MAX_ATTEMPTS - 1) throw e;
      // 歧义类:远端可能已有实例,没有对账通道就不能重试,第一次抛出。
      if (!isRejectedProvisionError(kind) && !reconcile) throw e;
      // 退避期间只是在睡觉,不是在真的创建沙箱:攥着并发槽位陪跑 setTimeout 会让被限流的
      // provider 把整批并发名额拖垮成"看起来卡在个位数并发"——先还名额,睡醒了再排队要回来。
      if (slot) await slot.release();
      // 「activity」而非「diagnostic」—— 这是正常的退避进度,不是需要去重/永久留痕的
      // warning(与 docker.ts 的镜像拉取进度、vercel.ts 的 session rotate 通知同一个理由,
      // 见 sink.ts 的 reportActivity 说明)。让 human dashboard 的 active slot 在整个退避
      // 窗口里有可见更新,而不是冻结到重试成功或耗尽为止。
      const delayMs = delayFor(attempt);
      const message = t("sandbox.provisionRetry", { delayMs: Math.round(delayMs), attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS }).trimEnd();
      if (feedback) feedback.progress({ message });
      else reportActivity(message);
      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } finally {
        if (slot) await slot.reacquire();
      }
      if (reconcile) {
        try {
          await reconcile();
        } catch (reconcileError) {
          // 对账是重试的硬前置:查不到账就重试与盲重试无异。放弃重试,留 diagnostic,
          // 抛回原始 create 错误(对账失败不掩盖它)。
          const diagnostic = {
            code: "sandbox-provision-reconcile-failed",
            level: "warning" as const,
            message: t("sandbox.provisionReconcileFailed", { error: String(reconcileError) }).trimEnd(),
          };
          if (feedback) feedback.diagnostic(diagnostic);
          else reportDiagnostic({ key: diagnostic.code, severity: diagnostic.level, message: diagnostic.message });
          throw e;
        }
      }
    }
  }
}
