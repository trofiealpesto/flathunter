import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  XCircle
} from "lucide-react";

import type { ListingDetail as ListingDetailRecord, LlmAnalysisStatus, UserStatus } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious
} from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { ToneBadge, toneFromState } from "./ToneBadge";
import { ListingApplySection } from "./ListingApplySection";
import { SurfaceCard } from "./SurfaceCard";
import { formatDistance, getGeoSourceLabel } from "../lib/geo";
import { getListingPrimaryAction } from "../lib/listingDetail";

type ListingDetailProps = {
  listing: ListingDetailRecord | null;
  loading: boolean;
  onStatusChange: (status: UserStatus) => void;
  onClearDuplicate: (id: number) => Promise<ListingDetailRecord>;
  onRefreshLlmAnalysis: (id: number) => Promise<ListingDetailRecord>;
  isFixtureMode: boolean;
  fallbackSearchUrl: string | null;
  hasOfficeLocation: boolean;
  onOpenOfficeSettings: () => void;
};

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
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

function DetailIconButton({
  children,
  label,
  onClick,
  variant = "secondary"
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "secondary" | "destructive";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} onClick={onClick} size="icon" type="button" variant={variant === "destructive" ? "destructive" : "secondary"}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ListingDetail({
  listing,
  loading,
  onStatusChange,
  onClearDuplicate,
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
    <SurfaceCard className="min-h-[540px]" contentClassName="min-h-0">
      {loading ? (
        <div className="grid min-h-96 place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : listing ? (
        <ScrollArea className="h-[calc(100svh-12rem)] min-h-[480px] pr-3">
          <div className="space-y-5">
            {visibleImageUrls.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visibleImageUrls.slice(0, 6).map((imageUrl, index) => (
                  <button
                    aria-label={`Open image ${index + 1} of ${visibleImageUrls.length}`}
                    className="aspect-[4/3] overflow-hidden rounded-lg border bg-muted"
                    key={imageUrl}
                    onClick={() => setLightboxImageIndex(index)}
                    type="button"
                  >
                    <img
                      alt={`${listing.title} ${index + 1}`}
                      className="h-full w-full object-cover transition-transform hover:scale-105"
                      loading="lazy"
                      onError={() => markImageFailed(imageUrl)}
                      src={imageUrl}
                    />
                  </button>
                ))}
              </div>
            ) : null}

            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <ToneBadge tone={toneFromState(listing.eligibilityState)}>{listing.eligibilityState}</ToneBadge>
                    <ToneBadge tone={toneFromState(listing.userStatus)}>{listing.userStatus}</ToneBadge>
                    <ToneBadge tone="info">{listing.portal}</ToneBadge>
                    {listing.sourceMode === "fixture" ? <ToneBadge tone="warning">Fixture listing</ToneBadge> : null}
                    {listing.sourceMode === "live" ? <ToneBadge tone="success">Live capture</ToneBadge> : null}
                    {listing.duplicateOfListingId != null ? (
                      <button
                        className="inline-flex"
                        onClick={() => void onClearDuplicate(listing.id)}
                        title="Flagged as a cross-portal duplicate. Click to un-flag."
                        type="button"
                      >
                        <ToneBadge tone="warning">Duplicate of #{listing.duplicateOfListingId}</ToneBadge>
                      </button>
                    ) : null}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold leading-tight">{listing.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {listing.district ?? "Unknown district"} · {formatListedRent(listing)} · Score {listing.score ?? "n/a"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {listing.addressLine ?? "Precise street address not available in the current scrape."}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <DetailIconButton label={primaryAction?.label ?? "View original listing"} onClick={() => openExternal(primaryAction?.url ?? listing.url)}>
                    <ArrowUpRight />
                  </DetailIconButton>
                  <DetailIconButton label="Mark reviewed" onClick={() => onStatusChange("REVIEWED")}>
                    <CheckCircle2 />
                  </DetailIconButton>
                  <DetailIconButton label="Mark contacted" onClick={() => onStatusChange("CONTACTED")}>
                    <Mail />
                  </DetailIconButton>
                  <DetailIconButton label="Mark rejected" onClick={() => onStatusChange("REJECTED")} variant="destructive">
                    <XCircle />
                  </DetailIconButton>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                {[
                  { label: "Rooms", value: listing.rooms ?? "n/a" },
                  { label: "Listed rent", value: formatListedRent(listing) },
                  { label: "Size", value: listing.sizeSqm ? `${listing.sizeSqm} m²` : "n/a" },
                  { label: "Distance", value: formatDistance(listing.distanceKm) },
                  {
                    label: "Commute",
                    value:
                      listing.commuteMinutes != null
                        ? `${listing.commuteMinutes} min${listing.commuteSource === "heuristic" ? " (est.)" : ""}`
                        : "n/a"
                  },
                  { label: "Updated", value: formatUpdatedAt(listing.updatedAt) }
                ].map((item) => (
                  <div className="rounded-lg border bg-muted/30 p-3" key={item.label}>
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                    <strong className="block truncate text-sm">{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-3 xl:grid-cols-2">
              <div className="rounded-lg border p-4">
                <h3 className="font-medium">Geo context</h3>
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
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
                    <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                      <p>Add the office location to compare homes by geographic distance.</p>
                      <Button className="mt-2" onClick={onOpenOfficeSettings} size="sm" variant="outline">
                        Open office settings
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="font-medium">Signals</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {listing.hasBalcony ? <ToneBadge tone="info">Balcony</ToneBadge> : null}
                  {listing.hasElevator ? <ToneBadge tone="info">Elevator</ToneBadge> : null}
                  {listing.isFurnished ? <ToneBadge>Furnished</ToneBadge> : null}
                  {listing.analysisFlags.map((flag) => (
                    <ToneBadge key={flag} tone="info">{flag.replace(/_/g, " ")}</ToneBadge>
                  ))}
                  {listing.semanticFlags.map((flag) => (
                    <ToneBadge key={flag}>{flag}</ToneBadge>
                  ))}
                  {listing.analysisFlags.length === 0 &&
                  listing.semanticFlags.length === 0 &&
                  !listing.hasBalcony &&
                  !listing.hasElevator &&
                  !listing.isFurnished ? (
                    <p className="text-sm text-muted-foreground">No structured or semantic flags returned yet.</p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="grid gap-3 xl:grid-cols-2">
              <div className="rounded-lg border p-4">
                <h3 className="font-medium">Deterministic reason</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {listing.eligibilityReason ?? "No semantic classification yet."}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <h3 className="font-medium">Semantic flags</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {listing.semanticFlags.length > 0 ? listing.semanticFlags.join(", ") : "No semantic flags returned."}
                </p>
              </div>
            </section>

            <section className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">English analyst</h3>
                <div className="flex flex-wrap gap-2">
                  {analystLoading ? (
                    <ToneBadge tone="info">Refreshing</ToneBadge>
                  ) : (
                    <ToneBadge tone={toneFromState(listing.llmAnalysisStatus)}>
                      {getLlmStatusLabel(listing.llmAnalysisStatus)}
                    </ToneBadge>
                  )}
                </div>
              </div>

              {englishAnalyst ? (
                <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <div className="flex flex-wrap gap-2">
                    <ToneBadge tone="info">Analyst {englishAnalyst.model}</ToneBadge>
                    <ToneBadge>Source {englishAnalyst.sourceLanguage}</ToneBadge>
                    <ToneBadge>Integrated translation</ToneBadge>
                  </div>
                  <p>{englishAnalyst.summary}</p>
                  <p>{englishAnalyst.fitNote}</p>
                  {englishAnalyst.translatedTitle && englishAnalyst.translatedTitle !== listing.title ? (
                    <p>
                      <strong className="text-foreground">Translated title:</strong> {englishAnalyst.translatedTitle}
                    </p>
                  ) : null}
                  <p>
                    <strong className="text-foreground">Translated description:</strong>{" "}
                    {englishAnalyst.translatedDescription ?? "Translation unavailable; showing source text only in this run."}
                  </p>
                  <p>
                    <strong className="text-foreground">Updated:</strong> {formatAnalystTimestamp(englishAnalyst.updatedAt)}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  {analystLoading
                    ? "Generating English analyst output with Gemini. The first refresh can take a bit longer on verbose listings."
                    : "No English analyst output is cached for this listing yet."}
                </p>
              )}

              {analystError ? <p className="mt-3 text-sm text-destructive">{analystError}</p> : null}

              {listing.llmAnalysisStatus !== "ready" ? (
                <Button className="mt-3" disabled={analystLoading} onClick={() => void refreshEnglishAnalyst()} size="sm" variant="outline">
                  {analystLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {englishAnalyst ? "Refresh English analyst" : "Generate English analyst"}
                </Button>
              ) : null}
            </section>

            <ListingApplySection listing={listing} onContacted={() => onStatusChange("CONTACTED")} />

            <section className="rounded-lg border p-4">
              <h3 className="font-medium">Description</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {listing.description ?? "No description available."}
              </p>
            </section>

            {primaryAction?.helperText ? <p className="text-xs text-muted-foreground">{primaryAction.helperText}</p> : null}
          </div>

          <Dialog open={lightboxImageIndex != null} onOpenChange={(open) => (!open ? setLightboxImageIndex(null) : undefined)}>
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle>{listing.title}</DialogTitle>
                <DialogDescription>{visibleImageUrls.length} listing images</DialogDescription>
              </DialogHeader>
              <Carousel className="mx-auto w-full max-w-4xl" opts={{ startIndex: lightboxImageIndex ?? 0 }}>
                <CarouselContent>
                  {visibleImageUrls.map((imageUrl, index) => (
                    <CarouselItem key={imageUrl}>
                      <img
                        alt={`${listing.title} ${index + 1}`}
                        className="max-h-[70svh] w-full rounded-lg object-contain"
                        onError={() => markImageFailed(imageUrl)}
                        src={imageUrl}
                      />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                {visibleImageUrls.length > 1 ? (
                  <>
                    <CarouselPrevious className="left-2" />
                    <CarouselNext className="right-2" />
                  </>
                ) : null}
              </Carousel>
            </DialogContent>
          </Dialog>
        </ScrollArea>
      ) : (
        <div className="grid min-h-96 place-items-center text-sm text-muted-foreground">
          Select a listing to inspect the normalized payload.
        </div>
      )}
    </SurfaceCard>
  );
}
