import type { AppSettings } from "./settings";
import type { AnalysisFlag, EligibilityState, ListingSummary, ListingUpsertInput } from "./listings";
import { computeDeterministicScore, type ScoringContext } from "./scoring";

type AnalyzableListing = Partial<Pick<ListingSummary, "title" | "description" | "availableFrom" | "isFurnished" | "hasBalcony" | "hasElevator" | "rooms" | "sizeSqm">> &
  Partial<Pick<ListingUpsertInput, "title" | "description" | "availableFrom" | "isFurnished" | "hasBalcony" | "hasElevator" | "rooms" | "sizeSqm">>;

export type DeterministicEvaluation = {
  analysisFlags: AnalysisFlag[];
  score: number;
  eligibilityState: EligibilityState;
  reason: string;
  shouldRunSemanticClassifier: boolean;
};

// Invalidates cached verdicts/templates that were derived from the old text rules.
export const deterministicAnalysisVersion = "rental-rules-v2";

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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() ?? "";
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const NEGATED_CLAUSE = /\b(?:kein\w*|nicht|ohne|no|not|never|without|neither|nor|non|senza)\b|\b(?:isn|aren|doesn|don|won|can)\s+t\b/;
const UNCERTAIN_CLAUSE = /\b(?:if|unless|maybe|optional|possibly|wenn|falls|eventuell|vielleicht|fruher|ehemals|bisher|previously|formerly|nebenan|nachbar\w*|neighbou?r\w*|next door|ignore|ignoriere|instructions?|anweisungen|classify|output)\b|[?"“”«»]/i;
const BLOCKING_FLAGS: AnalysisFlag[] = ["wbs_required", "swap_only", "temporary_sublet", "room_only"];

function analyzeListingText(listing: AnalyzableListing) {
  const text = [listing.title, listing.description, listing.availableFrom].filter(Boolean).join("\n");
  const combinedText = normalizeText(text);
  // Keep fields and clauses separate: negating WBS must not hide a swap elsewhere.
  const clauses = text.split(/[.;!\n,]+|\b(?:aber|but|jedoch|however|sondern)\b/i);
  let requiresSemanticReview = false;
  let contradictory = false;
  function hasAffirmativeSignal(patterns: RegExp[], mentions = patterns) {
    let affirmed = false;
    let negated = false;
    let uncertain = false;
    for (const clause of clauses) {
      const normalized = normalizeText(clause);
      if (!includesAny(normalized, mentions)) continue;
      if (UNCERTAIN_CLAUSE.test(clause) || UNCERTAIN_CLAUSE.test(normalized)) uncertain = true;
      else if (NEGATED_CLAUSE.test(normalized)) negated = true;
      else if (includesAny(normalized, patterns)) affirmed = true;
      else uncertain = true;
    }
    contradictory ||= affirmed && negated;
    requiresSemanticReview ||= uncertain || negated;
    // Negation scope inside a clause is deliberately conservative; the LLM resolves it.
    return affirmed && !negated && !uncertain;
  }

  const flags = new Set<AnalysisFlag>();

  if (
    hasAffirmativeSignal([
      /\b(?:wbs|wohnberechtigungsschein|housing permit)\s+(?:(?:ist|is)\s+)?(?:erforderlich|notwendig|pflicht|mandatory|required|needed)\b/,
      /\b(?:requires?|need|benotig\w*)\s+(?:(?:a|an|einen|ein)\s+)?(?:wbs|wohnberechtigungsschein|housing permit)\b/,
      /\bnur\s+mit\s+(?:gultigem\s+)?wbs\b/,
      /\bwbs[- ](?:pflichtig\w*|wohnung)\b/
    ], [/\bwbs\b/, /\bwohnberechtigungsschein\b/, /\bhousing permit\b/])
  ) {
    flags.add("wbs_required");
  }

  if (
    hasAffirmativeSignal([
      /\bwohnungstausch\b/,
      /\btauschwohnung\b/,
      /\bswap only\b/,
      /\bapartment swap\b/
    ])
  ) {
    flags.add("swap_only");
  }

  if (
    hasAffirmativeSignal([
      /\bzwischenmiete\b/,
      /\bbefristet(?:e[rmns]?)?\b/,
      /\bauf zeit\b/,
      /\btemporary sublet\b/,
      /\bshort[- ]term\b/,
      /\blimited term\b/,
      /\bfixed[- ]term\b/,
      /\bonly for \d+/,
      /\bfor \d+ months?\b/,
      /\bfur \d+ monate?\b/
    ])
  ) {
    flags.add("temporary_sublet");
  }

  if (
    hasAffirmativeSignal([
      /\bwg[- ]zimmer\b/,
      /\broom in (?:a )?shared\b/,
      /\b(?:one|single|only a|only one) (?:bed)?room\b.{0,60}\bshared (?:flat|kitchen|bathroom)\b/,
      /\bprivatzimmer\b/
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
    hasAffirmativeSignal([
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

  contradictory ||= flags.has("temporary_sublet") && flags.has("long_term");
  if (contradictory) {
    // Conflicting conditions/corrections need interpretation before any text-only rejection.
    for (const flag of [...BLOCKING_FLAGS, "long_term"] as AnalysisFlag[]) flags.delete(flag);
  }
  return { analysisFlags: [...flags], requiresSemanticReview: requiresSemanticReview || contradictory };
}

export function extractAnalysisFlags(listing: AnalyzableListing): AnalysisFlag[] {
  return analyzeListingText(listing).analysisFlags;
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
  settings: AppSettings,
  scoringContext: ScoringContext = {}
): DeterministicEvaluation {
  const { analysisFlags, requiresSemanticReview } = analyzeListingText(listing);
  const score = computeDeterministicScore(listing, settings, analysisFlags, scoringContext);

  const hardRejectFlag = analysisFlags.find((flag) =>
    BLOCKING_FLAGS.includes(flag)
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

  // Numeric facts cannot establish that arbitrary natural-language requirements are met.
  const hasSemanticRequirements = settings.semanticRules.mustMatch.length > 0
    || settings.semanticRules.avoid.length > 0 || settings.semanticRules.notes.trim().length > 0;
  if (
    !hasSemanticRequirements && !requiresSemanticReview &&
    listing.rentWarm != null &&
    listing.rentWarm <= settings.scoring.maxWarmRent &&
    listing.sizeSqm != null &&
    listing.sizeSqm >= settings.scoring.minimumSizeSqm &&
    listing.rooms != null &&
    listing.rooms >= settings.scoring.minimumRooms
  ) {
    return {
      analysisFlags,
      score,
      eligibilityState: "MATCH",
      reason: `Deterministic match: all core criteria met (score ${score}); ${describeFlags(analysisFlags)}.`,
      shouldRunSemanticClassifier: false
    };
  }

  return {
    analysisFlags,
    score,
    eligibilityState: "UNSURE",
    reason: `Pending LLM evaluation: ${hasSemanticRequirements || requiresSemanticReview ? "text conditions require semantic review; " : ""}score ${score}; ${describeFlags(analysisFlags)}.`,
    shouldRunSemanticClassifier: true
  };
}
