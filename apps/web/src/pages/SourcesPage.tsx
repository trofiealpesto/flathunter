import { Badge, Box, Button, Checkbox, NumberField, Spinner, Table, TextField } from "gestalt";
import { useEffect, useState } from "react";

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

import { SectionHeader } from "../components/SectionHeader";
import { SurfaceCard } from "../components/SurfaceCard";

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

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function getSourceBadge(source: PortalSourceSummary) {
  if (!source.enabled) {
    return {
      text: source.hasCredentials ? "Disabled" : "Setup required",
      type: "info" as const
    };
  }

  if (source.lastStatus === "failed") {
    return {
      text: "Needs attention",
      type: "error" as const
    };
  }

  if (source.lastStatus === "partial") {
    return {
      text: "Degraded run",
      type: "warning" as const
    };
  }

  if (!source.lastSuccessAt) {
    return {
      text: "Pending first run",
      type: "warning" as const
    };
  }

  return {
    text: "Healthy",
    type: "success" as const
  };
}

function getSourceNotice(source: PortalSourceSummary) {
  const normalizedLastError =
    source.lastError?.startsWith('Failed query: insert into "listings"')
      ? "The last run failed while saving listings to the database."
      : source.lastError?.startsWith("Failed query:")
        ? "The last run failed in the database layer."
        : source.lastError;

  if (!source.capabilities.supportsLogin && !source.enabled) {
    return {
      className: "app-banner app-banner--inline app-banner--info",
      message: "This public source is currently disabled and skipped by the worker."
    };
  }

  if (!source.enabled) {
    if (source.authStatus === "challenge_required") {
      return {
        className: "app-banner app-banner--inline app-banner--warning",
        message: source.lastAuthError ?? "This source is blocked by a challenge response and remains disabled until the session can be refreshed successfully."
      };
    }

    if (source.authStatus === "auth_failed" || source.authStatus === "session_expired") {
      return {
        className: "app-banner app-banner--inline app-banner--warning",
        message: source.lastAuthError ?? "This source needs a valid authenticated session before it can be enabled again."
      };
    }

    if (!source.hasCredentials) {
      return {
        className: "app-banner app-banner--inline app-banner--info",
        message: "This source is disabled until credentials are configured and a session can be refreshed."
      };
    }

    return {
      className: "app-banner app-banner--inline app-banner--info",
      message: "This source is currently disabled and skipped by the worker."
    };
  }

  if (!normalizedLastError) {
    return null;
  }

  if (source.lastStatus === "partial") {
    return {
      className: "app-banner app-banner--inline app-banner--warning",
      message: normalizedLastError.startsWith("Listings were ingested")
        ? normalizedLastError
        : source.lastFailedDetails && source.lastFailedDetails > 0
          ? `Listings were ingested, but ${source.lastFailedDetails} detail pages degraded the latest run. ${normalizedLastError}`
          : normalizedLastError
    };
  }

  return {
    className: "app-banner app-banner--inline",
    message: normalizedLastError
  };
}

function getAuthStatusPresentation(
  source: Pick<PortalSourceSummary, "portal" | "capabilities">,
  authStatus: SourceAuthStatus,
  hasCredentials: boolean
) {
  if (!source.capabilities.supportsLogin) {
    return {
      text: "Not needed",
      type: "info" as const
    };
  }

  if (source.portal === "IMMOWELT" && !hasCredentials && authStatus === "missing_credentials") {
    return {
      text: "Optional",
      type: "info" as const
    };
  }

  switch (authStatus) {
    case "missing_credentials":
      return {
        text: "Setup required",
        type: "info" as const
      };
    case "ready":
      return {
        text: "Ready",
        type: "warning" as const
      };
    case "session_valid":
      return {
        text: "Session valid",
        type: "success" as const
      };
    case "session_expired":
      return {
        text: "Needs auth",
        type: "warning" as const
      };
    case "challenge_required":
      return {
        text: "Challenge required",
        type: "warning" as const
      };
    case "auth_failed":
      return {
        text: "Auth failed",
        type: "error" as const
      };
  }
}

function getSourceStrategyPresentation(source: PortalSourceSummary) {
  switch (source.capabilities.readiness) {
    case "primary":
      return {
        text: source.capabilities.sourceKind === "public_api" ? "Primary source" : "Primary scraper",
        type: "success" as const
      };
    case "secondary":
      return {
        text: source.capabilities.sourceKind === "public_api" ? "Secondary source" : "Secondary scraper",
        type: "warning" as const
      };
    case "experimental":
      return {
        text: source.capabilities.sourceKind === "public_api" ? "Experimental source" : "Experimental scraper",
        type: "warning" as const
      };
  }
}

function getAuthStatusMessage(source: PortalSourceSummary, authSummary: PortalSourceAuthSummary | null) {
  const authStatus = authSummary?.authStatus ?? source.authStatus;
  const hasCredentials = authSummary?.hasCredentials ?? source.hasCredentials;
  const lastAuthError = authSummary?.lastAuthError ?? source.lastAuthError;
  const lastChallengeType = authSummary?.lastChallengeType ?? source.lastChallengeType;

  if (!source.capabilities.supportsLogin) {
    return {
      className: "app-banner app-banner--inline app-banner--info",
      message: "This source uses a signed-out public feed. No credentials, session refresh, or browser bootstrap flow is required."
    };
  }

  if (source.portal === "IMMOWELT" && !hasCredentials) {
    return {
      className: "app-banner app-banner--inline app-banner--info",
      message: "Authentication is optional for Immowelt. Refreshing the session validates live access without storing credentials."
    };
  }

  if (authStatus === "missing_credentials") {
    return {
      className: "app-banner app-banner--inline app-banner--info",
      message: "Enter portal credentials, save them, then refresh the session to validate access and auto-enable the source."
    };
  }

  if (authStatus === "ready") {
    return {
      className: "app-banner app-banner--inline app-banner--info",
      message: "Credentials were saved. Refresh the session to validate them and enable the source automatically."
    };
  }

  if (authStatus === "challenge_required") {
    return {
      className: "app-banner app-banner--inline app-banner--warning",
      message: lastChallengeType
        ? `The portal returned a ${lastChallengeType} challenge. Resolve the challenge or retry from a different session before enabling this source.`
        : "The portal returned a challenge. Resolve it before enabling this source."
    };
  }

  if (authStatus === "auth_failed") {
    return {
      className: "app-banner app-banner--inline",
      message: lastAuthError ?? "Source authentication failed with the current credentials or session."
    };
  }

  if (authStatus === "session_expired") {
    return {
      className: "app-banner app-banner--inline app-banner--warning",
      message: "The stored session is no longer valid. Refresh the session to revalidate and re-enable this source."
    };
  }

  if (authStatus === "session_valid") {
    return {
      className: "app-banner app-banner--inline app-banner--info",
      message: "The current session is valid and the source is ready for the worker."
    };
  }

  return null;
}

function toActionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The requested source action failed.";
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

        setAuthSummaries((current) => ({
          ...current,
          [selectedPortal]: summary
        }));
        setAuthDrafts((current) => ({
          ...current,
          [selectedPortal]: {
            loginIdentifier: current[selectedPortal]?.loginIdentifier ?? summary.loginIdentifier ?? "",
            password: ""
          }
        }));
        setBootstrapSummaries((current) => ({
          ...current,
          [selectedPortal]: bootstrap
        }));
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

        setBootstrapSummaries((current) => ({
          ...current,
          [selectedPortal]: summary
        }));
      });
    }, 3000);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedPortal, sources, bootstrapSummaries, onGetSourceAuthBootstrap]);

  if (loading && sources.length === 0) {
    return (
      <div className="page-loading">
        <Spinner accessibilityLabel="Loading sources" show />
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <SurfaceCard subtitle="Worker source configs are not available yet." title="Sources unavailable">
        <Button color="gray" text="Retry" onClick={() => onRetry()} />
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
    ? {
        className: "app-banner app-banner--inline app-banner--info",
        message: selectedBootstrapSummary.message
      }
    : null;
  const requiresAuthSetup = selectedSource.capabilities.requiresAuthSetup;
  const canEnableSource = !requiresAuthSetup || authStatus === "session_valid";
  const sourceEnabledHelperText =
    !requiresAuthSetup
      ? "Disabled sources are skipped by the worker."
      : canEnableSource
        ? "Disabled sources are skipped by the worker."
        : "Save credentials and refresh the session before enabling this source.";

  return (
    <div className="page page--sources">
      <SectionHeader
        actions={
          <div className="page-header-metrics">
            {[
              { label: "Sources", value: sources.length },
              { label: "Enabled", value: enabledSources.length },
              { label: "Disabled", value: disabledSources },
              { label: "Degraded", value: degradedSources },
              { label: "Failed", value: failedSources }
            ].map((item) => (
              <div className="page-header-metric" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        }
        subtitle="Operational control for scrape endpoints, intervals and current runtime health."
        title="Sources"
      />

      <div className="sources-layout">
        <SurfaceCard
          className="surface-card--sources-table surface-card--fill"
          subtitle="All worker sources ordered by portal and health."
          title="Source health"
        >
          <div className="table-wrapper table-wrapper--gestalt table-wrapper--sources">
            <Table accessibilityLabel="Portal sources table" borderStyle="none" maxHeight="100%">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Portal</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Auth</Table.HeaderCell>
                  <Table.HeaderCell>Mode</Table.HeaderCell>
                  <Table.HeaderCell>Last run</Table.HeaderCell>
                  <Table.HeaderCell>Upserted</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sources.map((source) => {
                  const badge = getSourceBadge(source);
                  const authCellBadge = getAuthStatusPresentation(source, source.authStatus, source.hasCredentials);

                  return (
                    <Table.Row
                      hoverStyle="gray"
                      key={source.portal}
                      selected={selectedSource.portal === source.portal ? "selected" : "unselected"}
                    >
                      <Table.Cell>
                        <button className="row-select-button row-select-button--compact" onClick={() => setSelectedPortal(source.portal)} type="button">
                          <strong>{source.portal}</strong>
                          <span className="row-select-button__meta">{source.enabled ? "Enabled" : "Disabled"}</span>
                        </button>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge text={badge.text} type={badge.type} />
                      </Table.Cell>
                      <Table.Cell>
                        <Badge text={authCellBadge.text} type={authCellBadge.type} />
                      </Table.Cell>
                      <Table.Cell>{source.lastMode ?? "Unknown"}</Table.Cell>
                      <Table.Cell>{formatDate(source.lastRunAt)}</Table.Cell>
                      <Table.Cell>
                        {source.lastListingsUpserted ?? 0}/{source.lastListingsFound ?? 0}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </div>
        </SurfaceCard>

        <SurfaceCard
          actions={<Badge text={selectedBadge.text} type={selectedBadge.type} />}
          className="surface-card--source-detail surface-card--fill"
          subtitle="Portal runtime config consumed by the worker."
          title={selectedSource.portal}
        >
          <div className="source-detail-stack">
            <div className="source-strategy-card">
              <div className="source-strategy-card__badges">
                <Badge text={strategyBadge.text} type={strategyBadge.type} />
                <Badge text={selectedSource.capabilities.sourceKind === "public_api" ? "Public API source" : "Scraping source"} type="info" />
                <Badge
                  text={selectedSource.capabilities.cloudCompatible ? "Cloud-safe" : "Local-only auth"}
                  type={selectedSource.capabilities.cloudCompatible ? "success" : "warning"}
                />
                <Badge
                  text={
                    !selectedSource.capabilities.supportsLogin
                      ? "No auth flow"
                      : requiresAuthSetup
                        ? "Auth required"
                        : "Auth optional"
                  }
                  type={!selectedSource.capabilities.supportsLogin ? "info" : requiresAuthSetup ? "warning" : "info"}
                />
              </div>
              <p>{selectedSource.capabilities.setupHint}</p>
              <span>
                {selectedSource.capabilities.cloudCompatible
                  ? "This source fits the cloud-safe profile for Vercel + Neon + Gemini. It does not depend on a local browser bootstrap to keep cloud scraping viable."
                  : "This source is not cloud-safe yet because it still depends on a local browser session/bootstrap flow for reliable access."}
              </span>
            </div>

            {selectedNotice ? (
              <div className={selectedNotice.className}>
                <div className="app-banner__message">{selectedNotice.message}</div>
              </div>
            ) : null}

            <Checkbox
              checked={selectedDraft.enabled}
              disabled={!selectedDraft.enabled && !canEnableSource}
              helperText={sourceEnabledHelperText}
              id={`${selectedSource.portal}-enabled`}
              label="Enabled"
              onChange={({ checked }) =>
                setDrafts((current) => ({
                  ...current,
                  [selectedSource.portal]: {
                    ...selectedDraft,
                    enabled: checked
                  }
                }))
              }
            />

            <div className="form-grid form-grid--single">
              <TextField
                id={`${selectedSource.portal}-url`}
                label="Search URL"
                onChange={({ value }) =>
                  setDrafts((current) => ({
                    ...current,
                    [selectedSource.portal]: {
                      ...selectedDraft,
                      searchUrl: value
                    }
                  }))
                }
                size="lg"
                type="url"
                value={selectedDraft.searchUrl}
              />

              <NumberField
                id={`${selectedSource.portal}-interval`}
                label="Scrape interval (minutes)"
                min={5}
                onChange={({ value }) =>
                  setDrafts((current) => ({
                    ...current,
                    [selectedSource.portal]: {
                      ...selectedDraft,
                      scrapeIntervalMinutes: value ?? selectedDraft.scrapeIntervalMinutes
                    }
                  }))
                }
                size="lg"
                value={selectedDraft.scrapeIntervalMinutes}
              />
            </div>

            <div className="source-auth-stack">
              <div className="source-auth-header">
                <div>
                  <h3>Authentication</h3>
                  <p>
                    {requiresAuthSetup
                      ? selectedSource.capabilities.cloudCompatible
                        ? "Store account credentials and refresh the session when needed. This source can still run in the cloud profile because browser bootstrap is optional."
                        : "Store account credentials and refresh the browser session locally. This source is not part of the cloud-safe profile because it still depends on local browser bootstrap."
                      : "This source runs without credentials. The worker uses the signed-out public feed only."}
                  </p>
                </div>
                {loadingAuthPortal === selectedSource.portal ? (
                  <Spinner accessibilityLabel="Loading auth summary" show />
                ) : (
                  <Badge text={authBadge.text} type={authBadge.type} />
                )}
              </div>

              {authNotice ? (
                <div className={authNotice.className}>
                  <div className="app-banner__message">{authNotice.message}</div>
                </div>
              ) : null}

              {bootstrapNotice ? (
                <div className={bootstrapNotice.className}>
                  <div className="app-banner__message">{bootstrapNotice.message}</div>
                </div>
              ) : null}

              {selectedSource.capabilities.supportsLogin ? (
                <>
                  <div className="source-auth-grid">
                    <TextField
                      id={`${selectedSource.portal}-login`}
                      label="Login identifier"
                      onChange={({ value }) =>
                        setAuthDrafts((current) => ({
                          ...current,
                          [selectedSource.portal]: {
                            ...selectedAuthDraft,
                            loginIdentifier: value
                          }
                        }))
                      }
                      placeholder="Email or username"
                      size="lg"
                      type="text"
                      value={selectedAuthDraft.loginIdentifier}
                    />

                    <TextField
                      id={`${selectedSource.portal}-password`}
                      label="Password"
                      onChange={({ value }) =>
                        setAuthDrafts((current) => ({
                          ...current,
                          [selectedSource.portal]: {
                            ...selectedAuthDraft,
                            password: value
                          }
                        }))
                      }
                      placeholder={hasCredentials ? "Enter a new password to replace the stored one" : "Portal password"}
                      size="lg"
                      type="password"
                      value={selectedAuthDraft.password}
                    />
                  </div>

                  <div className="source-auth-meta">
                    {[
                      { label: "Status", value: authBadge.text },
                      { label: "Stored login", value: selectedAuthSummary?.loginIdentifier ?? "Not saved" },
                      { label: "Last auth", value: formatDate(selectedAuthSummary?.lastAuthAt ?? null) },
                      { label: "Last validated", value: formatDate(selectedAuthSummary?.lastValidatedAt ?? null) }
                    ].map((item) => (
                      <Box color="lightWash" key={item.label} padding={4} rounding={4}>
                        <div className="stat-card stat-card--gestalt">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      </Box>
                    ))}
                  </div>

                  <div className="source-actions source-actions--cluster">
                    <Button
                      color="gray"
                      disabled={
                        authBusyPortal === selectedSource.portal ||
                        selectedAuthDraft.loginIdentifier.trim().length === 0 ||
                        selectedAuthDraft.password.length === 0
                      }
                      size="lg"
                      text={authBusyPortal === selectedSource.portal ? "Saving..." : "Save credentials"}
                      onClick={async () => {
                        setAuthBusyPortal(selectedSource.portal);

                        try {
                          const summary = await onSaveSourceAuth(selectedSource.portal, {
                            authMode: "FORM_CREDENTIALS",
                            loginIdentifier: selectedAuthDraft.loginIdentifier.trim(),
                            password: selectedAuthDraft.password
                          });

                          setAuthSummaries((current) => ({
                            ...current,
                            [selectedSource.portal]: summary
                          }));
                          setAuthDrafts((current) => ({
                            ...current,
                            [selectedSource.portal]: {
                              loginIdentifier: summary.loginIdentifier ?? selectedAuthDraft.loginIdentifier.trim(),
                              password: ""
                            }
                          }));
                        } finally {
                          setAuthBusyPortal(null);
                        }
                      }}
                    />

                    <Button
                      color="gray"
                      disabled={authBusyPortal === selectedSource.portal || (!hasCredentials && selectedSource.portal !== "IMMOWELT")}
                      size="lg"
                      text={authBusyPortal === selectedSource.portal ? "Refreshing..." : "Refresh session"}
                      onClick={async () => {
                        setAuthBusyPortal(selectedSource.portal);

                        try {
                          const summary = await onRefreshSourceAuth(selectedSource.portal);

                          setAuthSummaries((current) => ({
                            ...current,
                            [selectedSource.portal]: summary
                          }));
                        } finally {
                          setAuthBusyPortal(null);
                        }
                      }}
                    />

                    <Button
                      color="gray"
                      disabled={bootstrapBusyPortal === selectedSource.portal || bootstrapRunning}
                      size="lg"
                      text={bootstrapBusyPortal === selectedSource.portal ? "Opening..." : "Open browser login"}
                      onClick={async () => {
                        setBootstrapBusyPortal(selectedSource.portal);

                        try {
                          const summary = await onStartSourceAuthBootstrap(selectedSource.portal);
                          setBootstrapSummaries((current) => ({
                            ...current,
                            [selectedSource.portal]: summary
                          }));
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
                    />

                    <Button
                      color="gray"
                      disabled={bootstrapBusyPortal === selectedSource.portal || !bootstrapRunning}
                      size="lg"
                      text={bootstrapBusyPortal === selectedSource.portal ? "Saving..." : "Save browser session"}
                      onClick={async () => {
                        setBootstrapBusyPortal(selectedSource.portal);

                        try {
                          const result = await onFinishSourceAuthBootstrap(selectedSource.portal);
                          setBootstrapSummaries((current) => ({
                            ...current,
                            [selectedSource.portal]: result.bootstrap
                          }));
                          setAuthSummaries((current) => ({
                            ...current,
                            [selectedSource.portal]: result.authSummary
                          }));
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
                    />

                    <Button
                      color="transparent"
                      disabled={bootstrapBusyPortal === selectedSource.portal || !bootstrapRunning}
                      size="lg"
                      text={bootstrapBusyPortal === selectedSource.portal ? "Closing..." : "Close browser"}
                      onClick={async () => {
                        setBootstrapBusyPortal(selectedSource.portal);

                        try {
                          const summary = await onCancelSourceAuthBootstrap(selectedSource.portal);
                          setBootstrapSummaries((current) => ({
                            ...current,
                            [selectedSource.portal]: summary
                          }));
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
                    />

                    <Button
                      color="transparent"
                      disabled={authBusyPortal === selectedSource.portal || !hasCredentials}
                      size="lg"
                      text={authBusyPortal === selectedSource.portal ? "Removing..." : "Remove credentials"}
                      onClick={async () => {
                        setAuthBusyPortal(selectedSource.portal);

                        try {
                          const summary = await onDeleteSourceAuth(selectedSource.portal);

                          setAuthSummaries((current) => ({
                            ...current,
                            [selectedSource.portal]: summary
                          }));
                          setAuthDrafts((current) => ({
                            ...current,
                            [selectedSource.portal]: {
                              loginIdentifier: "",
                              password: ""
                            }
                          }));
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
                    />
                  </div>
                </>
              ) : (
                <div className="source-auth-meta">
                  {[
                    { label: "Status", value: authBadge.text },
                    { label: "Mode", value: "Public feed" },
                    { label: "Stored login", value: "Not used" },
                    { label: "Last validated", value: formatDate(selectedSource.lastRunAt) }
                  ].map((item) => (
                    <Box color="lightWash" key={item.label} padding={4} rounding={4}>
                      <div className="stat-card stat-card--gestalt">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    </Box>
                  ))}
                </div>
              )}
            </div>

            <div className="source-metrics-grid">
              {[
                { label: "Last run", value: formatDate(selectedSource.lastRunAt) },
                { label: "Last success", value: formatDate(selectedSource.lastSuccessAt) },
                { label: "Last mode", value: selectedSource.lastMode ?? "Unknown" },
                { label: "Listings found", value: String(selectedSource.lastListingsFound ?? 0) },
                { label: "Listings upserted", value: String(selectedSource.lastListingsUpserted ?? 0) },
                { label: "Failed details", value: String(selectedSource.lastFailedDetails ?? 0) }
              ].map((item) => (
                <Box color="lightWash" key={item.label} padding={4} rounding={4}>
                  <div className="stat-card stat-card--gestalt">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                </Box>
              ))}
            </div>

            <div className="source-actions">
              <Button
                color="dark"
                disabled={savingPortal === selectedSource.portal}
                size="lg"
                text={savingPortal === selectedSource.portal ? "Saving..." : "Save source"}
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
              />
            </div>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
