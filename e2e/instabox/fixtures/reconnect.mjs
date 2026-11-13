import ssh2 from "ssh2";
import { appendFileSync } from "node:fs";
let disconnected = false;
let connectCount = 0;
const connect = ssh2.Client.prototype.connect;
ssh2.Client.prototype.connect = function(config) {
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
  const config = command.match(/'([A-Za-z0-9+/=]+)'$/)?.[1];
  if (config) {
    const { argv } = JSON.parse(Buffer.from(config, "base64"));
    if (argv?.[1] === "command-timing") appendFileSync(process.env.NICEEVAL_TRANSPORT_CONNECTIONS, `timing ${argv[2]} ${argv[3]}\n`);
  }
  return exec.call(this, command, options, (error, channel) => {
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
