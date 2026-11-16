// Simulates only the external OpenSandbox SDK; commands execute in real containers.
import { Sandbox as Machine } from './sdk.mjs';
export class SandboxApiException extends Error { statusCode = 404; }
export class Sandbox {
  constructor(machine) { this.machine = machine; this.id = machine.sandboxId; }
  static async create({ snapshotId }) { return new Sandbox(await Machine.create(snapshotId ?? 'fixture')); }
  async waitUntilReady() {}
  async kill() { await this.machine.kill(); }
  async close() {}
  commands = { run: async (argv, options = {}, handlers) => {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const result = await this.machine.commands.run(argv.map(quote).join(' '), {
      cwd: options.workingDirectory, envs: options.envs,
      onStdout: text => handlers?.onStdout?.({ text }), onStderr: text => handlers?.onStderr?.({ text }),
    });
    return { exitCode: result.exitCode, logs: { stdout: [{ text: result.stdout }], stderr: [{ text: result.stderr }] } };
  } };
  files = {
    readFile: path => this.machine.files.read(path),
    readBytes: path => this.machine.files.read(path, { format: 'bytes' }),
    createDirectories: async entries => {
      for (const { path } of entries) await this.commands.run(['mkdir', '-p', path]);
    },
    writeFiles: async entries => { for (const { path, data } of entries) await this.machine.files.write(path, data); },
  };
}
export class SandboxManager {
  static create() { return new SandboxManager(); }
  async close() {}
  async createSnapshot(id, { name }) {
    const snapshot = await Machine.createSnapshot(id, { name });
    return { id: snapshot.snapshotId, name, status: { state: 'Ready' } };
  }
  async deleteSnapshot(id) { await Machine.deleteSnapshot(id); }
  async listSnapshots({ name }) {
    const rows = await Machine.listSnapshots({ name }).nextItems();
    return { items: rows.map(row => ({ id: row.snapshotId, name, status: { state: 'Ready' } })) };
  }
}
