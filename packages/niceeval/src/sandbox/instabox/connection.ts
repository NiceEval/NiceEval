import { createHash } from "node:crypto";
import { Client } from "ssh2";
import type { SSHToken } from "./api.ts";

export class InstaboxReconnectExhausted extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

/** One lazily authenticated connection owned by the Machine, never a process. */
export class InstaboxConnection {
  private current: { readonly client: Client; readonly ready: Promise<Client> } | undefined;
  private stopped = false;
  private recovery: Promise<Client> | undefined;
  private attempts = 0;
  private requests = 1;
  private readonly closed = new AbortController();
  private readonly secrets = new Set<string>();
  private token: SSHToken;
  private readonly requestToken: (signal: AbortSignal) => Promise<SSHToken>;
  constructor(token: SSHToken, requestToken: (signal: AbortSignal) => Promise<SSHToken>) {
    this.token = token;
    this.requestToken = requestToken;
    this.secrets.add(token.token);
  }

  get tokenRequests(): number {
    return this.requests;
  }

  redact(message: string): string {
    for (const token of this.secrets) message = message.replaceAll(token, "[REDACTED]");
    return message;
  }

  get reconnectAttempts(): number {
    return this.attempts;
  }

  /** All channels join the same bounded connection recovery, including backoff. */
  reconnect(failed: Client, deadline: number, budget: number): Promise<Client> {
    if (this.recovery) return this.recovery;
    if (this.current && this.current.client !== failed) return this.current.ready;
    this.invalidate(failed);
    const recovering = Promise.resolve().then(async () => {
      let last: unknown = new Error("Instabox SSH reconnect budget exhausted");
      let renewed = false;
      for (let attempt = 0; attempt < budget && performance.now() < deadline; attempt++) {
        if (this.stopped) throw new Error("Instabox SSH connection is closed");
        const delay = Math.min(250 * 2 ** attempt, Math.max(0, deadline - performance.now()));
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.stopped || performance.now() >= deadline) break;
        this.attempts++;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            this.open(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error("Instabox SSH reconnect timed out")),
                Math.max(1, deadline - performance.now()),
              );
            }),
          ]);
        } catch (cause) {
          last = cause;
          if (this.current) this.invalidate(this.current.client);
          if (cause instanceof Error && "level" in cause && cause.level === "client-authentication") {
            last = new Error("Instabox SSH token rejected", { cause });
            if (renewed || this.stopped || performance.now() >= deadline) break;
            renewed = true;
            this.requests++;
            try {
              const token = await this.requestToken(
                AbortSignal.any([
                  this.closed.signal,
                  AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))),
                ]),
              );
              this.secrets.add(token.token);
              if (token.machineId !== this.token.machineId)
                throw new Error("Instabox SSH grant belongs to another Machine");
              if (this.stopped) throw new Error("Instabox SSH connection is closed");
              this.token = token;
            } catch (error) {
              last = new Error(
                `Instabox SSH token rejected; SSH token renewal failed: ${this.redact(error instanceof Error ? error.message : String(error))}`,
              );
              break;
            }
          }
        } finally {
          clearTimeout(timer);
        }
      }
      throw new InstaboxReconnectExhausted(
        new Error(
          `${this.redact(last instanceof Error ? last.message : String(last))}; tokenRequests=${this.requests}`,
        ),
      );
    });
    this.recovery = recovering;
    void recovering
      .finally(() => {
        if (this.recovery === recovering) this.recovery = undefined;
      })
      .catch(() => undefined);
    return recovering;
  }

  get(): Promise<Client> {
    return this.recovery ?? this.open();
  }

  private open(): Promise<Client> {
    if (this.stopped) return Promise.reject(new Error("Instabox SSH connection is closed"));
    if (this.current) return this.current.ready;
    const client = new Client();
    const token = this.token;
    const ready = new Promise<Client>((resolve, reject) => {
      client.once("ready", () => resolve(client));
      client.on("error", (error: Error) => {
        this.invalidate(client);
        reject(error);
      });
      client.once("close", () => {
        this.invalidate(client);
        reject(new Error("SSH connection closed by peer"));
      });
    });
    this.current = { client, ready };
    void ready.catch(() => undefined);
    try {
      client.connect({
        host: token.host,
        port: token.port,
        username: token.token,
        authHandler: ["none"],
        readyTimeout: 30_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer) =>
          `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}` ===
          token.hostKeyFingerprint.replace(/=+$/, ""),
      });
    } catch (error) {
      this.invalidate(client);
      return Promise.reject(error);
    }
    return ready;
  }

  invalidate(client: Client): void {
    if (this.current?.client === client) this.current = undefined;
    client.destroy();
  }

  close(): void {
    this.stopped = true;
    this.closed.abort();
    const current = this.current;
    this.current = undefined;
    current?.client.destroy();
  }
}
