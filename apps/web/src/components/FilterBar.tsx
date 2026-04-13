import { Box, Button, Heading, Text } from "gestalt";

import type { EligibilityState, ListingFilters, Portal, UserStatus } from "@flathunter/shared";

type FilterBarProps = {
  filters: ListingFilters;
  hasActiveFilters: boolean;
  onChange: (patch: Partial<ListingFilters>) => void;
  onReset: () => void;
};

export function FilterBar({ filters, hasActiveFilters, onChange, onReset }: FilterBarProps) {
  return (
    <div className="surface-card surface-card--filters">
      <Box color="default" rounding={6} padding={5}>
        <div className="panel-header panel-header--split">
          <div>
            <Heading size="300" accessibilityLevel={2}>
              Filters
            </Heading>
            <Text size="100" color="subtle">
              Live query against the normalized listings index.
            </Text>
          </div>
          {hasActiveFilters ? <Button color="gray" size="sm" text="Reset" onClick={() => onReset()} /> : null}
        </div>

        <div className="panel-scroll">
          <div className="field-grid field-grid--filters">
            <label className="field field-span">
              <span>Search</span>
              <input value={filters.query ?? ""} onChange={(event) => onChange({ query: event.target.value || undefined })} />
            </label>
            <label className="field">
              <span>Portal</span>
              <select
                value={filters.portal ?? ""}
                onChange={(event) => onChange({ portal: (event.target.value || undefined) as Portal | undefined })}
              >
                <option value="">All</option>
                <option value="IMMOWELT">Immowelt</option>
                <option value="IMMOSCOUT24">ImmoScout24</option>
                <option value="KLEINANZEIGEN">Kleinanzeigen</option>
                <option value="WG_GESUCHT">WG-Gesucht</option>
                <option value="FLATSFORFRIENDZ">Flatsforfriendz</option>
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select
                value={filters.userStatus ?? ""}
                onChange={(event) => onChange({ userStatus: (event.target.value || undefined) as UserStatus | undefined })}
              >
                <option value="">All</option>
                <option value="NEW">New</option>
                <option value="REVIEWED">Reviewed</option>
                <option value="CONTACTED">Contacted</option>
                <option value="REJECTED">Rejected</option>
                <option value="BLACKLISTED">Blacklisted</option>
              </select>
            </label>
            <label className="field">
              <span>Eligibility</span>
              <select
                value={filters.eligibilityState ?? ""}
                onChange={(event) =>
                  onChange({ eligibilityState: (event.target.value || undefined) as EligibilityState | undefined })
                }
              >
                <option value="">All</option>
                <option value="MATCH">Match</option>
                <option value="UNSURE">Unsure</option>
                <option value="REJECT">Reject</option>
              </select>
            </label>
            <label className="field">
              <span>Max warm rent</span>
              <input
                type="number"
                value={filters.maxRentWarm ?? ""}
                onChange={(event) => onChange({ maxRentWarm: event.target.value ? Number(event.target.value) : undefined })}
              />
            </label>
            <label className="field">
              <span>Min size</span>
              <input
                type="number"
                value={filters.minSizeSqm ?? ""}
                onChange={(event) => onChange({ minSizeSqm: event.target.value ? Number(event.target.value) : undefined })}
              />
            </label>
            <label className="field">
              <span>Min score</span>
              <input
                type="number"
                value={filters.minScore ?? ""}
                onChange={(event) => onChange({ minScore: event.target.value ? Number(event.target.value) : undefined })}
              />
            </label>
            <label className="field field-span">
              <span>District</span>
              <input
                value={filters.district ?? ""}
                onChange={(event) => onChange({ district: event.target.value || undefined })}
              />
            </label>
          </div>
        </div>
      </Box>
    </div>
  );
}
