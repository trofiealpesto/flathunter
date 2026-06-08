import {
  ensurePortalSource,
  getPortalSourceAuthSummary,
  getDecryptedPortalCredentials,
  getDecryptedPortalSessionState,
  getPortalSource,
  getSettings,
  listPortalSources,
  updatePortalSource,
  upsertPortalSessionState,
  type Database
} from "@flathunter/db";
import { activeSourcePortals, isActiveSourcePortal, retiredSourcePortals, type Portal } from "@flathunter/shared";

import type { ApiEnv } from "../config";
import type { SourceAuthRunnerInput, SourceAuthRunnerResult, SourceSessionState } from "./source-auth";

const portalsDisabledUntilAuth = new Set<Portal>(["WG_GESUCHT"]);

export async function listActivePortalSources(db: Database) {
  const sources = await listPortalSources(db);
  return sources.filter((source) => isActiveSourcePortal(source.portal));
}

export async function ensureDefaultPortalSources(db: Database) {
  const settings = await getSettings(db);
  const definitions: Array<{
    portal: (typeof activeSourcePortals)[number];
    searchUrl: string;
    searchParams: Record<string, unknown>;
  }> = [
    {
      portal: "IMMOWELT",
      searchUrl: settings.search.immoweltSearchUrl,
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts
      }
    },
    {
      portal: "FLATSFORFRIENDZ",
      searchUrl: `https://app.flatsforfriendz.com/en?${new URLSearchParams({
        locations: settings.search.city,
        types: "FLAT"
      }).toString()}`,
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts,
        feedType: "OFFER",
        types: ["FLAT"],
        language: "en"
      }
    },
    {
      portal: "WG_GESUCHT",
      searchUrl: "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html",
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts,
        scope: "whole_flat"
      }
    },
    {
      portal: "KLEINANZEIGEN",
      searchUrl: "https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/c203l3331",
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts,
        category: "wohnung-mieten"
      }
    }
  ];

  for (const portal of retiredSourcePortals) {
    const current = await getPortalSource(db, portal);

    if (current?.enabled) {
      await updatePortalSource(db, portal, {
        enabled: false
      });
    }
  }

  for (const definition of definitions) {
    const current = await getPortalSource(db, definition.portal);

    if (!current) {
      await ensurePortalSource(db, {
        portal: definition.portal,
        searchUrl: definition.searchUrl,
        searchParams: definition.searchParams,
        enabled: !portalsDisabledUntilAuth.has(definition.portal)
      });
      continue;
    }

    if (
      portalsDisabledUntilAuth.has(definition.portal) &&
      current.enabled &&
      !current.hasCredentials &&
      current.authStatus !== "session_valid"
    ) {
      await updatePortalSource(db, definition.portal, {
        enabled: false
      });
    }
  }
}

export async function refreshPortalAuthState(
  db: Database,
  portal: Portal,
  env: ApiEnv,
  sourceAuthRunner: (input: SourceAuthRunnerInput) => Promise<SourceAuthRunnerResult>
) {
  const [source, storedSession, storedCredentials] = await Promise.all([
    getPortalSource(db, portal),
    getDecryptedPortalSessionState<SourceSessionState>(db, portal, env.PORTAL_SECRETS_KEY),
    getDecryptedPortalCredentials<{ password: string }>(db, portal, env.PORTAL_SECRETS_KEY)
  ]);

  if (!source) {
    return getPortalSourceAuthSummary(db, portal);
  }

  const result = await sourceAuthRunner({
    portal,
    searchUrl: source.searchUrl,
    credentials: storedCredentials
      ? {
          loginIdentifier: storedCredentials.loginIdentifier,
          password: storedCredentials.payload.password
        }
      : null,
    sessionState: storedSession?.storageState ?? null,
    env
  });

  await persistPortalAuthResult(db, portal, env, result);

  return getPortalSourceAuthSummary(db, portal);
}

export async function persistPortalAuthResult(
  db: Database,
  portal: Portal,
  env: ApiEnv,
  result: SourceAuthRunnerResult
) {

  await upsertPortalSessionState(
    db,
    portal,
    {
      storageState: result.storageState,
      status: result.status,
      expiresAt: result.expiresAt,
      lastAuthenticatedAt: result.authenticatedAt,
      lastValidatedAt: result.validatedAt,
      lastAuthError: result.errorMessage,
      lastChallengeType: result.challengeType
    },
    env.PORTAL_SECRETS_KEY
  );

  if (result.status === "session_valid") {
    await updatePortalSource(db, portal, {
      enabled: true
    });
  } else if (portal !== "IMMOWELT") {
    await updatePortalSource(db, portal, {
      enabled: false
    });
  }
}
