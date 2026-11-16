// Fixed-origin HTTP boundary. Never forwards an Instabox request to the network.
import { Sandbox as Machine } from './sdk.mjs';
const machines = new Map(), snapshots = new Map();
const json = value => Response.json(value);
const operation = id => ({ id: `op-${id}`, machineId: id, state: 'succeeded', error: null });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input);
  if (url.origin !== 'https://api.instabox.sh') return originalFetch(input, init);
  const parts = url.pathname.split('/').slice(2);
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  if (parts[0] === 'machines' && parts.length === 1 && method === 'POST') {
    const machine = await Machine.create(body.snapshotId ?? 'fixture');
    machines.set(machine.sandboxId, machine);
    return json(operation(machine.sandboxId));
  }
  if (parts[0] === 'snapshots') {
    if (parts.length === 1) return json({ snapshots: [...snapshots.values()] });
    const snapshot = snapshots.get(parts[1]);
    if (!snapshot) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    if (method === 'DELETE') { await Machine.deleteSnapshot(parts[1]); snapshots.delete(parts[1]); return json({}); }
    return json(snapshot);
  }
  const machine = machines.get(parts[1]);
  if (!machine) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  if (parts[2] === 'snapshots') {
    const { snapshotId } = await Machine.createSnapshot(machine.sandboxId, body);
    const snapshot = { id: snapshotId, name: body.name, status: 'ready' };
    snapshots.set(snapshotId, snapshot);
    return json(snapshot);
  }
  if (parts[2] === 'ssh-tokens') return json({ id: 'fixture-token', machineId: machine.sandboxId, token: machine.sandboxId,
    host: 'fixture.invalid', port: 22, hostKeyFingerprint: 'SHA256:Zml4dHVyZQ==' });
  if (parts[2] === 'files') {
    const path = url.searchParams.get('path');
    if (method === 'PUT') { await machine.files.write(path, init.body); return json({}); }
    if (!await machine.files.exists(path)) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    return parts[3] === 'content' ? new Response(await machine.files.read(path, { format: 'bytes' })) : json({});
  }
  if (parts.length === 2 && method === 'DELETE') { await machine.kill(); machines.delete(parts[1]); return json(operation(parts[1])); }
  if (parts.length === 2) return json({ id: machine.sandboxId, state: 'running', operationId: null, runtime: { ready: true } });
  throw new Error(`Unsupported fake Instabox request: ${method} ${url.pathname}`);
};
