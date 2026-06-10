/**
 * NeuralPattern — SVG decorative pattern dùng cho hero bands, empty states,
 * floating panels. Mô phỏng "neural connection" — node + đường nối subtle,
 * tạo identity rõ rệt cho Cogniva (AI Learning OS) khác với dashboard SaaS
 * generic.
 *
 * Implementation:
 *   - SVG `<pattern>` lặp tile 120x120px
 *   - Node = circle bán kính 2px
 *   - Connection = path cong subtle giữa các node
 *   - currentColor → bind tone primary qua className `text-primary`
 *   - Opacity prop để tinh chỉnh visibility (default 0.08)
 *
 * Cách dùng:
 *   <NeuralPattern className="text-primary opacity-[0.06]" />
 *   wrap trong absolute container có mask để fade edge:
 *     <div className="absolute inset-0 [mask-image:radial-gradient(...)]">
 *       <NeuralPattern />
 *     </div>
 */
import * as React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  className?: string;
  /** Tile size px. Default 120 — vừa đủ subtle, không quá to. */
  size?: number;
};

export function NeuralPattern({ className, size = 120 }: Props) {
  // Random-looking nhưng deterministic — không generate runtime để SSR ổn định.
  // Mỗi tile có 4 node + 5 connection cong nhẹ.
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
          {/* Connections — cong nhẹ (quadratic bezier), stroke mảnh */}
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
          {/* Nodes — filled circles, accent dot ở center node */}
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
