/**
 * ffmpeg helpers — tách audio + (sau này) thumbnail từ video recording.
 *
 * Yêu cầu runtime: binary `ffmpeg` có trong PATH.
 *   - Dev Windows: choco install ffmpeg / scoop install ffmpeg
 *   - Dev macOS  : brew install ffmpeg
 *   - Dev Linux  : apt-get install -y ffmpeg
 *   - Prod VPS   : đã pre-install trong `infrastructure/scripts/provision-server.sh`
 *
 * Tại sao subprocess thay vì @ffmpeg/ffmpeg (WASM):
 *   - WASM nặng (~30MB), chạy chậm hơn 5-10x trên file dài.
 *   - Inngest function chạy trên Node.js (không edge runtime) → có quyền spawn.
 *
 * Tại sao output 16kHz mono WAV PCM:
 *   - Whisper-1 docs khuyên dùng (giảm transcribe latency + cost).
 *   - PCM tránh re-encode loss khi đã trải qua composite encoding.
 *
 * Lưu ý: function này KHÔNG validate input path → caller phải đảm bảo path
 * là file tin cậy (R2 download xong, không phải user-controlled string).
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Output config cho audio extract — fix luôn cho Whisper. */
const AUDIO_FORMAT = {
  sampleRate: 16_000,
  channels: 1,
  codec: 'pcm_s16le',
  ext: 'wav',
} as const;

/**
 * Tách audio từ video file → WAV 16kHz mono.
 *
 * @param videoInput - Đường dẫn local hoặc URL https (sẽ download trước nếu là URL).
 * @returns Đường dẫn file WAV tạm (caller chịu trách nhiệm cleanup).
 */
export async function extractAudio(videoInput: string): Promise<string> {
  const inputPath = videoInput.startsWith('http')
    ? await downloadToTmp(videoInput)
    : videoInput;

  const outputPath = path.join(tmpdir(), `cogniva-audio-${randomUUID()}.${AUDIO_FORMAT.ext}`);

  await runFfmpeg([
    '-y',                                       // overwrite nếu trùng
    '-i', inputPath,
    '-vn',                                       // bỏ video
    '-ar', String(AUDIO_FORMAT.sampleRate),
    '-ac', String(AUDIO_FORMAT.channels),
    '-c:a', AUDIO_FORMAT.codec,
    outputPath,
  ]);

  return outputPath;
}

/**
 * Lấy duration (giây) của 1 video/audio file qua ffprobe.
 * Trả 0 nếu fail (không throw — caller có thể fallback).
 */
export async function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    let out = '';
    ff.stdout.on('data', (d) => { out += d.toString(); });
    ff.on('close', () => {
      const sec = parseFloat(out.trim());
      resolve(Number.isFinite(sec) ? sec : 0);
    });
    ff.on('error', () => resolve(0));
  });
}

/**
 * Chạy ffmpeg với args, reject khi exit code != 0.
 * Stderr được log ra console khi fail để dễ debug pipeline.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d.toString(); });
    ff.on('close', (code) => {
      if (code === 0) return resolve();
      console.error('[ffmpeg] exit', code, stderr.slice(-500));
      reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-200)}`));
    });
    ff.on('error', (err) => {
      // ENOENT = ffmpeg không có trong PATH
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(new Error('ffmpeg không có trong PATH — cài binary trước khi chạy pipeline'));
      }
      reject(err);
    });
  });
}

/**
 * Download URL về 1 file tmp (cần cho R2 presigned URL).
 * Stream qua fs.writeFile để tránh load full vào memory cho file dài.
 */
async function downloadToTmp(url: string): Promise<string> {
  const ext = path.extname(new URL(url).pathname) || '.mp4';
  const tmpPath = path.join(tmpdir(), `cogniva-dl-${randomUUID()}${ext}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download fail: HTTP ${res.status} ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(tmpPath, buf);
  return tmpPath;
}

/**
 * Cleanup tmp files — gọi từ pipeline finally block.
 * Bỏ qua lỗi (file có thể đã bị xoá ở step trước).
 */
export async function safeUnlink(...paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((p) =>
      fs.unlink(p).catch(() => {
        /* ignore */
      }),
    ),
  );
}
