import ssh2 from "ssh2";
import { appendFileSync } from "node:fs";
let disconnected = false;
let connectCount = 0;
const connect = ssh2.Client.prototype.connect;
ssh2.Client.prototype.connect = function(config) {
  appendFileSync(process.env.NICEEVAL_TRANSPORT_CONNECTIONS, `connect ${++connectCount}\n`);
  return connect.call(this, config);
};
const exec = ssh2.Client.prototype.exec;
ssh2.Client.prototype.exec = function(command, options, callback) {
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
