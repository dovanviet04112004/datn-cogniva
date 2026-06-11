import * as React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  className?: string;
  size?: number;
};

export function NeuralPattern({ className, size = 120 }: Props) {
  const nodes = [
    { cx: 15, cy: 22, r: 2 },
    { cx: 85, cy: 18, r: 1.5 },
    { cx: 48, cy: 60, r: 2.5 },
    { cx: 22, cy: 92, r: 1.5 },
    { cx: 95, cy: 88, r: 2 },
  ];

  return (
    <svg
      aria-hidden
      className={cn('pointer-events-none h-full w-full', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id="neural-grid"
          x="0"
          y="0"
          width={size}
          height={size}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${nodes[0]!.cx} ${nodes[0]!.cy} Q 30 40 ${nodes[2]!.cx} ${nodes[2]!.cy}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeLinecap="round"
          />
          <path
            d={`M ${nodes[1]!.cx} ${nodes[1]!.cy} Q 70 38 ${nodes[2]!.cx} ${nodes[2]!.cy}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeLinecap="round"
          />
          <path
            d={`M ${nodes[2]!.cx} ${nodes[2]!.cy} Q 30 80 ${nodes[3]!.cx} ${nodes[3]!.cy}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeLinecap="round"
          />
          <path
            d={`M ${nodes[2]!.cx} ${nodes[2]!.cy} Q 75 80 ${nodes[4]!.cx} ${nodes[4]!.cy}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeLinecap="round"
          />
          <path
            d={`M ${nodes[0]!.cx} ${nodes[0]!.cy} Q 20 60 ${nodes[3]!.cx} ${nodes[3]!.cy}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeLinecap="round"
          />
          {nodes.map((n, i) => (
            <circle
              key={i}
              cx={n.cx}
              cy={n.cy}
              r={n.r}
              fill="currentColor"
              opacity={i === 2 ? 1 : 0.6}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#neural-grid)" />
    </svg>
  );
}
