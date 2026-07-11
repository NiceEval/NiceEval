// 沙箱 provisioning 错误的中性分类:各 provider SDK 的限流错误形状互不相同(e2b 抛
// RateLimitError,vercel 抛 APIError{ response.status: 429 },docker 是 dockerode 的
// 普通 Error,message 里带 "toomanyrequests")。resolve.ts 的 createProvider() 据此统一
// 做退避重试,不需要认识任何 provider 专属的错误类型——分类逻辑留在各 provider 自己的
// 文件里(见 e2b.ts / vercel.ts / docker.ts 的 classifyProvisionError)。

/** 目前只区分"限流,值得退避重试"和"其它,原样抛出"。 */
export type SandboxProvisionErrorKind = "rate_limit" | "unknown";

/** 按 kind 判断是否该重试;模板不存在、凭据缺失等归入 unknown,第一次就抛,重试没有意义。 */
export function isRetryableProvisionError(kind: SandboxProvisionErrorKind): boolean {
  return kind === "rate_limit";
}
