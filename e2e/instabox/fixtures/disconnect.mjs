import ssh2 from "ssh2";
import { appendFileSync } from "node:fs";
let disconnected = false;
const connect = ssh2.Client.prototype.connect;
ssh2.Client.prototype.connect = function(config) {
  if (disconnected) {
    queueMicrotask(() => this.emit("error", new Error("fixture-client-disconnect")));
    return this;
  }
  return connect.call(this, config);
};
const exec = ssh2.Client.prototype.exec;
ssh2.Client.prototype.exec = function(command, options, callback) {
  return exec.call(this, command, options, (error, channel) => {
    if (channel) channel.on("data", bytes => {
      if (!disconnected && bytes.includes(Buffer.from("transport-fault-ready"))) {
        disconnected = true;
        appendFileSync(process.env.NICEEVAL_TRANSPORT_FAULT_RECEIPT, "client-destroyed\n");
        this.emit("error", new Error("fixture-client-disconnect"));
        this.destroy();
      }
    });
    callback(error, channel);
  });
};
