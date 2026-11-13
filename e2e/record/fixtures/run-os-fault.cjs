// Faults affect only the operating system / SQLite boundary. No NiceEval module,
// table, row shape, or recovery algorithm is imported or reproduced here.
const { syncBuiltinESMExports } = require("node:module");
if (process.env.NICEEVAL_RUN_OS_FAULT === "identity-unavailable") {
  const fs = require("node:fs");
  const child = require("node:child_process");
  const read = fs.readFileSync;
  fs.readFileSync = function (path, ...args) {
    if (typeof path === "string" && (path === "/etc/machine-id" || path.startsWith("/proc/"))) throw new Error("OS identity unavailable");
    return read.call(this, path, ...args);
  };
  const exec = child.execFileSync;
  child.execFileSync = function (path, ...args) {
    if (["/usr/sbin/ioreg", "/usr/sbin/sysctl", "/bin/ps"].includes(path)) throw new Error("OS identity unavailable");
    return exec.call(this, path, ...args);
  };
  syncBuiltinESMExports();
} else if (process.env.NICEEVAL_RUN_OS_FAULT === "commit-once") {
  const { DatabaseSync } = require("node:sqlite");
  const exec = DatabaseSync.prototype.exec;
  let immediate = false;
  let injected = false;
  DatabaseSync.prototype.exec = function (sql) {
    const result = exec.call(this, sql);
    if (/^BEGIN IMMEDIATE$/iu.test(sql.trim())) immediate = true;
    if (/^COMMIT$/iu.test(sql.trim()) && immediate && !injected) {
      injected = true;
      immediate = false;
      throw new Error("Injected I/O failure after SQLite committed a write transaction");
    }
    if (/^(COMMIT|ROLLBACK)$/iu.test(sql.trim())) immediate = false;
    return result;
  };
}
