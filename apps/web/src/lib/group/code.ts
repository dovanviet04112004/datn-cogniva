const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

export function generateInviteCode(): string {
  const out: string[] = [];
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < CODE_LENGTH; i++) {
      const b = bytes[i] ?? 0;
      out.push(ALPHABET.charAt(b % ALPHABET.length));
    }
  } else {
    for (let i = 0; i < CODE_LENGTH; i++) {
      out.push(ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length)));
    }
  }
  return out.join('');
}

export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}
