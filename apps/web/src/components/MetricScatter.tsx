import { CartesianGrid, Cell, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

type ScatterDatum = {
  id: number;
  label: string;
  tone: string;
  x: number | null;
  y: number | null;
  tooltip: string;
};

type MetricScatterProps = {
  points: ScatterDatum[];
  xLabel: string;
  yLabel: string;
  emptyLabel: string;
  selectedIds?: number[];
  hoveredId?: number | null;
  onHover?: (id: number | null) => void;
  onSelect?: (id: number) => void;
  onBrushChange?: (ids: number[] | null) => void;
};

type ChartPoint = ScatterDatum & {
  xValue: number;
  yValue: number;
};

type TooltipPayload = {
  payload?: ChartPoint;
};

const chartConfig = {
  listings: {
    label: "Listings",
    color: "var(--primary)"
  }
} satisfies ChartConfig;

export function MetricScatter({
  points,
  xLabel,
  yLabel,
  emptyLabel,
  selectedIds = [],
  hoveredId = null,
  onHover,
  onSelect,
  onBrushChange
}: MetricScatterProps) {
  const data: ChartPoint[] = points
    .filter((point): point is ScatterDatum & { x: number; y: number } => point.x != null && point.y != null)
    .map((point) => ({
      ...point,
      xValue: point.x,
      yValue: point.y
    }));

  if (data.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const hasSelection = selectedIds.length > 0;

  return (
    <div className="space-y-3">
      <ChartContainer config={chartConfig} className="h-[260px] w-full" initialDimension={{ width: 520, height: 260 }}>
        <ScatterChart accessibilityLayer margin={{ bottom: 18, left: 0, right: 12, top: 12 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="xValue"
            name={xLabel}
            tickLine={false}
            type="number"
            tickMargin={8}
          />
          <YAxis
            dataKey="yValue"
            name={yLabel}
            tickLine={false}
            type="number"
            tickMargin={8}
            width={48}
          />
          <ZAxis range={[64, 64]} />
          <ChartTooltip
            content={(props) => {
              const payload = props.payload as readonly TooltipPayload[] | undefined;
              const point = payload?.[0]?.payload;

              if (!props.active || !point) {
                return null;
              }

              return (
                <div className="max-w-72 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
                  <div className="font-medium">{point.label}</div>
                  <div className="mt-1 text-muted-foreground">{point.tooltip}</div>
                </div>
              );
            }}
            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 4" }}
          />
          <Scatter
            data={data}
            dataKey="yValue"
            name="Listings"
            onClick={(point: unknown) => onSelect?.((point as ChartPoint).id)}
            onMouseEnter={(point: unknown) => onHover?.((point as ChartPoint).id)}
            onMouseLeave={() => onHover?.(null)}
          >
            {data.map((point) => {
              const selected = selectedIds.includes(point.id);
              const hovered = hoveredId === point.id;

              return (
                <Cell
                  className={cn("cursor-pointer transition-opacity", hasSelection && !selected && !hovered ? "opacity-30" : "")}
                  fill={point.tone}
                  key={point.id}
                  stroke={selected || hovered ? "var(--foreground)" : "var(--border)"}
                  strokeWidth={selected || hovered ? 2 : 1}
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ChartContainer>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{xLabel}</span>
        <Button onClick={() => onBrushChange?.(null)} size="xs" type="button" variant="ghost">
          Clear brush
        </Button>
        <span>{yLabel}</span>
      </div>
    </div>
  );
}
