import "dotenv/config";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const CI_LOG = "logs/exp-ci.log";
const EXPECTED_EVALS = [
  "coding-task/write-and-verify",
  "session/recall",
  "usage/tokens",
];

function ensureDirs(): void {
  mkdirSync("logs", { recursive: true });
  writeFileSync(CI_LOG, "");
}

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  console.log(`\n$ ${cmd}`);
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const combined = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  appendFileSync(CI_LOG, `$ ${cmd}\n${combined}\n(exit ${exit})\n\n`);
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(ok, `${cmd}\n退出 ${exit},期望 ${expect}。输出尾部:\n${combined.slice(-2000)}`);
  return combined;
}

function latestAttemptLine(evalId: string): string {
  const lines = sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
  assert.ok(lines.length > 0, `show --history 里 ${evalId} 没有任何 attempt 行`);
  return lines.at(-1)!;
}

export async function runVerify(): Promise<void> {
  ensureDirs();
  console.log(`[verify] niceeval: ${sh("pnpm exec niceeval --version").trim()}`);
  sh("pnpm --silent exec niceeval exp ci --force --json --junit junit.xml");
  const junitXml = readFileSync("junit.xml", "utf8");
  assert.ok(!junitXml.includes("<failure") && !junitXml.includes("<error"), `JUnit 有 failure/error:\n${junitXml}`);

  const board = sh("pnpm exec niceeval show");
  for (const id of EXPECTED_EVALS) {
    assert.ok(board.includes(id), `show 默认报告缺少 ${id}:\n${board}`);
  }

  const locators: Record<string, string> = {};
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(line.includes("passed"), `${id} 不是 passed: ${line}`);
    const locator = line.match(/@\S+/)?.[0];
    assert.ok(locator, `${id} 缺少 locator: ${line}`);
    locators[id] = locator!;
  }

  const coding = sh(`pnpm exec niceeval show ${locators["coding-task/write-and-verify"]} --execution`);
  assert.ok(
    coding.includes("notes.txt") || coding.includes("file_write") || coding.includes("write"),
    `执行树缺少写文件证据:\n${coding}`,
  );
}

export default runVerify;
