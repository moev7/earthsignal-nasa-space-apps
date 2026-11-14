import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import type { AnalysisResult } from "@/lib/analysis-contract";

export function DistributionChart({
  before,
  after,
}: {
  before: AnalysisResult["distributions"]["before"];
  after: AnalysisResult["distributions"]["after"];
}) {
  const data = [];
  for (let i = 0; i < before.counts.length; i++) {
    data.push({
      bin: (before.edges[i] + before.edges[i + 1]) / 2,
      before: before.counts[i],
      after: after.counts[i],
    });
  }

  return (
    <div className="chart-container" style={{ width: "100%", height: 180 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
          <XAxis
            dataKey="bin"
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(val) => val.toFixed(1)}
          />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#111", border: "1px solid #333", fontSize: 12 }}
            labelFormatter={(val) => `${Number(val).toFixed(1)} dB`}
          />
          <Area type="stepAfter" dataKey="before" stroke="#888" fill="#888" fillOpacity={0.3} name="Before" />
          <Area type="stepAfter" dataKey="after" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.3} name="After" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChangeHistogram({
  difference,
}: {
  difference: AnalysisResult["distributions"]["difference"];
}) {
  const data = [];
  for (let i = 0; i < difference.counts.length; i++) {
    data.push({
      bin: (difference.edges[i] + difference.edges[i + 1]) / 2,
      count: difference.counts[i],
    });
  }

  return (
    <div className="chart-container" style={{ width: "100%", height: 180 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
          <XAxis
            dataKey="bin"
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(val) => val.toFixed(1)}
          />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#111", border: "1px solid #333", fontSize: 12 }}
            labelFormatter={(val) => `${Number(val).toFixed(1)} dB diff`}
            cursor={{ fill: "#222" }}
          />
          <Bar dataKey="count" fill="#ff3366" name="Pixels" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TransectChart({
  transect,
}: {
  transect: AnalysisResult["transect"];
}) {
  return (
    <div className="chart-container" style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={transect} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
          <XAxis
            dataKey="distanceM"
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(val) => `${Math.round(val)}m`}
          />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#111", border: "1px solid #333", fontSize: 12 }}
            labelFormatter={(val) => `${Math.round(Number(val))} m`}
          />
          <Line
            type="stepAfter"
            dataKey="differenceDb"
            stroke="#ff3366"
            strokeWidth={2}
            name="Difference dB"
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
