import { defaultAppSettings, evaluateListingDeterministically } from "@flathunter/shared";

import { loadLlmBenchmarkCorpus } from "./llm-corpus";
import { classifyListingEligibility, generateListingEnglishAnalyst } from "../services/semantic";

type BenchmarkConfig = {
  id: string;
  classifierModel: string;
  analystModel: string;
};

type CaseResult = {
  id: string;
  classifierValid: boolean;
  analystValid: boolean;
  classifierLatencyMs: number;
  analystLatencyMs: number;
  matchedExpectation: boolean;
  translatedTitle: string | null;
  translatedDescription: string | null;
  eligibilityState: string | null;
  flags: string[];
  error: string | null;
};

const benchmarkConfigs: BenchmarkConfig[] = [
  {
    id: "baseline-flash-lite",
    classifierModel: "gemini-2.5-flash-lite",
    analystModel: "gemini-2.5-flash-lite"
  },
  {
    id: "recommended-mix",
    classifierModel: "gemini-2.5-flash-lite",
    analystModel: "gemini-2.5-flash"
  },
  {
    id: "flash-only",
    classifierModel: "gemini-2.5-flash",
    analystModel: "gemini-2.5-flash"
  }
];

function normalizeFlag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2 : sorted[midpoint]!;
}

function toRate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(3));
}

async function runCase(
  config: BenchmarkConfig,
  benchCase: ReturnType<typeof loadLlmBenchmarkCorpus>[number],
  apiKey: string,
  baseUrl: string,
  timeoutMs: number
): Promise<CaseResult> {
  const deterministic = evaluateListingDeterministically(benchCase.listing, defaultAppSettings);
  const classifierStart = performance.now();

  try {
    const classification = await classifyListingEligibility(
      benchCase.listing,
      defaultAppSettings,
      {
        deterministicScore: deterministic.score,
        deterministicReason: deterministic.reason,
        analysisFlags: deterministic.analysisFlags
      },
      {
        apiKey,
        baseUrl,
        classifierModel: config.classifierModel,
        analystModel: config.analystModel,
        fetchImpl: fetch,
        timeoutMs,
        retryTimeoutMs: Math.round(timeoutMs * 1.25)
      }
    );
    const classifierLatencyMs = Math.round(performance.now() - classifierStart);

    const analystStart = performance.now();
    const analysis = await generateListingEnglishAnalyst(benchCase.listing, defaultAppSettings, {
      apiKey,
      baseUrl,
      classifierModel: config.classifierModel,
      analystModel: config.analystModel,
      fetchImpl: fetch,
      analystTimeoutMs: Math.max(timeoutMs, 45_000)
    });
    const analystLatencyMs = Math.round(performance.now() - analystStart);
    const normalizedFlags = classification.flags.map(normalizeFlag);
    const matchedExpectation =
      classification.eligibilityState === benchCase.expectation.eligibilityState &&
      benchCase.expectation.requiredFlags.every((flag) => normalizedFlags.includes(flag));

    return {
      id: benchCase.id,
      classifierValid: !classification.usedFallback,
      analystValid: true,
      classifierLatencyMs,
      analystLatencyMs,
      matchedExpectation,
      translatedTitle: analysis.llmAnalysis.translatedTitle,
      translatedDescription: analysis.llmAnalysis.translatedDescription,
      eligibilityState: classification.eligibilityState,
      flags: normalizedFlags,
      error: null
    };
  } catch (error) {
    return {
      id: benchCase.id,
      classifierValid: false,
      analystValid: false,
      classifierLatencyMs: Math.round(performance.now() - classifierStart),
      analystLatencyMs: 0,
      matchedExpectation: false,
      translatedTitle: null,
      translatedDescription: null,
      eligibilityState: null,
      flags: [],
      error: error instanceof Error ? error.message : "Unknown benchmark failure"
    };
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for the Gemini benchmark.");
  }

  const baseUrl = process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const taskTimeoutMs = Number.parseInt(process.env.LLM_BENCH_TIMEOUT_MS ?? "", 10);
  const requestedConfigIds = new Set(
    (process.env.LLM_BENCH_CONFIGS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const caseLimit = Number.parseInt(process.env.LLM_BENCH_CASE_LIMIT ?? "", 10);
  const corpus = loadLlmBenchmarkCorpus().slice(0, Number.isFinite(caseLimit) && caseLimit > 0 ? caseLimit : undefined);
  const effectiveTaskTimeoutMs = Number.isFinite(taskTimeoutMs) && taskTimeoutMs > 0 ? taskTimeoutMs : 30_000;
  const selectedConfigs = requestedConfigIds.size > 0
    ? benchmarkConfigs.filter((config) => requestedConfigIds.has(config.id))
    : benchmarkConfigs;

  if (selectedConfigs.length === 0) {
    throw new Error("No Gemini benchmark configs selected.");
  }

  const reports = [];

  for (const config of selectedConfigs) {
    const caseResults: CaseResult[] = [];

    for (const benchCase of corpus) {
      caseResults.push(await runCase(config, benchCase, apiKey, baseUrl, effectiveTaskTimeoutMs));
    }

    const classifierLatencies = caseResults.filter((result) => result.classifierValid).map((result) => result.classifierLatencyMs);
    const analystLatencies = caseResults.filter((result) => result.analystValid).map((result) => result.analystLatencyMs);

    reports.push({
      id: config.id,
      classifierModel: config.classifierModel,
      analystModel: config.analystModel,
      metrics: {
        classifierValidJsonRate: toRate(
          caseResults.filter((result) => result.classifierValid).length,
          caseResults.length
        ),
        analystValidJsonRate: toRate(
          caseResults.filter((result) => result.analystValid).length,
          caseResults.length
        ),
        semanticMatchRate: toRate(
          caseResults.filter((result) => result.matchedExpectation).length,
          caseResults.length
        ),
        medianClassifierLatencyMs: median(classifierLatencies),
        medianAnalystLatencyMs: median(analystLatencies)
      },
      cases: caseResults
    });
  }

  const summary = {
    provider: "gemini",
    apiBaseUrl: baseUrl,
    totalCases: corpus.length,
    reports
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
