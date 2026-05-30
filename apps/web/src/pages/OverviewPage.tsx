import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { DashboardStats, EligibilityState, OfficeLocation, Portal, PortalSourceSummary } from "@flathunter/shared";

import { Button } from "@/components/ui/button";

import { CompactMetricBreakdown } from "../components/CompactMetricBreakdown";
import { GeoOverviewMap } from "../components/GeoOverviewMap";
import { MetricScatter } from "../components/MetricScatter";
import { RankedMetricChart } from "../components/RankedMetricChart";
import { SectionHeader } from "../components/SectionHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { ToneBadge } from "../components/ToneBadge";
import { formatDistance, getEligibilityTone } from "../lib/geo";

type OverviewPageProps = {
  dashboardStats: DashboardStats | null;
  officeLocation: OfficeLocation | null;
  sources: PortalSourceSummary[];
  loading: boolean;
  onRetry: () => void;
};

function formatCurrency(value: number | null) {
  if (value == null) {
    return "n/a";
  }

  return `${Math.round(value)} EUR`;
}

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "Never";
  }

  const diffMs = new Date(value).getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }

  return formatter.format(Math.round(diffHours / 24), "day");
}

function getSourceStatusLabel(source: PortalSourceSummary) {
  if (!source.enabled) {
    return "Disabled";
  }

  if (!source.lastStatus) {
    return "Pending first run";
  }

  if (source.lastStatus === "failed") {
    return "Failed";
  }

  if (source.lastStatus === "partial") {
    return "Degraded";
  }

  return "Healthy";
}

function getGeoPrecisionLabel(value: DashboardStats["geoPrecisionBreakdown"][number]["precision"]) {
  if (value === "portal_coordinates") {
    return "Portal coordinates";
  }

  if (value === "district_centroid") {
    return "District centroid";
  }

  return "Unknown";
}

function toggleValue<T>(current: T | null, next: T) {
  return current === next ? null : next;
}

function buildListingsSearchParams(filters: {
  portal: Portal | null;
  eligibilityState: EligibilityState | null;
  district: string | null;
  selectedId: number | null;
}) {
  const searchParams = new URLSearchParams();

  if (filters.portal) {
    searchParams.set("portal", filters.portal);
  }

  if (filters.eligibilityState) {
    searchParams.set("eligibilityState", filters.eligibilityState);
  }

  if (filters.district) {
    searchParams.set("district", filters.district);
  }

  if (filters.selectedId) {
    searchParams.set("selectedId", String(filters.selectedId));
  }

  const query = searchParams.toString();
  return query ? `/listings?${query}` : "/listings";
}

function MetricTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <strong className="text-sm">{value}</strong>
    </div>
  );
}

export function OverviewPage({ dashboardStats, officeLocation, sources, loading, onRetry }: OverviewPageProps) {
  const navigate = useNavigate();
  const [activeDistrict, setActiveDistrict] = useState<string | null>(null);
  const [activePortal, setActivePortal] = useState<Portal | null>(null);
  const [activeEligibility, setActiveEligibility] = useState<EligibilityState | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<number | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [brushedPointIds, setBrushedPointIds] = useState<number[] | null>(null);

  const allPoints = dashboardStats?.rentSizePoints ?? [];
  const filteredPoints = useMemo(
    () =>
      allPoints.filter((point) => {
        if (activeDistrict && point.district !== activeDistrict) {
          return false;
        }

        if (activePortal && point.portal !== activePortal) {
          return false;
        }

        if (activeEligibility && point.eligibilityState !== activeEligibility) {
          return false;
        }

        if (brushedPointIds && !brushedPointIds.includes(point.id)) {
          return false;
        }

        return true;
      }),
    [activeDistrict, activeEligibility, activePortal, allPoints, brushedPointIds]
  );

  const selectedPoint = useMemo(
    () => filteredPoints.find((point) => point.id === selectedPointId) ?? allPoints.find((point) => point.id === selectedPointId) ?? null,
    [allPoints, filteredPoints, selectedPointId]
  );
  const selectedIds = brushedPointIds && brushedPointIds.length > 0 ? brushedPointIds : selectedPoint ? [selectedPoint.id] : [];
  const hasActiveOverviewFilters = Boolean(activeDistrict || activePortal || activeEligibility || (brushedPointIds && brushedPointIds.length > 0));
  const showListingPoints = Boolean(hasActiveOverviewFilters || selectedPointId);
  const filteredAverageRent =
    filteredPoints.filter((point) => point.rent != null).reduce((sum, point) => sum + (point.rent ?? 0), 0) /
      Math.max(filteredPoints.filter((point) => point.rent != null).length, 1) || null;
  const filteredAverageScore =
    filteredPoints.filter((point) => point.score != null).reduce((sum, point) => sum + (point.score ?? 0), 0) /
      Math.max(filteredPoints.filter((point) => point.score != null).length, 1) || null;

  useEffect(() => {
    if (!filteredPoints.some((point) => point.id === selectedPointId)) {
      setSelectedPointId(null);
    }

    if (!filteredPoints.some((point) => point.id === hoveredPointId)) {
      setHoveredPointId(null);
    }
  }, [filteredPoints, hoveredPointId, selectedPointId]);

  if (loading && !dashboardStats) {
    return (
      <div className="grid min-h-96 place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading overview" />
      </div>
    );
  }

  if (!dashboardStats) {
    return (
      <SurfaceCard subtitle="Overview data could not be loaded." title="Overview unavailable">
        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center">
          <span>Retry the dashboard request to load analytics and sources.</span>
          <Button onClick={() => onRetry()} variant="outline">
            Retry
          </Button>
        </div>
      </SurfaceCard>
    );
  }

  const populatedPortalBreakdown = dashboardStats.portalBreakdown.filter((item) => item.count > 0);
  const activeSources = sources.filter((source) => source.enabled);
  const healthySources = activeSources.filter((source) => source.lastStatus === "success").length;
  const degradedSources = activeSources.filter((source) => source.lastStatus === "partial").length;
  const failedSources = activeSources.filter((source) => source.lastStatus === "failed").length;
  const latestRunAt =
    [...activeSources]
      .map((source) => source.lastRunAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  const clearFocus = () => {
    setActiveEligibility(null);
    setActivePortal(null);
    setActiveDistrict(null);
    setBrushedPointIds(null);
    setSelectedPointId(null);
    setHoveredPointId(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() =>
                navigate(
                  buildListingsSearchParams({
                    portal: activePortal,
                    eligibilityState: activeEligibility,
                    district: activeDistrict,
                    selectedId: selectedPoint?.id ?? null
                  })
                )
              }
            >
              Open listings
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <MetricTile label="Total listings" value={dashboardStats.totals.listings} />
              <MetricTile label="Review queue" value={dashboardStats.totals.reviewQueue} />
              <MetricTile label="Match" value={dashboardStats.totals.match} />
              <MetricTile label="Contacted" value={dashboardStats.totals.contacted} />
            </div>
          </div>
        }
        subtitle="Operational view of listing triage, spatial spread, pricing bands and source freshness."
        title="Overview"
      />

      {hasActiveOverviewFilters || selectedPoint ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          {activeEligibility ? <ToneBadge tone="warning">Eligibility {activeEligibility}</ToneBadge> : null}
          {activePortal ? <ToneBadge tone="info">Portal {activePortal}</ToneBadge> : null}
          {activeDistrict ? <ToneBadge tone="success">District {activeDistrict}</ToneBadge> : null}
          {brushedPointIds?.length ? <ToneBadge>Brush {brushedPointIds.length}</ToneBadge> : null}
          {selectedPoint ? <ToneBadge>Selected #{selectedPoint.id}</ToneBadge> : null}
          <Button onClick={clearFocus} size="sm" variant="outline">
            Clear overview focus
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <SurfaceCard
          actions={officeLocation ? <ToneBadge tone="success">Office: {officeLocation.label}</ToneBadge> : <ToneBadge tone="warning">Office not set</ToneBadge>}
          className="lg:col-span-8"
          subtitle="District bubbles scale with listing count. Click a district to focus the whole overview."
          title="Berlin geo spread"
        >
          <GeoOverviewMap
            activeDistrict={activeDistrict}
            districts={dashboardStats.districtGeoSummary}
            hoveredPointId={hoveredPointId}
            listingPoints={filteredPoints}
            officeLocation={officeLocation}
            onDistrictSelect={(district) => {
              setActiveDistrict((current) => toggleValue(current, district));
              setBrushedPointIds(null);
            }}
            onPointHover={setHoveredPointId}
            onPointSelect={setSelectedPointId}
            selectedPointId={selectedPointId}
            showListingPoints={showListingPoints}
          />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-4" subtitle="Source health, office context and review pressure." title="Operations">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <MetricTile label="Healthy" value={healthySources} />
              <MetricTile label="Degraded" value={degradedSources} />
              <MetricTile label="Failed" value={failedSources} />
              <MetricTile label="Latest run" value={formatRelativeTime(latestRunAt)} />
            </div>

            <div className="grid gap-2">
              {activeSources.map((source) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3" key={source.portal}>
                  <div>
                    <strong className="text-sm">{source.portal}</strong>
                    <p className="text-xs text-muted-foreground">
                      {source.lastListingsUpserted ?? 0}/{source.lastListingsFound ?? 0} upserted
                    </p>
                  </div>
                  <ToneBadge tone={source.lastStatus === "failed" ? "danger" : source.lastStatus === "partial" ? "warning" : "success"}>
                    {getSourceStatusLabel(source)}
                  </ToneBadge>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>{officeLocation ? `Office anchored in ${officeLocation.label}` : "Office location not configured yet"}</span>
              <Button onClick={() => navigate("/sources")} size="sm" variant="outline">
                Open sources
              </Button>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-3" subtitle="Semantic classifier output split." title="Eligibility mix">
          <CompactMetricBreakdown
            activeLabel={activeEligibility}
            items={dashboardStats.eligibilityBreakdown.map((item) => ({
              label: item.eligibility,
              count: item.count,
              tone: item.eligibility === "MATCH" ? "success" : item.eligibility === "REJECT" ? "error" : "warning"
            }))}
            onSelect={(label) => {
              setActiveEligibility((current) => toggleValue(current, label as EligibilityState));
              setBrushedPointIds(null);
            }}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-3" subtitle="Manual workflow position." title="Status pipeline">
          <CompactMetricBreakdown
            items={dashboardStats.statusBreakdown.map((item) => ({
              label: item.status,
              count: item.count,
              tone: item.status === "CONTACTED" ? "success" : item.status === "REJECTED" || item.status === "BLACKLISTED" ? "error" : "neutral"
            }))}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-3" subtitle="Current geolocation precision." title="Geo precision">
          <CompactMetricBreakdown
            items={dashboardStats.geoPrecisionBreakdown.map((item) => ({
              label: getGeoPrecisionLabel(item.precision),
              count: item.count,
              tone: item.precision === "portal_coordinates" ? "success" : item.precision === "district_centroid" ? "warning" : "neutral"
            }))}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-3" subtitle="Classifier cache and analyst freshness." title="LLM health">
          <CompactMetricBreakdown
            items={[
              { label: "Classifier ready", count: dashboardStats.llmHealth.classifierReady, tone: "success" },
              { label: "Analyst missing", count: dashboardStats.llmHealth.analystMissing, tone: "warning" },
              { label: "Analyst stale", count: dashboardStats.llmHealth.analystStale, tone: "info" },
              { label: "Analyst error", count: dashboardStats.llmHealth.analystError, tone: "error" }
            ]}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-4" subtitle="Populated portals only. Click a row to focus the overview." title="Portal mix">
          <CompactMetricBreakdown
            activeLabel={activePortal}
            items={populatedPortalBreakdown.map((item) => ({ label: item.portal, count: item.count, tone: "neutral" }))}
            onSelect={(label) => {
              setActivePortal((current) => toggleValue(current, label as Portal));
              setBrushedPointIds(null);
            }}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-4" subtitle="Best available rent signal from current listings." title="Rent bands">
          <RankedMetricChart
            items={dashboardStats.rentBands
              .filter((band) => band.count > 0)
              .map((band) => ({ label: band.label, value: band.count, tone: "brand" }))}
          />
        </SurfaceCard>

        <SurfaceCard
          className="lg:col-span-4"
          subtitle={officeLocation ? "Distance buckets from configured office location." : "Configure office location to unlock this view."}
          title="Distance bands"
        >
          {officeLocation ? (
            <RankedMetricChart items={dashboardStats.distanceBands.map((band) => ({ label: band.label, value: band.count, tone: "success" }))} />
          ) : (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">Set an office location to compare homes by geographic distance.</p>
              <Button onClick={() => navigate("/settings#office-location")} variant="outline">
                Open office settings
              </Button>
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-6" subtitle="Rent plotted against office distance." title="Distance vs rent">
          <MetricScatter
            emptyLabel="Add office location and rent data to compare geographic distance against price."
            hoveredId={hoveredPointId}
            onBrushChange={setBrushedPointIds}
            onHover={setHoveredPointId}
            onSelect={setSelectedPointId}
            points={filteredPoints.map((point) => ({
              id: point.id,
              label: point.title,
              tone: getEligibilityTone(point.eligibilityState),
              x: point.distanceKm,
              y: point.rent,
              tooltip: `${point.title} • ${formatDistance(point.distanceKm)} • ${point.rent ? `${Math.round(point.rent)} EUR` : "Rent n/a"} • ${point.portal}`
            }))}
            selectedIds={selectedIds}
            xLabel="Closer to office"
            yLabel="Higher rent"
          />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-6" subtitle="Each point is a listing with size on X and rent on Y." title="Rent vs size">
          <MetricScatter
            emptyLabel="Not enough rent and size data to render the comparison."
            hoveredId={hoveredPointId}
            onBrushChange={setBrushedPointIds}
            onHover={setHoveredPointId}
            onSelect={setSelectedPointId}
            points={filteredPoints.map((point) => ({
              id: point.id,
              label: point.title,
              tone: getEligibilityTone(point.eligibilityState),
              x: point.sizeSqm,
              y: point.rent,
              tooltip: `${point.title} • ${point.sizeSqm ?? "n/a"} m² • ${point.rent ? `${Math.round(point.rent)} EUR` : "Rent n/a"} • ${point.portal}`
            }))}
            selectedIds={selectedIds}
            xLabel="Smaller to larger"
            yLabel="Lower to higher rent"
          />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-12" subtitle="Current selection summary." title="Inspector">
          {selectedPoint ? (
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <strong>{selectedPoint.title}</strong>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedPoint.portal} · {selectedPoint.district ?? "District n/a"} · {formatCurrency(selectedPoint.rent)}
                  {selectedPoint.sizeSqm != null ? ` · ${selectedPoint.sizeSqm} m²` : ""} · Score {selectedPoint.score ?? "n/a"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedPoint.llmAnalysisStatus === "ready"
                    ? "English analyst cached."
                    : `English analyst ${selectedPoint.llmAnalysisStatus}. Open the listing to refresh it on-demand.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ToneBadge tone={selectedPoint.eligibilityState === "MATCH" ? "success" : selectedPoint.eligibilityState === "REJECT" ? "danger" : "warning"}>
                  {selectedPoint.eligibilityState}
                </ToneBadge>
                <ToneBadge>{selectedPoint.userStatus}</ToneBadge>
                <Button
                  onClick={() =>
                    navigate(
                      buildListingsSearchParams({
                        portal: activePortal,
                        eligibilityState: activeEligibility,
                        district: activeDistrict,
                        selectedId: selectedPoint.id
                      })
                    )
                  }
                >
                  Open in listings
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <strong>{filteredPoints.length} listings in the current overview slice</strong>
                <p className="mt-1 text-sm text-muted-foreground">
                  Average rent {formatCurrency(Number.isFinite(filteredAverageRent) ? filteredAverageRent : null)} · Average score{" "}
                  {Number.isFinite(filteredAverageScore) ? filteredAverageScore?.toFixed(1) : "n/a"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">Hover or click a point in the linked views to inspect a single listing.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ToneBadge tone="info">{filteredPoints.length} active</ToneBadge>
                <Button
                  onClick={() =>
                    navigate(
                      buildListingsSearchParams({
                        portal: activePortal,
                        eligibilityState: activeEligibility,
                        district: activeDistrict,
                        selectedId: null
                      })
                    )
                  }
                  variant="outline"
                >
                  Open current slice
                </Button>
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
