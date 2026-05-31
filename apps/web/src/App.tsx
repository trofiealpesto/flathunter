import { Loader2 } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";

import type {
  AppSettings,
  DashboardStats,
  Portal,
  PortalSourceAuthBootstrapFinishResult,
  PortalSourceAuthBootstrapSummary,
  PortalSourceAuthSummary,
  PortalSourceAuthUpsert,
  PortalSourcePatch,
  PortalSourceSummary,
  SessionResponse
} from "@flathunter/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { LoginGate } from "./components/LoginGate";
import { PageShell } from "./components/PageShell";
import { OverviewPage } from "./pages/OverviewPage";
import { ListingsPage } from "./pages/ListingsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { api, type ResetListingsResult } from "./lib/api";

const GLOBAL_POLL_INTERVAL_MS = 30_000;

function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [sources, setSources] = useState<PortalSourceSummary[]>([]);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingGlobals, setLoadingGlobals] = useState(false);
  const [globalsVersion, setGlobalsVersion] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const refreshSourcesAndDashboard = async () => {
    try {
      const [nextSources, nextDashboardStats] = await Promise.all([api.listSources(), api.getDashboardStats()]);
      setSources(nextSources);
      setDashboardStats(nextDashboardStats);
      setGlobalError(null);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Unable to refresh source state");
    }
  };

  useEffect(() => {
    let isCancelled = false;

    async function loadSession() {
      setLoadingSession(true);

      try {
        const nextSession = await api.session();

        if (!isCancelled) {
          setSession(nextSession);
        }
      } catch {
        if (!isCancelled) {
          setSession({
            authenticated: false,
            user: null
          });
        }
      } finally {
        if (!isCancelled) {
          setLoadingSession(false);
        }
      }
    }

    void loadSession();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session?.authenticated) {
      setSettings(null);
      setDashboardStats(null);
      setSources([]);
      setGlobalError(null);
      return;
    }

    let isCancelled = false;

    async function loadGlobals() {
      setLoadingGlobals(true);
      setGlobalError(null);

      try {
        const [nextSettings, nextDashboardStats, nextSources] = await Promise.all([
          api.getSettings(),
          api.getDashboardStats(),
          api.listSources()
        ]);

        if (isCancelled) {
          return;
        }

        setSettings(nextSettings);
        setDashboardStats(nextDashboardStats);
        setSources(nextSources);
      } catch (error) {
        if (!isCancelled) {
          setGlobalError(error instanceof Error ? error.message : "Unable to load dashboard data");
        }
      } finally {
        if (!isCancelled) {
          setLoadingGlobals(false);
        }
      }
    }

    void loadGlobals();

    return () => {
      isCancelled = true;
    };
  }, [session?.authenticated, globalsVersion]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      setGlobalsVersion((current) => current + 1);
    }, GLOBAL_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [session?.authenticated]);

  const handleRefreshGlobals = () => {
    setGlobalsVersion((current) => current + 1);
  };

  const handleLogout = async () => {
    await api.logout();
    setSession({
      authenticated: false,
      user: null
    });
  };

  const handleSaveSettings = async (nextSettings: AppSettings) => {
    const saved = await api.patchSettings(nextSettings);
    setSettings(saved);
  };

  const handleResetListings = async (): Promise<ResetListingsResult> => {
    const result = await api.resetListings();
    await refreshSourcesAndDashboard();
    return result;
  };

  const handleSaveSource = async (portal: Portal, patch: PortalSourcePatch) => {
    const updated = await api.updateSource(portal, patch);
    setSources((current) => current.map((source) => (source.portal === updated.portal ? updated : source)));
    await refreshSourcesAndDashboard();
  };

  const handleGetSourceAuth = async (portal: Portal) => api.getSourceAuthSummary(portal);

  const handleSaveSourceAuth = async (portal: Portal, payload: PortalSourceAuthUpsert): Promise<PortalSourceAuthSummary> => {
    const summary = await api.putSourceAuth(portal, payload);
    await refreshSourcesAndDashboard();
    return summary;
  };

  const handleRefreshSourceAuth = async (portal: Portal): Promise<PortalSourceAuthSummary> => {
    const summary = await api.refreshSourceAuth(portal);
    await refreshSourcesAndDashboard();
    return summary;
  };

  const handleGetSourceAuthBootstrap = async (portal: Portal): Promise<PortalSourceAuthBootstrapSummary> =>
    api.getSourceAuthBootstrap(portal);

  const handleStartSourceAuthBootstrap = async (portal: Portal): Promise<PortalSourceAuthBootstrapSummary> =>
    api.startSourceAuthBootstrap(portal);

  const handleFinishSourceAuthBootstrap = async (portal: Portal): Promise<PortalSourceAuthBootstrapFinishResult> => {
    const result = await api.finishSourceAuthBootstrap(portal);
    await refreshSourcesAndDashboard();
    return result;
  };

  const handleCancelSourceAuthBootstrap = async (portal: Portal): Promise<PortalSourceAuthBootstrapSummary> =>
    api.cancelSourceAuthBootstrap(portal);

  const handleDeleteSourceAuth = async (portal: Portal): Promise<PortalSourceAuthSummary> => {
    const summary = await api.deleteSourceAuth(portal);
    await refreshSourcesAndDashboard();
    return summary;
  };

  if (loadingSession) {
    return (
      <div className="grid min-h-svh place-items-center bg-background text-foreground">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading session" />
      </div>
    );
  }

  if (!session?.authenticated || !session.user) {
    return <LoginGate />;
  }

  const primarySearchUrl = sources.find((source) => source.portal === "IMMOWELT")?.searchUrl ?? settings?.search.immoweltSearchUrl ?? null;
  const sourceIssueCount = sources.filter(
    (source) => source.enabled && (source.lastStatus === "failed" || source.lastStatus === "partial")
  ).length;

  return (
    <BrowserRouter>
      <PageShell
        user={session.user}
        sourceIssueCount={sourceIssueCount}
        onLogout={handleLogout}
      >
        {globalError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{globalError}</span>
              <Button onClick={handleRefreshGlobals} type="button" variant="outline">
              Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <Routes>
          <Route
            path="/overview"
            element={
              <OverviewPage
                dashboardStats={dashboardStats}
                officeLocation={settings?.search.officeLocation ?? null}
                sources={sources}
                loading={loadingGlobals && !dashboardStats}
                onRetry={handleRefreshGlobals}
              />
            }
          />
          <Route
            path="/listings"
            element={
              <ListingsPage
                fallbackSearchUrl={primarySearchUrl}
                isFixtureMode={settings?.runtime.scrapeWithFixtures ?? false}
                officeLocation={settings?.search.officeLocation ?? null}
                onListingMutation={handleRefreshGlobals}
              />
            }
          />
          <Route
            path="/sources"
            element={
              <SourcesPage
                sources={sources}
                loading={loadingGlobals && sources.length === 0}
                onCancelSourceAuthBootstrap={handleCancelSourceAuthBootstrap}
                onDeleteSourceAuth={handleDeleteSourceAuth}
                onGetSourceAuth={handleGetSourceAuth}
                onGetSourceAuthBootstrap={handleGetSourceAuthBootstrap}
                onFinishSourceAuthBootstrap={handleFinishSourceAuthBootstrap}
                onRefreshSourceAuth={handleRefreshSourceAuth}
                onRetry={handleRefreshGlobals}
                onSaveSource={handleSaveSource}
                onSaveSourceAuth={handleSaveSourceAuth}
                onStartSourceAuthBootstrap={handleStartSourceAuthBootstrap}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                loading={loadingGlobals && !settings}
                onSearchOfficeLocation={(query) => api.searchOfficeLocation(query)}
                onResetListings={handleResetListings}
                onRetry={handleRefreshGlobals}
                onSaveSettings={handleSaveSettings}
                settings={settings}
              />
            }
          />
          <Route path="*" element={<Navigate replace to="/overview" />} />
        </Routes>
      </PageShell>
    </BrowserRouter>
  );
}

export default App;
