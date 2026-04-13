import { Badge, Button, Flex, Spinner, Text } from "gestalt";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { DashboardStats, EligibilityState, OfficeLocation, Portal, PortalSourceSummary } from "@flathunter/shared";

import { CompactMetricBreakdown } from "../components/CompactMetricBreakdown";
import { GeoOverviewMap } from "../components/GeoOverviewMap";
import { MetricScatter } from "../components/MetricScatter";
import { RankedMetricChart } from "../components/RankedMetricChart";
import { SectionHeader } from "../components/SectionHeader";
import { SurfaceCard } from "../components/SurfaceCard";
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

function buildListingsSearchParams(
  filters: {
    portal: Portal | null;
    eligibilityState: EligibilityState | null;
    district: string | null;
    selectedId: number | null;
  }
) {
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
      Math.max(
        filteredPoints.filter((point) => point.rent != null).length,
        1
      ) || null;
  const filteredAverageScore =
    filteredPoints.filter((point) => point.score != null).reduce((sum, point) => sum + (point.score ?? 0), 0) /
      Math.max(
        filteredPoints.filter((point) => point.score != null).length,
        1
      ) || null;

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
      <div className="page-loading">
        <Spinner accessibilityLabel="Loading overview" show />
      </div>
    );
  }

  if (!dashboardStats) {
    return (
      <SurfaceCard subtitle="Overview data could not be loaded." title="Overview unavailable">
        <Flex alignItems="center" gap={3}>
          <Text>Retry the dashboard request to load analytics and sources.</Text>
          <Button color="gray" text="Retry" onClick={() => onRetry()} />
        </Flex>
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

  return (
    <div className="page page--overview">
      <SectionHeader
        actions={
          <div className="page-section-header__cluster">
            <Button
              color="dark"
              size="lg"
              text="Open listings"
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
            />
            <div className="page-header-metrics">
              {[
                { label: "Total listings", value: dashboardStats.totals.listings },
                { label: "Review queue", value: dashboardStats.totals.reviewQueue },
                { label: "Match", value: dashboardStats.totals.match },
                { label: "Contacted", value: dashboardStats.totals.contacted }
              ].map((item) => (
                <div className="page-header-metric" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        }
        subtitle="Operational view of listing triage, spatial spread, pricing bands and source freshness. Geo analysis remains district-first and now links directly into the current overview slice."
        title="Overview"
      />

      {hasActiveOverviewFilters || selectedPoint ? (
        <div className="overview-filter-bar">
          <Flex alignItems="center" gap={2} wrap>
            {activeEligibility ? <Badge text={`Eligibility ${activeEligibility}`} type="warning" /> : null}
            {activePortal ? <Badge text={`Portal ${activePortal}`} type="info" /> : null}
            {activeDistrict ? <Badge text={`District ${activeDistrict}`} type="success" /> : null}
            {brushedPointIds?.length ? <Badge text={`Brush ${brushedPointIds.length}`} type="neutral" /> : null}
            {selectedPoint ? <Badge text={`Selected #${selectedPoint.id}`} type="neutral" /> : null}
            <Button
              color="gray"
              size="sm"
              text="Clear overview focus"
              onClick={() => {
                setActiveEligibility(null);
                setActivePortal(null);
                setActiveDistrict(null);
                setBrushedPointIds(null);
                setSelectedPointId(null);
                setHoveredPointId(null);
              }}
            />
          </Flex>
        </div>
      ) : null}

      <div className="overview-grid overview-grid--packed">
        <SurfaceCard
          actions={
            officeLocation ? <Badge text={`Office: ${officeLocation.label}`} type="success" /> : <Badge text="Office not set" type="warning" />
          }
          className="overview-card overview-card--span-8 overview-card--hero"
          subtitle="District bubbles scale with listing count and expose rent, score and average distance. Click a district to focus the whole overview; linked listing points appear when a slice is active."
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

        <SurfaceCard
          className="overview-card overview-card--span-4 overview-card--ops"
          subtitle="Snapshot of source health, office context and current review pressure."
          title="Operations"
        >
          <div className="overview-ops">
            <div className="overview-ops__datapoints">
              {[
                { label: "Healthy", value: healthySources },
                { label: "Degraded", value: degradedSources },
                { label: "Failed", value: failedSources },
                { label: "Latest run", value: formatRelativeTime(latestRunAt) }
              ].map((item) => (
                <div className="overview-ops__stat" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            <div className="overview-ops__sources">
              {activeSources.map((source) => (
                <div className="overview-ops__source" key={source.portal}>
                  <div>
                    <strong>{source.portal}</strong>
                    <p>
                      {source.lastListingsUpserted ?? 0}/{source.lastListingsFound ?? 0} upserted
                    </p>
                  </div>
                  <Badge
                    text={getSourceStatusLabel(source)}
                    type={source.lastStatus === "failed" ? "error" : source.lastStatus === "partial" ? "warning" : "success"}
                  />
                </div>
              ))}
            </div>

            <div className="overview-ops__footer">
              <span>{officeLocation ? `Office anchored in ${officeLocation.label}` : "Office location not configured yet"}</span>
              <Button color="gray" size="md" text="Open sources" onClick={() => navigate("/sources")} />
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-3 overview-card--compact"
          subtitle="Semantic classifier output split."
          title="Eligibility mix"
        >
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

        <SurfaceCard
          className="overview-card overview-card--span-3 overview-card--compact"
          subtitle="Where listings are in the manual workflow."
          title="Status pipeline"
        >
          <CompactMetricBreakdown
            items={dashboardStats.statusBreakdown.map((item) => ({
              label: item.status,
              count: item.count,
              tone: item.status === "CONTACTED" ? "success" : item.status === "REJECTED" || item.status === "BLACKLISTED" ? "error" : "neutral"
            }))}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-3 overview-card--compact"
          subtitle="How precise listing geolocation currently is."
          title="Geo precision"
        >
          <CompactMetricBreakdown
            items={dashboardStats.geoPrecisionBreakdown.map((item) => ({
              label: getGeoPrecisionLabel(item.precision),
              count: item.count,
              tone:
                item.precision === "portal_coordinates"
                  ? "success"
                  : item.precision === "district_centroid"
                    ? "warning"
                    : "neutral"
            }))}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-3 overview-card--compact"
          subtitle="Classifier cache and analyst freshness across the current dataset."
          title="LLM health"
        >
          <CompactMetricBreakdown
            items={[
              {
                label: "Classifier ready",
                count: dashboardStats.llmHealth.classifierReady,
                tone: "success"
              },
              {
                label: "Analyst missing",
                count: dashboardStats.llmHealth.analystMissing,
                tone: "warning"
              },
              {
                label: "Analyst stale",
                count: dashboardStats.llmHealth.analystStale,
                tone: "info"
              },
              {
                label: "Analyst error",
                count: dashboardStats.llmHealth.analystError,
                tone: "error"
              }
            ]}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-4"
          subtitle="Populated portals only. Click a row to focus the overview."
          title="Portal mix"
        >
          <CompactMetricBreakdown
            activeLabel={activePortal}
            items={populatedPortalBreakdown.map((item) => ({
              label: item.portal,
              count: item.count,
              tone: "neutral"
            }))}
            onSelect={(label) => {
              setActivePortal((current) => toggleValue(current, label as Portal));
              setBrushedPointIds(null);
            }}
            total={dashboardStats.totals.listings}
          />
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-4"
          subtitle="Distribution of the best available rent signal from current listings."
          title="Rent bands"
        >
          <RankedMetricChart
            items={dashboardStats.rentBands
              .filter((band) => band.count > 0)
              .map((band) => ({
                label: band.label,
                value: band.count,
                tone: "brand"
              }))}
          />
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-4"
          subtitle={officeLocation ? "Distance buckets from the configured office location." : "Configure the office location to unlock this view."}
          title="Distance bands"
        >
          {officeLocation ? (
            <RankedMetricChart
              items={dashboardStats.distanceBands.map((band) => ({
                label: band.label,
                value: band.count,
                tone: "success"
              }))}
            />
          ) : (
            <div className="overview-card__callout">
              <Text color="subtle">Set an office location to compare homes by geographic distance across the dashboard and listing detail.</Text>
              <Button color="gray" text="Open office settings" onClick={() => navigate("/settings#office-location")} />
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-6 overview-card--scatter"
          subtitle="Rent plotted against office distance for listings with both data points. Drag to brush a slice; click a point to inspect it."
          title="Distance vs rent"
        >
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
              tooltip: `${point.title} • ${formatDistance(point.distanceKm)} • ${
                point.rent ? `${Math.round(point.rent)} EUR` : "Rent n/a"
              } • ${point.portal}`
            }))}
            selectedIds={selectedIds}
            xLabel="Closer to office"
            yLabel="Higher rent"
          />
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-6 overview-card--scatter"
          subtitle="Each point is a listing with size on X and rent on Y."
          title="Rent vs size"
        >
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
              tooltip: `${point.title} • ${point.sizeSqm ?? "n/a"} m² • ${
                point.rent ? `${Math.round(point.rent)} EUR` : "Rent n/a"
              } • ${point.portal}`
            }))}
            selectedIds={selectedIds}
            xLabel="Smaller to larger"
            yLabel="Lower to higher rent"
          />
        </SurfaceCard>

        <SurfaceCard
          className="overview-card overview-card--span-12"
          subtitle="Current selection summary. Single-point selection opens directly into the listings workspace."
          title="Inspector"
        >
          {selectedPoint ? (
            <div className="overview-inspector">
              <div className="overview-inspector__copy">
                <strong>{selectedPoint.title}</strong>
                <p>
                  {selectedPoint.portal} · {selectedPoint.district ?? "District n/a"} · {formatCurrency(selectedPoint.rent)}
                  {selectedPoint.sizeSqm != null ? ` · ${selectedPoint.sizeSqm} m²` : ""} · Score {selectedPoint.score ?? "n/a"}
                </p>
                <p>
                  {selectedPoint.llmAnalysisStatus === "ready"
                    ? "English analyst cached."
                    : `English analyst ${selectedPoint.llmAnalysisStatus}. Open the listing to refresh it on-demand.`}
                </p>
              </div>
              <div className="overview-inspector__meta">
                <Badge text={selectedPoint.eligibilityState} type={selectedPoint.eligibilityState === "MATCH" ? "success" : selectedPoint.eligibilityState === "REJECT" ? "error" : "warning"} />
                <Badge text={selectedPoint.userStatus} type="neutral" />
                <Button
                  color="dark"
                  text="Open in listings"
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
                />
              </div>
            </div>
          ) : (
            <div className="overview-inspector">
              <div className="overview-inspector__copy">
                <strong>{filteredPoints.length} listings in the current overview slice</strong>
                <p>
                  Average rent {formatCurrency(Number.isFinite(filteredAverageRent) ? filteredAverageRent : null)} · Average score{" "}
                  {Number.isFinite(filteredAverageScore) ? filteredAverageScore?.toFixed(1) : "n/a"}
                </p>
                <p>
                  Hover or click a point in the linked views to inspect a single listing. Brush one of the scatter plots to narrow the active slice locally.
                </p>
              </div>
              <div className="overview-inspector__meta">
                <Badge text={`${filteredPoints.length} active`} type="info" />
                <Button
                  color="gray"
                  text="Open current slice"
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
                />
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
