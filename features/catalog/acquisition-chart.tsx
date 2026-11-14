"use client";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import type { Scene } from "./domain";
export function AcquisitionChart({ scenes }: { scenes: Scene[] }) {
  const counts = new Map<string, number>();
  scenes.forEach((s) => {
    const date = s.startTime.slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  });
  const data = [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
  return (
    <div className="acquisition-chart">
      <h3>Products by acquisition date</h3>
      <p>Counts within this returned result only.</p>
      <ChartContainer
        className="trend-chart"
        config={{ count: { label: "Returned products", color: "#b3f84c" } }}
      >
        <BarChart
          data={data}
          margin={{ left: -15, right: 8 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} stroke="#ffffff10" />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => v.slice(5)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="chart-tooltip">
                  {payload[0].payload.date}
                  <br />
                  {payload[0].value} returned products
                </div>
              ) : null
            }
          />
          <Bar
            dataKey="count"
            fill="#b3f84c"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
