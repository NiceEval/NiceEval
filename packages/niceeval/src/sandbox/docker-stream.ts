// Docker exec 流的 demux 与 tar 打包/解包 helper——从 docker.ts 拆出的纯工具层,
// 不含任何容器编排逻辑,便于独立测试与复用。

import * as tar from "tar-stream";

/**
 * Docker exec 复用流(8 字节头 + 载荷)的增量解析器。
 * 头:[stream_type(1B), 0, 0, 0, size(4B 大端)];stream_type:1=stdout,2=stderr。
 *
 * 关键:一帧可能被 Node 的可读流切到【多个 data 事件】里(尤其大输出,如 cat 一个
 * ~100KB 的文件),帧头 / 载荷都可能跨 chunk。所以必须跨 data 累积一个 leftover,
 * 只消费「已到齐的完整帧」,残帧留到下个 data —— 否则会在 chunk 边界丢字节 / 串帧,
 * 表现为 transcript 里随机损坏的行(曾导致 bub tape 的 tool_result/tool_call 被吞)。
 */
export function createExecDemuxer(): {
  push(chunk: Buffer): void;
  stdout(): string;
  stderr(): string;
} {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let buffer: Buffer = Buffer.alloc(0); // 跨 data 累积的残帧;注解为 Buffer 以容纳 concat 的 ArrayBufferLike

  return {
    push(chunk: Buffer): void {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      while (buffer.length >= 8) {
        const streamType = buffer[0];
        const size = buffer.readUInt32BE(4);
        if (buffer.length < 8 + size) break; // 载荷未到齐 → 等下个 chunk
        const payload = buffer.subarray(8, 8 + size);
        if (streamType === 2) stderrChunks.push(payload);
        else stdoutChunks.push(payload); // 1 / 0 / 未知 → 归 stdout
        buffer = buffer.subarray(8 + size);
      }
    },
    stdout(): string {
      return Buffer.concat(stdoutChunks).toString("utf-8");
    },
    stderr(): string {
      return Buffer.concat(stderrChunks).toString("utf-8");
    },
  };
}

/** Readable stream → Buffer。 */
export async function readableToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** 从单文件 tar 包里提取第一个 entry 的内容。 */
export async function extractFileFromTar(tarBuf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    let found = false;
    extract.on("entry", (header, stream, next) => {
      if (!found) {
        found = true;
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => { resolve(Buffer.concat(chunks)); next(); });
        stream.on("error", reject);
      } else {
        stream.resume();
        next();
      }
    });
    extract.on("finish", () => { if (!found) reject(new Error("tar: no entries found")); });
    extract.on("error", reject);
    extract.end(tarBuf);
  });
}

/**
 * 从(可能含多条 entry 的)tar 包里提取全部普通文件——downloadDirectory 用:`getArchive`
 * 对目录路径返回该目录的整棵 tar,entry 名以请求路径的 basename 为首段。跳过目录 / 符号链接
 * 等非常规文件条目,只收集 `type === "file"` 的 entry。
 */
export async function extractFilesFromTar(tarBuf: Buffer): Promise<{ name: string; content: Buffer }[]> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const files: { name: string; content: Buffer }[] = [];
    extract.on("entry", (header, stream, next) => {
      if (header.type !== "file") {
        stream.resume();
        next();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        files.push({ name: header.name, content: Buffer.concat(chunks) });
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", () => resolve(files));
    extract.on("error", reject);
    extract.end(tarBuf);
  });
}

/** 把若干文件打成 tar 流(putArchive 用)。 */
export function packFilesToTar(entries: readonly { name: string; content: Buffer }[]): tar.Pack {
  const pack = tar.pack();
  for (const entry of entries) {
    pack.entry({ name: entry.name }, entry.content);
  }
  pack.finalize();
  return pack;
}
