import { useEffect, useState } from "react";

import type { DashboardStats, OfficeLocation } from "@flathunter/shared";

import { Map, MapControls, MapMarker, MarkerContent, MarkerTooltip, useMap } from "@/components/ui/map";
import { cn } from "@/lib/utils";

import { ToneBadge } from "./ToneBadge";
import { getEligibilityTone } from "../lib/geo";

type GeoOverviewMapProps = {
  officeLocation: OfficeLocation | null;
  districts: DashboardStats["districtGeoSummary"];
  listingPoints: DashboardStats["rentSizePoints"];
  showListingPoints: boolean;
  activeDistrict: string | null;
  selectedPointId: number | null;
  hoveredPointId: number | null;
  onDistrictSelect: (district: string) => void;
  onPointHover: (id: number | null) => void;
  onPointSelect: (id: number) => void;
};

const berlinCenter: [number, number] = [13.405, 52.52];
const initialZoom = 11;
const listingPointZoomThreshold = 11.8;
const districtFocusZoom = 12.6;

function markerRadius(count: number) {
  return Math.max(8, Math.min(22, 6 + count * 1.5));
}

function MapSizeSync({ center }: { center: [number, number] }) {
  const { isLoaded, map } = useMap();

  useEffect(() => {
    if (!map) {
      return;
    }

    const currentMap = map;
    const frame = window.requestAnimationFrame(() => {
      currentMap.resize();
    });

    function handleResize() {
      currentMap.resize();
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !isLoaded) {
      return;
    }

    map.easeTo({ center, duration: 0 });
  }, [center[0], center[1], isLoaded, map]);

  return null;
}

function DistrictMarker({
  district,
  isActive,
  onDistrictSelect
}: {
  district: DashboardStats["districtGeoSummary"][number];
  isActive: boolean;
  onDistrictSelect: (district: string) => void;
}) {
  const { map } = useMap();
  const radius = markerRadius(district.count);

  return (
    <MapMarker
      key={district.district}
      latitude={district.latitude}
      longitude={district.longitude}
      onClick={() => {
        onDistrictSelect(district.district);
        map?.flyTo({
          center: [district.longitude, district.latitude],
          duration: 1200,
          essential: true,
          zoom: districtFocusZoom
        });
      }}
    >
      <MarkerContent>
        <button
          aria-label={`${district.district} district marker`}
          className={cn(
            "block cursor-pointer appearance-none rounded-full border p-0 shadow-md transition-transform duration-150",
            isActive ? "scale-110 ring-2 ring-background" : "hover:scale-105"
          )}
          style={{
            backgroundColor: isActive ? "#111111" : "#262626",
            borderColor: isActive ? "#111111" : "#5f5f5f",
            height: radius * 2,
            opacity: isActive ? 0.88 : 0.64,
            width: radius * 2
          }}
          type="button"
        />
      </MarkerContent>
      <MarkerTooltip offset={Math.max(18, radius + 8)}>
        <div className="grid gap-0.5 text-xs">
          <strong>{district.district}</strong>
          <span>{district.count} listings</span>
          <span>{district.averageWarmRent ? `${Math.round(district.averageWarmRent)} EUR avg` : "Rent n/a"}</span>
          <span>{district.averageScore ? `${district.averageScore.toFixed(1)} avg score` : "Score n/a"}</span>
          <span>Click to zoom into listings</span>
        </div>
      </MarkerTooltip>
    </MapMarker>
  );
}

export function GeoOverviewMap({
  officeLocation,
  districts,
  listingPoints,
  showListingPoints,
  activeDistrict,
  selectedPointId,
  hoveredPointId,
  onDistrictSelect,
  onPointHover,
  onPointSelect
}: GeoOverviewMapProps) {
  const [currentZoom, setCurrentZoom] = useState(initialZoom);
  const center: [number, number] = officeLocation
    ? [officeLocation.longitude, officeLocation.latitude]
    : districts[0]
      ? [districts[0].longitude, districts[0].latitude]
      : berlinCenter;
  const showListingMarkers = currentZoom >= listingPointZoomThreshold;

  return (
    <div className="relative h-[420px] overflow-hidden rounded-lg border bg-muted">
      <Map
        center={center}
        className="h-full w-full"
        dragRotate={false}
        onViewportChange={(viewport) => setCurrentZoom(viewport.zoom)}
        pitchWithRotate={false}
        scrollZoom={false}
        zoom={initialZoom}
      >
        <MapSizeSync center={center} />
        <MapControls position="bottom-right" showCompass showFullscreen />

        {!showListingMarkers
          ? districts.map((district) => (
              <DistrictMarker
                district={district}
                isActive={activeDistrict === district.district}
                key={district.district}
                onDistrictSelect={onDistrictSelect}
              />
            ))
          : null}

        {showListingMarkers
          ? listingPoints
              .filter((point) => point.latitude != null && point.longitude != null)
              .map((point) => {
                const isSelected = selectedPointId === point.id;
                const isHovered = hoveredPointId === point.id;

                return (
                  <MapMarker
                    key={`point-${point.id}`}
                    latitude={point.latitude as number}
                    longitude={point.longitude as number}
                    onClick={() => onPointSelect(point.id)}
                    onMouseEnter={() => onPointHover(point.id)}
                    onMouseLeave={() => onPointHover(null)}
                  >
                    <MarkerContent>
                      <button
                        aria-label={`${point.title} listing marker`}
                        className={cn(
                          "block cursor-pointer appearance-none rounded-full border border-neutral-950 p-0 shadow-sm transition-transform duration-150",
                          isSelected || isHovered ? "scale-110 ring-2 ring-background" : "hover:scale-110"
                        )}
                        style={{
                          backgroundColor: getEligibilityTone(point.eligibilityState),
                          height: isSelected || isHovered ? 14 : 10,
                          width: isSelected || isHovered ? 14 : 10
                        }}
                        type="button"
                      />
                    </MarkerContent>
                    <MarkerTooltip offset={18}>
                      <div className="grid gap-0.5 text-xs">
                        <strong>{point.title}</strong>
                        <span>
                          {point.portal} · {point.district ?? "District n/a"}
                        </span>
                        <span>{point.rent != null ? `${Math.round(point.rent)} EUR` : "Rent n/a"}</span>
                        <span>{point.score != null ? `Score ${point.score}` : "Score n/a"}</span>
                      </div>
                    </MarkerTooltip>
                  </MapMarker>
                );
              })
          : null}

        {officeLocation ? (
          <MapMarker
            latitude={officeLocation.latitude}
            longitude={officeLocation.longitude}
          >
            <MarkerContent>
              <span
                aria-label={`${officeLocation.label} office marker`}
                className="block size-[18px] rounded-full border-2 border-neutral-950 bg-emerald-600 shadow-md ring-2 ring-background"
              />
            </MarkerContent>
            <MarkerTooltip offset={20}>
              <div className="grid gap-0.5 text-xs">
                <strong>{officeLocation.label}</strong>
                <span>{officeLocation.address}</span>
              </div>
            </MarkerTooltip>
          </MapMarker>
        ) : null}
      </Map>

      <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/90 p-2 shadow-sm backdrop-blur">
        <ToneBadge tone="info">{showListingMarkers ? "Listing detail map" : "District-first map"}</ToneBadge>
        {officeLocation ? <ToneBadge tone="success">Office: {officeLocation.label}</ToneBadge> : null}
        {activeDistrict ? <ToneBadge tone="warning">District {activeDistrict}</ToneBadge> : null}
        {showListingMarkers ? (
          <ToneBadge>{listingPoints.length} linked points</ToneBadge>
        ) : (
          <ToneBadge>{showListingPoints ? "Zoom for filtered points" : "Zoom for listing points"}</ToneBadge>
        )}
        {!officeLocation ? (
          <span className="basis-full text-xs text-muted-foreground">
            Add an office location in Settings to unlock distance bands and per-listing travel context.
          </span>
        ) : null}
      </div>
    </div>
  );
}
