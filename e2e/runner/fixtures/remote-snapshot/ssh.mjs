// Authenticated SSH is an external boundary. Execute the exact supplied spool
// reader inside the fake Machine, retaining NiceEval's real spool protocol.
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { spawn } from 'node:child_process';
export class Client extends EventEmitter {
  connect({ username }) { this.machineId = username; queueMicrotask(() => this.emit('ready')); }
  destroy() {}
  exec(command, _options, callback) {
    const child = spawn('docker', ['exec', '-i', '-u', 'node', this.machineId, 'bash', '-c', command]);
    const channel = new Duplex({
      read() {},
      write(chunk, _encoding, done) { child.stdin.write(chunk, done); },
      destroy(error, done) { child.stdin.destroy(); child.kill(); done(error); },
    });
    channel.stderr = child.stderr;
    child.stdout.on('data', bytes => channel.push(bytes));
    child.stdout.once('end', () => channel.push(null));
    child.once('error', error => channel.destroy(error));
    child.once('close', () => channel.destroy());
    child.stdin.on('error', () => {});
    callback(null, channel);
  }
}
