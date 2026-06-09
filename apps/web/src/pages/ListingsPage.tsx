import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { ListingDetail as ListingDetailType, ListingSummary, OfficeLocation, UserStatus } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ListingDetail } from "../components/ListingDetail";
import { ListingsTable } from "../components/ListingsTable";
import { SectionHeader } from "../components/SectionHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { applyListingViewTab, filtersFromSearchParams, getListingViewTab, hasActiveFilters, mergeFilterSearchParams, resetFilterSearchParams, type ListingViewTab } from "../lib/listingFilters";
import { api } from "../lib/api";

type ListingsPageProps = {
  isFixtureMode: boolean;
  fallbackSearchUrl: string | null;
  officeLocation: OfficeLocation | null;
  onListingMutation: () => void;
};

const listingTabs: Array<{ label: string; value: ListingViewTab }> = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Match", value: "match" },
  { label: "Contacted", value: "contacted" }
];

const LISTINGS_POLL_INTERVAL_MS = 20_000;

export function ListingsPage({ isFixtureMode, fallbackSearchUrl, officeLocation, onListingMutation }: ListingsPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [selectedListingId, setSelectedListingId] = useState<number | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingDetailType | null>(null);
  const [loadingListings, setLoadingListings] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [listingsVersion, setListingsVersion] = useState(0);
  const [detailVersion, setDetailVersion] = useState(0);

  const filters = filtersFromSearchParams(searchParams);
  const deferredFilterKey = useDeferredValue(JSON.stringify(filters));
  const selectedListingIdFromSearch = (() => {
    const value = Number(searchParams.get("selectedId"));
    return Number.isInteger(value) && value > 0 ? value : null;
  })();

  useEffect(() => {
    let isCancelled = false;

    async function loadListings() {
      setLoadingListings(true);
      setListingsError(null);

      try {
        const nextListings = await api.listListings(JSON.parse(deferredFilterKey) as typeof filters);

        if (isCancelled) {
          return;
        }

        setListings(nextListings);
        startTransition(() => {
          setSelectedListingId((currentSelectedListingId) =>
            currentSelectedListingId && nextListings.some((listing) => listing.id === currentSelectedListingId)
              ? currentSelectedListingId
              : selectedListingIdFromSearch && nextListings.some((listing) => listing.id === selectedListingIdFromSearch)
                ? selectedListingIdFromSearch
                : nextListings[0]?.id ?? null
          );
        });
      } catch (error) {
        if (!isCancelled) {
          setListingsError(error instanceof Error ? error.message : "Unable to load listings");
        }
      } finally {
        if (!isCancelled) {
          setLoadingListings(false);
        }
      }
    }

    void loadListings();

    return () => {
      isCancelled = true;
    };
  }, [deferredFilterKey, listingsVersion, selectedListingIdFromSearch]);

  useEffect(() => {
    if (!selectedListingIdFromSearch) {
      return;
    }

    if (!listings.some((listing) => listing.id === selectedListingIdFromSearch)) {
      return;
    }

    setSelectedListingId(selectedListingIdFromSearch);
  }, [listings, selectedListingIdFromSearch]);

  useEffect(() => {
    if (!selectedListingId) {
      setSelectedListing(null);
      return;
    }

    const listingId = selectedListingId;
    let isCancelled = false;

    async function loadDetail() {
      setLoadingDetail(true);
      setDetailError(null);

      try {
        const detail = await api.getListing(listingId);

        if (!isCancelled) {
          setSelectedListing(detail);
        }
      } catch (error) {
        if (!isCancelled) {
          setDetailError(error instanceof Error ? error.message : "Unable to load listing detail");
        }
      } finally {
        if (!isCancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadDetail();

    return () => {
      isCancelled = true;
    };
  }, [detailVersion, selectedListingId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      setListingsVersion((current) => current + 1);
      setDetailVersion((current) => current + 1);
    }, LISTINGS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const visibleMatches = listings.filter((listing) => listing.eligibilityState === "MATCH").length;
  const visibleContacted = listings.filter((listing) => listing.userStatus === "CONTACTED").length;

  const handleFilterChange = (patch: Parameters<typeof mergeFilterSearchParams>[1]) => {
    setSearchParams(mergeFilterSearchParams(searchParams, patch), { replace: true });
  };

  const handleResetFilters = () => {
    setSearchParams(resetFilterSearchParams(searchParams), { replace: true });
  };

  const handleTabChange = (tab: ListingViewTab) => {
    setSearchParams(applyListingViewTab(searchParams, tab), { replace: true });
  };

  const handleStatusChange = async (status: UserStatus) => {
    if (!selectedListingId) {
      return;
    }

    await api.updateListingStatus(selectedListingId, status);
    setListingsVersion((current) => current + 1);
    setDetailVersion((current) => current + 1);
    onListingMutation();
  };

  const handleSelectListing = (id: number) => {
    setSelectedListingId(id);

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("selectedId", String(id));
    setSearchParams(nextSearchParams, { replace: true });
  };

  const handleRefreshLlmAnalysis = async (id: number) => {
    try {
      const detail = await api.generateListingLlmAnalysis(id);
      setSelectedListing(detail);
      return detail;
    } catch (error) {
      try {
        const detail = await api.getListing(id);
        setSelectedListing(detail);
      } catch {
        // Keep the current selection if the refresh failed and the detail cannot be reloaded.
      }

      throw error;
    }
  };

  const handleClearDuplicate = async (id: number) => {
    const detail = await api.clearListingDuplicate(id);
    setSelectedListing(detail);
    return detail;
  };

  return (
    <div className="fh-viewport-workspace flex min-h-0 flex-col gap-4">
      <SectionHeader
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Tabs onValueChange={(value) => handleTabChange(value as ListingViewTab)} value={getListingViewTab(filters)}>
              <TabsList>
                {listingTabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { label: "Visible", value: listings.length },
                { label: "Match", value: visibleMatches },
                { label: "Contacted", value: visibleContacted }
              ].map((item) => (
                <div className="rounded-lg border bg-card px-3 py-2" key={item.label}>
                  <span className="block text-xs text-muted-foreground">{item.label}</span>
                  <strong className="text-sm">{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        }
        subtitle="Viewport-bound review workspace with column filters, sticky table controls and stacked detail inspection."
        title="Listings"
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:h-full xl:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.92fr)] xl:overflow-hidden">
        <ListingsTable
          error={listingsError}
          filters={filters}
          hasActiveFilters={hasActiveFilters(filters)}
          listings={listings}
          loading={loadingListings}
          onChange={handleFilterChange}
          onResetFilters={handleResetFilters}
          onSelect={handleSelectListing}
          selectedListingId={selectedListingId}
        />

        <div className="min-w-0 xl:min-h-0 xl:overflow-hidden">
          {detailError && !selectedListing ? (
            <SurfaceCard
              subtitle="The selected listing could not be loaded from the protected API."
              title="Listing detail unavailable"
            >
              <div className="flex flex-col gap-3 text-sm text-muted-foreground">
                <span>{detailError}</span>
                <Button onClick={() => setDetailVersion((current) => current + 1)} variant="outline">
                  Retry
                </Button>
              </div>
            </SurfaceCard>
          ) : (
            <ListingDetail
              fallbackSearchUrl={fallbackSearchUrl}
              hasOfficeLocation={Boolean(officeLocation)}
              isFixtureMode={isFixtureMode}
              listing={selectedListing}
              loading={loadingDetail}
              onOpenOfficeSettings={() => navigate("/settings#office-location")}
              onClearDuplicate={handleClearDuplicate}
              onRefreshLlmAnalysis={handleRefreshLlmAnalysis}
              onStatusChange={handleStatusChange}
            />
          )}
        </div>
      </div>

      {loadingListings && listings.length === 0 ? (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/40 backdrop-blur-sm">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading listings workspace" />
        </div>
      ) : null}
    </div>
  );
}
