import { createHash } from "node:crypto";
import { Client } from "ssh2";
import type { SSHToken } from "./api.ts";

export class InstaboxReconnectExhausted extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }); }
}

/** One lazily authenticated connection owned by the Machine, never a process. */
export class InstaboxConnection {
  private current?: { readonly client: Client; readonly ready: Promise<Client> };
  private stopped = false;
  private recovery?: Promise<Client>;
  private attempts = 0;
  constructor(private readonly token: SSHToken) {}

  get reconnectAttempts(): number { return this.attempts; }

  /** All channels join the same bounded connection recovery, including backoff. */
  reconnect(failed: Client, deadline: number, budget: number): Promise<Client> {
    if (this.recovery) return this.recovery;
    if (this.current && this.current.client !== failed) return this.current.ready;
    this.invalidate(failed);
    const recovering = Promise.resolve().then(async () => {
      let last: unknown = new Error("Instabox SSH reconnect budget exhausted");
      for (let attempt = 0; attempt < budget && performance.now() < deadline; attempt++) {
        if (this.stopped) throw new Error("Instabox SSH connection is closed");
        const delay = Math.min(250 * 2 ** attempt, Math.max(0, deadline - performance.now()));
        await new Promise(resolve => setTimeout(resolve, delay));
        if (this.stopped || performance.now() >= deadline) break;
        this.attempts++;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([this.open(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Instabox SSH reconnect timed out")), Math.max(1, deadline - performance.now()));
          })]);
        } catch (cause) {
          last = cause;
          if (this.current) this.invalidate(this.current.client);
        } finally { clearTimeout(timer); }
      }
      throw new InstaboxReconnectExhausted(last);
    });
    this.recovery = recovering;
    void recovering.finally(() => { if (this.recovery === recovering) this.recovery = undefined; }).catch(() => undefined);
    return recovering;
  }

  get(): Promise<Client> {
    return this.recovery ?? this.open();
  }

  private open(): Promise<Client> {
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
