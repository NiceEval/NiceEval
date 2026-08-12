// command projection 的唯一 normalizer。它只消费 Adapter 已确认的 original argv，
// 不读取 tool name、tool input 或 shell 文本。

import type {
  CommandProjection,
  LogicalCommandInvocation,
  LogicalCommandNormalizer,
  OriginalCommandInvocation,
  OriginalCommandOpaqueReason,
  StreamEvent,
} from "./types.ts";

export const LOGICAL_COMMAND_NORMALIZER: LogicalCommandNormalizer = "logical-command/v1";

type OpaqueOriginalCommandInvocation = Extract<OriginalCommandInvocation, { readonly state: "opaque" }>;

function isOpaqueOriginalCommand(original: OriginalCommandInvocation): original is OpaqueOriginalCommandInvocation {
  return original.state === "opaque";
}

/** 已确认不是 command 的 tool operation。 */
export function notCommandProjection(): CommandProjection {
  return { kind: "not-command" };
}

/**
 * 用 Adapter 已确认的 original invocation 创建完整投影。
 * original 是 opaque 时仍保留其原因；available 时一律走本文件的同一 normalizer。
 */
export function commandProjection(original: OriginalCommandInvocation): CommandProjection {
  const copiedOriginal = copyOriginal(original);
  return {
    kind: "command",
    original: copiedOriginal,
    logical: normalizeLogicalCommand(copiedOriginal),
  };
}

/** 原生协议只给 shell source、已脱敏或已截断时的 command 分类快捷入口。 */
export function opaqueCommandProjection(
  reason: OriginalCommandOpaqueReason,
): CommandProjection {
  return commandProjection({ state: "opaque", reason });
}

/**
 * 旧的或协议中立的 producer 没有给每笔 tool operation 分类时，不能继续声明 actions complete。
 * 它只检查 Adapter 是否已经交付 classification，不读取 name、input 或 command source。
 */
export function unclassifiedToolActionsCoverage(
  events: readonly StreamEvent[],
): { readonly actions: { readonly status: "partial"; readonly reason: string } } | undefined {
  const unclassified = events.some(
    (event) => event.type === "operation.started" && event.operation.kind === "tool" && event.operation.command === undefined,
  );
  return unclassified
    ? {
        actions: {
          status: "partial",
          reason: "The source protocol did not classify every tool operation as command or not-command.",
        },
      }
    : undefined;
}

/**
 * `logical-command/v1` 的纯 normalizer。
 *
 * 仅 transparent 地处理 exact `pnpm exec`、`pnpm --silent exec` 和无 runner option 的
 * `npx <target>`；未识别 wrapper form 保留 original，但 logical 变为 opaque。
 */
export function normalizeLogicalCommand(original: OriginalCommandInvocation): LogicalCommandInvocation {
  if (isOpaqueOriginalCommand(original)) {
    return {
      state: "opaque",
      normalizer: LOGICAL_COMMAND_NORMALIZER,
      reason: "original-opaque",
      originalReason: original.reason,
    };
  }

  if (original.executable === "pnpm") return normalizePnpmExec(original.args);
  if (original.executable === "npx") return normalizeNpx(original.args);

  return availableLogicalCommand(original.executable, original.args, "identity");
}

function copyOriginal(original: OriginalCommandInvocation): OriginalCommandInvocation {
  if (isOpaqueOriginalCommand(original)) return { state: "opaque", reason: original.reason };
  if (original.executable.length === 0) {
    throw new TypeError("available original command executable must not be empty");
  }
  if (!Array.isArray(original.args) || !original.args.every((token) => typeof token === "string")) {
    throw new TypeError("available original command argv must contain only string tokens");
  }
  return {
    state: "available",
    executable: original.executable,
    args: [...original.args],
  };
}

function normalizePnpmExec(args: readonly string[]): LogicalCommandInvocation {
  if (args[0] === "exec") return pnpmTarget(args, 1);
  if (args[0] === "--silent" && args[1] === "exec") return pnpmTarget(args, 2);
  if (args.some(isRecursivePnpmOption)) return opaqueLogicalCommand("multiple-executions");
  return opaqueLogicalCommand("unsupported-wrapper-form");
}

function pnpmTarget(args: readonly string[], targetIndex: number): LogicalCommandInvocation {
  const target = args[targetIndex];
  if (target === undefined || target.length === 0 || target === "--" || target.startsWith("-")) {
    return opaqueLogicalCommand("ambiguous-wrapper-target");
  }
  return availableLogicalCommand(target, args.slice(targetIndex + 1), "pnpm-exec");
}

function normalizeNpx(args: readonly string[]): LogicalCommandInvocation {
  const target = args[0];
  if (target === undefined || target.length === 0 || target.startsWith("-")) {
    return opaqueLogicalCommand("unsupported-wrapper-form");
  }
  return availableLogicalCommand(target, args.slice(1), "npx");
}

function isRecursivePnpmOption(token: string): boolean {
  return token === "-r" || token === "--recursive";
}

function availableLogicalCommand(
  executable: string,
  args: readonly string[],
  normalization: "identity" | "pnpm-exec" | "npx",
): LogicalCommandInvocation {
  return {
    state: "available",
    executable,
    args: [...args],
    normalizer: LOGICAL_COMMAND_NORMALIZER,
    normalization,
  };
}

function opaqueLogicalCommand(
  reason: "unsupported-wrapper-form" | "ambiguous-wrapper-target" | "multiple-executions",
): LogicalCommandInvocation {
  return {
    state: "opaque",
    normalizer: LOGICAL_COMMAND_NORMALIZER,
    reason,
  };
}
