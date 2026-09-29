"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatAmount } from "@/lib/money";

type Slice = { name: string; value: number; color: string };

/** Spend by category: donut with the total in the hole; the legend beside it carries identity. */
export function DonutChart({ data, total, size = 220 }: { data: Slice[]; total: number; size?: number }) {
  return (
    <div role="img" aria-label="Spend by category" className="relative shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="56%"
            outerRadius="100%"
            paddingAngle={data.length > 1 ? 1 : 0}
            stroke="var(--surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Slice;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-sm">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="size-2.5 rounded-sm" style={{ background: d.color }} />
                    {d.name}
                  </div>
                  <div>
                    {formatAmount(d.value)} · {total ? Math.round((d.value / total) * 100) : 0}%
                  </div>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="text-xs text-muted-ink">Total</span>
        <span className="text-xl font-semibold">{formatAmount(total)}</span>
      </div>
    </div>
  );
}
