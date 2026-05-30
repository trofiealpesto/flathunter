import type { StatsSummary } from "../lib/api";
import { SurfaceCard } from "./SurfaceCard";

type StatsOverviewProps = {
  stats: StatsSummary | null;
};

export function StatsOverview({ stats }: StatsOverviewProps) {
  return (
    <SurfaceCard subtitle="Live aggregate from the protected API." title="Snapshot">
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Total listings", value: stats.totals.listings },
            { label: "Matches", value: stats.totals.match },
            { label: "Unsure", value: stats.totals.unsure },
            { label: "Rejected", value: stats.totals.reject }
          ].map((item) => (
            <div className="rounded-lg border bg-muted/30 p-3" key={item.label}>
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <strong className="block text-xl">{item.value}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">No stats yet.</div>
      )}
    </SurfaceCard>
  );
}
