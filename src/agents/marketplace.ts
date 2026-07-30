// marketplace `add` 后的注册名回读校验 —— claude-code / codex 共用的实现(回读命令由各
// adapter 传入,这里不按 agent 名分支)。为什么必须回读:真实 CLI 的 `marketplace add` 按
// 目标仓库 manifest 里的 `name` 注册,配置名对不上时 add **静默成功**,直到下一步
// `plugin install <plugin>@<name>` 才以「找不到 marketplace」的形式间接失败(见
// memory/native-plugin-marketplace-name-not-caller-assignable.md)。契约:add 之后回读已
// 注册的 marketplace 列表,配置的 `marketplace.name` 不在其中就立刻抛带两个名字的错误,
// 不把失败拖延到 install 一步(docs/feature/adapters/architecture/coding-agent-extensions.md)。

import { t } from "../i18n/index.ts";
import type { Sandbox } from "../types.ts";

/**
 * `<cli> plugin marketplace list --json` 的输出里抠注册名。形状按 CLI 宽容解析:裸数组
 * (元素是字符串,或带 name / marketplaceName / id 的对象)或 `{ marketplaces: [...] }` 容器;
 * 抠不出(非 JSON / 未知形状)返回 undefined —— 调用方按「回读失败」处理,不静默放行
 * (形状硬猜的教训见 memory/codex-plugin-list-json-shape-guessed-wrong.md)。
 */
export function marketplaceNamesFromList(stdout: string): string[] | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as { marketplaces?: unknown }).marketplaces
      : undefined;
  if (!Array.isArray(arr)) return undefined;
  const names: string[] = [];
  for (const item of arr) {
    const name =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? ((item as { name?: unknown }).name ??
            (item as { marketplaceName?: unknown }).marketplaceName ??
            (item as { id?: unknown }).id)
          : undefined;
    if (typeof name === "string" && name) names.push(name);
  }
  return names;
}

/** 读一次注册列表:解析成功给名字,命令非零退出或输出解析不出给 undefined(附输出末尾供报错)。 */
async function readMarketplaceNames(
  sb: Sandbox,
  listCommand: string,
): Promise<{ names?: string[]; tail: string }> {
  const res = await sb.runShell(listCommand);
  return {
    names: res.exitCode === 0 ? marketplaceNamesFromList(res.stdout) : undefined,
    tail: (res.stdout + res.stderr).trim().split("\n").slice(-12).join("\n"),
  };
}

export interface VerifyMarketplaceNameOptions {
  /** 报错归属的 agent 名(如 "claude-code")。 */
  agent: string;
  /** 回读命令(如 `claude plugin marketplace list --json`)。 */
  listCommand: string;
  /** 配置里声明的 marketplace(name 必须等于目标仓库 manifest 声明的 name)。 */
  marketplace: { name: string; source: string };
  /** 本次 setup 已校验过的 marketplace 名 —— 从「实际注册了什么」里剔除,让报错聚焦这次 add 新注册的名字。 */
  knownNames: ReadonlySet<string>;
}

/**
 * `marketplace add` 成功后回读注册列表,校验配置的 `marketplace.name` 真的被注册。
 * 回读失败(命令非零退出 / 输出解析不出)与名字不匹配都立刻抛错,attempt 在 setup 阶段
 * errored —— 不把失败拖延到 `plugin install`。
 */
export async function verifyMarketplaceName(sb: Sandbox, opts: VerifyMarketplaceNameOptions): Promise<void> {
  const { names, tail } = await readMarketplaceNames(sb, opts.listCommand);
  if (names === undefined) {
    throw new Error(
      t("plugin.marketplaceVerifyFailed", {
        agent: opts.agent,
        name: opts.marketplace.name,
        command: opts.listCommand,
        tail,
      }),
    );
  }
  if (names.includes(opts.marketplace.name)) return;
  const actual = names.filter((n) => !opts.knownNames.has(n));
  throw new Error(
    t("plugin.marketplaceNameMismatch", {
      agent: opts.agent,
      expected: opts.marketplace.name,
      source: opts.marketplace.source,
      actual: actual.length ? actual.join(", ") : "(none)",
    }),
  );
}
