import { Badge, Box, Button, Checkbox, NumberField, Spinner, TableOfContents, Text, TextArea, TextField } from "gestalt";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import type { AppSettings, GeoSearchResult } from "@flathunter/shared";

import { SectionHeader } from "../components/SectionHeader";
import { SurfaceCard } from "../components/SurfaceCard";

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
      <div className="page-loading">
        <Spinner accessibilityLabel="Loading settings" show />
      </div>
    );
  }

  if (!draft) {
    return (
      <SurfaceCard subtitle="Settings could not be loaded." title="Settings unavailable">
        <Button color="gray" text="Retry" onClick={() => onRetry()} />
      </SurfaceCard>
    );
  }

  return (
    <div className="page page--settings">
      <SectionHeader
        actions={
          <Button
            color="dark"
            disabled={saving}
            size="lg"
            text={saving ? "Saving..." : "Save settings"}
            onClick={async () => {
              setSaving(true);

              try {
                await onSaveSettings(draft);
              } finally {
                setSaving(false);
              }
            }}
          />
        }
        subtitle="Profile, search heuristics, office location, scoring and runtime controls. Office location powers geographic distance on listings and dashboard charts."
        title="Settings"
      />

      <div className="settings-layout">
        <div className="settings-sections">
          <section id="profile">
            <SurfaceCard subtitle="Contact and bio used for downstream outreach flows." title="Profile">
              <div className="form-grid">
                <TextField
                  id="profile-full-name"
                  label="Full name"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            profile: {
                              ...current.profile,
                              fullName: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.profile.fullName}
                />
                <TextField
                  id="profile-email"
                  label="Email"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            profile: {
                              ...current.profile,
                              email: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  type="email"
                  value={draft.profile.email}
                />
                <TextField
                  id="profile-phone"
                  label="Phone"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            profile: {
                              ...current.profile,
                              phone: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.profile.phone}
                />
                <TextArea
                  id="profile-bio"
                  label="Short bio"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            profile: {
                              ...current.profile,
                              shortBio: value
                            }
                          }
                        : current
                    )
                  }
                  rows={4}
                  value={draft.profile.shortBio}
                />
              </div>
            </SurfaceCard>
          </section>

          <section id="search">
            <SurfaceCard subtitle="Search heuristics shared with the worker." title="Search preferences">
              <div className="form-grid">
                <TextField
                  id="search-city"
                  label="City"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            search: {
                              ...current.search,
                              city: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.search.city}
                />
                <TextArea
                  id="search-districts"
                  helperText="One district per line or comma separated."
                  label="Preferred districts"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            search: {
                              ...current.search,
                              districts: parseMultiline(value)
                            }
                          }
                        : current
                    )
                  }
                  rows={5}
                  value={toMultiline(draft.search.districts)}
                />
              </div>
            </SurfaceCard>
          </section>

          <section id="office-location">
            <SurfaceCard
              actions={
                draft.search.officeLocation ? (
                  <Badge text={draft.search.officeLocation.label} type="success" />
                ) : (
                  <Badge text="Not configured" type="warning" />
                )
              }
              subtitle="Set the office once to expose geographic distance throughout the product."
              title="Office location"
            >
              <div className="office-location-stack">
                <div className="office-search-row">
                  <TextField
                    id="office-location-query"
                    label="Office address"
                    onChange={({ value }) => setOfficeQuery(value)}
                    onKeyDown={({ event }) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                      }
                    }}
                    placeholder="Alexanderplatz 1, Berlin"
                    size="lg"
                    value={officeQuery}
                  />
                  <Button
                    color="dark"
                    disabled={searchingOffice || officeQuery.trim().length < 3}
                    size="lg"
                    text={searchingOffice ? "Searching..." : "Find location"}
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
                  />
                </div>

                {draft.search.officeLocation ? (
                  <Box color="lightWash" padding={4} rounding={4}>
                    <div className="stat-card stat-card--gestalt">
                      <span>Current office</span>
                      <strong>{draft.search.officeLocation.label}</strong>
                      <Text color="subtle" size="100">
                        {draft.search.officeLocation.address}
                      </Text>
                    </div>
                  </Box>
                ) : null}

                {officeSearchMessage ? (
                  <Text color="subtle" size="100">
                    {officeSearchMessage}
                  </Text>
                ) : null}

                {officeResults.length > 0 ? (
                  <div className="office-results">
                    {officeResults.map((result) => (
                      <button
                        className="office-result"
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
                        <strong>{result.label}</strong>
                        <span>{result.address}</span>
                        <span>{result.district ?? "Berlin"}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="office-actions">
                  <Button
                    color="gray"
                    disabled={!draft.search.officeLocation}
                    size="md"
                    text="Clear office location"
                    onClick={() =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              search: {
                                ...current.search,
                                officeLocation: null
                              }
                            }
                          : current
                      )
                    }
                  />
                </div>
              </div>
            </SurfaceCard>
          </section>

          <section id="scoring">
            <SurfaceCard subtitle="Deterministic score thresholds and bonuses." title="Scoring">
              <div className="form-grid">
                <NumberField
                  id="score-max-rent"
                  label="Max warm rent"
                  min={0}
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current && value != null
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              maxWarmRent: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.scoring.maxWarmRent}
                />
                <NumberField
                  id="score-min-size"
                  label="Minimum size"
                  min={0}
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current && value != null
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              minimumSizeSqm: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.scoring.minimumSizeSqm}
                />
                <NumberField
                  id="score-min-rooms"
                  label="Minimum rooms"
                  min={0}
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current && value != null
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              minimumRooms: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  step={0.5}
                  value={draft.scoring.minimumRooms}
                />
                <NumberField
                  id="score-balcony-bonus"
                  label="Balcony bonus"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current && value != null
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              balconyBonus: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.scoring.balconyBonus}
                />
                <NumberField
                  id="score-elevator-bonus"
                  label="Elevator bonus"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current && value != null
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              elevatorBonus: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.scoring.elevatorBonus}
                />
                <NumberField
                  id="score-furnished-penalty"
                  label="Furnished penalty"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current && value != null
                        ? {
                            ...current,
                            scoring: {
                              ...current.scoring,
                              furnishedPenalty: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.scoring.furnishedPenalty}
                />
              </div>
            </SurfaceCard>
          </section>

          <section id="runtime">
            <SurfaceCard subtitle="Worker and semantic runtime behavior." title="Runtime">
              <div className="form-grid">
                <Checkbox
                  checked={draft.runtime.enableSemanticClassifier}
                  helperText="Disable to keep deterministic scoring only."
                  id="runtime-semantic"
                  label="Enable semantic classifier"
                  onChange={({ checked }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            runtime: {
                              ...current.runtime,
                              enableSemanticClassifier: checked
                            }
                          }
                        : current
                    )
                  }
                />
                <Checkbox
                  checked={draft.runtime.enableLlmEnrichment}
                  helperText="Translate and summarize listings with the English analyst pipeline."
                  id="runtime-llm-enrichment"
                  label="Enable English analyst"
                  onChange={({ checked }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            runtime: {
                              ...current.runtime,
                              enableLlmEnrichment: checked
                            }
                          }
                        : current
                    )
                  }
                />
                <Checkbox
                  checked={draft.runtime.scrapeWithFixtures}
                  helperText="Use only for parser debugging; live scraping is the default local mode."
                  id="runtime-fixtures"
                  label="Use fixtures"
                  onChange={({ checked }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            runtime: {
                              ...current.runtime,
                              scrapeWithFixtures: checked
                            }
                          }
                        : current
                    )
                  }
                />
                <TextField
                  helperText="Recommended hot-path classifier default: gemini-2.5-flash-lite. Use a faster, cheaper model here so UNSURE listings can be classified in batch without local model infrastructure."
                  id="runtime-llm-classifier-model"
                  label="Classifier model"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            runtime: {
                              ...current.runtime,
                              llmClassifierModel: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.runtime.llmClassifierModel}
                />
                <TextField
                  helperText="Recommended on-demand English analyst default: gemini-2.5-flash. This single Gemini call handles language detection, translation, summary, fit note, and semantic verdict together."
                  id="runtime-llm-analyst-model"
                  label="English analyst model"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            runtime: {
                              ...current.runtime,
                              llmAnalystModel: value
                            }
                          }
                        : current
                    )
                  }
                  size="lg"
                  value={draft.runtime.llmAnalystModel}
                />
              </div>
            </SurfaceCard>
          </section>

          <section id="semantic-rules">
            <SurfaceCard subtitle="Textual constraints passed into semantic classification." title="Semantic rules">
              <div className="form-grid">
                <TextArea
                  id="semantic-must-match"
                  helperText="One rule per line or comma separated."
                  label="Must match"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            semanticRules: {
                              ...current.semanticRules,
                              mustMatch: parseMultiline(value)
                            }
                          }
                        : current
                    )
                  }
                  rows={5}
                  value={toMultiline(draft.semanticRules.mustMatch)}
                />
                <TextArea
                  id="semantic-avoid"
                  helperText="One rule per line or comma separated."
                  label="Avoid"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            semanticRules: {
                              ...current.semanticRules,
                              avoid: parseMultiline(value)
                            }
                          }
                        : current
                    )
                  }
                  rows={5}
                  value={toMultiline(draft.semanticRules.avoid)}
                />
                <TextArea
                  id="semantic-notes"
                  label="Classifier notes"
                  onChange={({ value }) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            semanticRules: {
                              ...current.semanticRules,
                              notes: value
                            }
                          }
                        : current
                    )
                  }
                  rows={6}
                  value={draft.semanticRules.notes}
                />
              </div>
            </SurfaceCard>
          </section>
        </div>

        <aside className="settings-toc">
          <SurfaceCard subtitle="Jump between configuration groups." title="Sections">
            <TableOfContents title="Settings outline">
              {sections.map((section) => (
                <TableOfContents.Item
                  active={activeHash === section.id}
                  href={`#${section.id}`}
                  key={section.id}
                  label={section.label}
                />
              ))}
            </TableOfContents>
          </SurfaceCard>
        </aside>
      </div>
    </div>
  );
}
