// Docker 沙箱后端:用 dockerode 把容器当隔离工作区跑 eval。
// 改编自 agent-eval 的 docker-sandbox.ts,签名对齐 ../types.ts 的 Sandbox 契约
//(runShell/runCommand 的 opts 一律是选项对象,不再用位置参数)。

import Docker from "dockerode";
import * as tar from "tar-stream";
import type { Sandbox, CommandResult, CommandOptions, SandboxFile } from "../types.ts";

// 各 Node 运行时对应的镜像。用 -slim 变体下载更快、兼容性够用。
const DOCKER_IMAGES: Record<string, string> = {
  node20: "node:20-slim",
  node24: "node:24-slim",
};

// 单条命令默认超时(10 分钟)。
const DEFAULT_TIMEOUT = 600_000;

// 容器内工作目录。
const CONTAINER_WORKDIR = "/home/sandbox/workspace";

// 非 root 用户:安全 + 兼容(如 Claude Code 在 root 下拒绝 --dangerously-skip-permissions)。
// node:*-slim 镜像自带 UID/GID 1000 的 node 用户。
const SANDBOX_UID = 1000;
const SANDBOX_GID = 1000;

// npm 全局包安装目录(非 root 可写)。
const NPM_GLOBAL_DIR = "/home/node/.npm-global";

// 命令执行时注入的 PATH:把 npm 全局 bin 放最前。
const SANDBOX_PATH = `${NPM_GLOBAL_DIR}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;

/** 创建 Docker 沙箱的选项。 */
export interface DockerSandboxOptions {
  /** 单条命令超时(毫秒)。 */
  timeout?: number;
  /** Node 运行时。 */
  runtime?: "node20" | "node24";
}

/**
 * Docker 沙箱:为每次运行起一个隔离容器。
 * 实现 ../types.ts 的 Sandbox 接口。
 */
export class DockerSandbox implements Sandbox {
  private docker: Docker;
  private container: Docker.Container | null = null;
  private _containerId = "";
  private timeout: number;
  private runtime: string;
  private _workingDirectory: string = CONTAINER_WORKDIR;

  constructor(options: DockerSandboxOptions = {}) {
    this.docker = new Docker();
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.runtime = options.runtime ?? "node24";
  }

  /** 创建并启动一个 Docker 沙箱。 */
  static async create(options: DockerSandboxOptions = {}): Promise<DockerSandbox> {
    const sandbox = new DockerSandbox(options);
    await sandbox.initialize();
    return sandbox;
  }

  /** 拉镜像、起容器、装基础工具、备好工作区与 npm 前缀。 */
  private async initialize(): Promise<void> {
    const imageName = DOCKER_IMAGES[this.runtime];
    if (!imageName) {
      throw new Error(`Unsupported runtime: ${this.runtime}`);
    }

    // 确保镜像在本地。
    await this.ensureImage(imageName);

    // 起容器(先以 root 做初始化,之后命令切到非 root 用户)。
    this.container = await this.docker.createContainer({
      Image: imageName,
      Cmd: ["sleep", "infinity"], // 保持容器存活
      WorkingDir: CONTAINER_WORKDIR,
      Tty: true,
      HostConfig: {
        AutoRemove: true, // 停止即清理
      },
    });

    this._containerId = this.container.id;

    await this.container.start();

    // slim 镜像可能缺 CA 证书和 git,补装。
    await this.runCommandAsRoot("bash", [
      "-c",
      "apt-get update -qq && apt-get install -y -qq ca-certificates git > /dev/null 2>&1",
    ]);

    // 工作目录交给非 root 用户(node:node)。node 用户(UID 1000)在 slim 镜像里已存在。
    await this.runCommandAsRoot("mkdir", ["-p", CONTAINER_WORKDIR]);
    await this.runCommandAsRoot("chown", ["-R", `${SANDBOX_UID}:${SANDBOX_GID}`, CONTAINER_WORKDIR]);

    // 为非 root 全局安装准备 npm 目录。
    await this.runCommandAsRoot("mkdir", ["-p", NPM_GLOBAL_DIR]);
    await this.runCommandAsRoot("chown", ["-R", `${SANDBOX_UID}:${SANDBOX_GID}`, NPM_GLOBAL_DIR]);

    // 让 npm 用这个目录当全局前缀。
    await this.runCommand("npm", ["config", "set", "prefix", NPM_GLOBAL_DIR]);
  }

  /** 确保镜像在本地,缺了就拉。 */
  private async ensureImage(imageName: string): Promise<void> {
    try {
      const image = this.docker.getImage(imageName);
      await image.inspect();
    } catch {
      // 镜像不存在,拉取。
      console.log(`Pulling Docker image: ${imageName}...`);
      await this.pullImage(imageName);
      console.log(`Docker image ready: ${imageName}`);
    }
  }

  /** 拉取镜像并跟进度。 */
  private async pullImage(imageName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        this.docker.modem.followProgress(
          stream,
          (followErr: Error | null) => {
            if (followErr) {
              reject(followErr);
            } else {
              resolve();
            }
          },
          // 进度回调(可在此挂进度条)。
          () => {},
        );
      });
    });
  }

  /** 容器短 ID(像 Docker CLI 那样取前 12 位)。 */
  get sandboxId(): string {
    return this._containerId.slice(0, 12);
  }

  /** 以非 root 用户在容器里跑一条命令。 */
  async runCommand(
    cmd: string,
    args: string[] = [],
    opts: CommandOptions = {},
  ): Promise<CommandResult> {
    // 保证 npm 全局 bin 在 PATH 里。
    const env = {
      ...opts.env,
      PATH: SANDBOX_PATH,
    };

    return this.execCommand(cmd, args, {
      env,
      cwd: opts.cwd,
      user: `${SANDBOX_UID}:${SANDBOX_GID}`,
    });
  }

  /** 以 root 跑命令(仅内部初始化用)。 */
  private async runCommandAsRoot(
    cmd: string,
    args: string[] = [],
    opts: CommandOptions = {},
  ): Promise<CommandResult> {
    return this.execCommand(cmd, args, {
      env: opts.env,
      cwd: opts.cwd,
      user: "root",
    });
  }

  /** 真正在容器里 exec 一条命令,demux stdout/stderr 并带超时。 */
  private async execCommand(
    cmd: string,
    args: string[] = [],
    opts: { env?: Record<string, string>; cwd?: string; user?: string } = {},
  ): Promise<CommandResult> {
    if (!this.container) {
      throw new Error("Container not initialized");
    }

    const fullCmd = [cmd, ...args];
    const env = opts.env
      ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)
      : undefined;

    const exec = await this.container.exec({
      Cmd: fullCmd,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: opts.cwd ?? this._workingDirectory,
      Env: env,
      User: opts.user,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise<CommandResult>((resolve, reject) => {
      // Docker 把 stdout/stderr 复用在同一条流里,需手动 demux。
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      stream.on("data", (chunk: Buffer) => {
        // Docker 流格式:8 字节头 + 载荷。
        // 头:[stream_type(1B), 0, 0, 0, size(4B 大端)]。
        // stream_type:1 = stdout,2 = stderr。
        let offset = 0;
        while (offset < chunk.length) {
          if (offset + 8 > chunk.length) {
            // 头不完整,剩余当 stdout。
            stdoutChunks.push(chunk.subarray(offset));
            break;
          }

          const streamType = chunk[offset];
          const size = chunk.readUInt32BE(offset + 4);

          if (offset + 8 + size > chunk.length) {
            // 载荷不完整,剩余当 stdout。
            stdoutChunks.push(chunk.subarray(offset + 8));
            break;
          }

          const payload = chunk.subarray(offset + 8, offset + 8 + size);
          if (streamType === 1) {
            stdoutChunks.push(payload);
          } else if (streamType === 2) {
            stderrChunks.push(payload);
          } else {
            // 未知类型,当 stdout。
            stdoutChunks.push(payload);
          }

          offset += 8 + size;
        }
      });

      // 超时:杀流并 reject。
      const timeoutId = setTimeout(() => {
        stream.destroy();
        reject(new Error(`Command timed out after ${this.timeout}ms`));
      }, this.timeout);

      stream.on("end", async () => {
        clearTimeout(timeoutId);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");

        try {
          const inspection = await exec.inspect();
          resolve({
            stdout,
            stderr,
            exitCode: inspection.ExitCode ?? 0,
          });
        } catch (error) {
          reject(error);
        }
      });

      stream.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /** 经 bash -c 跑一段 shell 脚本。opts 为选项对象。 */
  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    return this.runCommand("bash", ["-c", script], opts);
  }

  /** 读容器里的文件。 */
  async readFile(path: string): Promise<string> {
    const result = await this.runCommand("cat", [path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file ${path}: ${result.stderr}`);
    }
    return result.stdout;
  }

  /** 判断容器里某文件是否存在。 */
  async fileExists(path: string): Promise<boolean> {
    const result = await this.runCommand("test", ["-f", path]);
    return result.exitCode === 0;
  }

  /** 批量写文件(路径 -> 文本内容)。 */
  async writeFiles(files: Record<string, string>): Promise<void> {
    const sandboxFiles: SandboxFile[] = Object.entries(files).map(([path, content]) => ({
      path,
      content: Buffer.from(content, "utf-8"),
    }));

    await this.uploadFiles(sandboxFiles);
  }

  /** 用 tar 归档把文件灌进容器。 */
  async uploadFiles(files: SandboxFile[]): Promise<void> {
    if (!this.container) {
      throw new Error("Container not initialized");
    }

    if (files.length === 0) {
      return;
    }

    // 打 tar 包。
    const pack = tar.pack();

    for (const file of files) {
      const content =
        typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : file.content;

      pack.entry({ name: file.path }, content);
    }

    pack.finalize();

    // putArchive 以 root 身份解包到工作区。
    await this.container.putArchive(pack, { path: CONTAINER_WORKDIR });

    // 修正属主:putArchive 上传成 root,改回 node 用户,agent 才能编辑。
    await this.runCommandAsRoot("chown", ["-R", `${SANDBOX_UID}:${SANDBOX_GID}`, CONTAINER_WORKDIR]);
  }

  /** 取当前工作目录。 */
  getWorkingDirectory(): string {
    return this._workingDirectory;
  }

  /** 设当前工作目录。 */
  setWorkingDirectory(path: string): void {
    this._workingDirectory = path;
  }

  /** 停止并清理容器(AutoRemove 负责销毁)。 */
  async stop(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop({ t: 0 }); // 立即停止
      } catch {
        // 容器可能已停止或被移除,忽略。
      }
      this.container = null;
    }
  }
}
