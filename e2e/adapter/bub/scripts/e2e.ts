#!/usr/bin/env -S npx tsx
// scripts/e2e.ts — bub 唯一执行入口(docs/engineering/testing/e2e/README.md §3.1)。
//
// 1. 检查所需 secrets(fail-fast)与本地 Docker daemon 是否可达。
// 2. 安装依赖(候选包注入由根编排器完成)。
// 3. 构建/复用本仓库的预制 Docker 镜像(scripts/build-docker-env.ts)。
// 4. 清理上一次运行的临时结果。
// 5. 跑 scripts/verify.ts 的全部断言(真实跑 ci 实验 + CLI 读回)。
// 6. 按能否确证的外部故障分类退出码:0 契约符合预期,75(EX_TEMPFAIL)基础设施故障,
//    其它非零是回归。没有需要起停的独立被测服务——被测对象是 Docker 沙箱本身,由
//    niceeval runner 在跑实验时自己创建/销毁容器。

import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { ensureDockerImage } from "./build-docker-env.ts";
import { runVerify } from "./verify.ts";

const EX_TEMPFAIL = 75;
const REQUIRED_SECRETS = ["BUB_API_KEY", "BUB_API_BASE", "NICEEVAL_JUDGE_KEY", "NICEEVAL_JUDGE_BASE"] as const;

class InfraError extends Error {}

function runInherited(cmd: string, args: string[]): number {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  return res.status ?? 1;
}

function checkDockerDaemon(): void {
  const res = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (res.status !== 0) {
    throw new InfraError(
      "docker info failed — local Docker daemon is not reachable. bub is a `sandbox` group repo " +
        "(e2e.json.requires.docker) and needs a running daemon (confirm with `docker info` before rerunning).",
    );
  }
}

async function main(): Promise<void> {
  mkdirSync("logs", { recursive: true });

  // 1. secrets fail-fast + docker daemon 可达性(结构化基础设施前置检查)。
  const missing = REQUIRED_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`[bub] missing required secret(s): ${missing.join(", ")} — see .env.example`);
    process.exitCode = 1;
    return;
  }

  try {
    checkDockerDaemon();

    // 2. 安装依赖——本仓库自带 pnpm-workspace.yaml(packages: []),独立跑(未被编排器复制到
    //    隔离目录)时也会被 pnpm 当成离自己最近的 workspace root,不会被顶到仓库根 workspace。
    if (!existsSync("node_modules")) {
      console.log("[bub] installing dependencies ...");
      const code = runInherited("pnpm", ["install", "--no-frozen-lockfile"]);
      if (code !== 0) {
        throw new InfraError(`pnpm install failed (exit ${code})`);
      }
    }

    // 3. 预制 Docker 镜像——幂等,tag 已存在时跳过构建(见 scripts/build-docker-env.ts)。
    ensureDockerImage();

    // 4. 清理上一次运行的临时结果。
    rmSync(".niceeval", { recursive: true, force: true });

    // 5-6. 验收(选择、退出码折叠、CLI 读回),把预期非零退出转换成通过/失败判定。
    await runVerify();
    console.log("\n[bub] all assertions passed.");
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[bub] verification failed:");
    console.error(err);

    let ciLog = "";
    try {
      ciLog = readFileSync("logs/exp-ci.log", "utf8");
    } catch {
      // 日志还没写出(极早期失败),留空即可,走回归分类。
    }

    // 能确证的外部故障:自己的 InfraError(docker daemon 不可达 / install 失败)、
    // provider/网络侧 429、5xx、连接类错误,或 sandbox.create/setup 阶段的超时——本仓库跑在
    // 共享 Docker daemon 上,与其它并发仓库争抢资源时会在起容器这步本身超时,这是环境问题,
    // 不是本仓库的契约回归。判不准就按回归退出——宁可误报回归,不可把回归漏报成环境问题。
    // ciLog 是 `--json` NDJSON 事件流(scripts/verify.ts 的 sh() 落盘),按结构化 `error`
    // 事件的 `reason`/`phase` 字段判定,不再正则抠 `--output ci` 时代的人读 "errored" 文本
    // (那个 flag 已经从 CLI 整个删除)。
    const infra =
      err instanceof InfraError ||
      ciLog.split("\n").some((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return false;
        let evt: unknown;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          return false;
        }
        if (!evt || typeof evt !== "object" || (evt as { event?: string }).event !== "error") return false;
        const reason = String((evt as { reason?: unknown }).reason ?? "");
        const phase = String((evt as { phase?: unknown }).phase ?? "");
        return /429|5\d\d|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(reason) || /^sandbox\.(create|setup)$/i.test(phase);
      });
    process.exitCode = infra ? EX_TEMPFAIL : 1;
  }
}

main();
