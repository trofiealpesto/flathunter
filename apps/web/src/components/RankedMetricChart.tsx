import { Box, Text } from "gestalt";

type RankedMetricChartProps = {
  items: Array<{
    label: string;
    value: number;
    detail?: string;
    tone?: "success" | "warning" | "error" | "neutral" | "brand";
  }>;
  emptyLabel?: string;
};

function maxValue(items: RankedMetricChartProps["items"]) {
  return Math.max(...items.map((item) => item.value), 0);
}

export function RankedMetricChart({
  items,
  emptyLabel = "No rows available for the current selection."
}: RankedMetricChartProps) {
  if (items.length === 0) {
    return (
      <Box paddingY={4}>
        <Text color="subtle">{emptyLabel}</Text>
      </Box>
    );
  }

  const ceiling = Math.max(maxValue(items), 1);

  return (
    <div className="ranked-chart">
      {items.map((item) => (
        <div className="ranked-chart__row" key={item.label}>
          <div className="ranked-chart__meta">
            <div>
              <strong>{item.label}</strong>
              {item.detail ? <span>{item.detail}</span> : null}
            </div>
            <b>{item.value}</b>
          </div>
          <div className="ranked-chart__track">
            <div
              className={`ranked-chart__fill ranked-chart__fill--${item.tone ?? "neutral"}`}
              style={{ width: `${item.value === 0 ? 0 : Math.max(8, (item.value / ceiling) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
