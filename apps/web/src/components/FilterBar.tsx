import type { EligibilityState, ListingFilters, Portal, UserStatus } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { FormField } from "./FormField";
import { SurfaceCard } from "./SurfaceCard";

type FilterBarProps = {
  filters: ListingFilters;
  hasActiveFilters: boolean;
  onChange: (patch: Partial<ListingFilters>) => void;
  onReset: () => void;
};

export function FilterBar({ filters, hasActiveFilters, onChange, onReset }: FilterBarProps) {
  return (
    <SurfaceCard
      actions={
        hasActiveFilters ? (
          <Button onClick={() => onReset()} size="sm" variant="outline">
            Reset
          </Button>
        ) : null
      }
      subtitle="Live query against the normalized listings index."
      title="Filters"
    >
      <div className="grid gap-3 md:grid-cols-4">
        <FormField className="md:col-span-2" htmlFor="filter-search" label="Search">
          <Input
            id="filter-search"
            onChange={(event) => onChange({ query: event.target.value || undefined })}
            value={filters.query ?? ""}
          />
        </FormField>
        <FormField label="Portal">
          <Select onValueChange={(value) => onChange({ portal: value === "all" ? undefined : (value as Portal) })} value={filters.portal ?? "all"}>
            <SelectTrigger className="w-full"><SelectValue placeholder="All portals" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="IMMOWELT">Immowelt</SelectItem>
              <SelectItem value="IMMOSCOUT24">ImmoScout24</SelectItem>
              <SelectItem value="KLEINANZEIGEN">Kleinanzeigen</SelectItem>
              <SelectItem value="WG_GESUCHT">WG-Gesucht</SelectItem>
              <SelectItem value="FLATSFORFRIENDZ">Flatsforfriendz</SelectItem>
              <SelectItem value="INBERLINWOHNEN">inBerlinWohnen</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Status">
          <Select onValueChange={(value) => onChange({ userStatus: value === "all" ? undefined : (value as UserStatus) })} value={filters.userStatus ?? "all"}>
            <SelectTrigger className="w-full"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="NEW">New</SelectItem>
              <SelectItem value="REVIEWED">Reviewed</SelectItem>
              <SelectItem value="CONTACTED">Contacted</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="BLACKLISTED">Blacklisted</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Eligibility">
          <Select
            onValueChange={(value) => onChange({ eligibilityState: value === "all" ? undefined : (value as EligibilityState) })}
            value={filters.eligibilityState ?? "all"}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="All eligibility" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="MATCH">Match</SelectItem>
              <SelectItem value="UNSURE">Unsure</SelectItem>
              <SelectItem value="REJECT">Reject</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField htmlFor="filter-max-rent" label="Max warm rent">
          <Input
            id="filter-max-rent"
            onChange={(event) => onChange({ maxRentWarm: event.target.value ? Number(event.target.value) : undefined })}
            type="number"
            value={filters.maxRentWarm ?? ""}
          />
        </FormField>
        <FormField htmlFor="filter-min-size" label="Min size">
          <Input
            id="filter-min-size"
            onChange={(event) => onChange({ minSizeSqm: event.target.value ? Number(event.target.value) : undefined })}
            type="number"
            value={filters.minSizeSqm ?? ""}
          />
        </FormField>
        <FormField htmlFor="filter-min-score" label="Min score">
          <Input
            id="filter-min-score"
            onChange={(event) => onChange({ minScore: event.target.value ? Number(event.target.value) : undefined })}
            type="number"
            value={filters.minScore ?? ""}
          />
        </FormField>
        <FormField className="md:col-span-2" htmlFor="filter-district" label="District">
          <Input
            id="filter-district"
            onChange={(event) => onChange({ district: event.target.value || undefined })}
            value={filters.district ?? ""}
          />
        </FormField>
      </div>
    </SurfaceCard>
  );
}
