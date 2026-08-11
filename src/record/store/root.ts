import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { LocalStoreRootError } from "./errors.ts";

/**
 * bundled local factory 的 root normalization；在触碰 marker、目录或 lock 前完成，所以输入
 * 错误不会被降格成 missing / permission / IO。远端 backend 不能复用这个入口。
 */
export function normalizeLocalStoreRoot(root: string | URL): string {
  if (root instanceof URL) {
    if (root.protocol !== "file:") {
      throw new LocalStoreRootError({
        root: root.toString(),
        issue: "url-scheme-unsupported",
      });
    }
    if (root.host !== "") {
      throw new LocalStoreRootError({ root: root.toString(), issue: "file-url-host" });
    }
    if (root.search !== "" || root.hash !== "") {
      throw new LocalStoreRootError({ root: root.toString(), issue: "query-or-fragment" });
    }
    try {
      return resolve(fileURLToPath(root));
    } catch {
      throw new LocalStoreRootError({ root: root.toString(), issue: "malformed-url" });
    }
  }

  if (root.trim() === "") {
    throw new LocalStoreRootError({ root, issue: "empty" });
  }
  if (!isAbsolute(root)) {
    throw new LocalStoreRootError({ root, issue: "not-absolute" });
  }
  return resolve(root);
}
