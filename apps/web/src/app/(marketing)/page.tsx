import Link from 'next/link';
import { ArrowRight, BrainCircuit, FileText, Network, Sparkles, Target, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NeuralNetworkHero } from '@/components/marketing/neural-network-hero';
import { StaggerGrid } from '@/components/marketing/stagger-grid';

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
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-32 top-20 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-purple-500/10 blur-3xl" />
        </div>

        <div className="container grid items-center gap-12 py-16 md:grid-cols-2 md:gap-16 md:py-24 lg:py-32">
          <div className="flex flex-col items-start gap-5 text-left">
            <div className="bg-muted/50 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
              <Sparkles className="h-3 w-3" />
              Phase 0 — Foundation shipping
            </div>
            <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl">
              AI tutor that actually{' '}
              <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
                knows you
              </span>
              .
            </h1>
            <p className="text-muted-foreground max-w-xl text-balance text-base md:text-lg">
              Cogniva builds a personal knowledge graph for every learner, retrieves with
              multi-stage RAG, and adapts in real-time using Bayesian mastery tracking and spaced
              repetition.
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
            <p className="text-muted-foreground text-xs">
              Free tier · 10 documents · 50 AI messages/day · No credit card.
            </p>
          </div>

          <div className="relative aspect-square w-full md:aspect-auto md:h-[480px] lg:h-[560px]">
            <NeuralNetworkHero className="h-full w-full" />
          </div>
        </div>
      </section>

      <section id="features" className="container py-16 md:py-24">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Not a ChatGPT wrapper.
          </h2>
          <p className="text-muted-foreground mt-4">
            Every interaction makes the system smarter about <em>this specific learner</em>.
          </p>
        </div>
        <StaggerGrid className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card
                key={feature.title}
                className="border-muted hover:border-foreground/20 h-full transition-colors"
              >
                <CardHeader>
                  <div className="bg-muted/50 mb-2 flex h-10 w-10 items-center justify-center rounded-md border">
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
        </StaggerGrid>
      </section>

      <section className="container py-16 md:py-24">
        <div className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-pink-500/10 p-8 text-center md:p-12">
          <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 -right-10 h-40 w-40 rounded-full bg-pink-500/20 blur-3xl" />
          <h2 className="relative text-2xl font-semibold tracking-tight md:text-3xl">
            Sẵn sàng học theo cách của riêng bạn?
          </h2>
          <p className="text-muted-foreground relative mt-3">
            Upload PDF đầu tiên, tạo flashcard, chat với AI tutor — tất cả free.
          </p>
          <div className="relative mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" asChild>
              <Link href="/sign-up">
                Tạo tài khoản miễn phí <ArrowRight className="ml-1" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/sign-in">Đăng nhập</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
