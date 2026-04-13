import { Box, Text } from "gestalt";

type BreakdownTone = "success" | "warning" | "error" | "neutral" | "brand" | "info";

type BreakdownItem = {
  label: string;
  count: number;
  tone?: BreakdownTone;
};

type CompactMetricBreakdownProps = {
  items: BreakdownItem[];
  total: number;
  emptyLabel?: string;
  activeLabel?: string | null;
  onSelect?: (label: string) => void;
};

function percentage(count: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((count / total) * 100);
}

export function CompactMetricBreakdown({
  items,
  total,
  emptyLabel = "No data in the current slice.",
  activeLabel,
  onSelect
}: CompactMetricBreakdownProps) {
  if (items.length === 0 || total === 0) {
    return (
      <Box paddingY={4}>
        <Text color="subtle">{emptyLabel}</Text>
      </Box>
    );
  }

  return (
    <div className="compact-breakdown">
      <div className="compact-breakdown__segments" aria-hidden="true">
        {items.map((item) => (
          <span
            className={`compact-breakdown__segment compact-breakdown__segment--${item.tone ?? "neutral"}`}
            key={item.label}
            style={{ width: `${percentage(item.count, total)}%` }}
          />
        ))}
      </div>

      <div className="compact-breakdown__rows">
        {items.map((item) => (
          <button
            className={`compact-breakdown__row${activeLabel === item.label ? " is-active" : ""}${onSelect ? " is-clickable" : ""}`}
            key={item.label}
            onClick={() => onSelect?.(item.label)}
            type="button"
          >
            <div className="compact-breakdown__label-group">
              <span className={`compact-breakdown__dot compact-breakdown__dot--${item.tone ?? "neutral"}`} />
              <strong>{item.label}</strong>
            </div>
            <div className="compact-breakdown__values">
              <span>{item.count}</span>
              <span>{percentage(item.count, total)}%</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
