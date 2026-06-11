import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerJs = join(dirname(fileURLToPath(import.meta.url)), '../dist/worker.js');
const mtime = () => {
  try {
    return statSync(workerJs).mtimeMs;
  } catch {
    return null;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child = null;
process.on('SIGINT', () => {
  child?.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  child?.kill();
  process.exit(0);
});

for (;;) {
  let m = mtime();
  while (m === null || m !== (await sleep(1000), mtime())) {
    m = mtime();
    await sleep(1000);
  }

  const spawnedAt = m;
  child = spawn(process.execPath, [workerJs], { stdio: 'inherit' });
  const exited = new Promise((r) => child.on('exit', r));

  let done = false;
  void exited.then(() => (done = true));
  while (!done) {
    await sleep(2000);
    const now = mtime();
    if (now !== null && now !== spawnedAt) {
      console.log('[dev-worker] dist đổi — restart worker');
      child.kill();
      await exited;
      break;
    }
  }
  await sleep(1000);
}
