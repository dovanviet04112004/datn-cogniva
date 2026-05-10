/**
 * Landing page (route "/") — bộ mặt marketing chính của Cogniva.
 *
 * Gồm 2 section:
 *  1. Hero    : pitch ngắn, CTA "Get started" + "See how it works"
 *  2. Features: 6 thẻ giới thiệu các tính năng then chốt — định vị Cogniva
 *               KHÔNG phải ChatGPT wrapper, mà là pipeline RAG production
 *               + BKT mastery + FSRS spaced repetition.
 *
 * File này là Server Component (không có "use client") → render tĩnh
 * khi build, đổi nội dung chỉ cần redeploy.
 */
import Link from 'next/link';
import { ArrowRight, BrainCircuit, FileText, Network, Sparkles, Target, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Khai báo tách ra để dễ A/B test wording sau này — chỉ sửa ở 1 chỗ
const features = [
  {
    icon: FileText,
    title: 'Document Q&A with citations',
    description:
      'Upload PDFs, slides, lectures. Ask questions, get answers grounded in your sources — every claim is clickable.',
  },
  {
    icon: Network,
    title: 'Personal knowledge graph',
    description:
      'We auto-extract concepts and prerequisite links. Watch your understanding form into a visible structure.',
  },
  {
    icon: Target,
    title: 'Adaptive mastery tracking',
    description:
      'Bayesian Knowledge Tracing per concept with FSRS spaced repetition. The system knows what you forgot.',
  },
  {
    icon: Sparkles,
    title: 'Production-grade RAG',
    description:
      'HyDE rewriting, hybrid retrieval, Cohere reranking, MMR diversity. Not a toy — measured against golden datasets.',
  },
  {
    icon: BrainCircuit,
    title: 'Socratic AI tutor',
    description:
      'Streams responses, asks back, adapts difficulty to where you actually are. No more "explain like I\'m 5" loops.',
  },
  {
    icon: Zap,
    title: 'Quiz & flashcard generation',
    description:
      'One click on a chunk → cloze cards, MCQs, short-answer questions. Targeted at your weak topics.',
  },
];

export default function MarketingHomePage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="container flex flex-col items-center gap-6 py-24 text-center md:py-32">
        {/* Badge nhỏ phía trên hero — báo hiệu giai đoạn dự án */}
        <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Phase 0 — Foundation shipping
        </div>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          AI tutor that actually <span className="text-primary">knows you</span>.
        </h1>
        <p className="max-w-2xl text-balance text-lg text-muted-foreground">
          Cogniva builds a personal knowledge graph for every learner, retrieves with multi-stage
          RAG, and adapts in real-time using Bayesian mastery tracking and spaced repetition.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href="/sign-up">
              Get started free <ArrowRight className="ml-1" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/#features">See how it works</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Free tier · 10 documents · 50 AI messages/day · No credit card.
        </p>
      </section>

      {/* ── Features ──────────────────────────────────────── */}
      <section id="features" className="container py-16 md:py-24">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Not a ChatGPT wrapper.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Every interaction makes the system smarter about <em>this specific learner</em>.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="border-muted">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md border bg-muted/50">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{feature.description}</CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
