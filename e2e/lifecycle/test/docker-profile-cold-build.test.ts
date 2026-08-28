// owner: docs/engineering/testing/e2e/README.md#docker-profile-cold-build
// regression: memory/docker-profile-control-create-migration-incomplete.md
// regression: memory/docker-profile-assets-manifest-registry-collision.md
// regression: memory/docker-profile-doctor-inherits-dind-docker-host.md
import { appendFile, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  command,
  only,
  pollUntil,
  withProcess,
  withProjectCopy,
  withTempDir,
} from "@niceeval/testkit";
import { expect, test } from "vitest";

interface HostFixture {
  readonly assets: string;
  readonly controlSocket: string;
  readonly descriptor: string;
  readonly hostConfig: string;
  readonly journal: string;
  readonly readyFile: string;
}

interface HostJournalRecord {
  readonly event: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly state?: {
    readonly reservations?: Readonly<Record<string, {
      readonly kind?: string;
      readonly locator?: string;
      readonly builderName?: string;
      readonly retention?: "cache" | "ephemeral";
    }>>;
  };
}

const docker = command(["docker"]);
const sudo = command(["sudo", "-n"]);
const driverImage = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const dindImage = "docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c";
const buildkitImage = "moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8";
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-docker-profile-project-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

async function fileExists(path: string): Promise<true | undefined> {
  try {
    await readFile(path);
    return true;
  } catch {
    return undefined;
  }
}

async function quotaPath(): Promise<string> {
  const candidates = (process.env.PATH ?? "").split(":");
  try {
    for (const name of await readdir("/nix/store")) {
      if (/^[^-]+-quota-[^/]+$/.test(name)) candidates.push(`/nix/store/${name}/bin`);
    }
  } catch {
    // Non-Nix hosts can provide quota-tools on PATH.
  }
  for (const candidate of candidates) {
    if ((await command(["test"]).run(["-x", join(candidate, "setquota")])).exitCode === 0) {
      return [candidate, process.env.PATH ?? ""].filter(Boolean).join(":");
    }
  }
  throw new Error("project-quota tools (setquota/repquota) are required by this E2E");
}

async function exportImageRootfs(image: string, destination: string): Promise<void> {
  const created = await docker.run(["create", image]);
  expect(created.exitCode, created.diagnostic()).toBe(0);
  const containerId = created.stdout.trim();
  try {
    const exported = await docker.run(["export", "--output", destination, containerId], {
      timeoutMs: 60_000,
    });
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
  } finally {
    const removed = await docker.run(["rm", "--force", containerId]);
    expect(removed.exitCode, removed.diagnostic()).toBe(0);
  }
}

test("profile-bound Dockerfile cold build starts the Attempt through the public CLI", async () => {
  const scripts = process.env.NICEEVAL_E2E_DOCKER_PROFILE_HOST_SCRIPTS;
  expect(scripts, "runner must inject the actual Docker profile host scripts").toBeTruthy();
  const fixtureScript = resolve("fixtures/profile-host-fixture.py");
  const dockerInfo = await docker.run(["info", "--format", "{{.DockerRootDir}}"]);
  expect(dockerInfo.exitCode, dockerInfo.diagnostic()).toBe(0);
  const hostPath = await quotaPath();
  const user = process.env.USER ?? process.env.LOGNAME;
  expect(user, "E2E runner user must be named for the quota-slot owner").toBeTruthy();
  const id = await command(["id"]).run(["-gn", user!]);
  expect(id.exitCode, id.diagnostic()).toBe(0);

  await withProjectCopy(projectCopy, async ({ root: projectRoot }) => {
    const fixtureContext = join(projectRoot, "fixtures/profile-cold-build");
    await exportImageRootfs(driverImage, join(fixtureContext, "node-rootfs.tar"));
    await exportImageRootfs(dindImage, join(fixtureContext, "docker-rootfs.tar"));
    const inspectedBuildkit = await docker.run(["image", "inspect", buildkitImage]);
    if (inspectedBuildkit.exitCode !== 0) {
      const pulledBuildkit = await docker.run(["pull", buildkitImage], { timeoutMs: 120_000 });
      expect(pulledBuildkit.exitCode, pulledBuildkit.diagnostic()).toBe(0);
    }
    // The unique context byte keeps this owner a real cold build even when the
    // daemon already carries an image from an earlier reliability repetition.
    await appendFile(
      join(projectRoot, "fixtures/profile-cold-build/Dockerfile"),
      `\n# cold-build-owner ${crypto.randomUUID()}\n`,
    );
    await withTempDir("niceeval-e2e-docker-profile-", async (hostRoot) => {
      let fixture: HostFixture | undefined;
      let primaryError: unknown;
      try {
        const setup = await sudo.run([
          "env", `PATH=${hostPath}`,
          "python3", fixtureScript, "setup",
          "--root", hostRoot,
          "--scripts", scripts!,
          "--docker-root", dockerInfo.stdout.trim(),
          "--user", user!,
          "--group", id.stdout.trim(),
        ], { timeoutMs: 60_000 });
        expect(setup.exitCode, setup.diagnostic()).toBe(0);
        fixture = JSON.parse(setup.stdout.trim().split("\n").at(-1)!) as HostFixture;
        const activeFixture = fixture;

        await withProcess(
          [
            "sudo", "-n", "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
            "python3", join(scripts!, "watchdog.py"),
            "--control-socket", activeFixture.controlSocket,
            "--descriptor", activeFixture.descriptor,
            "--host-config", activeFixture.hostConfig,
            "--docker-socket", "/run/docker.sock",
            "--journal", activeFixture.journal,
            "--ready-file", activeFixture.readyFile,
            "--socket-mode", "0o600",
          ],
          { processGroup: true, timeoutMs: 330_000, graceMs: 5_000 },
          async (watchdog) => {
            await Promise.race([
              pollUntil(() => fileExists(activeFixture.readyFile), {
                timeoutMs: 15_000,
                intervalMs: 100,
                label: "isolated real watchdog ready file",
              }),
              watchdog.done.then((receipt) => {
                throw new Error(`watchdog exited before readiness\n${receipt.diagnostic()}`);
              }),
            ]);

            const driver = await docker.run([
              "run", "--rm", "--network", "none", "--user", "0:0",
              "--mount", `type=bind,src=${process.cwd()},dst=${process.cwd()},readonly`,
              "--mount", `type=bind,src=${projectRoot},dst=${projectRoot}`,
              "--mount", `type=bind,src=${hostRoot},dst=${hostRoot}`,
              "--mount", "type=bind,src=/run/docker.sock,dst=/run/docker.sock",
              "--workdir", projectRoot,
              "--env", "NICEEVAL_E2E_DOCKER_PROFILE_ALIAS=e2e-cold-build",
              driverImage,
              "sh", "-ec",
              `holder_pid=''; doctor_pid=''; fault_socket=''; compat_proxy_pid=''; compat_socket=''
cleanup_holder() { if [ -n "\${holder_pid}" ] && kill -0 "\${holder_pid}" 2>/dev/null; then kill -TERM "\${holder_pid}" 2>/dev/null || true; wait "\${holder_pid}" || true; fi; }
cleanup_doctor() { if [ -n "\${doctor_pid}" ] && kill -0 "\${doctor_pid}" 2>/dev/null; then kill -KILL "\${doctor_pid}" 2>/dev/null || true; wait "\${doctor_pid}" || true; fi; }
restore_fault_socket() { if [ -n "\${fault_socket}" ] && [ -S "\${fault_socket}" ]; then mv "\${fault_socket}" '${activeFixture.controlSocket}'; fi; }
restore_compat_socket() { if [ -n "\${compat_proxy_pid}" ] && kill -0 "\${compat_proxy_pid}" 2>/dev/null; then kill -TERM "\${compat_proxy_pid}" 2>/dev/null || true; wait "\${compat_proxy_pid}" || true; fi; if [ -n "\${compat_socket}" ] && [ -S "\${compat_socket}" ]; then rm -f '${activeFixture.controlSocket}'; mv "\${compat_socket}" '${activeFixture.controlSocket}'; fi; }
trap 'restore_fault_socket; restore_compat_socket; cleanup_doctor; cleanup_holder; chown -R ${process.getuid!()}:${process.getgid!()} ${projectRoot}/.niceeval 2>/dev/null || true' EXIT
mkdir -p /etc/niceeval/docker-profiles
cp '${activeFixture.descriptor}' /etc/niceeval/docker-profiles/e2e-cold-build.json
cp '${activeFixture.assets}' /etc/niceeval/docker-profiles/assets-v1.json
chown root:root /etc/niceeval/docker-profiles/e2e-cold-build.json
chown root:root /etc/niceeval/docker-profiles/assets-v1.json
chmod 600 /etc/niceeval/docker-profiles/e2e-cold-build.json
chmod 644 /etc/niceeval/docker-profiles/assets-v1.json
docker_api() { node - "$@" <<'NODE'
const Docker=require('dockerode'),d=new Docker({socketPath:'/run/docker.sock'}),[action,...args]=process.argv.slice(2);const labels=Object.fromEntries((args[0]||'').split(',').filter(Boolean).map(x=>x.split('=')));const filters={label:Object.entries(labels).map(([k,v])=>v?k+'='+v:k)};(async()=>{if(action==='image'){await d.getImage(args[0]).inspect();return}if(action==='find'){const c=await d.listContainers({all:false,filters});if(c[0])process.stdout.write(JSON.stringify({id:c[0].Id,labels:c[0].Labels}))}if(action==='kill'){await d.getContainer(args[0]).kill()}if(action==='absent'){const c=await d.listContainers({all:true,filters}),n=await d.listNetworks({filters});if(c.length||n.length)throw Error('owned resource remains')}})().catch(e=>{console.error(e);process.exit(1)})
NODE
}
docker_api image '${dindImage}'
docker_api image '${buildkitImage}'
compat_socket='${activeFixture.controlSocket}.compat'
mv '${activeFixture.controlSocket}' "$compat_socket"
node - '${activeFixture.controlSocket}' "$compat_socket" <<'NODE' &
const net=require('net'),[front,back]=process.argv.slice(2);const server=net.createServer({allowHalfOpen:true},client=>{let request='',response='';client.on('data',b=>request+=b);client.on('end',()=>{const upstream=net.createConnection(back);upstream.on('connect',()=>upstream.end(request));upstream.on('data',b=>response+=b);upstream.on('error',e=>client.destroy(e));upstream.on('close',()=>{try{const value=JSON.parse(response),input=JSON.parse(request);if(input.kind==='status'&&value.ok)delete value.result.journal;client.end(JSON.stringify(value)+String.fromCharCode(10))}catch(e){client.destroy(e)}})})});server.listen(front);process.on('SIGTERM',()=>server.close(()=>process.exit(0)))
NODE
compat_proxy_pid=$!
for _ in $(seq 1 100); do [ -S '${activeFixture.controlSocket}' ] && break; kill -0 "$compat_proxy_pid" 2>/dev/null || exit 1; sleep 0.05; done
[ -S '${activeFixture.controlSocket}' ] || { echo 'compatibility control proxy did not become ready' >&2; exit 1; }
set +e
node_modules/.bin/niceeval docker profile doctor e2e-cold-build --json >/tmp/niceeval-doctor-compat.json
compat_status=$?
set -e
COMPAT_STATUS="$compat_status" node - /tmp/niceeval-doctor-compat.json <<'NODE'
const fs=require('fs'),d=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),ids=['descriptor','control','daemon','cgroup','storage','journal','assets','cold-build','cold-build-cleanup','container-limits','nested-docker','container-cleanup'];const invalid=process.env.COMPAT_STATUS==='0'||d.status!=='FAIL'||JSON.stringify(d.checks.map(x=>x.id))!==JSON.stringify(ids)||ids.slice(0,5).some((id,i)=>d.checks[i].status!=='PASS')||d.checks[5].status!=='FAIL'||d.checks[5].code!=='UNSAFE_TO_CONTINUE'||!d.checks[5].detail.includes('durable journal')||d.checks.slice(6).some(x=>x.status!=='FAIL'||x.code!=='PREREQUISITE_FAILED');if(invalid){console.error(JSON.stringify({compatStatus:process.env.COMPAT_STATUS,doctor:d},null,2));process.exit(1)}
NODE
kill -TERM "$compat_proxy_pid"
wait "$compat_proxy_pid"
compat_proxy_pid=''
rm -f '${activeFixture.controlSocket}'
mv "$compat_socket" '${activeFixture.controlSocket}'
compat_socket=''
rm -f /tmp/niceeval-preoccupier.json /tmp/niceeval-preoccupier.ready
node - '${activeFixture.controlSocket}' /tmp/niceeval-preoccupier.json /tmp/niceeval-preoccupier.ready <<'NODE' &
const net=require('net'), fs=require('fs'), crypto=require('crypto'); const [path,out,ready]=process.argv.slice(2);
const call=(request)=>new Promise((resolve,reject)=>{let text=''; const s=net.createConnection(path); s.on('connect',()=>s.end(JSON.stringify(request)+'\\n')); s.on('data',b=>text+=b); s.on('error',reject); s.on('close',()=>{try { const r=JSON.parse(text); if(!r.ok) throw Error(r.error?.message||'control error'); resolve(r.result) } catch(e) { reject(e) }});});
(async()=>{const status=await call({kind:'status'}); const invocationId=crypto.randomUUID(), reservationId=crypto.randomUUID(); const lease=await call({kind:'lease.create',profileId:status.profileId,daemonGeneration:status.generation,invocationId}); const held={invocationId,reservationId,leaseToken:lease.leaseToken}; const reservation=await call({kind:'reservation.acquire',...held,reservationKind:'build',resources:{cpus:0,memoryBytes:0,pids:0,containers:0,ephemeralDiskBytes:0}}); if(reservation.state!=='granted') throw Error('preoccupier was not granted'); fs.writeFileSync(out,JSON.stringify(held)); fs.writeFileSync(ready,'ready'); const beat=setInterval(()=>call({kind:'lease.heartbeat',invocationId,leaseToken:lease.leaseToken}).catch(()=>{}),4000); let done=false; const stop=async()=>{if(done)return;done=true;clearInterval(beat);await call({kind:'reservation.release',...held}).catch(()=>{});await call({kind:'lease.drain',invocationId,leaseToken:lease.leaseToken}).catch(()=>{});process.exit(0)};process.on('SIGTERM',stop);process.on('SIGINT',stop);})().catch(e=>{console.error(e);process.exit(1)});
NODE
holder_pid=$!
for _ in $(seq 1 100); do [ -f /tmp/niceeval-preoccupier.ready ] && break; sleep 0.1; done
[ -f /tmp/niceeval-preoccupier.ready ] || { echo 'preoccupier did not become ready' >&2; exit 1; }
set +e
node_modules/.bin/niceeval docker profile doctor e2e-cold-build --json >/tmp/niceeval-doctor.json
doctor_status=$?
set -e
cat /tmp/niceeval-doctor.json
DOCTOR_STATUS="$doctor_status" node - '${activeFixture.controlSocket}' /tmp/niceeval-preoccupier.json <<'NODE'
const net=require('net'), fs=require('fs'); const path=process.argv[2], held=JSON.parse(fs.readFileSync(process.argv[3]));
const call=(request)=>new Promise((resolve,reject)=>{let text=''; const s=net.createConnection(path); s.on('connect',()=>s.end(JSON.stringify(request)+'\\n')); s.on('data',b=>text+=b); s.on('error',reject); s.on('close',()=>{try {const r=JSON.parse(text);if(!r.ok)throw Error(r.error?.message||'control error');resolve(r.result)}catch(e){reject(e)}})});
(async()=>{const d=JSON.parse(fs.readFileSync('/tmp/niceeval-doctor.json','utf8')); const ids=['descriptor','control','daemon','cgroup','storage','journal','assets','cold-build','cold-build-cleanup','container-limits','nested-docker','container-cleanup']; if(process.env.DOCTOR_STATUS==='0'||d.status!=='BLOCKED'||JSON.stringify(d.checks?.map(c=>c.id))!==JSON.stringify(ids)||d.checks.some(c=>c.status==='FAIL')||d.checks.filter(c=>ids.slice(7).includes(c.id)).some(c=>c.status!=='BLOCKED'||c.code!=='CAPACITY_QUEUE_TIMEOUT')) throw Error('doctor did not report only capacity BLOCKED')})().catch(e=>{console.error(e);process.exit(1)});
NODE
kill -TERM "$holder_pid"
wait "$holder_pid"
holder_pid=''
node - '${activeFixture.controlSocket}' /tmp/niceeval-preoccupier.json <<'NODE'
const net=require('net'),fs=require('fs');const path=process.argv[2],held=JSON.parse(fs.readFileSync(process.argv[3]));const call=r=>new Promise((resolve,reject)=>{let t='';const s=net.createConnection(path);s.on('connect',()=>s.end(JSON.stringify(r)+'\\n'));s.on('data',b=>t+=b);s.on('error',reject);s.on('close',()=>{try{const v=JSON.parse(t);if(!v.ok)throw Error(v.error?.message);resolve(v.result)}catch(e){reject(e)}})});(async()=>{for(let i=0;i<50;i++){const s=await call({kind:'status'});if(!s.reservations.some(r=>r.reservationId===held.reservationId)&&!s.leases.some(l=>l.invocationId===held.invocationId)&&s.used.builds===0&&s.admissionOpen&&s.degraded.length===0)return;await new Promise(r=>setTimeout(r,100))}throw Error('preoccupier cleanup did not converge')})().catch(e=>{console.error(e);process.exit(1)});
NODE
rm -f /tmp/niceeval-doctor-kill.json /tmp/niceeval-doctor-owned.json
node_modules/.bin/niceeval docker profile doctor e2e-cold-build --json >/tmp/niceeval-doctor-kill.json 2>&1 &
doctor_pid=$!
for _ in $(seq 1 300); do
  doctor_owned=$(docker_api find 'niceeval.attempt-id=doctor-diagnostic')
  if [ -n "$doctor_owned" ]; then
    printf '%s' "$doctor_owned" >/tmp/niceeval-doctor-owned.json
    node - /tmp/niceeval-doctor-owned.json <<'NODE'
const x=require('fs').readFileSync(process.argv[2],'utf8'),l=JSON.parse(x).labels;if(l['niceeval.attempt-id']!=='doctor-diagnostic'||['niceeval.profile-id','niceeval.invocation-id','niceeval.reservation-id','niceeval.provision-token'].some(k=>!l[k]))process.exit(1)
NODE
    break
  fi
  kill -0 "$doctor_pid" 2>/dev/null || { cat /tmp/niceeval-doctor-kill.json >&2; exit 1; }
  sleep 0.1
done
[ -s /tmp/niceeval-doctor-owned.json ] || { echo 'doctor diagnostic did not become running' >&2; exit 1; }
kill -KILL "$doctor_pid"
set +e; wait "$doctor_pid"; doctor_kill_status=$?; set -e
[ "$doctor_kill_status" -eq 137 ] || { echo 'doctor did not exit from SIGKILL' >&2; exit 1; }
doctor_pid=''
node - '${activeFixture.controlSocket}' /tmp/niceeval-doctor-owned.json <<'NODE'
const net=require('net'),fs=require('fs'),path=process.argv[2],o=JSON.parse(fs.readFileSync(process.argv[3])).labels;const call=r=>new Promise((ok,no)=>{let t='';const s=net.createConnection(path);s.on('connect',()=>s.end(JSON.stringify(r)+'\\n'));s.on('data',b=>t+=b);s.on('error',no);s.on('close',()=>{try{const v=JSON.parse(t);if(!v.ok)throw Error(v.error?.message);ok(v.result)}catch(e){no(e)}})});(async()=>{for(let i=0;i<300;i++){const s=await call({kind:'status'}),r=o['niceeval.reservation-id'],l=o['niceeval.invocation-id'];if(!s.reservations.some(x=>x.reservationId===r)&&!s.leases.some(x=>x.invocationId===l)&&s.used.builds===0&&s.used.containers===0&&s.slots.every(x=>x.reservationId!==r&&x.state==='free')&&s.availableQuotaSlots===1&&s.admissionOpen&&s.degraded.length===0)return;await new Promise(x=>setTimeout(x,100))}throw Error('SIGKILL recovery did not converge')})().catch(e=>{console.error(e);process.exit(1)})
NODE
profile_label=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/niceeval-doctor-owned.json")).labels["niceeval.profile-id"])')
reservation_label=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/niceeval-doctor-owned.json")).labels["niceeval.reservation-id"])')
docker_api absent "niceeval.profile-id=$profile_label,niceeval.reservation-id=$reservation_label"
docker_api image '${dindImage}'
docker_api image '${buildkitImage}'
rm -f /tmp/niceeval-doctor-fault.json /tmp/niceeval-doctor-fault-owned.json
node_modules/.bin/niceeval docker profile doctor e2e-cold-build --json >/tmp/niceeval-doctor-fault.json 2>&1 &
doctor_pid=$!
for _ in $(seq 1 300); do
  fault_owned=$(docker_api find 'niceeval.attempt-id=doctor-diagnostic')
  if [ -n "$fault_owned" ]; then printf '%s' "$fault_owned" >/tmp/niceeval-doctor-fault-owned.json; break; fi
  kill -0 "$doctor_pid" 2>/dev/null || { cat /tmp/niceeval-doctor-fault.json >&2; exit 1; }; sleep 0.1
done
[ -s /tmp/niceeval-doctor-fault-owned.json ] || { echo 'fault diagnostic did not become running' >&2; exit 1; }
fault_socket='${activeFixture.controlSocket}.fault'
mv '${activeFixture.controlSocket}' "$fault_socket"
fault_container=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/niceeval-doctor-fault-owned.json")).id)')
docker_api kill "$fault_container"
set +e; wait "$doctor_pid"; doctor_fault_status=$?; set -e
[ "$doctor_fault_status" -eq 1 ] || { cat /tmp/niceeval-doctor-fault.json >&2; exit 1; }
doctor_pid=''
node - /tmp/niceeval-doctor-fault.json <<'NODE'
const fs=require('fs'),d=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),ids=['descriptor','control','daemon','cgroup','storage','journal','assets','cold-build','cold-build-cleanup','container-limits','nested-docker','container-cleanup'];const fail=d.checks.find(x=>x.status==='FAIL');if(d.status!=='FAIL'||JSON.stringify(d.checks.map(x=>x.id))!==JSON.stringify(ids)||!fail||!fail.detail.includes('primary:')||!fail.detail.includes('cleanup:')||!fail.detail.includes('control-owned diagnostic'))process.exit(1)
NODE
mv "$fault_socket" '${activeFixture.controlSocket}'
fault_socket=''
node - '${activeFixture.controlSocket}' /tmp/niceeval-doctor-fault-owned.json <<'NODE'
const net=require('net'),fs=require('fs'),p=process.argv[2],o=JSON.parse(fs.readFileSync(process.argv[3])).labels;const call=r=>new Promise((ok,no)=>{let t='';const s=net.createConnection(p);s.on('connect',()=>s.end(JSON.stringify(r)+'\\n'));s.on('data',b=>t+=b);s.on('error',no);s.on('close',()=>{try{const v=JSON.parse(t);if(!v.ok)throw Error(v.error?.message);ok(v.result)}catch(e){no(e)}})});(async()=>{for(let i=0;i<300;i++){const s=await call({kind:'status'}),r=o['niceeval.reservation-id'],l=o['niceeval.invocation-id'],used=s.used;if(!s.reservations.some(x=>x.reservationId===r)&&!s.leases.some(x=>x.invocationId===l)&&Object.values(used).every(x=>x===0)&&s.slots.every(x=>x.reservationId!==r&&x.state==='free')&&s.availableQuotaSlots===1&&s.admissionOpen&&s.degraded.length===0)return;await new Promise(x=>setTimeout(x,100))}throw Error('fault cleanup did not converge')})().catch(e=>{console.error(e);process.exit(1)})
NODE
fault_profile=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/niceeval-doctor-fault-owned.json")).labels["niceeval.profile-id"])')
fault_reservation=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/niceeval-doctor-fault-owned.json")).labels["niceeval.reservation-id"])')
docker_api absent "niceeval.profile-id=$fault_profile,niceeval.reservation-id=$fault_reservation"
docker_api image '${dindImage}'
docker_api image '${buildkitImage}'
set +e
node_modules/.bin/niceeval docker profile doctor e2e-cold-build --json >/tmp/niceeval-doctor-pass.json
doctor_pass_status=$?
set -e
cat /tmp/niceeval-doctor-pass.json
DOCTOR_PASS_STATUS="$doctor_pass_status" node - /tmp/niceeval-doctor-pass.json <<'NODE'
const d=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));if(process.env.DOCTOR_PASS_STATUS!=='0'||d.status!=='PASS'||d.checks.length!==12||d.checks.some(x=>x.status!=='PASS')){console.error(JSON.stringify(d,null,2));process.exit(1)}
NODE
set +e
node_modules/.bin/niceeval exp docker-profile-cold-build --rerun all --json >/tmp/niceeval-exp.ndjson
status=$?
set -e
cat /tmp/niceeval-exp.ndjson
run_id=$(node -e 'const fs=require("fs"); const lines=fs.readFileSync("/tmp/niceeval-exp.ndjson","utf8").trim().split("\\n"); const receipt=JSON.parse(lines.at(-1)); process.stdout.write(receipt.receipt.runIds[0])')
if [ "$status" -ne 0 ]; then
  locator=$(node -e 'const fs=require("fs"); for (const line of fs.readFileSync("/tmp/niceeval-exp.ndjson","utf8").trim().split("\\n")) { const value=JSON.parse(line); if (value.locator) { process.stdout.write(value.locator); break } }')
  if [ -n "$locator" ]; then
    node - "$locator" /tmp/niceeval-inspection-request.json <<'NODE'
const fs=require("fs");fs.writeFileSync(process.argv[3],JSON.stringify({protocol:"niceeval.query/v1",operation:{kind:"attempt.trace",locator:process.argv[2]}})+"\\n")
NODE
    node_modules/.bin/niceeval query run --request /tmp/niceeval-inspection-request.json
  else
    node - "$run_id" /tmp/niceeval-inspection-request.json <<'NODE'
const fs=require("fs");fs.writeFileSync(process.argv[3],JSON.stringify({protocol:"niceeval.query/v1",operation:{kind:"run.summary",runId:process.argv[2]}})+"\\n")
NODE
    node_modules/.bin/niceeval query run --request /tmp/niceeval-inspection-request.json
  fi
fi
exit "$status"`,
          ], { cwd: projectRoot, timeoutMs: 300_000 });
            expect(driver.exitCode, driver.diagnostic()).toBe(0);
            const evals = driver.expEvents().filter(
              (event): event is Extract<ExpEvent, { event: "eval" }> =>
                "event" in event && event.event === "eval",
            );
            expect(only(evals, (event) => event.evalId === "docker-profile-cold-build"), driver.diagnostic())
              .toMatchObject({ verdict: "passed" });
          },
        );

        const journal = await sudo.run(["cat", fixture.journal]);
        expect(journal.exitCode, journal.diagnostic()).toBe(0);
        const records = journal.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as HostJournalRecord);
        const events = records.map((record) => record.event);
        expect(events).toContain("reservation-granted");
        expect(events).toContain("build-terminated");
        expect(events).toContain("container-active");
        expect(events).toContain("reservation-released");
        const buildLocator = records.find((record) => record.event === "build-terminated")?.detail.locator;
        expect(typeof buildLocator).toBe("string");
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        const cleanupErrors: unknown[] = [];
        if (fixture !== undefined) {
          try {
            const journal = await sudo.run(["cat", fixture.journal]);
            if (journal.exitCode !== 0 && primaryError === undefined) throw new Error(journal.diagnostic());
            const records = journal.exitCode === 0 ? journal.stdout
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line) as HostJournalRecord) : [];
            const locators = new Map<string, "cache" | "ephemeral" | undefined>();
            const builderNames = new Set<string>();
            for (const record of records) {
              if (record.event === "build-terminated" && typeof record.detail.locator === "string") {
                locators.set(record.detail.locator, undefined);
              }
              if (record.event === "build-builder-created" && typeof record.detail.builderName === "string") {
                builderNames.add(record.detail.builderName);
              }
              for (const reservation of Object.values(record.state?.reservations ?? {})) {
                if (reservation.kind === "build" && typeof reservation.locator === "string") {
                  locators.set(reservation.locator, reservation.retention);
                }
                if (reservation.kind === "build" && typeof reservation.builderName === "string") {
                  builderNames.add(reservation.builderName);
                }
              }
            }
            for (const [locator, retention] of locators) {
              const inspectImage = await docker.run(["image", "inspect", locator]);
              if (retention === "ephemeral" && inspectImage.exitCode === 0) {
                // Clean the fixture after recording the ownership leak, but do
                // not let cleanup turn a failed proof into a passing run.
                await docker.run(["image", "rm", "--force", locator]);
                throw new Error(`watchdog leaked ephemeral build locator ${locator}`);
              }
              if (retention === "ephemeral" && !/No such image/i.test(inspectImage.diagnostic())) {
                throw new Error(inspectImage.diagnostic());
              }
              const removeImage = await docker.run(["image", "rm", "--force", locator]);
              if (removeImage.exitCode !== 0 && !/No such image/i.test(removeImage.diagnostic())) {
                throw new Error(removeImage.diagnostic());
              }
            }
            for (const builderName of builderNames) {
              if (!/^niceeval-build-[a-f0-9]{24}$/.test(builderName)) {
                throw new Error(`watchdog journal contains a non-derived builder name: ${builderName}`);
              }
              const volumeName = `buildx_buildkit_${builderName}0_state`;
              const inspectVolume = await docker.run(["volume", "inspect", volumeName]);
              if (inspectVolume.exitCode === 0) {
                const removeVolume = await docker.run(["volume", "rm", "--force", volumeName]);
                throw new Error(
                  `watchdog leaked Buildx state volume ${volumeName}; cleanup: ${removeVolume.diagnostic()}`,
                );
              }
              if (!/No such volume/i.test(inspectVolume.diagnostic())) {
                throw new Error(inspectVolume.diagnostic());
              }
            }
          } catch (error) {
            cleanupErrors.push(error);
          }
          try {
            const cleanup = await sudo.run([
              "env", `PATH=${hostPath}`,
              "python3", fixtureScript, "cleanup", "--root", hostRoot,
            ], { timeoutMs: 30_000 });
            if (cleanup.exitCode !== 0) throw new Error(cleanup.diagnostic());
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length > 0) {
          if (primaryError !== undefined) {
            console.error(new AggregateError(cleanupErrors, "Docker profile E2E cleanup also failed"));
          } else {
            throw new AggregateError(cleanupErrors, "Docker profile E2E cleanup failed");
          }
        }
      }
    });
  });
}, 360_000);
