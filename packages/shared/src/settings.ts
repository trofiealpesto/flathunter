import { z } from "zod";
import { officeLocationSchema } from "./geo";

// Analyst always stays on Gemini (native responseJsonSchema support).
export const defaultAnalystModel = "gemini-2.5-flash";

// Free-tier defaults per provider. classifierModel = primary; classifierFallbackModel = escalation model.
export const providerDefaults = {
  gemini: {
    classifierModel: "gemini-2.5-flash-lite",
    classifierFallbackModel: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta"
  },
  groq: {
    // llama-3.1-8b-instant: 14,400 RPD free; fallback to 70B (1,000 RPD free).
    classifierModel: "llama-3.1-8b-instant",
    classifierFallbackModel: "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai/v1"
  },
  cerebras: {
    // llama3.1-8b free; escalate to 70B for uncertain listings.
    classifierModel: "llama3.1-8b",
    classifierFallbackModel: "llama-3.3-70b",
    baseUrl: "https://api.cerebras.ai/v1"
  }
} as const;

export type LlmProvider = keyof typeof providerDefaults;

// Kept for backward compat — still the Gemini primary/fallback defaults.
export const defaultClassifierPrimaryModel = providerDefaults.gemini.classifierModel;
export const defaultClassifierFallbackModel = providerDefaults.gemini.classifierFallbackModel;
export const defaultClassifierFallbackMinScore = 80;

const runtimeSettingsObjectSchema = z.object({
  llmProvider: z.enum(["gemini", "groq", "cerebras"]).default("gemini"),
  enableSemanticClassifier: z.boolean().default(true),
  enableLlmEnrichment: z.boolean().default(true),
  llmClassifierModel: z.string().trim().min(1).default(defaultClassifierPrimaryModel),
  llmClassifierFallbackEnabled: z.boolean().default(true),
  llmClassifierFallbackModel: z.string().trim().min(1).default(defaultClassifierFallbackModel),
  llmClassifierFallbackMinScore: z.number().int().nonnegative().default(defaultClassifierFallbackMinScore),
  llmAnalystModel: z.string().trim().min(1).default(defaultAnalystModel),
  scrapeWithFixtures: z.boolean().default(false)
});
const defaultRuntimeSettings = runtimeSettingsObjectSchema.parse({});

const runtimeSettingsSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const provider = (record.llmProvider as string | undefined) ?? "gemini";
  const defaults = providerDefaults[provider as LlmProvider] ?? providerDefaults.gemini;

  // Use provider-specific model defaults when the user hasn't explicitly set a model,
  // so switching provider automatically picks sensible model names.
  const llmClassifierModel =
    record.llmClassifierModel ??
    record.ollamaModel ??
    defaults.classifierModel;
  const llmClassifierFallbackModel =
    record.llmClassifierFallbackModel ??
    defaults.classifierFallbackModel;
  const llmAnalystModel =
    record.llmAnalystModel ??
    record.ollamaTranslationModel ??
    record.ollamaModel ??
    defaultAnalystModel;

  return {
    ...record,
    llmClassifierModel,
    llmClassifierFallbackModel,
    llmAnalystModel
  };
}, runtimeSettingsObjectSchema);

export const appSettingsSchema = z.object({
  scoring: z.object({
    maxWarmRent: z.number().int().positive(),
    minimumSizeSqm: z.number().int().positive(),
    minimumRooms: z.number().positive(),
    preferredDistricts: z.array(z.string().trim().min(1)),
    balconyBonus: z.number().int(),
    elevatorBonus: z.number().int(),
    furnishedPenalty: z.number().int(),
    // Defaults keep previously stored settings JSON parseable without a migration.
    maxCommuteMinutes: z.number().int().positive().default(35),
    commutePenaltyPerTenMinutes: z.number().int().nonnegative().default(5)
  }),
  search: z.object({
    city: z.string().trim().min(1),
    districts: z.array(z.string().trim().min(1)),
    immoweltSearchUrl: z.string().url(),
    officeLocation: officeLocationSchema.nullable()
  }),
  semanticRules: z.object({
    mustMatch: z.array(z.string().trim().min(1)),
    avoid: z.array(z.string().trim().min(1)),
    notes: z.string().trim()
  }),
  runtime: runtimeSettingsSchema.default(defaultRuntimeSettings),
  profile: z.object({
    fullName: z.string().trim(),
    shortBio: z.string().trim(),
    email: z.string().email().or(z.literal("")),
    phone: z.string().trim()
  })
});

export const appSettingsPatchSchema = z.object({
  scoring: appSettingsSchema.shape.scoring.partial().optional(),
  search: appSettingsSchema.shape.search.partial().optional(),
  semanticRules: appSettingsSchema.shape.semanticRules.partial().optional(),
  runtime: runtimeSettingsObjectSchema.partial().optional(),
  profile: appSettingsSchema.shape.profile.partial().optional()
});

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

export const defaultAppSettings: AppSettings = {
  scoring: {
    maxWarmRent: 1800,
    minimumSizeSqm: 50,
    minimumRooms: 2,
    preferredDistricts: ["Prenzlauer Berg", "Mitte", "Friedrichshain", "Kreuzberg"],
    balconyBonus: 5,
    elevatorBonus: 3,
    furnishedPenalty: 8,
    maxCommuteMinutes: 35,
    commutePenaltyPerTenMinutes: 5
  },
  search: {
    city: "Berlin",
    districts: ["Prenzlauer Berg", "Mitte", "Friedrichshain", "Kreuzberg"],
    immoweltSearchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
    officeLocation: null
  },
  semanticRules: {
    mustMatch: ["apartment in Berlin", "private long-term rental"],
    avoid: ["WBS required", "swap only", "temporary sublet under 6 months"],
    notes: "Prefer listings suitable for a couple and long-term residence."
  },
  runtime: {
    llmProvider: "gemini",
    enableSemanticClassifier: true,
    enableLlmEnrichment: true,
    llmClassifierModel: defaultClassifierPrimaryModel,
    llmClassifierFallbackEnabled: true,
    llmClassifierFallbackModel: defaultClassifierFallbackModel,
    llmClassifierFallbackMinScore: defaultClassifierFallbackMinScore,
    llmAnalystModel: defaultAnalystModel,
    scrapeWithFixtures: false
  },
  profile: {
    fullName: "",
    shortBio: "",
    email: "",
    phone: ""
  }
};
