import { createHash } from "node:crypto";
import { Client } from "ssh2";
import type { SSHToken } from "./api.ts";

/** One lazily authenticated connection owned by the Machine, never a process. */
export class InstaboxConnection {
  private current?: { readonly client: Client; readonly ready: Promise<Client> };
  private stopped = false;
  constructor(private readonly token: SSHToken) {}

  get(): Promise<Client> {
    if (this.stopped) return Promise.reject(new Error("Instabox SSH connection is closed"));
    if (this.current) return this.current.ready;
    const client = new Client();
    const ready = new Promise<Client>((resolve, reject) => {
      client.once("ready", () => resolve(client));
      client.on("error", (error: Error) => { this.invalidate(client); reject(error); });
      client.once("close", () => { this.invalidate(client); reject(new Error("SSH connection closed by peer")); });
    });
    this.current = { client, ready };
    void ready.catch(() => undefined);
    try {
      client.connect({
        host: this.token.host, port: this.token.port, username: this.token.token,
        authHandler: ["none"], readyTimeout: 30_000, keepaliveInterval: 10_000, keepaliveCountMax: 3,
        hostVerifier: (key: Buffer) => `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}` === this.token.hostKeyFingerprint.replace(/=+$/, ""),
      });
    } catch (error) { this.invalidate(client); return Promise.reject(error); }
    return ready;
  }

  invalidate(client: Client): void {
    if (this.current?.client === client) this.current = undefined;
    client.destroy();
  }

  close(): void {
    this.stopped = true;
    const current = this.current;
    this.current = undefined;
    current?.client.destroy();
  }
}
