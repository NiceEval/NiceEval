import ssh2 from "ssh2";
import { appendFileSync } from "node:fs";
let disconnected = false;
let connectCount = 0;
let writeReceiptLost = false, eofReceiptLost = false;
const connect = ssh2.Client.prototype.connect;
ssh2.Client.prototype.connect = function(config) {
  const started = performance.now();
  let channels = 0, maximumChannels = 0;
  this.on("fixture-channel-open", () => { maximumChannels = Math.max(maximumChannels, ++channels); });
  this.on("fixture-channel-close", () => { channels--; });
  this.once("close", () => appendFileSync(process.env.NICEEVAL_TRANSPORT_CONNECTIONS,
    `connection-metrics ${JSON.stringify({ elapsedMs: Math.round(performance.now() - started), maximumChannels, bytesRead: this._sock?.bytesRead, bytesWritten: this._sock?.bytesWritten })}\n`));
  appendFileSync(process.env.NICEEVAL_TRANSPORT_CONNECTIONS, `connect ${++connectCount}\n`);
  if (disconnected && connectCount <= 3) {
    appendFileSync(process.env.NICEEVAL_TRANSPORT_CONNECTIONS, `reconnect-reset ${connectCount}\n`);
    queueMicrotask(() => this.emit("error", new Error("read ECONNRESET (fixture reconnect)")));
    return this;
  }
  return connect.call(this, config);
};
const exec = ssh2.Client.prototype.exec;
ssh2.Client.prototype.exec = function(command, options, callback) {
  let argv;
  const config = command.match(/'([A-Za-z0-9+/=]+)'$/)?.[1];
  if (config) {
    ({ argv } = JSON.parse(Buffer.from(config, "base64")));
    if (argv?.[1] === "command-timing") appendFileSync(process.env.NICEEVAL_TRANSPORT_CONNECTIONS, `timing ${argv[2]} ${argv[3]}\n`);
  }
  return exec.call(this, command, options, (error, channel) => {
    if (channel) {
      this.emit("fixture-channel-open");
      channel.once("close", () => this.emit("fixture-channel-close"));
      // Drop a real supervisor receipt before the consumer sees it. Only the
      // transport boundary is intercepted; guest delivery remains real.
      const rawEcho = argv?.[2] === "process.stdin.pipe(process.stdout)";
      const rpc = argv?.[2]?.includes("request.method");
      if (rawEcho || rpc) {
        let buffered = Buffer.alloc(0);
        const emit = channel.emit;
        channel.emit = (event, ...args) => {
          if (event !== "data") return emit.call(channel, event, ...args);
          buffered = Buffer.concat([buffered, args[0]]);
          while (buffered.length >= 5 && buffered.length >= 5 + buffered.readUInt32BE(1)) {
            const size = buffered.readUInt32BE(1), tag = buffered[0];
            const frame = buffered.subarray(0, 5 + size);
            buffered = buffered.subarray(5 + size);
            if (tag === 4) {
              const receipt = JSON.parse(frame.subarray(5));
              const write = rawEcho && !writeReceiptLost && receipt.offset > 5 && !receipt.eof;
              const eof = rpc && !eofReceiptLost && receipt.eof;
              if (write || eof) {
                if (write) writeReceiptLost = true; else eofReceiptLost = true;
                appendFileSync(process.env.NICEEVAL_TRANSPORT_CONNECTIONS, `${write ? "write" : "eof"}-ack-destroyed\n`);
                this.destroy();
                return true;
              }
            }
            emit.call(channel, "data", frame);
          }
          return true;
        };
      }
    }
    if (channel) channel.on("data", bytes => {
      if (!disconnected && bytes.includes(Buffer.from("transport-resume-ready"))) {
        disconnected = true;
        appendFileSync(process.env.NICEEVAL_TRANSPORT_CONNECTIONS, "client-destroyed\n");
        // Destroy only the client's connection. Do not signal or kill the guest.
        this.destroy();
      }
    });
    callback(error, channel);
  });
};
