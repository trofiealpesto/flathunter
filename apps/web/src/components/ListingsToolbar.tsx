import { Button, NumberField, SelectList, TextField } from "gestalt";

import type { EligibilityState, ListingFilters, Portal, UserStatus } from "@flathunter/shared";

type ListingsToolbarProps = {
  filters: ListingFilters;
  hasActiveFilters: boolean;
  onChange: (patch: Partial<ListingFilters>) => void;
  onReset: () => void;
};

export function ListingsToolbar({ filters, hasActiveFilters, onChange, onReset }: ListingsToolbarProps) {
  return (
    <div className="listings-toolbar">
      <div className="listings-toolbar-grid">
        <SelectList
          id="portal"
          label="Portal"
          size="lg"
          value={filters.portal ?? ""}
          onChange={({ value }) => onChange({ portal: (value || undefined) as Portal | undefined })}
        >
          <SelectList.Option label="All portals" value="" />
          <SelectList.Option label="Immowelt" value="IMMOWELT" />
          <SelectList.Option label="ImmoScout24" value="IMMOSCOUT24" />
          <SelectList.Option label="Kleinanzeigen" value="KLEINANZEIGEN" />
          <SelectList.Option label="WG-Gesucht" value="WG_GESUCHT" />
          <SelectList.Option label="Flatsforfriendz" value="FLATSFORFRIENDZ" />
        </SelectList>

        <SelectList
          id="status"
          label="Status"
          size="lg"
          value={filters.userStatus ?? ""}
          onChange={({ value }) => onChange({ userStatus: (value || undefined) as UserStatus | undefined })}
        >
          <SelectList.Option label="All statuses" value="" />
          <SelectList.Option label="New" value="NEW" />
          <SelectList.Option label="Reviewed" value="REVIEWED" />
          <SelectList.Option label="Contacted" value="CONTACTED" />
          <SelectList.Option label="Rejected" value="REJECTED" />
          <SelectList.Option label="Blacklisted" value="BLACKLISTED" />
        </SelectList>

        <SelectList
          id="eligibility"
          label="Eligibility"
          size="lg"
          value={filters.eligibilityState ?? ""}
          onChange={({ value }) =>
            onChange({ eligibilityState: (value || undefined) as EligibilityState | undefined })
          }
        >
          <SelectList.Option label="All eligibility" value="" />
          <SelectList.Option label="Match" value="MATCH" />
          <SelectList.Option label="Unsure" value="UNSURE" />
          <SelectList.Option label="Reject" value="REJECT" />
        </SelectList>

        <TextField
          id="district"
          label="District"
          placeholder="Mitte, Kreuzberg..."
          size="lg"
          value={filters.district ?? ""}
          onChange={({ value }) => onChange({ district: value || undefined })}
        />

        <NumberField
          id="max-rent"
          label="Max rent"
          placeholder="1800"
          min={0}
          size="lg"
          value={filters.maxRentWarm}
          onChange={({ value }) => onChange({ maxRentWarm: value })}
        />

        <NumberField
          id="min-size"
          label="Min size"
          placeholder="50"
          min={0}
          size="lg"
          value={filters.minSizeSqm}
          onChange={({ value }) => onChange({ minSizeSqm: value })}
        />

        <NumberField
          id="min-score"
          label="Min score"
          placeholder="70"
          min={0}
          max={100}
          size="lg"
          value={filters.minScore}
          onChange={({ value }) => onChange({ minScore: value })}
        />

        <div className="listings-toolbar-actions">
          <Button color="gray" size="lg" text="Reset filters" disabled={!hasActiveFilters} onClick={() => onReset()} />
        </div>
      </div>
    </div>
  );
}
