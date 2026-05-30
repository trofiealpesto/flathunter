import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLocation } from "react-router-dom";

import type { AppSettings, GeoSearchResult } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
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

function toMultiline(value: string[]) {
  return value.join("\n");
}

function parseMultiline(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SettingsPage({
  settings,
  loading,
  onRetry,
  onSaveSettings,
  onSearchOfficeLocation
}: SettingsPageProps) {
  const location = useLocation();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [officeQuery, setOfficeQuery] = useState("");
  const [officeResults, setOfficeResults] = useState<GeoSearchResult[]>([]);
  const [searchingOffice, setSearchingOffice] = useState(false);
  const [officeSearchMessage, setOfficeSearchMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const activeHash = useMemo(() => location.hash.replace(/^#/, "") || "profile", [location.hash]);

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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
        <div className="grid gap-4">
          <section id="profile">
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
          </section>

          <section id="search">
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
                  label="Preferred districts"
                >
                  <Textarea
                    id="search-districts"
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, search: { ...current.search, districts: parseMultiline(event.target.value) } } : current
                      )
                    }
                    rows={5}
                    value={toMultiline(draft.search.districts)}
                  />
                </FormField>
              </div>
            </SurfaceCard>
          </section>

          <section id="office-location">
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
          </section>

          <section id="scoring">
            <SurfaceCard subtitle="Deterministic score thresholds and bonuses." title="Scoring">
              <div className="grid gap-4 md:grid-cols-3">
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
          </section>

          <section id="runtime">
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
                  description="Recommended hot-path classifier default: gemini-2.5-flash-lite."
                  htmlFor="runtime-llm-classifier-model"
                  label="Classifier model"
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
                  description="Recommended on-demand English analyst default: gemini-2.5-flash."
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
          </section>

          <section id="semantic-rules">
            <SurfaceCard subtitle="Textual constraints passed into semantic classification." title="Semantic rules">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField description="One rule per line or comma separated." htmlFor="semantic-must-match" label="Must match">
                  <Textarea
                    id="semantic-must-match"
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, semanticRules: { ...current.semanticRules, mustMatch: parseMultiline(event.target.value) } }
                          : current
                      )
                    }
                    rows={5}
                    value={toMultiline(draft.semanticRules.mustMatch)}
                  />
                </FormField>
                <FormField description="One rule per line or comma separated." htmlFor="semantic-avoid" label="Avoid">
                  <Textarea
                    id="semantic-avoid"
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, semanticRules: { ...current.semanticRules, avoid: parseMultiline(event.target.value) } }
                          : current
                      )
                    }
                    rows={5}
                    value={toMultiline(draft.semanticRules.avoid)}
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
          </section>
        </div>

        <aside className="hidden xl:block">
          <SurfaceCard subtitle="Jump between configuration groups." title="Sections">
            <ScrollArea className="max-h-[calc(100svh-12rem)]">
              <nav className="grid gap-1">
                {sections.map((section) => (
                  <a
                    className={`rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted ${
                      activeHash === section.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground"
                    }`}
                    href={`#${section.id}`}
                    key={section.id}
                  >
                    {section.label}
                  </a>
                ))}
              </nav>
            </ScrollArea>
          </SurfaceCard>
        </aside>
      </div>
    </div>
  );
}
