// These programs run inside the authenticated Machine. The detached supervisor
// owns the target; an SSH channel owns only a replaceable spool reader.
export const spoolSupervisor = String.raw`
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const c = JSON.parse(Buffer.from(process.argv[1], 'base64'));
process.on('SIGHUP', () => {});
const env = { ...process.env, ...c.env };
if (c.pathPrepend.length) env.PATH = c.pathPrepend.join(':') + ':' + env.PATH;
const out = fs.openSync(c.spool + '/stdout', 'a', 0600);
const err = fs.openSync(c.spool + '/stderr', 'a', 0600);
fs.writeFileSync(c.spool + '/pid', String(process.pid));
const sockets = new Set();
let child, finished = false, stdinClosed = false;
const finish = (exitCode, signal) => {
  if (finished) return;
  finished = true;
  const result = { exitCode, ...(signal ? { signal } : {}), stdoutSize: fs.fstatSync(out).size, stderrSize: fs.fstatSync(err).size };
  fs.writeFileSync(c.spool + '/exit.tmp', JSON.stringify(result), { mode: 0600 });
  fs.renameSync(c.spool + '/exit.tmp', c.spool + '/exit');
  for (const socket of sockets) socket.destroy();
  server.close();
  child?.stdin.destroy(); child?.unref();
  fs.closeSync(out); fs.closeSync(err);
  process.exit(0);
};
const server = net.createServer(socket => {
  sockets.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => sockets.delete(socket));
  let buffered = '';
  socket.on('data', bytes => {
    buffered += bytes.toString('utf8');
    let index;
    while ((index = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
      let message;
      try { message = JSON.parse(line); } catch { socket.destroy(); return; }
      const ack = error => { if (!socket.destroyed) socket.write(JSON.stringify({ id: message.id, ...(error ? { error: error.message } : {}) }) + '\n'); };
      if (!child || finished || stdinClosed) { ack(Error('Process stdin is closed')); continue; }
      if (message.kind === 'eof') { stdinClosed = true; child.stdin.end(() => ack()); }
      else if (message.kind === 'write') child.stdin.write(Buffer.from(message.bytes, 'base64'), ack);
      else ack(Error('Invalid stdin operation'));
    }
  });
});
server.listen(c.spool + '/stdin.sock', () => {
  try {
    child = spawn(c.argv[0], c.argv.slice(1), { cwd: c.cwd, env, detached: true, stdio: ['pipe', out, err] });
    child.stdin.on('error', () => {});
    child.once('error', error => { fs.writeSync(err, error.message + '\n'); finish(error.code === 'ENOENT' ? 127 : 126); });
    child.once('exit', (code, signal) => finish(code, signal));
  } catch (error) { fs.writeSync(err, error.message + '\n'); finish(126); }
});
`;

export const spoolReader = String.raw`
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const c = JSON.parse(Buffer.from(process.argv[1], 'base64'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
process.stdout.on('error', () => process.exit(1));
const frame = async (tag, data) => {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
  const header = Buffer.alloc(5); header[0] = tag; header.writeUInt32BE(bytes.length, 1);
  if (!process.stdout.write(Buffer.concat([header, bytes]))) await once(process.stdout, 'drain');
};
const exists = path => { try { return fs.statSync(path); } catch (e) { if (e.code === 'ENOENT') return; throw e; } };
const alive = () => { try { process.kill(Number(fs.readFileSync(c.spool + '/pid', 'utf8')), 0); return true; } catch { return false; } };
(async () => {
  if (c.initial) {
    fs.mkdirSync(c.spool, { mode: 0700 });
    const config = Buffer.from(JSON.stringify(c)).toString('base64');
    const supervisor = spawn(process.execPath, ['-e', c.supervisor, config], { detached: true, stdio: 'ignore' });
    supervisor.unref();
    supervisor.on('error', () => {});
    const until = Date.now() + 10000;
    while (!exists(c.spool + '/exit') && (!exists(c.spool + '/stdin.sock') || !exists(c.spool + '/stdout'))) {
      if (Date.now() >= until) throw Error('Supervisor startup did not produce its spool');
      await delay(10);
    }
  }
  if (!exists(c.spool + '/stdout') || (!exists(c.spool + '/exit') && !alive())) {
    await frame(6, { reason: 'spool or supervisor is missing' }); process.exit(1); return;
  }
  if (c.initial && !exists(c.spool + '/exit')) {
    const until = Date.now() + 10000;
    while (!exists(c.spool + '/exit')) {
      socket = net.connect(c.spool + '/stdin.sock');
      socket.on('error', () => {});
      try { await once(socket, 'connect'); break; }
      catch (error) {
        socket.destroy(); socket = undefined;
        // A fast target can publish its exit and unlink the socket between
        // the check above and connect(). Its exit file is authoritative.
        if (exists(c.spool + '/exit')) break;
        if (!alive() || Date.now() >= until) throw error;
        await delay(10);
      }
    }
  }
  if (socket) {
    let buffered = '';
    socket.on('data', bytes => {
      buffered += bytes.toString('utf8');
      let index;
      while ((index = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
        void frame(4, JSON.parse(line));
      }
    });
    process.stdin.pipe(socket);
  }
  await frame(3, {});
  let stdout = c.stdoutOffset, stderr = c.stderrOffset;
  const out = fs.openSync(c.spool + '/stdout', 'r'), err = fs.openSync(c.spool + '/stderr', 'r');
  const read = async (fd, offset, limit, tag) => {
    while (offset < limit) {
      const bytes = Buffer.alloc(Math.min(65536, limit - offset));
      const count = fs.readSync(fd, bytes, 0, bytes.length, offset);
      if (!count) break;
      await frame(tag, bytes.subarray(0, count)); offset += count;
    }
    return offset;
  };
  while (true) {
    const exit = exists(c.spool + '/exit') ? JSON.parse(fs.readFileSync(c.spool + '/exit', 'utf8')) : undefined;
    // An independent service can append between the foreground exit and its
    // atomic exit-file publication. Never retract bytes already delivered.
    if (exit) { exit.stdoutSize = Math.max(exit.stdoutSize, stdout); exit.stderrSize = Math.max(exit.stderrSize, stderr); }
    stdout = await read(out, stdout, exit ? exit.stdoutSize : fs.fstatSync(out).size, 1);
    stderr = await read(err, stderr, exit ? exit.stderrSize : fs.fstatSync(err).size, 2);
    if (exit) { await frame(5, exit); socket?.destroy(); process.exit(0); return; }
    if (!alive()) { await frame(6, { reason: 'supervisor disappeared before publishing exit' }); process.exit(1); return; }
    await delay(10);
  }
})().catch(async error => { try { await frame(6, { reason: error.message }); } finally { process.exit(1); } });
`;
