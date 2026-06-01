import type { AppSettings } from "./settings";
import type { AnalysisFlag, EligibilityState, ListingSummary, ListingUpsertInput } from "./listings";
import { computeDeterministicScore } from "./scoring";

type AnalyzableListing = Partial<Pick<ListingSummary, "title" | "description" | "availableFrom" | "isFurnished" | "hasBalcony" | "hasElevator" | "rooms" | "sizeSqm">> &
  Partial<Pick<ListingUpsertInput, "title" | "description" | "availableFrom" | "isFurnished" | "hasBalcony" | "hasElevator" | "rooms" | "sizeSqm">>;

export type DeterministicEvaluation = {
  analysisFlags: AnalysisFlag[];
  score: number;
  eligibilityState: EligibilityState;
  reason: string;
  shouldRunSemanticClassifier: boolean;
};

const FLAG_REASON_LABELS: Record<AnalysisFlag, string> = {
  wbs_required: "WBS required",
  swap_only: "swap-only listing",
  temporary_sublet: "temporary sublet",
  room_only: "shared-room listing",
  couple_friendly: "couple-friendly language",
  long_term: "long-term language",
  balcony_mentioned: "balcony mentioned",
  elevator_mentioned: "elevator mentioned",
  furnished_text: "furnished language"
};

function normalizeText(value: string | null | undefined) {
  return value
    ?.normalize("NFKD")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() ?? "";
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function extractAnalysisFlags(listing: AnalyzableListing): AnalysisFlag[] {
  const combinedText = normalizeText(
    [
      listing.title,
      listing.description,
      listing.availableFrom
    ]
      .filter(Boolean)
      .join(" ")
  );

  const flags = new Set<AnalysisFlag>();

  if (
    includesAny(combinedText, [
      /\bwbs\b/,
      /wohnberechtigungsschein/,
      /housing permit/
    ])
  ) {
    flags.add("wbs_required");
  }

  if (
    includesAny(combinedText, [
      /\bwohnungstausch\b/,
      /\btauschwohnung\b/,
      /\bswap only\b/,
      /\bapartment swap\b/
    ])
  ) {
    flags.add("swap_only");
  }

  if (
    includesAny(combinedText, [
      /\bzwischenmiete\b/,
      /\buntermiete\b/,
      /\bbefristet\b/,
      /\bauf zeit\b/,
      /\btemporary sublet\b/,
      /\bshort[- ]term\b/,
      /\bsublet\b/,
      /\blimited term\b/,
      /\bonly for \d+/,
      /\bfor \d+ months?\b/,
      /\bfur \d+ monate?\b/
    ])
  ) {
    flags.add("temporary_sublet");
  }

  if (
    includesAny(combinedText, [
      /\bwg[- ]zimmer\b/,
      /\bshared flat\b/,
      /\broom in shared\b/,
      /\bprivatzimmer\b/,
      /\broommate\b/
    ])
  ) {
    flags.add("room_only");
  }

  if (
    includesAny(combinedText, [
      /\bfur paare\b/,
      /\bfuer paare\b/,
      /\bpaare\b/,
      /\bideal for couples\b/,
      /\bcouple(?:s)?\b/
    ])
  ) {
    flags.add("couple_friendly");
  }

  if (
    includesAny(combinedText, [
      /\blangfristig\b/,
      /\bunbefrist\w*\b/,
      /\bauf unbestimmte zeit\b/,
      /\blong[- ]term\b/,
      /\bpermanent\b/
    ])
  ) {
    flags.add("long_term");
  }

  if (listing.hasBalcony || includesAny(combinedText, [/\bbalkon\b/, /\bbalcony\b/])) {
    flags.add("balcony_mentioned");
  }

  if (listing.hasElevator || includesAny(combinedText, [/\baufzug\b/, /\belevator\b/, /\blift\b/])) {
    flags.add("elevator_mentioned");
  }

  if (listing.isFurnished || includesAny(combinedText, [/\bmobliert\b/, /\bmoebliert\b/, /\bfurnished\b/])) {
    flags.add("furnished_text");
  }

  return [...flags];
}

function describeFlags(flags: AnalysisFlag[]) {
  if (flags.length === 0) {
    return "no strong text signals";
  }

  return flags.map((flag) => FLAG_REASON_LABELS[flag]).join(", ");
}

function buildRejectReason(flag: AnalysisFlag) {
  return `Deterministic reject: ${FLAG_REASON_LABELS[flag]}.`;
}

function listingClearlyMissesProfile(
  listing: Parameters<typeof evaluateListingDeterministically>[0],
  settings: AppSettings
): string | null {
  if (listing.rentWarm != null && listing.rentWarm > settings.scoring.maxWarmRent * 1.2) {
    return `warm rent ${listing.rentWarm} exceeds limit ${settings.scoring.maxWarmRent} by >20%`;
  }

  if (listing.sizeSqm != null && listing.sizeSqm < settings.scoring.minimumSizeSqm * 0.75) {
    return `size ${listing.sizeSqm} sqm is <75% of minimum ${settings.scoring.minimumSizeSqm} sqm`;
  }

  if (listing.rooms != null && listing.rooms < settings.scoring.minimumRooms - 0.75) {
    return `${listing.rooms} rooms is below minimum ${settings.scoring.minimumRooms}`;
  }

  return null;
}

export function evaluateListingDeterministically(
  listing: AnalyzableListing & Pick<ListingSummary, "district" | "rentWarm"> & Partial<Pick<ListingSummary, "city">>,
  settings: AppSettings
): DeterministicEvaluation {
  const analysisFlags = extractAnalysisFlags(listing);
  const score = computeDeterministicScore(listing, settings, analysisFlags);

  const hardRejectFlag = analysisFlags.find((flag) =>
    ["wbs_required", "swap_only", "temporary_sublet", "room_only"].includes(flag)
  );

  if (hardRejectFlag) {
    return {
      analysisFlags,
      score,
      eligibilityState: "REJECT",
      reason: buildRejectReason(hardRejectFlag),
      shouldRunSemanticClassifier: false
    };
  }

  const profileMissReason = listingClearlyMissesProfile(listing, settings);

  if (profileMissReason) {
    return {
      analysisFlags,
      score,
      eligibilityState: "REJECT",
      reason: `Deterministic reject: ${profileMissReason}.`,
      shouldRunSemanticClassifier: false
    };
  }

  // No deterministic MATCH: the LLM is the only authority for positive decisions.
  // Deterministic logic is reject-only; everything else goes to the semantic classifier.
  return {
    analysisFlags,
    score,
    eligibilityState: "UNSURE",
    reason: `Pending LLM evaluation: score ${score}; ${describeFlags(analysisFlags)}.`,
    shouldRunSemanticClassifier: true
  };
}
