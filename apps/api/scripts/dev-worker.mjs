/**
 * Supervisor worker ở DEV — chạy song song với `nest start --watch` (process
 * http) trong cùng `pnpm dev`. Không build riêng (tránh 2 watcher giẫm dist):
 *   - đợi dist/worker.js xuất hiện + ỔN ĐỊNH (mtime đứng yên ≥2s — nest đang
 *     ghi dở thì chưa chạy),
 *   - spawn `node dist/worker.js`; nest rebuild (mtime đổi) → kill + respawn;
 *     dist bị deleteOutDir lúc nest boot → child chết → đợi file quay lại.
 */
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
  // Đợi file tồn tại + ổn định (2 lần đo mtime giống nhau cách 1s).
  let m = mtime();
  while (m === null || m !== (await sleep(1000), mtime())) {
    m = mtime();
    await sleep(1000);
  }

  const spawnedAt = m;
  child = spawn(process.execPath, [workerJs], { stdio: 'inherit' });
  const exited = new Promise((r) => child.on('exit', r));

  // Chờ: child chết (crash/deleteOutDir) HOẶC nest rebuild xong (mtime đổi).
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
