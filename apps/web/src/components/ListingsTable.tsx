import { Badge, Box, Button, Heading, NumberField, SearchField, SelectList, Spinner, Text, TextField } from "gestalt";

import type { EligibilityState, ListingFilters, ListingSummary, Portal, UserStatus } from "@flathunter/shared";

import { formatDistance } from "../lib/geo";

type ListingsTableProps = {
  listings: ListingSummary[];
  loading: boolean;
  error?: string | null;
  selectedListingId: number | null;
  hasActiveFilters: boolean;
  filters: ListingFilters;
  onChange: (patch: Partial<ListingFilters>) => void;
  onResetFilters: () => void;
  onSelect: (id: number) => void;
};

function formatListedRent(listing: ListingSummary) {
  if (listing.rentWarm != null) {
    return `${listing.rentWarm} EUR warm`;
  }

  if (listing.rentCold != null) {
    return `${listing.rentCold} EUR cold`;
  }

  return "n/a";
}

function renderBadge(value: string) {
  return (
    <Badge
      text={value}
      type={value === "MATCH" ? "success" : value === "REJECT" ? "error" : value === "CONTACTED" ? "info" : "warning"}
    />
  );
}

export function ListingsTable({
  listings,
  loading,
  error,
  selectedListingId,
  hasActiveFilters,
  filters,
  onChange,
  onResetFilters,
  onSelect
}: ListingsTableProps) {
  return (
    <div className="surface-card surface-card--fill surface-card--listings">
      <Box color="default" padding={5} rounding={6}>
        <div className="panel-header panel-header--split">
          <div>
            <Heading size="300" accessibilityLevel={2}>
              Listings
            </Heading>
            <Text size="100" color="subtle">
              Scroll the queue in place, refine the visible slice by column, then inspect the selected listing below.
            </Text>
          </div>
          <div className="panel-header-actions">
            <Badge text={`${listings.length} visible`} type="info" />
            {hasActiveFilters ? (
              <Button color="gray" size="md" text="Reset filters" onClick={() => onResetFilters()} />
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="centered-block">
            <Spinner accessibilityLabel="Loading listings" show />
          </div>
        ) : error ? (
          <div className="empty-state">
            <h3>Listings unavailable</h3>
            <p>{error}</p>
            <Button color="gray" size="lg" text="Reset filters" onClick={() => onResetFilters()} />
          </div>
        ) : listings.length === 0 ? (
          <div className="empty-state">
            <h3>{hasActiveFilters ? "No listings match current filters" : "No listings yet"}</h3>
            <p>
              {hasActiveFilters
                ? "Reset the filters or broaden the thresholds to bring the current batch back into view."
                : "Run the worker to ingest the first batch, then the table will populate with normalized listings."}
            </p>
            {hasActiveFilters ? (
              <Button color="gray" size="lg" text="Reset filters" onClick={() => onResetFilters()} />
            ) : (
              <code>make worker</code>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="listings-table">
              <thead>
                <tr className="listings-table__head-row">
                  <th>Title</th>
                  <th>Portal</th>
                  <th>District</th>
                  <th>Listed rent</th>
                  <th>Size</th>
                  <th>Rooms</th>
                  <th>Score</th>
                  <th>Distance</th>
                  <th>Eligibility</th>
                  <th>Status</th>
                </tr>
                <tr className="listings-table__filter-row">
                  <th>
                    <SearchField
                      accessibilityClearButtonLabel="Clear title search"
                      accessibilityLabel="Search listing title or description"
                      id="filter-query"
                      label="Title query"
                      labelDisplay="hidden"
                      onChange={({ value }) => onChange({ query: value || undefined })}
                      onClear={() => onChange({ query: undefined })}
                      placeholder="Search"
                      size="md"
                      value={filters.query ?? ""}
                    />
                  </th>
                  <th>
                    <SelectList
                      id="filter-portal"
                      label="Portal"
                      labelDisplay="hidden"
                      onChange={({ value }) => onChange({ portal: (value || undefined) as Portal | undefined })}
                      size="md"
                      value={filters.portal ?? ""}
                    >
                      <SelectList.Option label="All" value="" />
                      <SelectList.Option label="Immowelt" value="IMMOWELT" />
                      <SelectList.Option label="ImmoScout24" value="IMMOSCOUT24" />
                      <SelectList.Option label="Kleinanzeigen" value="KLEINANZEIGEN" />
                      <SelectList.Option label="WG-Gesucht" value="WG_GESUCHT" />
                      <SelectList.Option label="Flatsforfriendz" value="FLATSFORFRIENDZ" />
                    </SelectList>
                  </th>
                  <th>
                    <TextField
                      id="filter-district"
                      label="District"
                      labelDisplay="hidden"
                      onChange={({ value }) => onChange({ district: value || undefined })}
                      placeholder="District"
                      size="md"
                      value={filters.district ?? ""}
                    />
                  </th>
                  <th>
                    <NumberField
                      id="filter-rent"
                      label="Max rent"
                      labelDisplay="hidden"
                      min={0}
                      onChange={({ value }) => onChange({ maxRentWarm: value })}
                      placeholder="Max"
                      size="md"
                      value={filters.maxRentWarm}
                    />
                  </th>
                  <th>
                    <NumberField
                      id="filter-size"
                      label="Minimum size"
                      labelDisplay="hidden"
                      min={0}
                      onChange={({ value }) => onChange({ minSizeSqm: value })}
                      placeholder="Min"
                      size="md"
                      value={filters.minSizeSqm}
                    />
                  </th>
                  <th>
                    <div className="listings-table__filter-placeholder">Any</div>
                  </th>
                  <th>
                    <NumberField
                      id="filter-score"
                      label="Minimum score"
                      labelDisplay="hidden"
                      max={100}
                      min={0}
                      onChange={({ value }) => onChange({ minScore: value })}
                      placeholder="Min"
                      size="md"
                      value={filters.minScore}
                    />
                  </th>
                  <th>
                    <div className="listings-table__filter-placeholder">Any</div>
                  </th>
                  <th>
                    <SelectList
                      id="filter-eligibility"
                      label="Eligibility"
                      labelDisplay="hidden"
                      onChange={({ value }) =>
                        onChange({ eligibilityState: (value || undefined) as EligibilityState | undefined })
                      }
                      size="md"
                      value={filters.eligibilityState ?? ""}
                    >
                      <SelectList.Option label="All" value="" />
                      <SelectList.Option label="Match" value="MATCH" />
                      <SelectList.Option label="Unsure" value="UNSURE" />
                      <SelectList.Option label="Reject" value="REJECT" />
                    </SelectList>
                  </th>
                  <th>
                    <SelectList
                      id="filter-status"
                      label="Status"
                      labelDisplay="hidden"
                      onChange={({ value }) => onChange({ userStatus: (value || undefined) as UserStatus | undefined })}
                      size="md"
                      value={filters.userStatus ?? ""}
                    >
                      <SelectList.Option label="All" value="" />
                      <SelectList.Option label="New" value="NEW" />
                      <SelectList.Option label="Reviewed" value="REVIEWED" />
                      <SelectList.Option label="Contacted" value="CONTACTED" />
                      <SelectList.Option label="Rejected" value="REJECTED" />
                      <SelectList.Option label="Blacklisted" value="BLACKLISTED" />
                    </SelectList>
                  </th>
                </tr>
              </thead>

              <tbody>
                {listings.map((listing) => (
                  <tr
                    className={selectedListingId === listing.id ? "selected" : undefined}
                    key={listing.id}
                    onClick={() => onSelect(listing.id)}
                  >
                    <td>
                      <button className="row-select-button" onClick={() => onSelect(listing.id)} type="button">
                        <strong>{listing.title}</strong>
                        <span className="row-select-button__meta">
                          {listing.sourceMode === "fixture"
                            ? "Fixture capture"
                            : listing.sourceMode === "live"
                              ? "Live capture"
                              : "Unknown origin"}
                        </span>
                      </button>
                    </td>
                    <td>{listing.portal}</td>
                    <td>{listing.district ?? "Unknown"}</td>
                    <td>{formatListedRent(listing)}</td>
                    <td>{listing.sizeSqm ? `${listing.sizeSqm} m²` : "n/a"}</td>
                    <td>{listing.rooms ?? "n/a"}</td>
                    <td>{listing.score ?? "n/a"}</td>
                    <td>{formatDistance(listing.distanceKm)}</td>
                    <td>{renderBadge(listing.eligibilityState)}</td>
                    <td>{renderBadge(listing.userStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>
    </div>
  );
}
