import type {
  AppSettings,
  ListingUpsertInput,
  Portal,
  PortalSearchParams,
  PortalSourceCapabilities,
  SourceAuthStatus,
  SourceRunMode
} from "@flathunter/shared";
import type { BrowserContextOptions } from "@playwright/test";
import type { Database } from "@flathunter/db";

import type { WorkerEnv } from "../config";

export type DetailFailureCounts = {
  blocked: number;
  invalid: number;
  error: number;
};

export type SourceSessionState = Extract<BrowserContextOptions["storageState"], object>;

export type SourceCredentials = {
  loginIdentifier: string;
  password: string;
};

export type SourceAuthAttemptResult = {
  status: SourceAuthStatus;
  storageState: SourceSessionState | null;
  expiresAt?: Date | null;
  authenticatedAt?: Date | null;
  validatedAt?: Date | null;
  errorMessage?: string | null;
  challengeType?: string | null;
};

export type SourceScrapeResult = {
  listings: ListingUpsertInput[];
  listingsFound: number;
  failedDetails: number;
  detailFailures: DetailFailureCounts;
  mode: SourceRunMode;
  authStatus: SourceAuthStatus;
  authError: string | null;
  challengeType: string | null;
  sessionState: SourceSessionState | null;
  sessionExpiresAt: Date | null;
  authenticatedAt: Date | null;
  validatedAt: Date | null;
};

export type SourceEnsureDefaults = {
  searchUrl: string;
  searchParams: PortalSearchParams;
};

export type SourceAdapterContext = {
  env: WorkerEnv;
  settings: AppSettings;
  searchUrl: string;
  searchParams: PortalSearchParams;
  scrapeWithFixtures: boolean;
  sessionState: SourceSessionState | null;
  credentials: SourceCredentials | null;
  fetchImpl?: typeof fetch;
  forceAuthRefresh?: boolean;
};

export type SourceAdapter = {
  portal: Portal;
  capabilities: PortalSourceCapabilities;
  defaultSource(settings: AppSettings, env: WorkerEnv): SourceEnsureDefaults;
  scrape(context: SourceAdapterContext): Promise<SourceScrapeResult>;
  cleanup?: (context: {
    db: Database;
    portal: Portal;
    runMode: SourceRunMode;
    listingsFound: number;
    listingsUpserted: number;
  }) => Promise<void>;
};
