import { z } from "zod";
import { officeLocationSchema } from "./geo";

const runtimeSettingsObjectSchema = z.object({
  llmProvider: z.literal("gemini").default("gemini"),
  enableSemanticClassifier: z.boolean().default(true),
  enableLlmEnrichment: z.boolean().default(true),
  llmClassifierModel: z.string().trim().min(1).default("gemini-2.5-flash-lite"),
  llmAnalystModel: z.string().trim().min(1).default("gemini-2.5-flash"),
  scrapeWithFixtures: z.boolean().default(false)
});
const defaultRuntimeSettings = runtimeSettingsObjectSchema.parse({});

const runtimeSettingsSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const llmClassifierModel =
    record.llmClassifierModel ??
    record.ollamaModel ??
    "gemini-2.5-flash-lite";
  const llmAnalystModel =
    record.llmAnalystModel ??
    record.ollamaTranslationModel ??
    record.ollamaModel ??
    "gemini-2.5-flash";

  return {
    ...record,
    llmProvider: "gemini",
    llmClassifierModel,
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
    furnishedPenalty: z.number().int()
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
    furnishedPenalty: 8
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
    llmClassifierModel: "gemini-2.5-flash-lite",
    llmAnalystModel: "gemini-2.5-flash",
    scrapeWithFixtures: false
  },
  profile: {
    fullName: "",
    shortBio: "",
    email: "",
    phone: ""
  }
};
