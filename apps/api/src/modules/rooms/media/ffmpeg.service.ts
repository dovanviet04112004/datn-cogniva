import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Injectable } from '@nestjs/common';

const AUDIO_FORMAT = {
  sampleRate: 16_000,
  channels: 1,
  codec: 'pcm_s16le',
  ext: 'wav',
} as const;

@Injectable()
export class FfmpegService {
  async extractAudio(videoInput: string): Promise<string> {
    const inputPath = videoInput.startsWith('http')
      ? await this.downloadToTmp(videoInput)
      : videoInput;

    const outputPath = path.join(tmpdir(), `cogniva-audio-${randomUUID()}.${AUDIO_FORMAT.ext}`);

    await this.runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ar',
      String(AUDIO_FORMAT.sampleRate),
      '-ac',
      String(AUDIO_FORMAT.channels),
      '-c:a',
      AUDIO_FORMAT.codec,
      outputPath,
    ]);

    return outputPath;
  }

  getMediaDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      const ff = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      let out = '';
      ff.stdout.on('data', (d) => {
        out += d.toString();
      });
      ff.on('close', () => {
        const sec = parseFloat(out.trim());
        resolve(Number.isFinite(sec) ? sec : 0);
      });
      ff.on('error', () => resolve(0));
    });
  }

  async safeUnlink(...paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', args);
      let stderr = '';
      ff.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      ff.on('close', (code) => {
        if (code === 0) return resolve();
        console.error('[ffmpeg] exit', code, stderr.slice(-500));
        reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-200)}`));
      });
      ff.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(
            new Error('ffmpeg không có trong PATH — cài binary trước khi chạy pipeline'),
          );
        }
        reject(err);
      });
    });
  }

  private async downloadToTmp(url: string): Promise<string> {
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
}
