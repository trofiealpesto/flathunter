import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type RankedMetricChartProps = {
  items: Array<{
    label: string;
    value: number;
    detail?: string;
    tone?: "success" | "warning" | "error" | "neutral" | "brand";
  }>;
  emptyLabel?: string;
};

const chartConfig = {
  value: {
    label: "Listings",
    color: "var(--primary)"
  }
} satisfies ChartConfig;

const toneColor = {
  brand: "var(--primary)",
  error: "var(--destructive)",
  neutral: "var(--muted-foreground)",
  success: "oklch(0.627 0.194 149.214)",
  warning: "oklch(0.769 0.188 70.08)"
};

export function RankedMetricChart({
  items,
  emptyLabel = "No rows available for the current selection."
}: RankedMetricChartProps) {
  if (items.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const data = items.map((item) => ({
    ...item,
    display: item.detail ? `${item.label} · ${item.detail}` : item.label
  }));

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full" initialDimension={{ width: 480, height: 220 }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ bottom: 4, left: 8, right: 16, top: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis dataKey="value" hide type="number" />
        <YAxis
          axisLine={false}
          dataKey="label"
          tickLine={false}
          tickMargin={8}
          type="category"
          width={112}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "var(--muted)" }} />
        <Bar dataKey="value" radius={5}>
          {data.map((item) => (
            <Cell fill={toneColor[item.tone ?? "neutral"]} key={item.label} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
