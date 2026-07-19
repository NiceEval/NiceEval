// 唯一执行入口(docs/engineering/e2e-ci/README.md §3.1):准备、运行、验收、分类退出码。
// dotenv 必须在本文件顶部最先加载——本进程随后 spawn 的 `pnpm exec niceeval ...` 子进程
// 默认继承 process.env,verify.ts 与 experiments/agents 读到的 CODEX_API_KEY 等变量都来自这里。
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import runVerify from "./verify.ts";

function sh(cmd: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

class InfraError extends Error {}

async function main(): Promise<void> {
  const required = ["CODEX_API_KEY", "CODEX_BASE_URL", "NICEEVAL_JUDGE_KEY", "NICEEVAL_JUDGE_BASE"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new InfraError(
      `缺少必需的环境变量:${missing.join(", ")}——检查本仓库的 .env(见 .env.example)`,
    );
  }

  // group "sandbox" 需要真实 Docker daemon;起不来是确证的基础设施故障,不是回归。
  const dockerInfo = sh("docker info");
  if (dockerInfo.status !== 0) {
    throw new InfraError(`docker info 失败(exit ${dockerInfo.status})——本机 Docker daemon 未就绪:\n${dockerInfo.stderr.slice(-2000)}`);
  }

  // 编排器 / crabbox 的 `pnpm install --frozen-lockfile && pnpm e2e` 独立 checkout 路径已经
  // 装过依赖;这里只兜底"直接在本目录原地跑 pnpm e2e、还没装过依赖"的情况。本仓库自带
  // pnpm-workspace.yaml(packages: []),就地 install 不会被上一层 e2e/ 的旧 workspace 劫持
  // (见 memory/e2e-repos-stale-pnpm-workspace-hijacks-lockfile.md)。
  if (!existsSync("node_modules/niceeval")) {
    const install = sh("pnpm install --no-frozen-lockfile --ignore-workspace");
    if (install.status !== 0) {
      throw new InfraError(`pnpm install 失败(exit ${install.status})——依赖没装上:\n${install.stderr.slice(-2000)}`);
    }
  }

  // 清理上一次运行的临时结果(README §3.1 第 3 步),不依赖 verify.ts 内部的单点清理。
  sh("rm -rf .niceeval junit.xml logs");

  await runVerify();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);

    let infra = err instanceof InfraError;
    if (!infra) {
      try {
        const ciLog = readFileSync("logs/exp-ci.log", "utf8");
        infra = /errored .*(429|5\d\d|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)/i.test(ciLog);
      } catch {
        // 日志还没落地(比如 install 阶段就失败了)——不算已确证的 infra 故障,按回归退出。
      }
    }

    // 判不准就按回归退出——宁可误报回归,不可把回归漏报成环境问题
    // (docs/engineering/e2e-ci/verification.md「失败分类」)。
    process.exit(infra ? 75 : 1);
  });
