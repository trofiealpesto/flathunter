import { useEffect, useState } from "react";
import { Badge, Button, Flex, IconButton, Text } from "gestalt";
import { createPortal } from "react-dom";

import type { EligibilityState, ListingDetail as ListingDetailRecord, LlmAnalysisStatus, UserStatus } from "@flathunter/shared";

import { formatDistance, getGeoSourceLabel } from "../lib/geo";
import { getListingPrimaryAction } from "../lib/listingDetail";
import { SurfaceCard } from "./SurfaceCard";

type ListingDetailProps = {
  listing: ListingDetailRecord | null;
  loading: boolean;
  onStatusChange: (status: UserStatus) => void;
  onRefreshLlmAnalysis: (id: number) => Promise<ListingDetailRecord>;
  isFixtureMode: boolean;
  fallbackSearchUrl: string | null;
  hasOfficeLocation: boolean;
  onOpenOfficeSettings: () => void;
};

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function getEligibilityBadgeType(state: EligibilityState) {
  if (state === "MATCH") {
    return "success";
  }

  if (state === "REJECT") {
    return "error";
  }

  return "warning";
}

function formatListedRent(listing: ListingDetailRecord) {
  if (listing.rentWarm != null) {
    return `${listing.rentWarm} EUR warm`;
  }

  if (listing.rentCold != null) {
    return `${listing.rentCold} EUR cold`;
  }

  return "Price n/a";
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function formatAnalystTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function getPayloadMedia(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      coverImageUrl: null,
      imageUrls: [] as string[]
    };
  }

  const record = value as Record<string, unknown>;
  const coverImageUrl = typeof record.coverImageUrl === "string" ? record.coverImageUrl : null;
  const imageUrls = Array.isArray(record.imageUrls)
    ? record.imageUrls.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    coverImageUrl,
    imageUrls
  };
}

function getListingImageUrls(listing: ListingDetailRecord) {
  const payload = listing.rawPayload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const detailMedia = getPayloadMedia(record.detail);
  const searchMedia = getPayloadMedia(record.search);

  return uniqueStrings([
    ...(detailMedia.coverImageUrl ? [detailMedia.coverImageUrl] : []),
    ...detailMedia.imageUrls,
    ...(searchMedia.coverImageUrl ? [searchMedia.coverImageUrl] : []),
    ...searchMedia.imageUrls
  ]);
}

function getLlmStatusBadgeType(status: LlmAnalysisStatus) {
  if (status === "ready") {
    return "success";
  }

  if (status === "error") {
    return "error";
  }

  return "warning";
}

function getLlmStatusLabel(status: LlmAnalysisStatus) {
  if (status === "ready") {
    return "Ready";
  }

  if (status === "stale") {
    return "Stale";
  }

  if (status === "error") {
    return "Error";
  }

  return "Missing";
}

export function ListingDetail({
  listing,
  loading,
  onStatusChange,
  onRefreshLlmAnalysis,
  isFixtureMode,
  fallbackSearchUrl,
  hasOfficeLocation,
  onOpenOfficeSettings
}: ListingDetailProps) {
  const primaryAction = listing ? getListingPrimaryAction(listing, isFixtureMode, fallbackSearchUrl) : null;
  const imageUrls = listing ? getListingImageUrls(listing) : [];
  const englishAnalyst = listing?.llmAnalysis ?? null;
  const [lightboxImageIndex, setLightboxImageIndex] = useState<number | null>(null);
  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
  const [analystLoading, setAnalystLoading] = useState(false);
  const [analystError, setAnalystError] = useState<string | null>(null);
  const [autoRequestedListingId, setAutoRequestedListingId] = useState<number | null>(null);

  useEffect(() => {
    setLightboxImageIndex(null);
    setFailedImageUrls([]);
    setAnalystLoading(false);
    setAnalystError(null);
    setAutoRequestedListingId(null);
  }, [listing?.id]);

  const visibleImageUrls = imageUrls.filter((imageUrl) => !failedImageUrls.includes(imageUrl));
  const lightboxImageUrl =
    lightboxImageIndex != null ? visibleImageUrls[lightboxImageIndex] ?? visibleImageUrls[0] ?? null : null;

  function markImageFailed(imageUrl: string) {
    setFailedImageUrls((current) => (current.includes(imageUrl) ? current : [...current, imageUrl]));
  }

  async function refreshEnglishAnalyst() {
    if (!listing) {
      return;
    }

    setAnalystLoading(true);
    setAnalystError(null);

    try {
      const updated = await onRefreshLlmAnalysis(listing.id);

      if (updated.llmAnalysisStatus !== "ready") {
        setAnalystError("English analyst is not ready yet. Retry after the Gemini refresh completes.");
      } else {
        setAnalystError(null);
      }
    } catch (error) {
      setAnalystError(error instanceof Error ? error.message : "English analyst generation failed");
    } finally {
      setAnalystLoading(false);
    }
  }

  useEffect(() => {
    if (lightboxImageIndex == null || visibleImageUrls.length === 0) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLightboxImageIndex(null);
        return;
      }

      if (visibleImageUrls.length <= 1) {
        return;
      }

      if (event.key === "ArrowRight") {
        setLightboxImageIndex((current) => {
          const currentIndex = current ?? 0;
          return (currentIndex + 1) % visibleImageUrls.length;
        });
      }

      if (event.key === "ArrowLeft") {
        setLightboxImageIndex((current) => {
          const currentIndex = current ?? 0;
          return (currentIndex - 1 + visibleImageUrls.length) % visibleImageUrls.length;
        });
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightboxImageIndex, visibleImageUrls]);

  useEffect(() => {
    if (!listing || loading || analystLoading || listing.llmAnalysisStatus === "ready") {
      return;
    }

    if (autoRequestedListingId === listing.id) {
      return;
    }

    setAutoRequestedListingId(listing.id);
    void refreshEnglishAnalyst();
  }, [autoRequestedListingId, analystLoading, listing, loading]);

  return (
    <SurfaceCard className="surface-card--detail surface-card--fill">
      {loading ? (
        <div className="centered-block">Loading detail...</div>
      ) : listing ? (
        <div className="detail-stack detail-stack--scrollable">
          <section className="detail-hero">
            {visibleImageUrls.length > 0 ? (
              <section className="detail-media">
                <div className="detail-media__strip">
                  {visibleImageUrls.slice(0, 10).map((imageUrl, index) => (
                    <button
                      aria-label={`Open image ${index + 1} of ${visibleImageUrls.length}`}
                      aria-pressed={index === lightboxImageIndex}
                      className={`detail-media__thumb${index === lightboxImageIndex ? " is-active" : ""}`}
                      key={imageUrl}
                      onClick={() => setLightboxImageIndex(index)}
                      type="button"
                    >
                      <img
                        alt={`${listing.title} ${index + 1}`}
                        loading="lazy"
                        onError={() => markImageFailed(imageUrl)}
                        src={imageUrl}
                      />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="detail-hero__head">
              <div className="detail-summary">
                <div className="detail-summary__topline">
                  <div className="detail-icon-actions">
                    <IconButton
                      accessibilityLabel={primaryAction?.label ?? "View original listing"}
                      bgColor="transparentDarkGray"
                      icon="arrow-up-right"
                      iconColor="light"
                      onClick={() => openExternal(primaryAction?.url ?? listing.url)}
                      size="md"
                      tooltip={{ inline: true, text: primaryAction?.label ?? "View original listing" }}
                    />
                    <IconButton
                      accessibilityLabel="Mark reviewed"
                      bgColor="transparentDarkGray"
                      icon="check-circle"
                      iconColor="light"
                      onClick={() => onStatusChange("REVIEWED")}
                      size="md"
                      tooltip={{ inline: true, text: "Mark reviewed" }}
                    />
                    <IconButton
                      accessibilityLabel="Mark contacted"
                      bgColor="transparentDarkGray"
                      icon="envelope"
                      iconColor="light"
                      onClick={() => onStatusChange("CONTACTED")}
                      size="md"
                      tooltip={{ inline: true, text: "Mark contacted" }}
                    />
                    <IconButton
                      accessibilityLabel="Mark rejected"
                      bgColor="red"
                      icon="cancel"
                      iconColor="light"
                      onClick={() => onStatusChange("REJECTED")}
                      size="md"
                      tooltip={{ inline: true, text: "Mark rejected" }}
                    />
                  </div>

                  <div className="detail-summary__badges">
                    <Flex alignItems="center" gap={2} wrap>
                      <Badge text={listing.eligibilityState} type={getEligibilityBadgeType(listing.eligibilityState)} />
                      <Badge text={listing.userStatus} type="neutral" />
                      <Badge text={listing.portal} type="info" />
                      {listing.sourceMode === "fixture" ? <Badge text="Fixture listing" type="warning" /> : null}
                      {listing.sourceMode === "live" ? <Badge text="Live capture" type="success" /> : null}
                    </Flex>
                  </div>
                </div>

                <div className="detail-summary__copy">
                  <h3>{listing.title}</h3>
                  <p>
                    {listing.district ?? "Unknown district"} · {formatListedRent(listing)} · Score {listing.score ?? "n/a"}
                  </p>
                  <p>{listing.addressLine ?? "Precise street address not available in the current scrape."}</p>
                </div>
              </div>

              <div className="detail-sidecar">
                <section className="detail-kpis detail-kpis--hero">
                  {[
                    { label: "Rooms", value: listing.rooms ?? "n/a" },
                    { label: "Listed rent", value: formatListedRent(listing) },
                    { label: "Size", value: listing.sizeSqm ? `${listing.sizeSqm} m²` : "n/a" },
                    { label: "Distance", value: formatDistance(listing.distanceKm) },
                    { label: "Updated", value: formatUpdatedAt(listing.updatedAt) }
                  ].map((item) => (
                    <div className="detail-kpi-tile" key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </section>
              </div>
            </div>

            <div className="detail-hero__panels">
              <section className="detail-context-card detail-info-card detail-info-card--compact">
                <div className="detail-analysis-block">
                  <h4>Geo context</h4>
                  <p>Precision: {getGeoSourceLabel(listing.geoSource)}</p>
                  <p>
                    Coordinates:{" "}
                    {listing.latitude != null && listing.longitude != null
                      ? `${listing.latitude.toFixed(4)}, ${listing.longitude.toFixed(4)}`
                      : "Unavailable"}
                  </p>
                  {hasOfficeLocation ? (
                    <p>Office distance: {formatDistance(listing.distanceKm)}</p>
                  ) : (
                    <div className="detail-inline-callout detail-inline-callout--compact">
                      <p>Add the office location to compare homes by geographic distance.</p>
                      <Button color="gray" size="sm" text="Open office settings" onClick={onOpenOfficeSettings} />
                    </div>
                  )}
                </div>
              </section>

              <section className="detail-facts-card detail-info-card detail-info-card--compact">
                <div className="detail-facts-grid">
                  <div className="detail-analysis-block">
                    <h4>Signals</h4>
                    <Flex gap={2} wrap>
                      {listing.hasBalcony ? <Badge text="Balcony" type="info" /> : null}
                      {listing.hasElevator ? <Badge text="Elevator" type="info" /> : null}
                      {listing.isFurnished ? <Badge text="Furnished" type="neutral" /> : null}
                      {listing.analysisFlags.map((flag) => (
                        <Badge key={flag} text={flag.replace(/_/g, " ")} type="info" />
                      ))}
                      {listing.semanticFlags.map((flag) => (
                        <Badge key={flag} text={flag} type="neutral" />
                      ))}
                      {listing.analysisFlags.length === 0 &&
                      listing.semanticFlags.length === 0 &&
                      !listing.hasBalcony &&
                      !listing.hasElevator &&
                      !listing.isFurnished ? (
                        <Text color="subtle" size="100">
                          No structured or semantic flags returned yet.
                        </Text>
                      ) : null}
                    </Flex>
                  </div>

                  <div className="detail-analysis-block">
                    <h4>Deterministic reason</h4>
                    <p>{listing.eligibilityReason ?? "No semantic classification yet."}</p>
                  </div>

                  <div className="detail-analysis-block">
                    <h4>Semantic flags</h4>
                    <p>{listing.semanticFlags.length > 0 ? listing.semanticFlags.join(", ") : "No semantic flags returned."}</p>
                  </div>
                </div>
              </section>

              <section className="detail-info-card detail-info-card--compact detail-description-card">
                <div className="detail-analysis-block detail-analysis-block--wide">
                  <Flex alignItems="center" gap={2} justifyContent="between" wrap>
                    <h4>English analyst</h4>
                    <Flex gap={2} wrap>
                      {!analystLoading ? (
                        <Badge text={getLlmStatusLabel(listing.llmAnalysisStatus)} type={getLlmStatusBadgeType(listing.llmAnalysisStatus)} />
                      ) : null}
                      {analystLoading ? <Badge text="Refreshing" type="info" /> : null}
                    </Flex>
                  </Flex>

                  {englishAnalyst ? (
                    <>
                      <Flex gap={2} wrap>
                        <Badge text={`Analyst ${englishAnalyst.model}`} type="info" />
                        <Badge text={`Source ${englishAnalyst.sourceLanguage}`} type="neutral" />
                        <Badge text="Integrated translation" type="neutral" />
                      </Flex>
                      <p>{englishAnalyst.summary}</p>
                      <p>{englishAnalyst.fitNote}</p>
                      {englishAnalyst.translatedTitle && englishAnalyst.translatedTitle !== listing.title ? (
                        <p>
                          <strong>Translated title:</strong> {englishAnalyst.translatedTitle}
                        </p>
                      ) : null}
                      <p>
                        <strong>Translated description:</strong>{" "}
                        {englishAnalyst.translatedDescription ?? "Translation unavailable; showing source text only in this run."}
                      </p>
                      <p>
                        <strong>Updated:</strong> {formatAnalystTimestamp(englishAnalyst.updatedAt)}
                      </p>
                    </>
                  ) : (
                    <p>
                      {analystLoading
                        ? "Generating English analyst output with Gemini. The first refresh can take a bit longer on verbose listings."
                        : "No English analyst output is cached for this listing yet."}
                    </p>
                  )}

                  {analystError ? <p className="detail-inline-error">{analystError}</p> : null}

                  {listing.llmAnalysisStatus !== "ready" ? (
                    <Flex gap={2} wrap>
                      <Button
                        color="gray"
                        disabled={analystLoading}
                        size="sm"
                        text={englishAnalyst ? "Refresh English analyst" : "Generate English analyst"}
                        onClick={() => void refreshEnglishAnalyst()}
                      />
                    </Flex>
                  ) : null}
                </div>
              </section>

              <section className="detail-info-card detail-info-card--compact detail-description-card">
                <div className="detail-analysis-block detail-analysis-block--wide">
                  <h4>Description</h4>
                  <p>{listing.description ?? "No description available."}</p>
                </div>
              </section>
            </div>
          </section>

          <section className="detail-compact-shell">
            {primaryAction?.helperText ? (
              <Text size="100" color="subtle">
                {primaryAction.helperText}
              </Text>
            ) : null}
          </section>

          {lightboxImageUrl
            ? createPortal(
                <div
                  aria-label="Listing image viewer"
                  className="detail-lightbox"
                  onClick={() => setLightboxImageIndex(null)}
                  role="dialog"
                >
                  <div className="detail-lightbox__backdrop" />
                  <div className="detail-lightbox__frame" onClick={(event) => event.stopPropagation()}>
                    <button
                      aria-label="Close image viewer"
                      className="detail-lightbox__close"
                      onClick={() => setLightboxImageIndex(null)}
                      type="button"
                    >
                      ×
                    </button>

                    {visibleImageUrls.length > 1 ? (
                      <button
                        aria-label="Previous image"
                        className="detail-lightbox__nav detail-lightbox__nav--prev"
                        onClick={() =>
                          setLightboxImageIndex((current) => {
                            const currentIndex = current ?? 0;
                            return (currentIndex - 1 + visibleImageUrls.length) % visibleImageUrls.length;
                          })
                        }
                        type="button"
                      >
                        ‹
                      </button>
                    ) : null}

                    <img
                      alt={listing.title}
                      className="detail-lightbox__image"
                      onError={() => markImageFailed(lightboxImageUrl)}
                      src={lightboxImageUrl}
                    />

                    {visibleImageUrls.length > 1 ? (
                      <button
                        aria-label="Next image"
                        className="detail-lightbox__nav detail-lightbox__nav--next"
                        onClick={() =>
                          setLightboxImageIndex((current) => {
                            const currentIndex = current ?? 0;
                            return (currentIndex + 1) % visibleImageUrls.length;
                          })
                        }
                        type="button"
                      >
                        ›
                      </button>
                    ) : null}
                  </div>
                </div>,
                document.body
              )
            : null}
        </div>
      ) : (
        <div className="centered-block">Select a listing to inspect the normalized payload.</div>
      )}
    </SurfaceCard>
  );
}
