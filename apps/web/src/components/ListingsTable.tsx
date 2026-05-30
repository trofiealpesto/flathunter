import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Loader2, Search as SearchIcon } from "lucide-react";

import type { EligibilityState, ListingFilters, ListingSummary, Portal, UserStatus } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { ToneBadge, toneFromState } from "./ToneBadge";
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

const columns: ColumnDef<ListingSummary>[] = [
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => (
      <div className="min-w-64">
        <div className="line-clamp-2 font-medium">{row.original.title}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.sourceMode === "fixture"
            ? "Fixture capture"
            : row.original.sourceMode === "live"
              ? "Live capture"
              : "Unknown origin"}
        </div>
      </div>
    )
  },
  { accessorKey: "portal", header: "Portal" },
  {
    accessorKey: "district",
    header: "District",
    cell: ({ row }) => row.original.district ?? "Unknown"
  },
  {
    id: "rent",
    header: "Listed rent",
    cell: ({ row }) => formatListedRent(row.original)
  },
  {
    accessorKey: "sizeSqm",
    header: "Size",
    cell: ({ row }) => (row.original.sizeSqm ? `${row.original.sizeSqm} m²` : "n/a")
  },
  {
    accessorKey: "rooms",
    header: "Rooms",
    cell: ({ row }) => row.original.rooms ?? "n/a"
  },
  {
    accessorKey: "score",
    header: "Score",
    cell: ({ row }) => row.original.score ?? "n/a"
  },
  {
    accessorKey: "distanceKm",
    header: "Distance",
    cell: ({ row }) => formatDistance(row.original.distanceKm)
  },
  {
    accessorKey: "eligibilityState",
    header: "Eligibility",
    cell: ({ row }) => <ToneBadge tone={toneFromState(row.original.eligibilityState)}>{row.original.eligibilityState}</ToneBadge>
  },
  {
    accessorKey: "userStatus",
    header: "Status",
    cell: ({ row }) => <ToneBadge tone={toneFromState(row.original.userStatus)}>{row.original.userStatus}</ToneBadge>
  }
];

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
  const table = useReactTable({
    columns,
    data: listings,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <div className="flex min-h-[540px] min-w-0 flex-col rounded-xl border bg-card text-card-foreground xl:h-full xl:min-h-0 xl:overflow-hidden">
      <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-1">
          <h2 className="font-medium">Listings</h2>
          <p className="text-sm text-muted-foreground">
            Scroll the queue in place, refine the visible slice by column, then inspect the selected listing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone="info">{listings.length} visible</ToneBadge>
          {hasActiveFilters ? (
            <Button onClick={() => onResetFilters()} size="sm" variant="outline">
              Reset filters
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 border-b p-3 md:grid-cols-5 xl:grid-cols-10">
        <div className="relative md:col-span-2 xl:col-span-2">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search listing title or description"
            className="pl-8"
            onChange={(event) => onChange({ query: event.target.value || undefined })}
            placeholder="Search"
            value={filters.query ?? ""}
          />
        </div>
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
        <Input
          aria-label="District"
          onChange={(event) => onChange({ district: event.target.value || undefined })}
          placeholder="District"
          value={filters.district ?? ""}
        />
        <Input
          aria-label="Max rent"
          min={0}
          onChange={(event) => onChange({ maxRentWarm: event.target.value ? Number(event.target.value) : undefined })}
          placeholder="Max rent"
          type="number"
          value={filters.maxRentWarm ?? ""}
        />
        <Input
          aria-label="Minimum size"
          min={0}
          onChange={(event) => onChange({ minSizeSqm: event.target.value ? Number(event.target.value) : undefined })}
          placeholder="Min size"
          type="number"
          value={filters.minSizeSqm ?? ""}
        />
        <Input
          aria-label="Minimum score"
          max={100}
          min={0}
          onChange={(event) => onChange({ minScore: event.target.value ? Number(event.target.value) : undefined })}
          placeholder="Min score"
          type="number"
          value={filters.minScore ?? ""}
        />
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
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollbars="both">
        {loading ? (
          <div className="grid min-h-80 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading listings" />
          </div>
        ) : error ? (
          <div className="grid min-h-80 place-items-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <h3 className="font-medium">Listings unavailable</h3>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button onClick={() => onResetFilters()} variant="outline">
                Reset filters
              </Button>
            </div>
          </div>
        ) : listings.length === 0 ? (
          <div className="grid min-h-80 place-items-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <h3 className="font-medium">{hasActiveFilters ? "No listings match current filters" : "No listings yet"}</h3>
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "Reset the filters or broaden the thresholds to bring the current batch back into view."
                  : "Run the worker to ingest the first batch, then the table will populate with normalized listings."}
              </p>
              {hasActiveFilters ? (
                <Button onClick={() => onResetFilters()} variant="outline">
                  Reset filters
                </Button>
              ) : (
                <code className="rounded bg-muted px-2 py-1 text-xs">make worker</code>
              )}
            </div>
          </div>
        ) : (
          <Table className="min-w-[1120px]">
            <TableHeader className="sticky top-0 z-10 bg-card">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  className="cursor-pointer"
                  data-state={selectedListingId === row.original.id ? "selected" : undefined}
                  key={row.id}
                  onClick={() => onSelect(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollArea>
    </div>
  );
}
