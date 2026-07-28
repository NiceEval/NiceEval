// 沙箱 provisioning 错误的中性分类:各 provider SDK 的限流错误形状互不相同(e2b 抛
// RateLimitError,vercel 抛 APIError{ response.status: 429 },docker 是 dockerode 的
// 普通 Error,message 里带 "toomanyrequests")。resolve.ts 的 createProvider() 据此统一
// 做退避重试,不需要认识任何 provider 专属的错误类型——分类逻辑留在各 provider 自己的
// 文件里(见 e2b.ts / vercel.ts / docker.ts 的 classifyProvisionError)。
//
// FailureScope / FailureClass 是 src/shared/failure-class.ts 落地的执行失败分类两轴词表
// (见 docs/feature/error-classification/architecture.md);这里只 import 类型,不反向依赖
// context 层的任何运行时代码——sandbox 内部两维分类(性质+后果)自治,只有下面
// classifyProvisionConfigCause 识别出的三档可证明配置死因才向外浮出 FailureClass。
import { attachFailureClass, type FailureClass, type FailureScope } from "../shared/failure-class.ts";

/**
 * Provisioning 失败的两维分类(见 docs/feature/sandbox/architecture.md「Provisioning 失败与重试」):
 * **性质**(瞬时 / 确定性)决定要不要重试,**后果**(远端是否可能已创建实例)决定能不能直接重试。
 * - `rate_limit` / `rejected`:拒绝类——请求确定没被受理(限流、DNS/连接被拒/TLS 握手失败),
 *   直接指数退避重试。
 * - `ambiguous`:歧义类——请求可能已被受理、只是响应丢了(响应中途重置、请求超时、5xx),
 *   远端可能有一台正在计费的实例;重试前必须对账(provider 提供检索通道时),否则第一次抛出。
 * - `unknown`:确定性失败(模板不存在、凭据缺失、权限不足),第一次就抛,重试没有意义。
 * 分类器偏向宽认瞬时:误判成确定性会白白判死可自愈的 attempt;反向只多花封顶的退避时间。
 */
export type SandboxProvisionErrorKind = "rate_limit" | "rejected" | "ambiguous" | "unknown";

/** 拒绝类(含限流):请求确定没被受理,直接退避重试。 */
export function isRejectedProvisionError(kind: SandboxProvisionErrorKind): boolean {
  return kind === "rate_limit" || kind === "rejected";
}

/** 按 kind 判断是否可能重试(歧义类还需对账通道,见 retry.ts);unknown 第一次就抛。 */
export function isRetryableProvisionError(kind: SandboxProvisionErrorKind): boolean {
  return kind !== "unknown";
}

/**
 * 与文件 IO 重试共用的保守瞬时分类兜底:provider 没认出的错误按形态落进拒绝类或歧义类。
 * 连接建立失败(DNS / refused / TLS)= 拒绝类;响应中途重置 / 超时 / 5xx = 歧义类。
 */
export function classifyProvisionErrorFallback(error: unknown): SandboxProvisionErrorKind {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? (current as globalThis.Record<string, unknown>) : undefined;
    const message = current instanceof Error ? current.message : String(current);
    const status = provisionStatus(record);
    if (status === 429) return "rate_limit";
    if (status !== undefined && status >= 500 && status <= 599) return "ambiguous";
    const code = record && typeof record.code === "string" ? record.code : "";
    // 连接根本没建立:请求确定没被受理。
    if (/^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|CERT_|ERR_TLS)/i.test(code)) return "rejected";
    // 连接中途断掉 / 超时:请求可能已被受理。
    if (/^(ECONNRESET|EPIPE|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/i.test(code)) return "ambiguous";
    if (/getaddrinfo|connection refused|certificate|tls handshake/i.test(message)) return "rejected";
    if (/fetch failed|other side closed|socket hang up|connection (?:reset|closed)|timed? ?out|service unavailable|bad gateway|gateway timeout|\b50[0234]\b/i.test(message)) {
      return "ambiguous";
    }
    if (/too many requests|rate.?limit|\b429\b/i.test(message)) return "rate_limit";
    current = record?.cause;
  }
  return "unknown";
}

function provisionStatus(record: globalThis.Record<string, unknown> | undefined): number | undefined {
  if (!record) return undefined;
  if (typeof record.status === "number") return record.status;
  if (typeof record.statusCode === "number") return record.statusCode;
  const response = record.response;
  if (response && typeof response === "object") {
    const status = (response as globalThis.Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * 已创建 Sandbox 上单次文件 IO 的中性错误分类。这里描述的是传输层瞬时故障，
 * 不是文件不存在、权限不足、路径错误等确定性结果。
 */
export type SandboxIoErrorKind = "rate_limit" | "network" | "service_unavailable" | "unknown";

export function isRetryableSandboxIoError(kind: SandboxIoErrorKind): boolean {
  return kind !== "unknown";
}

/**
 * 内置 provider 与自定义 provider 共用的保守分类器。SDK 常把底层网络错误包在
 * `cause` 中，因此最多沿 cause 链向下检查几层；Abort/沙箱终止明确不重试。
 */
export function classifySandboxIoError(error: unknown): SandboxIoErrorKind {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? current as globalThis.Record<string, unknown> : undefined;
    const name = record && typeof record.name === "string" ? record.name : "";
    const message = current instanceof Error ? current.message : String(current);

    if (/abort|cancel|terminated|killed|sandbox.*(closed|stopped)/i.test(`${name} ${message}`)) return "unknown";

    const status = numericStatus(record);
    if (status === 429) return "rate_limit";
    if (status !== undefined && status >= 500 && status <= 599) return "service_unavailable";

    const code = record && typeof record.code === "string" ? record.code : "";
    if (/^(ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT)$/i.test(code)) {
      return "network";
    }
    if (/fetch failed|socket hang up|network error|connection (?:reset|closed)|temporary failure|timed out while (?:fetching|uploading|downloading)/i.test(message)) {
      return "network";
    }
    if (/too many requests|rate.?limit|\b429\b/i.test(message)) return "rate_limit";
    if (/service unavailable|bad gateway|gateway timeout|\b50[0234]\b/i.test(message)) return "service_unavailable";

    current = record?.cause;
  }
  return "unknown";
}

function numericStatus(record: globalThis.Record<string, unknown> | undefined): number | undefined {
  if (!record) return undefined;
  if (typeof record.status === "number") return record.status;
  if (typeof record.statusCode === "number") return record.statusCode;
  const response = record.response;
  if (response && typeof response === "object") {
    const status = (response as globalThis.Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * 确定性 provisioning 死因的配置解析域细分(见
 * docs/feature/sandbox/architecture.md「Provisioning 失败与重试」「对外的空间轴映射」)。
 * 只在 provider 自身的 `classifyProvisionError` 判定为 `"unknown"`(性质轴:确定性,重试
 * 没有意义)之后调用一次,进一步细分成三档可证明死因:凭据缺失、权限不足、模板不存在。
 * 认不出的确定性错误(参数非法、通用 SDK 错误等)返回 `undefined`——不附带 scope 比误判
 * 安全,悬空错误照常落成本 attempt `errored`,不触发实验 / eval 级止损。
 */
export type ProvisionConfigCause = "credentials" | "permission" | "template_not_found";

// 凭据缺失:e2b `AuthenticationError`(.name,SDK 不挂 401 状态码)、vercel/其余 provider
// 的 401 响应、常见 SDK 文案("invalid api key" 等)。
const CREDENTIALS_PATTERN =
  /unauthenticated|unauthoriz|authentication (?:failed|required)|invalid (?:api[_ ]?key|credentials|token)|missing (?:api[_ ]?key|credentials|token)/i;
// 权限不足:403 响应、docker 私有仓库鉴权被拒的经典文案。
const PERMISSION_PATTERN = /forbidden|permission denied|access denied|pull access denied|not authorized/i;
// 模板 / 镜像 / 快照不存在:404/410 响应、vercel `snapshot_not_found` 错误码、docker 拉取
// 未知镜像的 message 形态(dockerode 对拉取失败通常不带 statusCode,只能靠文案识别)。
const TEMPLATE_NOT_FOUND_PATTERN =
  /(template|image|run).{0,40}(not found|does not exist|unknown|invalid)|no such image|manifest unknown|repository does not exist/i;

export function classifyProvisionConfigCause(error: unknown): ProvisionConfigCause | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? (current as globalThis.Record<string, unknown>) : undefined;
    const name = record && typeof record.name === "string" ? record.name : "";
    const message = current instanceof Error ? current.message : String(current);
    const haystack = `${name} ${message}`;
    const status = numericStatus(record);
    const jsonErrorCode = provisionJsonErrorCode(record);

    if (status === 401 || name === "AuthenticationError" || CREDENTIALS_PATTERN.test(haystack)) return "credentials";
    if (status === 403 || PERMISSION_PATTERN.test(haystack)) return "permission";
    if (status === 404 || status === 410 || jsonErrorCode === "snapshot_not_found" || TEMPLATE_NOT_FOUND_PATTERN.test(haystack)) {
      return "template_not_found";
    }
    current = record?.cause;
  }
  return undefined;
}

/** vercel `APIError` 的 `snapshot_not_found` 落在 `err.json.error.code`,不是顶层字段。 */
function provisionJsonErrorCode(record: globalThis.Record<string, unknown> | undefined): string | undefined {
  const json = record?.json;
  if (!json || typeof json !== "object") return undefined;
  const err = (json as globalThis.Record<string, unknown>).error;
  if (!err || typeof err !== "object") return undefined;
  const code = (err as globalThis.Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * 三档死因 → 空间轴映射,按配置解析域定档(判据单源见
 * docs/feature/sandbox/architecture.md#provisioning-失败与重试):凭据缺失 / 权限不足
 * 来自实验级配置,恒 `"experiment"`;模板不存在按 spec 是否带 `environments` 表二分——
 * 带表时模板逐 eval 解析,可证明的档收紧到 `"eval"`(错杀健康模板的 eval 比多撞几次死
 * 模板更贵);不带表时模板全实验共享,`"experiment"`。
 */
export function provisionConfigCauseScope(cause: ProvisionConfigCause, hasEnvironmentsTable: boolean): FailureScope {
  if (cause === "template_not_found") return hasEnvironmentsTable ? "eval" : "experiment";
  return "experiment";
}

/**
 * 把可证明的配置死因原地附着到 provisioning 错误对象上,供 `failureClassOf` 沿 cause 链
 * 识别(第一道「抛出点携带的分类」即命中)。只用于确定性失败(`retryable: false`);瞬时
 * 失败重试耗尽后不调用这个函数——死因不可证明为兄弟共享,原样抛出不带 scope。
 *
 * 附着走 shared 层同一个 `attachFailureClass`,不在这里重写一份:两个标记字段必须不可枚举
 * (不进 JSON / console,只是路由标记),已携带分类的对象不覆盖,冻结对象静默跳过——这三条
 * 纪律单源在那边,复制一份迟早漂移。shared 是中性层,不是 context,沙箱依赖它不构成反向依赖。
 */
export function attachProvisionFailureScope(error: unknown, scope: FailureScope): void {
  const failureClass: FailureClass = { retryable: false, scope };
  attachFailureClass(error, failureClass);
}
