import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
import path from 'node:path';

const buf = fs.readFileSync(path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const font: any = (fontkit as any).create(buf);
const test = '→∫Σ√≤≥ωλŷᵢₐ²³•⟺∞×÷±≈πΔεφθ∓⇌≠';
const lines: string[] = [];
for (const ch of test) {
  const cp = ch.codePointAt(0)!;
  const g = font.glyphForCodePoint(cp);
  lines.push(`${ch} U+${cp.toString(16)} ${g && g.id > 0 ? 'OK' : 'MISS'}`);
}
console.log(lines.join('\n'));
process.exit(0);
