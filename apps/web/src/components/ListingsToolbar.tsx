import type { EligibilityState, ListingFilters, Portal, UserStatus } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { FormField } from "./FormField";

type ListingsToolbarProps = {
  filters: ListingFilters;
  hasActiveFilters: boolean;
  onChange: (patch: Partial<ListingFilters>) => void;
  onReset: () => void;
};

export function ListingsToolbar({ filters, hasActiveFilters, onChange, onReset }: ListingsToolbarProps) {
  return (
    <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
      <FormField label="Portal">
        <Select
          onValueChange={(value) => onChange({ portal: value === "all" ? undefined : (value as Portal) })}
          value={filters.portal ?? "all"}
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All portals</SelectItem>
            <SelectItem value="IMMOWELT">Immowelt</SelectItem>
            <SelectItem value="IMMOSCOUT24">ImmoScout24</SelectItem>
            <SelectItem value="KLEINANZEIGEN">Kleinanzeigen</SelectItem>
            <SelectItem value="WG_GESUCHT">WG-Gesucht</SelectItem>
            <SelectItem value="FLATSFORFRIENDZ">Flatsforfriendz</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Status">
        <Select
          onValueChange={(value) => onChange({ userStatus: value === "all" ? undefined : (value as UserStatus) })}
          value={filters.userStatus ?? "all"}
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
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
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All eligibility</SelectItem>
            <SelectItem value="MATCH">Match</SelectItem>
            <SelectItem value="UNSURE">Unsure</SelectItem>
            <SelectItem value="REJECT">Reject</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField htmlFor="toolbar-district" label="District">
        <Input
          id="toolbar-district"
          onChange={(event) => onChange({ district: event.target.value || undefined })}
          placeholder="Mitte"
          value={filters.district ?? ""}
        />
      </FormField>
      <FormField htmlFor="toolbar-max-rent" label="Max rent">
        <Input
          id="toolbar-max-rent"
          min={0}
          onChange={(event) => onChange({ maxRentWarm: event.target.value ? Number(event.target.value) : undefined })}
          placeholder="1800"
          type="number"
          value={filters.maxRentWarm ?? ""}
        />
      </FormField>
      <FormField htmlFor="toolbar-min-size" label="Min size">
        <Input
          id="toolbar-min-size"
          min={0}
          onChange={(event) => onChange({ minSizeSqm: event.target.value ? Number(event.target.value) : undefined })}
          placeholder="50"
          type="number"
          value={filters.minSizeSqm ?? ""}
        />
      </FormField>
      <FormField htmlFor="toolbar-min-score" label="Min score">
        <Input
          id="toolbar-min-score"
          max={100}
          min={0}
          onChange={(event) => onChange({ minScore: event.target.value ? Number(event.target.value) : undefined })}
          placeholder="70"
          type="number"
          value={filters.minScore ?? ""}
        />
      </FormField>
      <div className="flex items-end">
        <Button disabled={!hasActiveFilters} onClick={() => onReset()} variant="outline">
          Reset filters
        </Button>
      </div>
    </div>
  );
}
