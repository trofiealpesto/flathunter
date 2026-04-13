import { useEffect } from "react";
import { Badge, Box, Flex, Text } from "gestalt";
import { CircleMarker, MapContainer, TileLayer, Tooltip as LeafletTooltip, useMap } from "react-leaflet";

import type { DashboardStats, OfficeLocation } from "@flathunter/shared";

import { formatDistance, getEligibilityTone } from "../lib/geo";

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

const berlinCenter: [number, number] = [52.52, 13.405];

function markerRadius(count: number) {
  return Math.max(8, Math.min(22, 6 + count * 1.5));
}

function MapSizeSync() {
  const map = useMap();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize();
    });

    function handleResize() {
      map.invalidateSize();
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, [map]);

  return null;
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
  const center: [number, number] = officeLocation
    ? [officeLocation.latitude, officeLocation.longitude]
    : districts[0]
      ? [districts[0].latitude, districts[0].longitude]
      : berlinCenter;

  return (
    <div className="geo-map">
      <MapContainer center={center} className="geo-map__canvas" scrollWheelZoom={false} zoom={11}>
        <MapSizeSync />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {districts.map((district) => {
          const isActive = activeDistrict === district.district;

          return (
            <CircleMarker
              center={[district.latitude, district.longitude]}
              color={isActive ? "#111111" : "#5f5f5f"}
              eventHandlers={{
                click: () => onDistrictSelect(district.district)
              }}
              fillColor={isActive ? "#111111" : "#e60023"}
              fillOpacity={isActive ? 0.88 : 0.72}
              key={district.district}
              radius={markerRadius(district.count)}
              weight={isActive ? 2.5 : 1.5}
            >
              <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                <div className="geo-map__tooltip">
                  <strong>{district.district}</strong>
                  <span>{district.count} listings</span>
                  <span>{district.averageWarmRent ? `${Math.round(district.averageWarmRent)} EUR avg` : "Rent n/a"}</span>
                  <span>{district.averageScore ? `${district.averageScore.toFixed(1)} avg score` : "Score n/a"}</span>
                  {officeLocation ? <span>{formatDistance(district.averageDistanceKm)} avg distance</span> : null}
                </div>
              </LeafletTooltip>
            </CircleMarker>
          );
        })}

        {showListingPoints
          ? listingPoints
              .filter((point) => point.latitude != null && point.longitude != null)
              .map((point) => {
                const isSelected = selectedPointId === point.id;
                const isHovered = hoveredPointId === point.id;

                return (
                  <CircleMarker
                    center={[point.latitude as number, point.longitude as number]}
                    color="#111111"
                    eventHandlers={{
                      click: () => onPointSelect(point.id),
                      mouseout: () => onPointHover(null),
                      mouseover: () => onPointHover(point.id)
                    }}
                    fillColor={getEligibilityTone(point.eligibilityState)}
                    fillOpacity={0.92}
                    key={`point-${point.id}`}
                    radius={isSelected || isHovered ? 7 : 5}
                    weight={isSelected || isHovered ? 2 : 1}
                  >
                    <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                      <div className="geo-map__tooltip">
                        <strong>{point.title}</strong>
                        <span>
                          {point.portal} · {point.district ?? "District n/a"}
                        </span>
                        <span>{point.rent != null ? `${Math.round(point.rent)} EUR` : "Rent n/a"}</span>
                        <span>{point.score != null ? `Score ${point.score}` : "Score n/a"}</span>
                      </div>
                    </LeafletTooltip>
                  </CircleMarker>
                );
              })
          : null}

        {officeLocation ? (
          <CircleMarker
            center={[officeLocation.latitude, officeLocation.longitude]}
            color="#111111"
            fillColor="#1f8f4e"
            fillOpacity={1}
            radius={9}
            weight={2}
          >
            <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
              <div className="geo-map__tooltip">
                <strong>{officeLocation.label}</strong>
                <span>{officeLocation.address}</span>
              </div>
            </LeafletTooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>

      <div className="geo-map__overlay">
        <Flex alignItems="center" gap={2} wrap>
          <Badge text="District-first map" type="info" />
          {officeLocation ? <Badge text={`Office: ${officeLocation.label}`} type="success" /> : null}
          {activeDistrict ? <Badge text={`District ${activeDistrict}`} type="warning" /> : null}
          {showListingPoints ? <Badge text={`${listingPoints.length} linked points`} type="neutral" /> : null}
        </Flex>

        {!officeLocation ? (
          <Box marginTop={2}>
            <Text color="subtle" size="100">
              Add an office location in Settings to unlock distance bands and per-listing travel context.
            </Text>
          </Box>
        ) : null}
      </div>
    </div>
  );
}
