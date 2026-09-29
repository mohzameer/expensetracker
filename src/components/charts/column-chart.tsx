"use client";

import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "@/lib/money";

type Datum = { label: string; value: number; muted?: boolean; detail?: string };

/** Single-series columns: value on the cap, hover tooltip, optional reference line. */
export function ColumnChart({
  data,
  height = 240,
  reference,
  color = "var(--teal)",
  mutedColor = "var(--faint)",
  ariaLabel,
}: {
  data: Datum[];
  height?: number;
  reference?: { value: number; label: string };
  color?: string;
  mutedColor?: string;
  ariaLabel: string;
}) {
  const max = Math.max(...data.map((d) => d.value), reference?.value ?? 0, 1);
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 8 }} barCategoryGap="22%">
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--line-strong)" }}
            tick={{ fill: "var(--muted-ink)", fontSize: 13 }}
          />
          <YAxis hide domain={[Math.min(0, ...data.map((d) => d.value)) * 1.15, max * 1.1]} />
          <Tooltip
            cursor={{ fill: "var(--line-soft)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Datum;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-sm">
                  <div className="font-semibold">{d.label}</div>
                  <div>{formatAmount(d.value)}</div>
                  {d.detail && <div className="text-muted-ink">{d.detail}</div>}
                </div>
              );
            }}
          />
          {reference && (
            <ReferenceLine
              y={reference.value}
              stroke="var(--faint)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              ifOverflow="extendDomain"
            />
          )}
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.muted ? mutedColor : color} />
            ))}
            <LabelList
              dataKey="value"
              content={(p) => {
                const { x = 0, y = 0, width = 0, height = 0, value } = p as { x?: number; y?: number; width?: number; height?: number; value?: number };
                const v = Number(value);
                // Above positive bars, below negative ones — never on the axis.
                const ty = v < 0 ? Number(y) + Math.abs(Number(height)) + 16 : Number(y) - 6;
                return (
                  <text x={Number(x) + Number(width) / 2} y={ty} textAnchor="middle" fill="var(--ink)" fontSize={13} fontWeight={600}>
                    {formatAmount(v)}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
