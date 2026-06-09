import type { Portal } from "./listings";

export const activeSourcePortals = ["IMMOWELT", "WG_GESUCHT", "FLATSFORFRIENDZ", "KLEINANZEIGEN", "INBERLINWOHNEN"] as const;
export const retiredSourcePortals = ["IMMOSCOUT24"] as const;

export type ActiveSourcePortal = (typeof activeSourcePortals)[number];
export type RetiredSourcePortal = (typeof retiredSourcePortals)[number];

export function isActiveSourcePortal(portal: Portal): portal is ActiveSourcePortal {
  return (activeSourcePortals as readonly Portal[]).includes(portal);
}

export function isRetiredSourcePortal(portal: Portal): portal is RetiredSourcePortal {
  return (retiredSourcePortals as readonly Portal[]).includes(portal);
}
