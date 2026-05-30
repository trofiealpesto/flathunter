import type { DashboardStats } from "@flathunter/shared";

import { getEligibilityTone } from "../lib/geo";
import { MetricScatter } from "./MetricScatter";

type RentSizeScatterProps = {
  points: DashboardStats["rentSizePoints"];
};

export function RentSizeScatter({ points }: RentSizeScatterProps) {
  return (
    <MetricScatter
      emptyLabel="Not enough rent and size data to render the scatter plot."
      points={points.map((point) => ({
        id: point.id,
        label: point.title,
        tone: getEligibilityTone(point.eligibilityState),
        tooltip: `${point.title} • ${point.rent ? Math.round(point.rent) : "n/a"} EUR • ${point.sizeSqm ?? "n/a"} m²`,
        x: point.sizeSqm,
        y: point.rent
      }))}
      xLabel="Size"
      yLabel="Rent"
    />
  );
}
