// External E2B SDK boundary only. Real shell commands and filesystem snapshots
// run in disposable Docker containers; NiceEval owns planning, ledger and holds.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const label = `niceeval.snapshot-fixture=${process.env.NICEEVAL_SNAPSHOT_FIXTURE_ID}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const snapshots = new Map();
const existingImages = docker('images', '-q', '--filter', `label=${label}`, '--filter', 'label=niceeval.snapshot-id').split(/\s+/u).filter(Boolean);
for (const image of new Set(existingImages)) {
  const [inspection] = JSON.parse(docker('image', 'inspect', image));
  const labels = inspection.Config.Labels;
  snapshots.set(labels['niceeval.snapshot-id'], { image, name: labels['niceeval.snapshot-name'] });
}
export class CommandExitError extends Error {}
export class NotFoundError extends Error {}
export class RateLimitError extends Error {}
export class ConnectionConfig { apiUrl = 'https://snapshot-fixture.invalid'; }
export class Template {
  static async getTags() { return [{ tag: 'default', buildId: 'immutable-fixture-build' }]; }
}
export class Sandbox {
  constructor(id) { this.sandboxId = id; }
  static async create(template) {
    if (template !== 'fixture' && !snapshots.has(template)) throw new NotFoundError('Unknown fixture snapshot');
    const image = snapshots.get(template)?.image ?? process.env.NICEEVAL_SNAPSHOT_FIXTURE_IMAGE;
    return new Sandbox(docker('run', '-d', '--label', label, '--user', 'root', '--entrypoint', 'sleep', image, 'infinity'));
  }
  static async createSnapshot(id, { name }) {
    const snapshotId = `snapshot-${randomUUID()}`;
    const image = docker('commit', '--change', `LABEL ${label}`, '--change', `LABEL niceeval.snapshot-id=${snapshotId}`, '--change', `LABEL niceeval.snapshot-name=${name}`, id);
    snapshots.set(snapshotId, { image, name });
    return { snapshotId };
  }
  static async deleteSnapshot(id) {
    const snapshot = snapshots.get(id);
    if (!snapshot) return false;
    docker('image', 'rm', snapshot.image);
    return snapshots.delete(id);
  }
  static listSnapshots({ name }) {
    return { hasNext: true, async nextItems() {
      this.hasNext = false;
      return [...snapshots].filter(([, s]) => s.name === name).map(([snapshotId, s]) => ({ snapshotId, names: [s.name] }));
    } };
  }
  async kill() { docker('rm', '-f', this.sandboxId); }
  async getInfo() { return { endAt: new Date(Date.now() + 600_000) }; }
  async setTimeout() {}
  commands = {
    run: async (script, options = {}) => {
      const args = ['exec', ...Object.entries(options.envs ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]), ...(options.cwd ? ['-w', options.cwd] : []), this.sandboxId, 'bash', '-c', script];
      const child = spawn('docker', args);
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; void options.onStdout?.(chunk.toString()); });
      child.stderr.on('data', chunk => { stderr += chunk; void options.onStderr?.(chunk.toString()); });
      const done = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
      });
      return options.background ? { wait: () => done, disconnect: async () => {}, kill: async () => child.kill() } : done;
    },
  };
  files = {
    read: async (path, { format } = {}) => {
      const bytes = execFileSync('docker', ['exec', this.sandboxId, 'cat', path]);
      return format === 'bytes' ? bytes : bytes.toString();
    },
    exists: async path => {
      try { docker('exec', this.sandboxId, 'test', '-e', path); return true; } catch { return false; }
    },
    write: async (path, data) => {
      if (Array.isArray(path)) { for (const entry of path) await this.files.write(entry.path, entry.data); return; }
      execFileSync('docker', ['exec', '-i', this.sandboxId, 'sh', '-c', 'mkdir -p "$(dirname "$1")"; cat > "$1"', 'sh', path], {
        input: typeof data === 'string' ? data : Buffer.from(data),
      });
    },
  };
}
