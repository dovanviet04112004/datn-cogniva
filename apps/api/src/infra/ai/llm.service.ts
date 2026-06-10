/**
 * LlmService — gọi LLM 1 lượt (non-stream) dùng chung cho apps/api.
 *
 * Port từ NotesService.pickChatProvider + generateCompletion (gốc là
 * apps/web/src/lib/ai/models.ts), NÂNG thành tham số hóa system /
 * temperature / maxTokens để các module AI (quiz gen, flashcard gen, chat
 * title...) dùng chung 1 chỗ. apps/api KHÔNG cài @ai-sdk/* providers →
 * REST trực tiếp; provider pick order + model default mỗi provider GIỮ
 * NGUYÊN theo lib cũ.
 */
import { Injectable } from '@nestjs/common';

type ChatProvider = 'anthropic' | 'groq' | 'google' | 'openrouter';

export interface LlmCompleteOptions {
  /** System message — Anthropic là field riêng, 3 provider kia là message role system. */
  system?: string;
  /** Default 0.6 (khớp generateText cũ). */
  temperature?: number;
  /** Default 1024 — caller cần output dài (quiz/flashcard gen) PHẢI truyền lớn hơn. */
  maxTokens?: number;
}

@Injectable()
export class LlmService {
  /** Sinh 1 completion text. Throw nếu không có provider key hoặc provider trả lỗi HTTP. */
  async complete(prompt: string, opts: LlmCompleteOptions = {}): Promise<string> {
    const provider = this.pickChatProvider();
    const temperature = opts.temperature ?? 0.6;
    const maxTokens = opts.maxTokens ?? 1024;

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          temperature,
          ...(opts.system ? { system: opts.system } : {}),
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const json = (await res.json()) as { content?: Array<{ text?: string }> };
      return json.content?.[0]?.text ?? '';
    }

    // 3 provider còn lại đều OpenAI-compatible chat/completions.
    const cfg: Record<
      Exclude<ChatProvider, 'anthropic'>,
      { url: string; key: string; model: string; headers: Record<string, string> }
    > = {
      groq: {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: process.env.GROQ_API_KEY ?? '',
        model: 'llama-3.3-70b-versatile',
        headers: {},
      },
      google: {
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        key: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
        model: 'gemini-2.5-flash',
        headers: {},
      },
      openrouter: {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key: process.env.OPENROUTER_API_KEY ?? '',
        model: 'openai/gpt-oss-20b:free',
        headers: {
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
          'X-Title': 'Cogniva',
        },
      },
    };
    const c = cfg[provider];

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.key}`, ...c.headers },
      body: JSON.stringify({ model: c.model, messages, temperature, max_tokens: maxTokens }),
    });
    if (!res.ok) throw new Error(`${provider} ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }

  /** Provider pick order copy từ lib/ai/models.ts pickChatProvider() — LLM_PROVIDER force trước. */
  private pickChatProvider(): ChatProvider {
    const forced = process.env.LLM_PROVIDER as ChatProvider | undefined;
    if (forced && ['anthropic', 'openrouter', 'groq', 'google'].includes(forced)) return forced;
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.GROQ_API_KEY) return 'groq';
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google';
    if (process.env.OPENROUTER_API_KEY) return 'openrouter';
    throw new Error('[ai] Không tìm thấy AI provider key (ANTHROPIC/GROQ/GOOGLE/OPENROUTER)');
  }
}
