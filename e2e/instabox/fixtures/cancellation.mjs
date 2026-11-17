import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";
const { Client } = createRequire(import.meta.resolve("niceeval"))("ssh2");
let disconnected = false;
const exec = Client.prototype.exec;
Client.prototype.exec = function(command, options, callback) {
  return exec.call(this, command, options, (error, channel) => {
    if (channel) channel.on("data", bytes => {
      if (!disconnected && bytes.includes(Buffer.from("cancel-ready:"))) {
        disconnected = true;
        appendFileSync(process.env.NICEEVAL_TRANSPORT_FAULT_RECEIPT, "client-destroyed\n");
        // Lose the real connection immediately before the caller cancels the
        // command. Both sibling readers and cancellation must join recovery.
        this.destroy();
      }
    });
    callback(error, channel);
  });
};
