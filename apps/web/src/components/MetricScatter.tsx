import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Text } from "gestalt";

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

const width = 520;
const height = 240;
const padding = { top: 20, right: 20, bottom: 34, left: 44 };

type BrushPoint = {
  x: number;
  y: number;
};

function buildTicks(min: number, max: number, count = 4) {
  if (min === max) {
    return [min];
  }

  return Array.from({ length: count + 1 }, (_, index) => min + ((max - min) / count) * index);
}

function formatTick(value: number) {
  if (value >= 1000) {
    return `${Math.round(value)}`;
  }

  if (value >= 10) {
    return value.toFixed(0);
  }

  return value.toFixed(1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);
  const [brushStart, setBrushStart] = useState<BrushPoint | null>(null);
  const [brushCurrent, setBrushCurrent] = useState<BrushPoint | null>(null);
  const validPoints = useMemo(() => points.filter((point) => point.x != null && point.y != null), [points]);

  if (validPoints.length === 0) {
    return (
      <Box paddingY={4}>
        <Text color="subtle">{emptyLabel}</Text>
      </Box>
    );
  }

  const xValues = validPoints.map((point) => point.x as number);
  const yValues = validPoints.map((point) => point.y as number);
  const maxX = Math.max(...xValues);
  const minX = Math.min(...xValues);
  const maxY = Math.max(...yValues);
  const minY = Math.min(...yValues);

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const projectX = (value: number) => padding.left + ((value - minX) / Math.max(maxX - minX, 1)) * chartWidth;
  const projectY = (value: number) => height - padding.bottom - ((value - minY) / Math.max(maxY - minY, 1)) * chartHeight;
  const ticksX = buildTicks(minX, maxX);
  const ticksY = buildTicks(minY, maxY);
  const hasSelection = selectedIds.length > 0;

  function readSvgPoint(event: ReactPointerEvent<SVGSVGElement>): BrushPoint | null {
    const svg = svgRef.current;

    if (!svg) {
      return null;
    }

    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;

    return {
      x: clamp((event.clientX - rect.left) * scaleX, padding.left, width - padding.right),
      y: clamp((event.clientY - rect.top) * scaleY, padding.top, height - padding.bottom)
    };
  }

  function clearBrushIfBackground(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.target === svgRef.current) {
      onBrushChange?.(null);
    }
  }

  function finishBrush() {
    if (!brushStart || !brushCurrent) {
      setBrushStart(null);
      setBrushCurrent(null);
      return;
    }

    const minBrushX = Math.min(brushStart.x, brushCurrent.x);
    const maxBrushX = Math.max(brushStart.x, brushCurrent.x);
    const minBrushY = Math.min(brushStart.y, brushCurrent.y);
    const maxBrushY = Math.max(brushStart.y, brushCurrent.y);
    const dragDistance = Math.abs(brushStart.x - brushCurrent.x) + Math.abs(brushStart.y - brushCurrent.y);

    if (dragDistance >= 12) {
      const brushedIds = validPoints
        .filter((point) => {
          const x = projectX(point.x as number);
          const y = projectY(point.y as number);
          return x >= minBrushX && x <= maxBrushX && y >= minBrushY && y <= maxBrushY;
        })
        .map((point) => point.id);

      onBrushChange?.(brushedIds.length > 0 ? brushedIds : null);
    }

    setBrushStart(null);
    setBrushCurrent(null);
  }

  return (
    <div className="scatter-plot">
      <div className="scatter-plot__canvas">
        <svg
          ref={svgRef}
          aria-label={`${yLabel} versus ${xLabel} scatter plot`}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
          onPointerDown={(event) => {
            clearBrushIfBackground(event);
            const point = readSvgPoint(event);

            if (point) {
              setBrushStart(point);
              setBrushCurrent(point);
            }
          }}
          onPointerLeave={() => {
            onHover?.(null);
            setTooltip(null);
          }}
          onPointerMove={(event) => {
            if (brushStart) {
              const point = readSvgPoint(event);

              if (point) {
                setBrushCurrent(point);
              }
            }
          }}
          onPointerUp={() => finishBrush()}
        >
          {ticksY.map((tick) => {
            const y = projectY(tick);
            return (
              <g key={`y-${tick}`}>
                <line className="scatter-plot__grid" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
                <text className="scatter-plot__tick-label" textAnchor="end" x={padding.left - 8} y={y + 4}>
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}

          {ticksX.map((tick) => {
            const x = projectX(tick);
            return (
              <g key={`x-${tick}`}>
                <line className="scatter-plot__grid" x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} />
                <text className="scatter-plot__tick-label" textAnchor="middle" x={x} y={height - padding.bottom + 18}>
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}

          <line className="scatter-plot__axis" x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} />
          <line
            className="scatter-plot__axis"
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom}
            y2={height - padding.bottom}
          />

          {validPoints.map((point) => {
            const isHovered = hoveredId === point.id;
            const isSelected = selectedIds.includes(point.id);
            const isDimmed = hasSelection && !isSelected && !isHovered;

            return (
              <circle
                className={`scatter-plot__point${isSelected ? " is-selected" : ""}${isHovered ? " is-hovered" : ""}`}
                cx={projectX(point.x as number)}
                cy={projectY(point.y as number)}
                fill={point.tone}
                key={point.id}
                opacity={isDimmed ? 0.22 : 0.92}
                r={isSelected || isHovered ? 6.5 : 5}
                stroke={isSelected || isHovered ? "#111111" : "rgba(17, 17, 17, 0.18)"}
                strokeWidth={isSelected || isHovered ? 2 : 1}
                onClick={() => onSelect?.(point.id)}
                onPointerEnter={(event) => {
                  onHover?.(point.id);
                  setTooltip({
                    x: event.clientX,
                    y: event.clientY,
                    content: point.tooltip
                  });
                }}
                onPointerLeave={() => {
                  onHover?.(null);
                  setTooltip(null);
                }}
                onPointerMove={(event) =>
                  setTooltip({
                    x: event.clientX,
                    y: event.clientY,
                    content: point.tooltip
                  })
                }
              />
            );
          })}

          {brushStart && brushCurrent ? (
            <rect
              className="scatter-plot__brush"
              height={Math.abs(brushCurrent.y - brushStart.y)}
              width={Math.abs(brushCurrent.x - brushStart.x)}
              x={Math.min(brushStart.x, brushCurrent.x)}
              y={Math.min(brushStart.y, brushCurrent.y)}
            />
          ) : null}
        </svg>

        {tooltip ? (
          <div className="scatter-plot__tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 24 }}>
            {tooltip.content}
          </div>
        ) : null}
      </div>

      <div className="scatter-plot__legend scatter-plot__legend--axes">
        <span>{xLabel}</span>
        <span>{yLabel}</span>
      </div>
    </div>
  );
}
