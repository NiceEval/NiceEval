// 留存生命周期的 sandbox/ 域内路由:in-run 的 suspend(留存提交后转休眠)与事后命令
// (`niceeval sandbox list/enter/stop`)用的 detached 能力(不需要原来的 run 进程或 Sandbox
// 实例还活着)。provider 名的行为分支只允许出现在 sandbox/ 内(见 docs/architecture.md);
// 运行器与评分路径不感知 provider 名。

import type { Sandbox } from "../types.ts";

/** 有留存能力的 provider 实例都带一个非公开接口成员 suspend()(Sandbox 接口不因留存扩大)。 */
interface Suspendable {
  suspend(): Promise<void>;
}

/** provider 是否参与留存(defineSandbox 自定义 provider 不参与,创建前报错)。 */
export const KEEPABLE_PROVIDERS = new Set(["docker", "e2b", "vercel"]);

/** in-run 的休眠:留存提交成功后由 Scope release 调用(sandbox.suspend 阶段,有界计时)。 */
export async function suspendSandbox(sandbox: Sandbox): Promise<void> {
  const suspend = (sandbox as unknown as Partial<Suspendable>).suspend;
  if (typeof suspend !== "function") {
    throw new Error(`sandbox provider has no suspend capability (sandboxId=${sandbox.sandboxId})`);
  }
  await suspend.call(sandbox);
}

/**
 * provider 原生的进入命令(记进注册表供直连与审计;日常入口是 `niceeval sandbox enter`)。
 * `sandboxId` 对 vercel 而言是沙箱的持久 `name`——官方 CLI(独立 npm 包 `sandbox`,别名
 * `sbx`)按 name 索引,`sandbox connect <name>`(别名 `ssh`/`shell`)唤醒并打开交互式 shell,
 * 与 docker/e2b 的"原生命令即可直连"语义一致(vercel.com/docs/sandbox/cli-reference)。
 */
export function nativeEnterCommand(provider: string, sandboxId: string): string | undefined {
  switch (provider) {
    case "docker":
      return `docker start ${sandboxId} && docker exec -it ${sandboxId} bash`;
    case "e2b":
      return `e2b sandbox connect ${sandboxId}`;
    case "vercel":
      return `sandbox connect ${sandboxId}`;
    default:
      return undefined;
  }
}

/**
 * Vercel 持久沙箱的默认快照保留期限:`snapshotExpiration` 默认 2,592,000,000ms(30 天),
 * 从快照最后一次使用起算(官方文档 vercel.com/docs/sandbox/concepts/persistent-sandboxes)。
 * niceeval 的 `VercelSandbox.create()` 不传自定义 `snapshotExpiration`,这个默认值就是
 * suspend(`stop()`,自动打快照)之后实际生效的保留期限。
 */
const VERCEL_DEFAULT_SNAPSHOT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 留存提交时算出 `expiresAt`——与 `nativeEnterCommand` 同步、无 IO,在 `writeKeptEntry`
 * 原子写入之前算好:provider 声明了保留期限才写。
 *
 * - **vercel**:写 `keptAt` + 默认快照保留期(30 天)。
 * - **e2b**:不写——官方文档("paused sandboxes are kept indefinitely; there is no
 *   automatic deletion or time-to-live limit")明确 pause 没有自然过期时刻。
 * - **docker**:不写——docker 的留存是本地停驻容器,不是「远端保留期限」这个概念。
 */
export function computeExpiresAt(provider: string, keptAt: string): string | undefined {
  switch (provider) {
    case "vercel":
      return new Date(Date.parse(keptAt) + VERCEL_DEFAULT_SNAPSHOT_EXPIRATION_MS).toISOString();
    default:
      return undefined;
  }
}

export type DetachedState = "alive" | "dormant" | "expired";

/** 事后核对现场状态(docker 问本地 daemon;云 provider 按实例状态核对,查不到 = expired)。 */
export async function inspectDetached(provider: string, sandboxId: string): Promise<DetachedState> {
  switch (provider) {
    case "docker": {
      try {
        const { default: Docker } = await import("dockerode");
        const info = await new Docker().getContainer(sandboxId).inspect();
        return info.State?.Running ? "alive" : "dormant";
      } catch {
        return "expired";
      }
    }
    case "e2b": {
      try {
        const { Sandbox: E2BSdkSandbox } = await import("e2b");
        const list = (E2BSdkSandbox as unknown as {
          list?: (opts?: Record<string, unknown>) => Promise<Array<{ sandboxId: string; state?: string }>>;
        }).list;
        if (typeof list !== "function") return "dormant";
        const sandboxes = await list({ apiKey: process.env.E2B_API_KEY });
        const hit = sandboxes.find((s) => s.sandboxId === sandboxId || s.sandboxId.startsWith(sandboxId));
        if (!hit) return "expired";
        return hit.state === "running" ? "alive" : "dormant";
      } catch {
        return "expired";
      }
    }
    case "vercel": {
      try {
        // 查状态用 name + resume:false——不为了看一眼状态就把休眠的沙箱唤醒(list 是只读命令,
        // 不该有唤醒这个副作用,也不该产生唤醒的计费)。
        const { Sandbox: VSandbox } = await import("@vercel/sandbox");
        const get = (
          VSandbox as unknown as {
            get?: (opts: Record<string, unknown>) => Promise<{ status: string } | null>;
          }
        ).get;
        if (typeof get !== "function") return "dormant";
        const found = await get({ name: sandboxId, resume: false });
        if (!found) return "expired";
        return found.status === "running" ? "alive" : "dormant";
      } catch {
        return "expired";
      }
    }
    default:
      return "expired";
  }
}

/**
 * detached 销毁:按注册表条目的 provider 名路由,不需要 Sandbox 实例。
 * 返回 "stopped"(成功销毁)或 "already-gone"(实例已不存在,幂等);
 * 其它错误上抛——调用方保留登记项并退出 1,不能把仍活着的资源从管理面隐藏掉。
 */
export async function destroyDetached(provider: string, sandboxId: string): Promise<"stopped" | "already-gone"> {
  switch (provider) {
    case "docker": {
      const { default: Docker } = await import("dockerode");
      const container = new Docker().getContainer(sandboxId);
      try {
        await container.remove({ force: true });
        return "stopped";
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode === 404) return "already-gone";
        throw e;
      }
    }
    case "e2b": {
      const { Sandbox: E2BSdkSandbox } = await import("e2b");
      const kill = (E2BSdkSandbox as unknown as {
        kill?: (id: string, opts?: Record<string, unknown>) => Promise<boolean>;
      }).kill;
      if (typeof kill !== "function") throw new Error("this e2b SDK version has no detached kill capability");
      const killed = await kill(sandboxId, { apiKey: process.env.E2B_API_KEY });
      return killed ? "stopped" : "already-gone";
    }
    case "vercel": {
      // 真正的销毁是 SDK 的 delete()(≙ 官方 CLI 的 `sandbox remove`)——stop() 只是 suspend
      // (自动打快照、之后能 Sandbox.get 恢复),把它当销毁用会把"已删除"的沙箱悄悄留成可恢复
      // 的休眠态,`sandbox stop` 的"销毁"承诺就不成立了。resume:false 避免删除前先唤醒。
      const { Sandbox: VSandbox } = await import("@vercel/sandbox");
      const get = (
        VSandbox as unknown as {
          get?: (opts: Record<string, unknown>) => Promise<{ delete(): Promise<void> } | null>;
        }
      ).get;
      if (typeof get !== "function") throw new Error("this vercel SDK version has no detached get capability");
      const found = await get({ name: sandboxId, resume: false }).catch(() => null);
      if (!found) return "already-gone";
      await found.delete();
      return "stopped";
    }
    default:
      throw new Error(`provider "${provider}" has no detached stop channel`);
  }
}

/** 唤醒休眠现场(enter / history / diff 前);docker start,云 provider 按 SDK 恢复。 */
export async function wakeDetached(provider: string, sandboxId: string): Promise<void> {
  switch (provider) {
    case "docker": {
      const { default: Docker } = await import("dockerode");
      const container = new Docker().getContainer(sandboxId);
      const info = await container.inspect();
      if (!info.State?.Running) await container.start();
      return;
    }
    case "e2b": {
      const { Sandbox: E2BSdkSandbox } = await import("e2b");
      const resume = (E2BSdkSandbox as unknown as {
        resume?: (id: string, opts?: Record<string, unknown>) => Promise<unknown>;
        connect?: (id: string, opts?: Record<string, unknown>) => Promise<unknown>;
      });
      if (typeof resume.resume === "function") {
        await resume.resume(sandboxId, { apiKey: process.env.E2B_API_KEY });
        return;
      }
      if (typeof resume.connect === "function") {
        await resume.connect(sandboxId, { apiKey: process.env.E2B_API_KEY });
        return;
      }
      throw new Error("this e2b SDK version has no resume capability");
    }
    case "vercel": {
      // Sandbox.get({ name, resume: true })(默认值)是 SDK 原生的恢复入口:sandbox 默认持久,
      // get() 在会话已停止时自动从最近快照恢复文件系统并起新会话——不需要另一个专门的
      // "resume" API(vercel.com/docs/sandbox/sdk-reference)。
      const { Sandbox: VSandbox } = await import("@vercel/sandbox");
      const get = (
        VSandbox as unknown as { get?: (opts: Record<string, unknown>) => Promise<unknown> }
      ).get;
      if (typeof get !== "function") throw new Error("this vercel SDK version has no get capability");
      await get({ name: sandboxId, resume: true });
      return;
    }
    default:
      throw new Error(`provider "${provider}" has no wake channel`);
  }
}

/** 送回休眠(enter 退出后 / history、diff 读完后)。 */
export async function suspendDetached(provider: string, sandboxId: string): Promise<void> {
  switch (provider) {
    case "docker": {
      const { default: Docker } = await import("dockerode");
      await new Docker().getContainer(sandboxId).stop({ t: 5 });
      return;
    }
    case "e2b": {
      const { Sandbox: E2BSdkSandbox } = await import("e2b");
      const pause = (E2BSdkSandbox as unknown as {
        pause?: (id: string, opts?: Record<string, unknown>) => Promise<unknown>;
      }).pause;
      if (typeof pause === "function") {
        await pause(sandboxId, { apiKey: process.env.E2B_API_KEY });
        return;
      }
      throw new Error("this e2b SDK version has no detached pause capability");
    }
    case "vercel": {
      // suspend = stop():自动打快照保存文件系统,之后经 Sandbox.get 恢复(留存语义见
      // docs/feature/sandbox/architecture.md「留存(keep)与注册表」)。resume:false——这里
      // 只想找到已经醒着的实例去 stop 它,不需要 get() 顺手再唤醒一次。
      const { Sandbox: VSandbox } = await import("@vercel/sandbox");
      const get = (
        VSandbox as unknown as {
          get?: (opts: Record<string, unknown>) => Promise<{ stop(): Promise<unknown> } | null>;
        }
      ).get;
      if (typeof get !== "function") throw new Error("this vercel SDK version has no get capability");
      const found = await get({ name: sandboxId, resume: false });
      if (!found) throw new Error(`vercel sandbox "${sandboxId}" not found; it may already be gone`);
      await found.stop();
      return;
    }
    default:
      throw new Error(`provider "${provider}" has no suspend channel`);
  }
}

/**
 * 打开交互式 shell(`niceeval sandbox enter`的落地动作):把三家 provider 各自的原生连接
 * 命令当子进程跑,stdio 直通当前终端——不重新实现各家的 PTY 协议(docker 是 exec 直连;e2b /
 * vercel 都有官方 CLI 已经处理好 PTY 转发,niceeval 只负责唤醒、启动这个子进程、退出后回眠)。
 * 返回子进程退出码;若原生命令本身起不来(如未安装对应 CLI),抛出原始 spawn 错误,调用方
 * 据此提示改用注册表里记录的 `enter` 命令直连。
 */
export async function openInteractiveShell(provider: string, sandboxId: string, workdir: string): Promise<number> {
  switch (provider) {
    case "docker":
      return spawnAndWait("docker", ["exec", "-it", "-w", workdir, sandboxId, "bash", "-l"]);
    case "e2b":
      return spawnAndWait("e2b", ["sandbox", "connect", sandboxId]);
    case "vercel": {
      // sandbox CLI 复用 niceeval 已经在用的显式凭据(与 VercelSandbox.create 同一路径),
      // 不强制用户额外 `vercel link` / `sandbox login`。
      const args = ["connect", "--workdir", workdir];
      const token = process.env.VERCEL_API_TOKEN;
      const teamId = process.env.VERCEL_TEAM_ID;
      const projectId = process.env.VERCEL_PROJECT_ID;
      if (token) args.push("--token", token);
      if (teamId) args.push("--scope", teamId);
      if (projectId) args.push("--project", projectId);
      args.push(sandboxId);
      return spawnAndWait("sandbox", args);
    }
    default:
      throw new Error(`provider "${provider}" has no interactive enter channel`);
  }
}

async function spawnAndWait(cmd: string, args: string[]): Promise<number> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => resolvePromise(code ?? 0));
    child.on("error", (err) => reject(err));
  });
}

/**
 * 在留存现场里跑一条非交互命令(`sandbox history` / `diff` 用,读私有变更分类账)。docker 走
 * dockerode exec(多路复用流需要按帧解析);e2b / vercel 走各自 SDK 拿到一个可 runCommand 的
 * 实例句柄——`wakeDetached` 已经确保现场醒着,这里只负责拿句柄、跑命令、取回 stdout。
 */
export async function execInDetached(provider: string, sandboxId: string, workdir: string, script: string): Promise<string> {
  switch (provider) {
    case "docker":
      return execInDockerLedger(sandboxId, workdir, script);
    case "e2b": {
      const { Sandbox: E2BSdkSandbox } = await import("e2b");
      const sbx = await E2BSdkSandbox.connect(sandboxId, { apiKey: process.env.E2B_API_KEY });
      const res = await sbx.commands.run(script, {
        cwd: workdir,
        envs: { GIT_DIR: "/tmp/.niceeval-ledger", GIT_WORK_TREE: workdir, HOME: "/tmp" },
      });
      return res.stdout;
    }
    case "vercel": {
      const { Sandbox: VSandbox } = await import("@vercel/sandbox");
      const get = (
        VSandbox as unknown as {
          get?: (opts: Record<string, unknown>) => Promise<{
            runCommand(params: Record<string, unknown>): Promise<{ stdout(): Promise<string> }>;
          } | null>;
        }
      ).get;
      if (typeof get !== "function") throw new Error("this vercel SDK version has no get capability");
      const found = await get({ name: sandboxId, resume: false });
      if (!found) throw new Error(`vercel sandbox "${sandboxId}" not found; the in-sandbox ledger died with it`);
      const finished = await found.runCommand({
        cmd: "sh",
        args: ["-c", script],
        cwd: workdir,
        env: { GIT_DIR: "/tmp/.niceeval-ledger", GIT_WORK_TREE: workdir, HOME: "/tmp" },
      });
      return await finished.stdout();
    }
    default:
      throw new Error(`replaying the ledger has no exec channel for provider "${provider}"`);
  }
}

/** docker 分支:dockerode exec 一条命令,多路复用流按 8 字节头逐帧剥离拼回文本。 */
async function execInDockerLedger(sandboxId: string, workdir: string, script: string): Promise<string> {
  const { default: Docker } = await import("dockerode");
  const container = new Docker().getContainer(sandboxId);
  const exec = await container.exec({
    Cmd: ["sh", "-c", script],
    AttachStdout: true,
    AttachStderr: true,
    Env: ["GIT_DIR=/tmp/.niceeval-ledger", `GIT_WORK_TREE=${workdir}`, "HOME=/tmp"],
  });
  const stream = await exec.start({});
  return await new Promise<string>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      // docker 多路复用帧:每帧 8 字节头(stream type + 长度),逐帧剥掉。
      const raw = Buffer.concat(chunks);
      let out = "";
      let offset = 0;
      while (offset + 8 <= raw.length) {
        const size = raw.readUInt32BE(offset + 4);
        out += raw.subarray(offset + 8, offset + 8 + size).toString("utf-8");
        offset += 8 + size;
      }
      resolvePromise(out || raw.toString("utf-8"));
    });
    stream.on("error", reject);
  });
}

/**
 * 事后命令(`enter`/`history`/`diff`)在 CLI 层是否可对某 provider 名执行的静态守门——
 * 留存注册表只可能出现 `KEEPABLE_PROVIDERS` 三家之一;命中之外(手改注册表、跨版本遗留的
 * provider 名)如实报出「不是 niceeval sandbox provider」,不是逐条 `if (provider === …)`。
 * 返回 undefined 表示可执行;否则给出可直接展示给用户的原因。
 */
export function detachedCapabilityGap(provider: string): string | undefined {
  if (KEEPABLE_PROVIDERS.has(provider)) return undefined;
  return `"${provider}" is not a niceeval sandbox provider (expected one of: ${[...KEEPABLE_PROVIDERS].join(", ")})`;
}
