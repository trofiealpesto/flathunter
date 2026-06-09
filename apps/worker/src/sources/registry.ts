import { ensurePortalSource, getPortalSource, updatePortalSource, type Database } from "@flathunter/db";
import { retiredSourcePortals, type AppSettings, type Portal } from "@flathunter/shared";

import type { WorkerEnv } from "../config";
import { flatsforfriendzAdapter } from "./adapters/flatsforfriendz";
import { immoweltAdapter } from "./adapters/immowelt";
import { inberlinwohnenAdapter } from "./adapters/inberlinwohnen";
import { kleinanzeigenAdapter } from "./adapters/kleinanzeigen";
import { wgGesuchtAdapter } from "./adapters/wg-gesucht";
import type { SourceAdapter } from "./types";

export const sourceAdapters = [
  flatsforfriendzAdapter,
  immoweltAdapter,
  wgGesuchtAdapter,
  kleinanzeigenAdapter,
  inberlinwohnenAdapter
] as const;

const adaptersByPortal = new Map<Portal, SourceAdapter>(sourceAdapters.map((adapter) => [adapter.portal, adapter]));
const portalsDisabledUntilAuth = new Set<Portal>(["WG_GESUCHT"]);

export function getSourceAdapter(portal: Portal) {
  const adapter = adaptersByPortal.get(portal);

  if (!adapter) {
    throw new Error(`No source adapter registered for ${portal}`);
  }

  return adapter;
}

export async function ensureDefaultPortalSources(db: Database, settings: AppSettings, env: WorkerEnv) {
  for (const portal of retiredSourcePortals) {
    const current = await getPortalSource(db, portal);

    if (current?.enabled) {
      await updatePortalSource(db, portal, {
        enabled: false
      });
    }
  }

  for (const adapter of sourceAdapters) {
    const current = await getPortalSource(db, adapter.portal);

    if (current) {
      if (
        portalsDisabledUntilAuth.has(adapter.portal) &&
        current.enabled &&
        !current.hasCredentials &&
        current.authStatus !== "session_valid"
      ) {
        await updatePortalSource(db, adapter.portal, {
          enabled: false
        });
      }

      continue;
    }

    const defaults = adapter.defaultSource(settings, env);
    await ensurePortalSource(db, {
      portal: adapter.portal,
      searchUrl: defaults.searchUrl,
      searchParams: defaults.searchParams,
      scrapeIntervalMinutes: defaults.scrapeIntervalMinutes,
      enabled: !portalsDisabledUntilAuth.has(adapter.portal)
    });
  }
}
