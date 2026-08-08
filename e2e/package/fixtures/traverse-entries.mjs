// feature: docs/engineering/testing/e2e/package.md — 安装后运行时入口
//
// 从安装后的 niceeval package.json 的 exports 动态推导公开入口，不硬编码子路径：
// - object 条件体是公开 runtime subpath：同一 raw Node 进程内分别用 import() 与
//   createRequire(import.meta.url)() 装载，断言两面公开导出 keys 一致；根入口再对
//   两边同时存在的每个函数/类逐一断言引用 ===（同一进程内共享 runtime identity）。
// - 纯字符串 exports 是静态 asset：只验证 import.meta.resolve + readFile 公开可达，
//   并把 import.meta.resolve 返回的 file:// URL 转成 filesystem path 消费。
// - 解析目标存在、但装载因缺失第三方依赖失败时，只有缺失包名命中安装后
//   package.json 的 peerDependenciesMeta[name].optional===true（scoped 包按
//   @scope/name 解析）才判为 dependency-gated 并跳过；其余缺失与其它失败
//   （exports 不可解析、目标缺失、node_modules 下的 .ts 不可类型剥离等）都是
//   hard failure，进程以非零退出并输出失败明细。
// - 另从仓库外临时 cwd 执行安装后的 niceeval --help。
//
// 本文件只用 Node 22 内置 API，可由 Vitest（Journey A）与 smoke.mjs 复用，
// 也可用 `node fixtures/traverse-entries.mjs` 直接运行。

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PACKAGE_NAME = "niceeval";

function specifierOf(packageName, exportKey) {
  return exportKey === "." ? packageName : `${packageName}${exportKey.slice(1)}`;
}

function describeError(error) {
  const code = error && error.code ? String(error.code) : "UNKNOWN";
  const message = String((error && error.message) || error || "unknown error");
  return { code, message };
}

/** 缺失信息里引用的裸 specifier 归一为包名：scoped 包取 @scope/name，其余取首段。 */
function packageNameOf(specifier) {
  const parts = specifier.split("/");
  if (parts[0].startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0];
}

/**
 * exports 目标存在但装载因缺失第三方依赖失败：仅当缺失包名命中安装后
 * package.json 声明的 optional peer 才允许 gated，其余一律 hard fail。
 */
function isMissingDependency(error, optionalPeers) {
  const code = error && error.code;
  if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") return false;
  const message = String((error && error.message) || "");
  const match = message.match(/(?:module|package) ['"]([^'"]+)['"]/i);
  if (!match) return false;
  const specifier = match[1];
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return false;
  }
  return optionalPeers.has(packageNameOf(specifier));
}

/** 安装后 package.json 中 optional===true 的 peerDependencies 名单。 */
function optionalPeerNames(packageJson) {
  const names = new Set();
  const meta = packageJson.peerDependenciesMeta;
  if (meta && typeof meta === "object") {
    for (const [name, entry] of Object.entries(meta)) {
      if (entry && typeof entry === "object" && entry.optional === true) {
        names.add(name);
      }
    }
  }
  return names;
}

/** Node 22 的 import.meta.resolve 返回公开 export 对应的 file:// URL。 */
function resolvePublicly(specifier) {
  return import.meta.resolve(specifier);
}

/** 把 import.meta.resolve 的 file:// URL 转成可读 filesystem path。 */
function toFilePath(target) {
  if (typeof target === "string" && target.startsWith("file:")) {
    return fileURLToPath(target);
  }
  return target;
}

/**
 * 从任意位于已安装包消费者内的模块 URL 出发，沿 node_modules 上溯找到安装后的
 * 包根与 package.json（不读候选 src/dist 布局，只读公开 metadata 与解析目标）。
 */
export function findInstalledPackageRoot(packageName, fromUrl) {
  const require = createRequire(fromUrl);
  const entryPath = require.resolve(packageName);
  let dir = dirname(entryPath);
  for (;;) {
    let packageJson = null;
    try {
      packageJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      packageJson = null;
    }
    if (packageJson && packageJson.name === packageName) {
      return { root: dir, packageJson, require };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`cannot find installed package root for ${packageName} below ${entryPath}`);
    }
    dir = parent;
  }
}

function targetExists(resolved) {
  try {
    const stat = statSync(toFilePath(resolved), { throwIfNoEntry: false });
    return Boolean(stat && stat.isFile());
  } catch {
    return false;
  }
}

/**
 * Node 的 require(esm) 在模块存在 default 导出时会在 require 侧附加 __esModule 互操作
 * 标记（公开能力之外、非包所有）。keys 一致性按去除该标记后的集合比较。
 */
function comparableKeys(keys) {
  return keys.filter((key) => key !== "__esModule").sort();
}

async function loadWith(loader, specifier) {
  try {
    const module = await loader(specifier);
    return { ok: true, module, keys: Object.keys(module).sort() };
  } catch (error) {
    return { ok: false, error };
  }
}

function checkRootIdentity(esmModule, cjsModule) {
  const mismatches = [];
  for (const key of Object.keys(esmModule)) {
    if (typeof esmModule[key] !== "function") continue;
    if (typeof cjsModule[key] !== "function" || esmModule[key] !== cjsModule[key]) {
      mismatches.push(key);
    }
  }
  return { checked: true, mismatches };
}

async function checkRuntimeEntry(require, specifier, exportKey, optionalPeers) {
  let resolved;
  try {
    resolved = resolvePublicly(specifier);
  } catch (error) {
    return { specifier, exportKey, status: "failed", error: describeError(error) };
  }

  if (!targetExists(resolved)) {
    return {
      specifier,
      exportKey,
      status: "failed",
      error: { code: "TARGET_MISSING", message: `resolved runtime target not found: ${resolved}` },
    };
  }

  const viaImport = await loadWith((s) => import(s), specifier);
  const viaRequire = await loadWith((s) => require(s), specifier);

  if (viaImport.ok && viaRequire.ok) {
    const keysEqual = JSON.stringify(comparableKeys(viaImport.keys)) === JSON.stringify(comparableKeys(viaRequire.keys));
    return {
      specifier,
      exportKey,
      status: "loaded",
      keysEqual,
      importKeys: viaImport.keys,
      requireKeys: viaRequire.keys,
      identity: exportKey === "." ? checkRootIdentity(viaImport.module, viaRequire.module) : undefined,
    };
  }

  if (viaImport.ok !== viaRequire.ok) {
    return {
      specifier,
      exportKey,
      status: "failed",
      error: {
        code: "ASYMMETRIC_LOAD",
        message: `import=${viaImport.ok ? "ok" : describeError(viaImport.error).code} require=${viaRequire.ok ? "ok" : describeError(viaRequire.error).code}`,
      },
    };
  }

  if (isMissingDependency(viaImport.error, optionalPeers) && isMissingDependency(viaRequire.error, optionalPeers)) {
    return {
      specifier,
      exportKey,
      status: "dependencyGated",
      error: { code: "DEPENDENCY_MISSING", message: describeError(viaImport.error).message },
    };
  }

  return { specifier, exportKey, status: "failed", error: describeError(viaImport.error) };
}

function checkAsset(specifier, exportKey) {
  try {
    const resolved = resolvePublicly(specifier);
    if (!targetExists(resolved)) {
      throw new Error(`resolved asset target not found: ${resolved}`);
    }
    const bytes = readFileSync(toFilePath(resolved));
    if (bytes.length === 0) {
      throw new Error(`asset is empty: ${specifier}`);
    }
    return { specifier, exportKey, status: "ok" };
  } catch (error) {
    return { specifier, exportKey, status: "failed", error: describeError(error) };
  }
}

function checkCli(require, packageName, packageRoot) {
  try {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const bin = packageJson.bin;
    let binPath = null;
    if (typeof bin === "string") {
      binPath = bin;
    } else if (bin && typeof bin === "object") {
      binPath = bin[packageName] || Object.values(bin)[0] || null;
    }
    if (!binPath) {
      return { status: "failed", error: { code: "NO_BIN", message: "installed package declares no bin entry" } };
    }

    const outsideCwd = mkdtempSync(join(tmpdir(), "niceeval-outside-cwd-"));
    const result = spawnSync(process.execPath, [join(packageRoot, binPath), "--help"], {
      cwd: outsideCwd,
      encoding: "utf8",
    });

    if (result.error || result.status !== 0) {
      return {
        status: "failed",
        error: {
          code: "CLI_FAILED",
          message: `${String(result.error || `exit ${result.status}`)}: ${String(result.stderr || "").slice(0, 400)}`,
        },
      };
    }
    const stdoutHasUsage = /niceeval/i.test(result.stdout || "");
    if (!stdoutHasUsage) {
      return {
        status: "failed",
        error: { code: "CLI_OUTPUT", message: "niceeval --help stdout missing expected marker" },
      };
    }
    return { status: "ok", command: `${packageName} --help`, exitCode: result.status, cwd: outsideCwd, stdoutHasUsage };
  } catch (error) {
    return { status: "failed", error: describeError(error) };
  }
}

/**
 * 遍历安装后包的 exports，执行 Journey A 全部断言并返回结构化 report。
 * 不抛异常；失败全部收集进 report.failures（exit 非零由调用方决定）。
 */
export async function traverseInstalledEntries({ packageName = DEFAULT_PACKAGE_NAME, fromUrl = import.meta.url } = {}) {
  let packageRoot = "";
  let packageVersion = "unknown";
  let require = null;
  let exportsMap = {};
  let optionalPeers = new Set();
  try {
    const found = findInstalledPackageRoot(packageName, fromUrl);
    packageRoot = found.root;
    packageVersion = String(found.packageJson.version || "unknown");
    exportsMap = found.packageJson.exports && typeof found.packageJson.exports === "object" ? found.packageJson.exports : {};
    require = found.require;
    optionalPeers = optionalPeerNames(found.packageJson);
  } catch (error) {
    const failures = [{ kind: "packageLookup", detail: describeError(error) }];
    return { packageName, packageVersion, ok: false, entries: [], assets: [], cli: null, failures };
  }

  const entries = [];
  const assets = [];
  for (const [exportKey, value] of Object.entries(exportsMap)) {
    if (exportKey.includes("*")) continue;
    const specifier = specifierOf(packageName, exportKey);
    if (typeof value === "string") {
      assets.push(checkAsset(specifier, exportKey));
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      entries.push(await checkRuntimeEntry(require, specifier, exportKey, optionalPeers));
    }
  }

  const cli = checkCli(require, packageName, packageRoot);

  const failures = [];
  for (const entry of entries) {
    if (entry.status === "failed") {
      failures.push({ kind: "runtimeEntry", specifier: entry.specifier, detail: entry.error });
    }
  }
  for (const asset of assets) {
    if (asset.status === "failed") {
      failures.push({ kind: "asset", specifier: asset.specifier, detail: asset.error });
    }
  }
  if (cli && cli.status === "failed") {
    failures.push({ kind: "cli", detail: cli.error });
  }

  return { packageName, packageVersion, ok: failures.length === 0, entries, assets, cli, failures };
}

async function main() {
  const report = await traverseInstalledEntries();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    for (const failure of report.failures) {
      const specifier = failure.specifier ? `${failure.specifier}: ` : "";
      process.stderr.write(`[traverse-entries] ${failure.kind} ${specifier}${JSON.stringify(failure.detail)}\n`);
    }
    process.exitCode = 1;
  }
}

const isDirectRun =
  typeof process.argv[1] === "string" && process.argv[1].split(/[\\/]/).pop() === "traverse-entries.mjs";
if (isDirectRun) {
  void main();
}
