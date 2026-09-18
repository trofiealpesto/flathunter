import type { PortalSourceCapabilities } from "./sources";

export const municipalSourceUrls = {
  HOWOGE: "https://www.howoge.de/immobiliensuche/wohnungssuche.html",
  GEWOBAG: "https://www.gewobag.de/fuer-mietinteressentinnen/mietangebote/?objekttyp%5B0%5D=wohnung",
} as const;

export type MunicipalPortal = keyof typeof municipalSourceUrls;

const publicCapabilities = {
  supportsLogin: false,
  supportsCaptchaSolver: false,
  supportsDetailFallback: false,
  readiness: "secondary",
  cloudCompatible: true,
  requiresAuthSetup: false,
} as const;

export const municipalSourceCapabilities: Record<MunicipalPortal, PortalSourceCapabilities> = {
  HOWOGE: {
    ...publicCapabilities,
    sourceKind: "public_api",
    setupHint:
      "Annunci diretti HOWOGE, senza account. Include le singole abitazioni del feed; i riepiloghi dei progetti edilizi non sono annunci.",
  },
  GEWOBAG: {
    ...publicCapabilities,
    sourceKind: "scraping",
    setupHint:
      "Annunci diretti Gewobag, senza account. Legge tutte le pagine della ricerca e conserva gli eventuali requisiti WBS.",
  },
};
