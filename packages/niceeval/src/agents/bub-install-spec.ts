import { createHash } from "node:crypto";
import { DEFAULT_BUB_VERSION } from "./coding-cli-versions.ts";

/**
 * Bub 的 OTel tape store 插件——时间轨的来源。插件不发 PyPI，git 依赖是唯一安装方式。
 *
 * 这个 pin 与 Bub 0.6 的 tape 协议同代，从 `bub.core.tape` 取类型。
 */
export const DEFAULT_BUB_OTEL_PLUGIN =
  "git+https://github.com/bubbuild/bub-contrib.git@8727b088aea69615d44d3b58ab0b9be6d16a884e#subdirectory=packages/bub-tapestore-otel";

/** CLI extra for uv tool installation from PyPI. */
export const BUB_CLI_PACKAGE = "bub[app]";

/** The override keeps both the CLI extra and the PyPI release when resolving plugin dependencies. */
export const DEFAULT_BUB_REQUIREMENT = `${BUB_CLI_PACKAGE}==${DEFAULT_BUB_VERSION}`;

/** Bub 0.6.1 的上游 lockfile 所用的模型客户端与 HTTP 客户端。 */
export const DEFAULT_BUB_DEPENDENCY_OVERRIDES = ["republic==0.6.0", "httpx2==2.16.0"] as const;

export const BUB_CHECKPOINT_SUBDIRS = [".local"] as const;
export const BUB_INSTALL_MARKER = ".local/share/niceeval/bub-install-hash";

export function normalizeBubPackages(packages: readonly string[]): string[] {
  return [...new Set(packages.map((value) => value.trim()).filter(Boolean))].sort();
}

export function bubInstallSpec(
  packages: readonly string[],
  requirement = DEFAULT_BUB_REQUIREMENT,
  otelPlugin = DEFAULT_BUB_OTEL_PLUGIN,
  dependencyOverrides: readonly string[] = [],
): string {
  const normalized = normalizeBubPackages(packages);
  const plugins = normalized.length ? ` --with ${normalized.join(" --with ")}` : "";
  const overrides = dependencyOverrides.length ? ` --overrides ${dependencyOverrides.join(" ")}` : "";
  return `${requirement}${overrides} --with ${otelPlugin}${plugins} --checkpoint(${BUB_CHECKPOINT_SUBDIRS.join(",")})`;
}

export function bubInstallHash(
  packages: readonly string[],
  requirement = DEFAULT_BUB_REQUIREMENT,
  otelPlugin = DEFAULT_BUB_OTEL_PLUGIN,
  dependencyOverrides: readonly string[] = [],
): string {
  return createHash("md5")
    .update(bubInstallSpec(packages, requirement, otelPlugin, dependencyOverrides))
    .digest("hex")
    .slice(0, 12);
}
