import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import type { AppSettings, GeoSearchResult } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { FormField } from "../components/FormField";
import { SectionHeader } from "../components/SectionHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { ToneBadge } from "../components/ToneBadge";

type SettingsPageProps = {
  settings: AppSettings | null;
  loading: boolean;
  onRetry: () => void;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onSearchOfficeLocation: (query: string) => Promise<GeoSearchResult[]>;
};

const sections = [
  { id: "profile", label: "Profile" },
  { id: "search", label: "Search" },
  { id: "office-location", label: "Office location" },
  { id: "scoring", label: "Scoring" },
  { id: "runtime", label: "Runtime" },
  { id: "semantic-rules", label: "Semantic rules" }
] as const;

type SettingsSectionId = (typeof sections)[number]["id"];

function toMultiline(value: string[]) {
  return value.join("\n");
}

function parseMultiline(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSettingsSectionId(value: string): value is SettingsSectionId {
  return sections.some((section) => section.id === value);
}

type ListTextareaProps = {
  id: string;
  rows: number;
  value: string[];
  onValueChange: (value: string[]) => void;
};

function ListTextarea({ id, rows, value, onValueChange }: ListTextareaProps) {
  const [text, setText] = useState(() => toMultiline(value));
  const [focused, setFocused] = useState(false);
  const valueText = toMultiline(value);

  useEffect(() => {
    if (!focused) {
      setText(valueText);
    }
  }, [focused, valueText]);

  return (
    <Textarea
      id={id}
      onBlur={() => {
        setFocused(false);
        setText(toMultiline(parseMultiline(text)));
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        onValueChange(parseMultiline(next));
      }}
      onFocus={() => setFocused(true)}
      rows={rows}
      value={text}
    />
  );
}

export function SettingsPage({
  settings,
  loading,
  onRetry,
  onSaveSettings,
  onSearchOfficeLocation
}: SettingsPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [officeQuery, setOfficeQuery] = useState("");
  const [officeResults, setOfficeResults] = useState<GeoSearchResult[]>([]);
  const [searchingOffice, setSearchingOffice] = useState(false);
  const [officeSearchMessage, setOfficeSearchMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const activeSection = useMemo<SettingsSectionId>(() => {
    const hash = location.hash.replace(/^#/, "");
    return isSettingsSectionId(hash) ? hash : "profile";
  }, [location.hash]);

  const handleSectionChange = (value: string) => {
    if (!isSettingsSectionId(value)) {
      return;
    }

    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: `#${value}`
      },
      { replace: true }
    );
  };

  if (loading && !draft) {
    return (
      <div className="grid min-h-96 place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading settings" />
      </div>
    );
  }

  if (!draft) {
    return (
      <SurfaceCard subtitle="Settings could not be loaded." title="Settings unavailable">
        <Button onClick={() => onRetry()} variant="outline">
          Retry
        </Button>
      </SurfaceCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        actions={
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);

              try {
                await onSaveSettings(draft);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            {saving ? "Saving..." : "Save settings"}
          </Button>
        }
        subtitle="Profile, search heuristics, office location, scoring and runtime controls."
        title="Settings"
      />

      <Tabs className="min-w-0" onValueChange={handleSectionChange} value={activeSection}>
        <div className="sticky top-0 z-20 -mx-4 border-y bg-background/95 px-4 py-2 backdrop-blur md:-mx-5 md:px-5">
          <ScrollArea className="w-full pb-2" scrollbars="horizontal">
            <TabsList className="w-max justify-start">
              {sections.map((section) => (
                <TabsTrigger className="px-3" key={section.id} value={section.id}>
                  {section.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </ScrollArea>
        </div>

        <div className="grid gap-4">
          <TabsContent className="mt-0" id="profile" value="profile">
            <SurfaceCard subtitle="Contact and bio used for downstream outreach flows." title="Profile">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField htmlFor="profile-full-name" label="Full name">
                  <Input
                    id="profile-full-name"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, profile: { ...current.profile, fullName: event.target.value } } : current
                      )
                    }
                    value={draft.profile.fullName}
                  />
                </FormField>
                <FormField htmlFor="profile-email" label="Email">
                  <Input
                    id="profile-email"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, profile: { ...current.profile, email: event.target.value } } : current
                      )
                    }
                    type="email"
                    value={draft.profile.email}
                  />
                </FormField>
                <FormField htmlFor="profile-phone" label="Phone">
                  <Input
                    id="profile-phone"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, profile: { ...current.profile, phone: event.target.value } } : current
                      )
                    }
                    value={draft.profile.phone}
                  />
                </FormField>
                <FormField className="md:col-span-2" htmlFor="profile-bio" label="Short bio">
                  <Textarea
                    id="profile-bio"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, profile: { ...current.profile, shortBio: event.target.value } } : current
                      )
                    }
                    rows={4}
                    value={draft.profile.shortBio}
                  />
                </FormField>
              </div>
            </SurfaceCard>
          </TabsContent>

          <TabsContent className="mt-0" id="search" value="search">
            <SurfaceCard subtitle="Search heuristics shared with the worker." title="Search preferences">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField htmlFor="search-city" label="City">
                  <Input
                    id="search-city"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, search: { ...current.search, city: event.target.value } } : current
                      )
                    }
                    value={draft.search.city}
                  />
                </FormField>
                <FormField
                  className="md:col-span-2"
                  description="One district per line or comma separated."
                  htmlFor="search-districts"
                  label="Search districts"
                >
                  <ListTextarea
                    id="search-districts"
                    onValueChange={(districts) =>
                      setDraft((current) =>
                        current ? { ...current, search: { ...current.search, districts } } : current
                      )
                    }
                    rows={5}
                    value={draft.search.districts}
                  />
                </FormField>
              </div>
            </SurfaceCard>
          </TabsContent>

          <TabsContent className="mt-0" id="office-location" value="office-location">
            <SurfaceCard
              actions={draft.search.officeLocation ? <ToneBadge tone="success">{draft.search.officeLocation.label}</ToneBadge> : <ToneBadge tone="warning">Not configured</ToneBadge>}
              subtitle="Set the office once to expose geographic distance throughout the product."
              title="Office location"
            >
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <FormField htmlFor="office-location-query" label="Office address">
                    <Input
                      id="office-location-query"
                      onChange={(event) => setOfficeQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                        }
                      }}
                      placeholder="Alexanderplatz 1, Berlin"
                      value={officeQuery}
                    />
                  </FormField>
                  <div className="flex items-end">
                    <Button
                      disabled={searchingOffice || officeQuery.trim().length < 3}
                      onClick={async () => {
                        setSearchingOffice(true);
                        setOfficeSearchMessage(null);

                        try {
                          const results = await onSearchOfficeLocation(officeQuery);
                          setOfficeResults(results);
                          setOfficeSearchMessage(results.length === 0 ? "No office candidates found." : null);
                        } catch (error) {
                          setOfficeSearchMessage(error instanceof Error ? error.message : "Office lookup failed");
                        } finally {
                          setSearchingOffice(false);
                        }
                      }}
                    >
                      {searchingOffice ? <Loader2 className="animate-spin" /> : null}
                      {searchingOffice ? "Searching..." : "Find location"}
                    </Button>
                  </div>
                </div>

                {draft.search.officeLocation ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <span className="text-xs text-muted-foreground">Current office</span>
                    <strong className="block">{draft.search.officeLocation.label}</strong>
                    <p className="text-sm text-muted-foreground">{draft.search.officeLocation.address}</p>
                  </div>
                ) : null}

                {officeSearchMessage ? <p className="text-sm text-muted-foreground">{officeSearchMessage}</p> : null}

                {officeResults.length > 0 ? (
                  <div className="grid gap-2">
                    {officeResults.map((result) => (
                      <button
                        className="rounded-lg border p-3 text-left transition-colors hover:bg-muted"
                        key={`${result.address}-${result.latitude}-${result.longitude}`}
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  search: {
                                    ...current.search,
                                    officeLocation: {
                                      ...result,
                                      updatedAt: new Date().toISOString()
                                    }
                                  }
                                }
                              : current
                          )
                        }
                        type="button"
                      >
                        <strong className="block">{result.label}</strong>
                        <span className="block text-sm text-muted-foreground">{result.address}</span>
                        <span className="block text-xs text-muted-foreground">{result.district ?? "Berlin"}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <Button
                  disabled={!draft.search.officeLocation}
                  onClick={() =>
                    setDraft((current) =>
                      current ? { ...current, search: { ...current.search, officeLocation: null } } : current
                    )
                  }
                  variant="outline"
                >
                  Clear office location
                </Button>
              </div>
            </SurfaceCard>
          </TabsContent>

          <TabsContent className="mt-0" id="scoring" value="scoring">
            <SurfaceCard subtitle="Deterministic score thresholds and bonuses." title="Scoring">
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  className="md:col-span-3"
                  description="One district per line or comma separated."
                  htmlFor="score-preferred-districts"
                  label="Preferred districts"
                >
                  <ListTextarea
                    id="score-preferred-districts"
                    onValueChange={(preferredDistricts) =>
                      setDraft((current) =>
                        current ? { ...current, scoring: { ...current.scoring, preferredDistricts } } : current
                      )
                    }
                    rows={4}
                    value={draft.scoring.preferredDistricts}
                  />
                </FormField>
                {[
                  { id: "score-max-rent", label: "Max warm rent", key: "maxWarmRent", min: 0 },
                  { id: "score-min-size", label: "Minimum size", key: "minimumSizeSqm", min: 0 },
                  { id: "score-min-rooms", label: "Minimum rooms", key: "minimumRooms", min: 0, step: 0.5 },
                  { id: "score-balcony-bonus", label: "Balcony bonus", key: "balconyBonus" },
                  { id: "score-elevator-bonus", label: "Elevator bonus", key: "elevatorBonus" },
                  { id: "score-furnished-penalty", label: "Furnished penalty", key: "furnishedPenalty" }
                ].map((field) => (
                  <FormField htmlFor={field.id} key={field.id} label={field.label}>
                    <Input
                      id={field.id}
                      min={field.min}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isNaN(value)) {
                          return;
                        }

                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                scoring: {
                                  ...current.scoring,
                                  [field.key]: value
                                }
                              }
                            : current
                        );
                      }}
                      step={field.step}
                      type="number"
                      value={draft.scoring[field.key as keyof AppSettings["scoring"]]}
                    />
                  </FormField>
                ))}
              </div>
            </SurfaceCard>
          </TabsContent>

          <TabsContent className="mt-0" id="runtime" value="runtime">
            <SurfaceCard subtitle="Worker and semantic runtime behavior." title="Runtime">
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  {
                    key: "enableSemanticClassifier",
                    label: "Enable semantic classifier",
                    description: "Disable to keep deterministic scoring only."
                  },
                  {
                    key: "enableLlmEnrichment",
                    label: "Enable English analyst",
                    description: "Translate and summarize listings with the English analyst pipeline."
                  },
                  {
                    key: "llmClassifierFallbackEnabled",
                    label: "Enable classifier fallback",
                    description: "Escalate promising Gemma UNSURE results to Flash within the worker budget."
                  },
                  {
                    key: "scrapeWithFixtures",
                    label: "Use fixtures",
                    description: "Use only for parser debugging; live scraping is the default local mode."
                  }
                ].map((item) => (
                  <div className="flex items-start justify-between gap-4 rounded-lg border p-3" key={item.key}>
                    <div>
                      <div className="text-sm font-medium">{item.label}</div>
                      <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch
                      checked={Boolean(draft.runtime[item.key as keyof AppSettings["runtime"]])}
                      onCheckedChange={(checked) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                runtime: {
                                  ...current.runtime,
                                  [item.key]: checked
                                }
                              }
                            : current
                        )
                      }
                    />
                  </div>
                ))}
                <FormField
                  description="Primary quota-friendly classifier default: gemma-4-26b-a4b-it."
                  htmlFor="runtime-llm-classifier-model"
                  label="Primary classifier model"
                >
                  <Input
                    id="runtime-llm-classifier-model"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, runtime: { ...current.runtime, llmClassifierModel: event.target.value } } : current
                      )
                    }
                    value={draft.runtime.llmClassifierModel}
                  />
                </FormField>
                <FormField
                  description="Premium fallback default: gemini-2.5-flash."
                  htmlFor="runtime-llm-classifier-fallback-model"
                  label="Fallback classifier model"
                >
                  <Input
                    id="runtime-llm-classifier-fallback-model"
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, runtime: { ...current.runtime, llmClassifierFallbackModel: event.target.value } }
                          : current
                      )
                    }
                    value={draft.runtime.llmClassifierFallbackModel}
                  />
                </FormField>
                <FormField
                  description="Flash fallback only runs for Gemma UNSURE or recoverable errors at or above this score."
                  htmlFor="runtime-llm-classifier-fallback-min-score"
                  label="Fallback min score"
                >
                  <Input
                    id="runtime-llm-classifier-fallback-min-score"
                    min={0}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isNaN(value)) {
                        return;
                      }

                      setDraft((current) =>
                        current
                          ? { ...current, runtime: { ...current.runtime, llmClassifierFallbackMinScore: value } }
                          : current
                      );
                    }}
                    type="number"
                    value={draft.runtime.llmClassifierFallbackMinScore}
                  />
                </FormField>
                <FormField
                  description="Quality default: gemini-2.5-flash. Use gemma-4-26b-a4b-it only after benchmark checks."
                  htmlFor="runtime-llm-analyst-model"
                  label="English analyst model"
                >
                  <Input
                    id="runtime-llm-analyst-model"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, runtime: { ...current.runtime, llmAnalystModel: event.target.value } } : current
                      )
                    }
                    value={draft.runtime.llmAnalystModel}
                  />
                </FormField>
              </div>
            </SurfaceCard>
          </TabsContent>

          <TabsContent className="mt-0" id="semantic-rules" value="semantic-rules">
            <SurfaceCard subtitle="Textual constraints passed into semantic classification." title="Semantic rules">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField description="One rule per line or comma separated." htmlFor="semantic-must-match" label="Must match">
                  <ListTextarea
                    id="semantic-must-match"
                    onValueChange={(mustMatch) =>
                      setDraft((current) =>
                        current
                          ? { ...current, semanticRules: { ...current.semanticRules, mustMatch } }
                          : current
                      )
                    }
                    rows={5}
                    value={draft.semanticRules.mustMatch}
                  />
                </FormField>
                <FormField description="One rule per line or comma separated." htmlFor="semantic-avoid" label="Avoid">
                  <ListTextarea
                    id="semantic-avoid"
                    onValueChange={(avoid) =>
                      setDraft((current) =>
                        current
                          ? { ...current, semanticRules: { ...current.semanticRules, avoid } }
                          : current
                      )
                    }
                    rows={5}
                    value={draft.semanticRules.avoid}
                  />
                </FormField>
                <FormField className="md:col-span-2" htmlFor="semantic-notes" label="Classifier notes">
                  <Textarea
                    id="semantic-notes"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, semanticRules: { ...current.semanticRules, notes: event.target.value } } : current
                      )
                    }
                    rows={6}
                    value={draft.semanticRules.notes}
                  />
                </FormField>
              </div>
            </SurfaceCard>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
