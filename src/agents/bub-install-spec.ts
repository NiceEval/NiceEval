import { createHash } from "node:crypto";
import { DEFAULT_BUB_VERSION } from "./coding-cli-versions.ts";

/**
 * Bub 的 OTel tape store 插件——时间轨的来源。插件不发 PyPI，git 依赖是唯一安装方式。
 *
 * 插件与 Bub 的 tape 协议同代:这个 pin(bub-contrib#53 之后)从 `bub.tape` 取类型，
 * 要求 Bub ≥ 0.3.10;更早的 pin 按 republic 的类型校验，配 Bub ≤ 0.3.9。配错代不会安装失败，
 * 而是 span 全被拒、时间轨静默为空(台账见 memory/bub-tapestore-otel-tapeentry-drift.md)。
 */
export const DEFAULT_BUB_OTEL_PLUGIN =
  "git+https://github.com/bubbuild/bub-contrib.git@34715077877041b21472dcca39d91529296a1a9e#subdirectory=packages/bub-tapestore-otel";

/** 装哪一版 Bub：`uv tool install` 的 requirement，版本单源在 `coding-cli-versions.ts`。 */
export const DEFAULT_BUB_REQUIREMENT = bubRequirement(DEFAULT_BUB_VERSION);

export const BUB_CHECKPOINT_SUBDIRS = [".local"] as const;
export const BUB_INSTALL_MARKER = ".local/share/niceeval/bub-install-hash";

/**
 * PyPI requirement for a pinned Bub version.
 *
 * 这行同时是安装用的 uv override:OTel 插件所在 workspace 把 `bub` 声明成 git 依赖，
 * 不覆盖的话每次安装都会去拉 Bub 主干,版本失控。
 */
export function bubRequirement(version: string): string {
  return `bub==${version}`;
}

export function normalizeBubPackages(packages: readonly string[]): string[] {
  return [...new Set(packages.map((value) => value.trim()).filter(Boolean))].sort();
}

export function bubInstallSpec(
  packages: readonly string[],
  requirement = DEFAULT_BUB_REQUIREMENT,
  otelPlugin = DEFAULT_BUB_OTEL_PLUGIN,
): string {
  const normalized = normalizeBubPackages(packages);
  const plugins = normalized.length ? ` --with ${normalized.join(" --with ")}` : "";
  return `${requirement} --with ${otelPlugin}${plugins} --checkpoint(${BUB_CHECKPOINT_SUBDIRS.join(",")})`;
}

export function bubInstallHash(
  packages: readonly string[],
  requirement = DEFAULT_BUB_REQUIREMENT,
  otelPlugin = DEFAULT_BUB_OTEL_PLUGIN,
): string {
  return createHash("md5").update(bubInstallSpec(packages, requirement, otelPlugin)).digest("hex").slice(0, 12);
}
