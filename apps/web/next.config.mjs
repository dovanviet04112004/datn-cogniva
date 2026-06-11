const NEST_ORIGIN = process.env.NEST_API_ORIGIN ?? 'http://localhost:4000';
const NEST_MIGRATED_PREFIXES = [
  'healthz',
  'auth/google',
  'profile',
  'user/status',
  'leaderboard',
  'analytics',
  'mastery',
  'atoms',
  'notes',
  'study-plan',
  'graph',
  'search',
  'chunks',
  'workspaces',
  'documents',
  'flashcards',
  'quiz',
  'exams',
  'attempts',
  'conversations',
  'groups',
  'dm',
  'channels',
  'rooms',
  'notifications',
  'reports',
  'realtime',
  'questions',
  'library',
  'tutoring',
  'tutors',
  'wallet',
  'webhooks',
  'chat',
  'ai',
  'admin',
  'account',
  'health',
];
const NEST_MIGRATED_EXACT = [
  'auth/sign-in',
  'auth/sign-in/2fa',
  'auth/sign-up',
  'auth/refresh',
  'auth/sign-out',
  'auth/me',
  'auth/forgot-password',
  'auth/reset-password',
  'auth/2fa/enable',
  'auth/2fa/verify',
  'auth/2fa/disable',
];

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
        ...NEST_MIGRATED_PREFIXES.map((p) => ({
          source: `/api/${p}/:path*`,
          destination: `${NEST_ORIGIN}/api/${p}/:path*`,
        })),
        ...NEST_MIGRATED_PREFIXES.map((p) => ({
          source: `/api/${p}`,
          destination: `${NEST_ORIGIN}/api/${p}`,
        })),
        ...NEST_MIGRATED_EXACT.map((p) => ({
          source: `/api/${p}`,
          destination: `${NEST_ORIGIN}/api/${p}`,
        })),
      ],
    };
  },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@cogniva/db', '@cogniva/shared'],
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app', '*.ngrok.io'],
  experimental: {
    staleTimes: {
      dynamic: 60,
      static: 180,
    },
    optimizePackageImports: [
      '@tanstack/react-query',
      '@tiptap/react',
      '@tiptap/starter-kit',
      'yjs',
    ],
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
};

export default nextConfig;
