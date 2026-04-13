import { Box, Text } from "gestalt";

import type { DashboardStats } from "@flathunter/shared";

import { getEligibilityTone } from "../lib/geo";

type RentSizeScatterProps = {
  points: DashboardStats["rentSizePoints"];
};

const width = 560;
const height = 220;
const padding = 24;

export function RentSizeScatter({ points }: RentSizeScatterProps) {
  const validPoints = points.filter((point) => point.rent != null && point.sizeSqm != null);

  if (validPoints.length === 0) {
    return (
      <Box paddingY={6}>
        <Text color="subtle">Not enough rent and size data to render the scatter plot.</Text>
      </Box>
    );
  }

  const rentValues = validPoints.map((point) => point.rent as number);
  const sizeValues = validPoints.map((point) => point.sizeSqm as number);
  const maxRent = Math.max(...rentValues);
  const minRent = Math.min(...rentValues);
  const maxSize = Math.max(...sizeValues);
  const minSize = Math.min(...sizeValues);

  const projectX = (size: number) =>
    padding + ((size - minSize) / Math.max(maxSize - minSize, 1)) * (width - padding * 2);
  const projectY = (rent: number) =>
    height - padding - ((rent - minRent) / Math.max(maxRent - minRent, 1)) * (height - padding * 2);

  return (
    <div className="scatter-plot">
      <svg viewBox={`0 0 ${width} ${height}`} aria-label="Rent versus size scatter plot" role="img">
        <line className="scatter-plot__axis" x1={padding} x2={padding} y1={padding} y2={height - padding} />
        <line className="scatter-plot__axis" x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />

        {validPoints.map((point) => (
          <g key={point.id}>
            <circle
              className="scatter-plot__point"
              cx={projectX(point.sizeSqm as number)}
              cy={projectY(point.rent as number)}
              fill={getEligibilityTone(point.eligibilityState)}
              r={5}
            >
              <title>{`${point.title} • ${Math.round(point.rent as number)} EUR • ${point.sizeSqm} m²`}</title>
            </circle>
          </g>
        ))}
      </svg>

      <div className="scatter-plot__legend">
        <span>Smaller</span>
        <span>Lower rent</span>
        <span>Larger</span>
        <span>Higher rent</span>
      </div>
    </div>
  );
}
