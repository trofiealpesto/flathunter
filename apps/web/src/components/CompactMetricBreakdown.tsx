import { cn } from "@/lib/utils";

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

const toneClasses: Record<BreakdownTone, { segment: string; dot: string }> = {
  brand: { segment: "bg-primary", dot: "bg-primary" },
  error: { segment: "bg-destructive", dot: "bg-destructive" },
  info: { segment: "bg-sky-500", dot: "bg-sky-500" },
  neutral: { segment: "bg-muted-foreground/40", dot: "bg-muted-foreground/50" },
  success: { segment: "bg-emerald-500", dot: "bg-emerald-500" },
  warning: { segment: "bg-amber-500", dot: "bg-amber-500" }
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
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {items.map((item) => (
          <span
            className={cn(toneClasses[item.tone ?? "neutral"].segment)}
            key={item.label}
            style={{ width: `${percentage(item.count, total)}%` }}
          />
        ))}
      </div>

      <div className="grid gap-1">
        {items.map((item) => {
          const isActive = activeLabel === item.label;
          const Comp = onSelect ? "button" : "div";

          return (
            <Comp
              className={cn(
                "flex min-h-8 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-sm",
                onSelect ? "transition-colors hover:bg-muted" : "",
                isActive ? "bg-muted" : ""
              )}
              key={item.label}
              onClick={onSelect ? () => onSelect(item.label) : undefined}
              type={onSelect ? "button" : undefined}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("size-2 rounded-full", toneClasses[item.tone ?? "neutral"].dot)} />
                <span className="truncate font-medium">{item.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                <span>{item.count}</span>
                <span>{percentage(item.count, total)}%</span>
              </span>
            </Comp>
          );
        })}
      </div>
    </div>
  );
}
