import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import type {
  Portal,
  PortalSourceAuthBootstrapFinishResult,
  PortalSourceAuthBootstrapSummary,
  PortalSourceAuthSummary,
  PortalSourceAuthUpsert,
  PortalSourcePatch,
  PortalSourceSummary,
  SourceAuthStatus
} from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { FormField } from "../components/FormField";
import { SectionHeader } from "../components/SectionHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { ToneBadge } from "../components/ToneBadge";

type SourcesPageProps = {
  sources: PortalSourceSummary[];
  loading: boolean;
  onRetry: () => void;
  onSaveSource: (portal: Portal, patch: PortalSourcePatch) => Promise<void>;
  onGetSourceAuth: (portal: Portal) => Promise<PortalSourceAuthSummary>;
  onGetSourceAuthBootstrap: (portal: Portal) => Promise<PortalSourceAuthBootstrapSummary>;
  onSaveSourceAuth: (portal: Portal, payload: PortalSourceAuthUpsert) => Promise<PortalSourceAuthSummary>;
  onRefreshSourceAuth: (portal: Portal) => Promise<PortalSourceAuthSummary>;
  onStartSourceAuthBootstrap: (portal: Portal) => Promise<PortalSourceAuthBootstrapSummary>;
  onFinishSourceAuthBootstrap: (portal: Portal) => Promise<PortalSourceAuthBootstrapFinishResult>;
  onCancelSourceAuthBootstrap: (portal: Portal) => Promise<PortalSourceAuthBootstrapSummary>;
  onDeleteSourceAuth: (portal: Portal) => Promise<PortalSourceAuthSummary>;
};

type SourceAuthDraft = {
  loginIdentifier: string;
  password: string;
};

type BadgePresentation = {
  text: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
};

type NoticePresentation = {
  message: string;
  tone: "warning" | "danger" | "info";
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function getSourceBadge(source: PortalSourceSummary): BadgePresentation {
  if (!source.enabled) {
    return {
      text: source.hasCredentials ? "Disabled" : "Setup required",
      tone: "info"
    };
  }

  if (source.lastStatus === "failed") {
    return { text: "Needs attention", tone: "danger" };
  }

  if (source.lastStatus === "partial") {
    return { text: "Degraded run", tone: "warning" };
  }

  if (!source.lastSuccessAt) {
    return { text: "Pending first run", tone: "warning" };
  }

  return { text: "Healthy", tone: "success" };
}

function getSourceNotice(source: PortalSourceSummary): NoticePresentation | null {
  const normalizedLastError =
    source.lastError?.startsWith('Failed query: insert into "listings"')
      ? "The last run failed while saving listings to the database."
      : source.lastError?.startsWith("Failed query:")
        ? "The last run failed in the database layer."
        : source.lastError;

  if (!source.capabilities.supportsLogin && !source.enabled) {
    return { tone: "info", message: "This public source is currently disabled and skipped by the worker." };
  }

  if (!source.enabled) {
    if (source.authStatus === "challenge_required") {
      return {
        tone: "warning",
        message: source.lastAuthError ?? "This source is blocked by a challenge response and remains disabled until the session can be refreshed successfully."
      };
    }

    if (source.authStatus === "auth_failed" || source.authStatus === "session_expired") {
      return {
        tone: "warning",
        message: source.lastAuthError ?? "This source needs a valid authenticated session before it can be enabled again."
      };
    }

    if (!source.hasCredentials) {
      return { tone: "info", message: "This source is disabled until credentials are configured and a session can be refreshed." };
    }

    return { tone: "info", message: "This source is currently disabled and skipped by the worker." };
  }

  if (!normalizedLastError) {
    return null;
  }

  if (source.lastStatus === "partial") {
    return {
      tone: "warning",
      message: normalizedLastError.startsWith("Listings were ingested")
        ? normalizedLastError
        : source.lastFailedDetails && source.lastFailedDetails > 0
          ? `Listings were ingested, but ${source.lastFailedDetails} detail pages degraded the latest run. ${normalizedLastError}`
          : normalizedLastError
    };
  }

  return { tone: "danger", message: normalizedLastError };
}

function getAuthStatusPresentation(
  source: Pick<PortalSourceSummary, "portal" | "capabilities">,
  authStatus: SourceAuthStatus,
  hasCredentials: boolean
): BadgePresentation {
  if (!source.capabilities.supportsLogin) {
    return { text: "Not needed", tone: "info" };
  }

  if (source.portal === "IMMOWELT" && !hasCredentials && authStatus === "missing_credentials") {
    return { text: "Optional", tone: "info" };
  }

  switch (authStatus) {
    case "missing_credentials":
      return { text: "Setup required", tone: "info" };
    case "ready":
      return { text: "Ready", tone: "warning" };
    case "session_valid":
      return { text: "Session valid", tone: "success" };
    case "session_expired":
      return { text: "Needs auth", tone: "warning" };
    case "challenge_required":
      return { text: "Challenge required", tone: "warning" };
    case "auth_failed":
      return { text: "Auth failed", tone: "danger" };
  }
}

function getSourceStrategyPresentation(source: PortalSourceSummary): BadgePresentation {
  switch (source.capabilities.readiness) {
    case "primary":
      return { text: source.capabilities.sourceKind === "public_api" ? "Primary source" : "Primary scraper", tone: "success" };
    case "secondary":
      return { text: source.capabilities.sourceKind === "public_api" ? "Secondary source" : "Secondary scraper", tone: "warning" };
    case "experimental":
      return { text: source.capabilities.sourceKind === "public_api" ? "Experimental source" : "Experimental scraper", tone: "warning" };
  }
}

function getAuthStatusMessage(source: PortalSourceSummary, authSummary: PortalSourceAuthSummary | null): NoticePresentation | null {
  const authStatus = authSummary?.authStatus ?? source.authStatus;
  const hasCredentials = authSummary?.hasCredentials ?? source.hasCredentials;
  const lastAuthError = authSummary?.lastAuthError ?? source.lastAuthError;
  const lastChallengeType = authSummary?.lastChallengeType ?? source.lastChallengeType;

  if (!source.capabilities.supportsLogin) {
    return {
      tone: "info",
      message: "This source uses a signed-out public feed. No credentials, session refresh, or browser bootstrap flow is required."
    };
  }

  if (source.portal === "IMMOWELT" && !hasCredentials) {
    return {
      tone: "info",
      message: "Authentication is optional for Immowelt. Refreshing the session validates live access without storing credentials."
    };
  }

  if (authStatus === "missing_credentials") {
    return { tone: "info", message: "Enter portal credentials, save them, then refresh the session to validate access and auto-enable the source." };
  }

  if (authStatus === "ready") {
    return { tone: "info", message: "Credentials were saved. Refresh the session to validate them and enable the source automatically." };
  }

  if (authStatus === "challenge_required") {
    return {
      tone: "warning",
      message: lastChallengeType
        ? `The portal returned a ${lastChallengeType} challenge. Resolve the challenge or retry from a different session before enabling this source.`
        : "The portal returned a challenge. Resolve it before enabling this source."
    };
  }

  if (authStatus === "auth_failed") {
    return { tone: "danger", message: lastAuthError ?? "Source authentication failed with the current credentials or session." };
  }

  if (authStatus === "session_expired") {
    return { tone: "warning", message: "The stored session is no longer valid. Refresh the session to revalidate and re-enable this source." };
  }

  if (authStatus === "session_valid") {
    return { tone: "info", message: "The current session is valid and the source is ready for the worker." };
  }

  return null;
}

function toActionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The requested source action failed.";
}

function Notice({ notice }: { notice: NoticePresentation }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${notice.tone === "danger" ? "border-destructive/30 bg-destructive/10 text-destructive" : notice.tone === "warning" ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted/40 text-muted-foreground"}`}>
      {notice.message}
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="block truncate text-sm">{value}</strong>
    </div>
  );
}

export function SourcesPage({
  sources,
  loading,
  onRetry,
  onSaveSource,
  onGetSourceAuth,
  onGetSourceAuthBootstrap,
  onSaveSourceAuth,
  onRefreshSourceAuth,
  onStartSourceAuthBootstrap,
  onFinishSourceAuthBootstrap,
  onCancelSourceAuthBootstrap,
  onDeleteSourceAuth
}: SourcesPageProps) {
  const [drafts, setDrafts] = useState<Record<string, PortalSourceSummary>>({});
  const [authSummaries, setAuthSummaries] = useState<Record<string, PortalSourceAuthSummary>>({});
  const [bootstrapSummaries, setBootstrapSummaries] = useState<Record<string, PortalSourceAuthBootstrapSummary>>({});
  const [authDrafts, setAuthDrafts] = useState<Record<string, SourceAuthDraft>>({});
  const [savingPortal, setSavingPortal] = useState<string | null>(null);
  const [authBusyPortal, setAuthBusyPortal] = useState<string | null>(null);
  const [bootstrapBusyPortal, setBootstrapBusyPortal] = useState<string | null>(null);
  const [loadingAuthPortal, setLoadingAuthPortal] = useState<string | null>(null);
  const [selectedPortal, setSelectedPortal] = useState<Portal | null>(sources[0]?.portal ?? null);

  useEffect(() => {
    setDrafts(Object.fromEntries(sources.map((source) => [source.portal, source])));
    setSelectedPortal((current) => (current && sources.some((source) => source.portal === current) ? current : sources[0]?.portal ?? null));
  }, [sources]);

  useEffect(() => {
    if (!selectedPortal) {
      return;
    }

    const selectedSource = sources.find((source) => source.portal === selectedPortal);

    if (selectedSource && !selectedSource.capabilities.supportsLogin) {
      setAuthSummaries((current) => ({
        ...current,
        [selectedPortal]: {
          portal: selectedPortal,
          authMode: null,
          loginIdentifier: null,
          authStatus: "ready",
          hasCredentials: false,
          lastAuthAt: null,
          lastValidatedAt: null,
          expiresAt: null,
          lastAuthError: null,
          lastChallengeType: null,
          capabilities: selectedSource.capabilities
        }
      }));
      setBootstrapSummaries((current) => ({
        ...current,
        [selectedPortal]: {
          portal: selectedPortal,
          status: "idle",
          loginUrl: null,
          message: null,
          startedAt: null,
          updatedAt: null
        }
      }));
      setAuthDrafts((current) => ({
        ...current,
        [selectedPortal]: {
          loginIdentifier: "",
          password: ""
        }
      }));
      setLoadingAuthPortal(null);
      return;
    }

    let isCancelled = false;
    setLoadingAuthPortal(selectedPortal);

    void Promise.all([onGetSourceAuth(selectedPortal), onGetSourceAuthBootstrap(selectedPortal)])
      .then(([summary, bootstrap]) => {
        if (isCancelled) {
          return;
        }

        setAuthSummaries((current) => ({ ...current, [selectedPortal]: summary }));
        setAuthDrafts((current) => ({
          ...current,
          [selectedPortal]: {
            loginIdentifier: current[selectedPortal]?.loginIdentifier ?? summary.loginIdentifier ?? "",
            password: ""
          }
        }));
        setBootstrapSummaries((current) => ({ ...current, [selectedPortal]: bootstrap }));
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) {
          setLoadingAuthPortal((current) => (current === selectedPortal ? null : current));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedPortal, sources, onGetSourceAuth, onGetSourceAuthBootstrap]);

  useEffect(() => {
    if (!selectedPortal) {
      return;
    }

    const selectedSource = sources.find((source) => source.portal === selectedPortal);

    if (selectedSource && !selectedSource.capabilities.supportsLogin) {
      return;
    }

    const bootstrap = bootstrapSummaries[selectedPortal];

    if (!bootstrap || bootstrap.status !== "running") {
      return;
    }

    let isCancelled = false;
    const interval = window.setInterval(() => {
      void onGetSourceAuthBootstrap(selectedPortal).then((summary) => {
        if (isCancelled) {
          return;
        }

        setBootstrapSummaries((current) => ({ ...current, [selectedPortal]: summary }));
      });
    }, 3000);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedPortal, sources, bootstrapSummaries, onGetSourceAuthBootstrap]);

  if (loading && sources.length === 0) {
    return (
      <div className="grid min-h-96 place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading sources" />
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <SurfaceCard subtitle="Worker source configs are not available yet." title="Sources unavailable">
        <Button onClick={() => onRetry()} variant="outline">
          Retry
        </Button>
      </SurfaceCard>
    );
  }

  const enabledSources = sources.filter((source) => source.enabled);
  const disabledSources = sources.filter((source) => !source.enabled).length;
  const degradedSources = enabledSources.filter((source) => source.lastStatus === "partial").length;
  const failedSources = enabledSources.filter((source) => source.lastStatus === "failed").length;
  const selectedSource = sources.find((source) => source.portal === selectedPortal) ?? sources[0];
  const selectedDraft = drafts[selectedSource.portal] ?? selectedSource;
  const selectedBadge = getSourceBadge(selectedSource);
  const selectedNotice = getSourceNotice(selectedSource);
  const selectedAuthSummary = authSummaries[selectedSource.portal] ?? null;
  const selectedBootstrapSummary = bootstrapSummaries[selectedSource.portal] ?? null;
  const selectedAuthDraft = authDrafts[selectedSource.portal] ?? {
    loginIdentifier: selectedAuthSummary?.loginIdentifier ?? "",
    password: ""
  };
  const authStatus = selectedAuthSummary?.authStatus ?? selectedSource.authStatus;
  const hasCredentials = selectedAuthSummary?.hasCredentials ?? selectedSource.hasCredentials;
  const authBadge = getAuthStatusPresentation(selectedSource, authStatus, hasCredentials);
  const strategyBadge = getSourceStrategyPresentation(selectedSource);
  const authNotice = getAuthStatusMessage(selectedSource, selectedAuthSummary);
  const bootstrapRunning = selectedBootstrapSummary?.status === "running";
  const bootstrapNotice = selectedBootstrapSummary?.message
    ? { tone: "info" as const, message: selectedBootstrapSummary.message }
    : null;
  const requiresAuthSetup = selectedSource.capabilities.requiresAuthSetup;
  const canEnableSource = !requiresAuthSetup || authStatus === "session_valid";
  const sourceEnabledHelperText =
    !requiresAuthSetup || canEnableSource
      ? "Disabled sources are skipped by the worker."
      : "Save credentials and refresh the session before enabling this source.";

  return (
    <div className="fh-viewport-workspace flex min-h-0 flex-col gap-4">
      <SectionHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MetricBox label="Sources" value={sources.length} />
            <MetricBox label="Enabled" value={enabledSources.length} />
            <MetricBox label="Disabled" value={disabledSources} />
            <MetricBox label="Degraded" value={degradedSources} />
            <MetricBox label="Failed" value={failedSources} />
          </div>
        }
        subtitle="Operational control for scrape endpoints, intervals and current runtime health."
        title="Sources"
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:h-full xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)] xl:overflow-hidden">
        <SurfaceCard
          className="xl:h-full xl:min-h-0"
          contentClassName="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
          subtitle="All worker sources ordered by portal and health."
          title="Source health"
        >
          <ScrollArea className="xl:min-h-0 xl:flex-1">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Portal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Upserted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => {
                  const badge = getSourceBadge(source);
                  const authCellBadge = getAuthStatusPresentation(source, source.authStatus, source.hasCredentials);

                  return (
                    <TableRow
                      className="cursor-pointer"
                      data-state={selectedSource.portal === source.portal ? "selected" : undefined}
                      key={source.portal}
                      onClick={() => setSelectedPortal(source.portal)}
                    >
                      <TableCell>
                        <div className="font-medium">{source.portal}</div>
                        <div className="text-xs text-muted-foreground">{source.enabled ? "Enabled" : "Disabled"}</div>
                      </TableCell>
                      <TableCell><ToneBadge tone={badge.tone}>{badge.text}</ToneBadge></TableCell>
                      <TableCell><ToneBadge tone={authCellBadge.tone}>{authCellBadge.text}</ToneBadge></TableCell>
                      <TableCell>{source.lastMode ?? "Unknown"}</TableCell>
                      <TableCell>{formatDate(source.lastRunAt)}</TableCell>
                      <TableCell>{source.lastListingsUpserted ?? 0}/{source.lastListingsFound ?? 0}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </SurfaceCard>

        <SurfaceCard
          actions={<ToneBadge tone={selectedBadge.tone}>{selectedBadge.text}</ToneBadge>}
          className="xl:h-full xl:min-h-0"
          contentClassName="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
          subtitle="Portal runtime config consumed by the worker."
          title={selectedSource.portal}
        >
          <ScrollArea className="pr-3 xl:min-h-0 xl:flex-1">
            <div className="space-y-5">
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap gap-2">
                  <ToneBadge tone={strategyBadge.tone}>{strategyBadge.text}</ToneBadge>
                  <ToneBadge tone="info">{selectedSource.capabilities.sourceKind === "public_api" ? "Public API source" : "Scraping source"}</ToneBadge>
                  <ToneBadge tone={selectedSource.capabilities.cloudCompatible ? "success" : "warning"}>
                    {selectedSource.capabilities.cloudCompatible ? "Cloud-safe" : "Local-only auth"}
                  </ToneBadge>
                  <ToneBadge tone={!selectedSource.capabilities.supportsLogin ? "info" : requiresAuthSetup ? "warning" : "info"}>
                    {!selectedSource.capabilities.supportsLogin ? "No auth flow" : requiresAuthSetup ? "Auth required" : "Auth optional"}
                  </ToneBadge>
                </div>
                <p className="text-sm text-muted-foreground">{selectedSource.capabilities.setupHint}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedSource.capabilities.cloudCompatible
                    ? "This source fits the cloud-safe profile for Vercel + Neon + Gemini."
                    : "This source depends on a local browser session/bootstrap flow for reliable access."}
                </p>
              </div>

              {selectedNotice ? <Notice notice={selectedNotice} /> : null}

              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div>
                  <div className="text-sm font-medium">Enabled</div>
                  <p className="mt-1 text-xs text-muted-foreground">{sourceEnabledHelperText}</p>
                </div>
                <Switch
                  checked={selectedDraft.enabled}
                  disabled={!selectedDraft.enabled && !canEnableSource}
                  onCheckedChange={(checked) =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedSource.portal]: { ...selectedDraft, enabled: checked }
                    }))
                  }
                />
              </div>

              <div className="grid gap-4">
                <FormField htmlFor={`${selectedSource.portal}-url`} label="Search URL">
                  <Input
                    id={`${selectedSource.portal}-url`}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedSource.portal]: { ...selectedDraft, searchUrl: event.target.value }
                      }))
                    }
                    type="url"
                    value={selectedDraft.searchUrl}
                  />
                </FormField>
                <FormField htmlFor={`${selectedSource.portal}-interval`} label="Scrape interval (minutes)">
                  <Input
                    id={`${selectedSource.portal}-interval`}
                    min={5}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedSource.portal]: {
                          ...selectedDraft,
                          scrapeIntervalMinutes: event.target.value ? Number(event.target.value) : selectedDraft.scrapeIntervalMinutes
                        }
                      }))
                    }
                    type="number"
                    value={selectedDraft.scrapeIntervalMinutes}
                  />
                </FormField>
              </div>

              <section className="space-y-4 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">Authentication</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {requiresAuthSetup
                        ? selectedSource.capabilities.cloudCompatible
                          ? "Store account credentials and refresh the session when needed."
                          : "Store account credentials and refresh the browser session locally."
                        : "This source runs without credentials. The worker uses the signed-out public feed only."}
                    </p>
                  </div>
                  {loadingAuthPortal === selectedSource.portal ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <ToneBadge tone={authBadge.tone}>{authBadge.text}</ToneBadge>
                  )}
                </div>

                {authNotice ? <Notice notice={authNotice} /> : null}
                {bootstrapNotice ? <Notice notice={bootstrapNotice} /> : null}

                {selectedSource.capabilities.supportsLogin ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField htmlFor={`${selectedSource.portal}-login`} label="Login identifier">
                        <Input
                          id={`${selectedSource.portal}-login`}
                          onChange={(event) =>
                            setAuthDrafts((current) => ({
                              ...current,
                              [selectedSource.portal]: { ...selectedAuthDraft, loginIdentifier: event.target.value }
                            }))
                          }
                          placeholder="Email or username"
                          value={selectedAuthDraft.loginIdentifier}
                        />
                      </FormField>
                      <FormField htmlFor={`${selectedSource.portal}-password`} label="Password">
                        <Input
                          id={`${selectedSource.portal}-password`}
                          onChange={(event) =>
                            setAuthDrafts((current) => ({
                              ...current,
                              [selectedSource.portal]: { ...selectedAuthDraft, password: event.target.value }
                            }))
                          }
                          placeholder={hasCredentials ? "Enter a new password to replace the stored one" : "Portal password"}
                          type="password"
                          value={selectedAuthDraft.password}
                        />
                      </FormField>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <MetricBox label="Status" value={authBadge.text} />
                      <MetricBox label="Stored login" value={selectedAuthSummary?.loginIdentifier ?? "Not saved"} />
                      <MetricBox label="Last auth" value={formatDate(selectedAuthSummary?.lastAuthAt ?? null)} />
                      <MetricBox label="Last validated" value={formatDate(selectedAuthSummary?.lastValidatedAt ?? null)} />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={authBusyPortal === selectedSource.portal || selectedAuthDraft.loginIdentifier.trim().length === 0 || selectedAuthDraft.password.length === 0}
                        onClick={async () => {
                          setAuthBusyPortal(selectedSource.portal);

                          try {
                            const summary = await onSaveSourceAuth(selectedSource.portal, {
                              authMode: "FORM_CREDENTIALS",
                              loginIdentifier: selectedAuthDraft.loginIdentifier.trim(),
                              password: selectedAuthDraft.password
                            });

                            setAuthSummaries((current) => ({ ...current, [selectedSource.portal]: summary }));
                            setAuthDrafts((current) => ({
                              ...current,
                              [selectedSource.portal]: { loginIdentifier: summary.loginIdentifier ?? selectedAuthDraft.loginIdentifier.trim(), password: "" }
                            }));
                          } finally {
                            setAuthBusyPortal(null);
                          }
                        }}
                      >
                        {authBusyPortal === selectedSource.portal ? <Loader2 className="animate-spin" /> : null}
                        {authBusyPortal === selectedSource.portal ? "Saving..." : "Save credentials"}
                      </Button>

                      <Button
                        disabled={authBusyPortal === selectedSource.portal || (!hasCredentials && selectedSource.portal !== "IMMOWELT")}
                        onClick={async () => {
                          setAuthBusyPortal(selectedSource.portal);

                          try {
                            const summary = await onRefreshSourceAuth(selectedSource.portal);
                            setAuthSummaries((current) => ({ ...current, [selectedSource.portal]: summary }));
                          } finally {
                            setAuthBusyPortal(null);
                          }
                        }}
                        variant="outline"
                      >
                        {authBusyPortal === selectedSource.portal ? "Refreshing..." : "Refresh session"}
                      </Button>

                      <Button
                        disabled={bootstrapBusyPortal === selectedSource.portal || bootstrapRunning}
                        onClick={async () => {
                          setBootstrapBusyPortal(selectedSource.portal);

                          try {
                            const summary = await onStartSourceAuthBootstrap(selectedSource.portal);
                            setBootstrapSummaries((current) => ({ ...current, [selectedSource.portal]: summary }));
                          } catch (error) {
                            setBootstrapSummaries((current) => ({
                              ...current,
                              [selectedSource.portal]: {
                                portal: selectedSource.portal,
                                status: "idle",
                                loginUrl: current[selectedSource.portal]?.loginUrl ?? null,
                                message: toActionErrorMessage(error),
                                startedAt: null,
                                updatedAt: new Date().toISOString()
                              }
                            }));
                          } finally {
                            setBootstrapBusyPortal(null);
                          }
                        }}
                        variant="outline"
                      >
                        {bootstrapBusyPortal === selectedSource.portal ? "Opening..." : "Open browser login"}
                      </Button>

                      <Button
                        disabled={bootstrapBusyPortal === selectedSource.portal || !bootstrapRunning}
                        onClick={async () => {
                          setBootstrapBusyPortal(selectedSource.portal);

                          try {
                            const result = await onFinishSourceAuthBootstrap(selectedSource.portal);
                            setBootstrapSummaries((current) => ({ ...current, [selectedSource.portal]: result.bootstrap }));
                            setAuthSummaries((current) => ({ ...current, [selectedSource.portal]: result.authSummary }));
                          } catch (error) {
                            setBootstrapSummaries((current) => ({
                              ...current,
                              [selectedSource.portal]: {
                                portal: selectedSource.portal,
                                status: current[selectedSource.portal]?.status ?? "idle",
                                loginUrl: current[selectedSource.portal]?.loginUrl ?? null,
                                message: toActionErrorMessage(error),
                                startedAt: current[selectedSource.portal]?.startedAt ?? null,
                                updatedAt: new Date().toISOString()
                              }
                            }));
                          } finally {
                            setBootstrapBusyPortal(null);
                          }
                        }}
                        variant="outline"
                      >
                        {bootstrapBusyPortal === selectedSource.portal ? "Saving..." : "Save browser session"}
                      </Button>

                      <Button
                        disabled={bootstrapBusyPortal === selectedSource.portal || !bootstrapRunning}
                        onClick={async () => {
                          setBootstrapBusyPortal(selectedSource.portal);

                          try {
                            const summary = await onCancelSourceAuthBootstrap(selectedSource.portal);
                            setBootstrapSummaries((current) => ({ ...current, [selectedSource.portal]: summary }));
                          } catch (error) {
                            setBootstrapSummaries((current) => ({
                              ...current,
                              [selectedSource.portal]: {
                                portal: selectedSource.portal,
                                status: current[selectedSource.portal]?.status ?? "idle",
                                loginUrl: current[selectedSource.portal]?.loginUrl ?? null,
                                message: toActionErrorMessage(error),
                                startedAt: current[selectedSource.portal]?.startedAt ?? null,
                                updatedAt: new Date().toISOString()
                              }
                            }));
                          } finally {
                            setBootstrapBusyPortal(null);
                          }
                        }}
                        variant="ghost"
                      >
                        {bootstrapBusyPortal === selectedSource.portal ? "Closing..." : "Close browser"}
                      </Button>

                      <Button
                        disabled={authBusyPortal === selectedSource.portal || !hasCredentials}
                        onClick={async () => {
                          setAuthBusyPortal(selectedSource.portal);

                          try {
                            const summary = await onDeleteSourceAuth(selectedSource.portal);
                            setAuthSummaries((current) => ({ ...current, [selectedSource.portal]: summary }));
                            setAuthDrafts((current) => ({ ...current, [selectedSource.portal]: { loginIdentifier: "", password: "" } }));
                            setBootstrapSummaries((current) => ({
                              ...current,
                              [selectedSource.portal]: {
                                portal: selectedSource.portal,
                                status: "idle",
                                loginUrl: selectedBootstrapSummary?.loginUrl ?? null,
                                message: null,
                                startedAt: null,
                                updatedAt: null
                              }
                            }));
                          } finally {
                            setAuthBusyPortal(null);
                          }
                        }}
                        variant="ghost"
                      >
                        {authBusyPortal === selectedSource.portal ? "Removing..." : "Remove credentials"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <MetricBox label="Status" value={authBadge.text} />
                    <MetricBox label="Mode" value="Public feed" />
                    <MetricBox label="Stored login" value="Not used" />
                    <MetricBox label="Last validated" value={formatDate(selectedSource.lastRunAt)} />
                  </div>
                )}
              </section>

              <div className="grid gap-2 sm:grid-cols-2">
                <MetricBox label="Last run" value={formatDate(selectedSource.lastRunAt)} />
                <MetricBox label="Last success" value={formatDate(selectedSource.lastSuccessAt)} />
                <MetricBox label="Last mode" value={selectedSource.lastMode ?? "Unknown"} />
                <MetricBox label="Listings found" value={String(selectedSource.lastListingsFound ?? 0)} />
                <MetricBox label="Listings upserted" value={String(selectedSource.lastListingsUpserted ?? 0)} />
                <MetricBox label="Failed details" value={String(selectedSource.lastFailedDetails ?? 0)} />
              </div>

              <Button
                disabled={savingPortal === selectedSource.portal}
                onClick={async () => {
                  setSavingPortal(selectedSource.portal);

                  try {
                    await onSaveSource(selectedSource.portal, {
                      enabled: selectedDraft.enabled,
                      scrapeIntervalMinutes: selectedDraft.scrapeIntervalMinutes,
                      searchUrl: selectedDraft.searchUrl
                    });
                  } finally {
                    setSavingPortal(null);
                  }
                }}
              >
                {savingPortal === selectedSource.portal ? <Loader2 className="animate-spin" /> : null}
                {savingPortal === selectedSource.portal ? "Saving..." : "Save source"}
              </Button>
            </div>
          </ScrollArea>
        </SurfaceCard>
      </div>
    </div>
  );
}
