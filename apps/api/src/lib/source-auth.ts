import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import {
  buildStealthInitScript,
  formatRuntimeError,
  type Portal,
  type PortalSourceAuthBootstrapSummary,
  type SourceAuthStatus
} from "@flathunter/shared";

import type { ApiEnv } from "../config";

type SourceCredentials = {
  loginIdentifier: string;
  password: string;
};

export type SourceSessionState = Extract<BrowserContextOptions["storageState"], object>;

export type SourceAuthRunnerInput = {
  portal: Portal;
  searchUrl: string;
  credentials: SourceCredentials | null;
  sessionState: SourceSessionState | null;
  env: ApiEnv;
};

export type SourceAuthRunnerResult = {
  status: SourceAuthStatus;
  storageState: SourceSessionState | null;
  expiresAt: Date | null;
  authenticatedAt: Date | null;
  validatedAt: Date | null;
  errorMessage: string | null;
  challengeType: string | null;
};

export type SourceAuthBootstrapInput = {
  portal: Portal;
  searchUrl: string;
  sessionState: SourceSessionState | null;
  env: ApiEnv;
};

export type SourceAuthBootstrapCompleteResult = {
  bootstrap: PortalSourceAuthBootstrapSummary;
  authResult: SourceAuthRunnerResult | null;
};

export type SourceAuthBootstrapManager = {
  getStatus: (portal: Portal, env: ApiEnv) => Promise<PortalSourceAuthBootstrapSummary>;
  start: (input: SourceAuthBootstrapInput) => Promise<PortalSourceAuthBootstrapSummary>;
  finish: (input: Omit<SourceAuthBootstrapInput, "sessionState">) => Promise<SourceAuthBootstrapCompleteResult>;
  cancel: (portal: Portal) => Promise<PortalSourceAuthBootstrapSummary>;
};

type SourceAuthConfig = {
  optionalCredentials: boolean;
  loginUrl?: string;
  validationUrl?: string;
  navigationTimeoutMs?: number;
  blockedIndicators: string[];
  loginIndicators: string[];
  loginUrlIndicators: string[];
  loginIdentifierSelectors: string[];
  passwordSelectors: string[];
  nextSelectors: string[];
  submitSelectors: string[];
};

const defaultLoginIdentifierSelectors = [
  'input[type="email"]',
  'input[name*="email" i]',
  'input[id*="email" i]',
  'input[name*="user" i]',
  'input[id*="user" i]',
  'input[name*="login" i]',
  'input[id*="login" i]',
  'input[name*="identifier" i]',
  'input[id*="identifier" i]'
];

const defaultPasswordSelectors = ['input[type="password"]', 'input[name*="pass" i]', 'input[id*="pass" i]'];

const defaultNextSelectors = [
  'button:has-text("Continue")',
  'button:has-text("Weiter")',
  'button:has-text("Next")',
  'button:has-text("Anmelden")',
  'button:has-text("Einloggen")'
];

const defaultSubmitSelectors = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Anmelden")',
  'button:has-text("Einloggen")',
  'button:has-text("Login")',
  'button:has-text("Sign in")',
  'button:has-text("Log in")'
];

const sourceAuthConfigs: Record<Portal, SourceAuthConfig> = {
  IMMOWELT: {
    optionalCredentials: true,
    loginUrl: "https://www.immowelt.de/",
    blockedIndicators: [
      "wir haben technische schwierigkeiten",
      "bitte versuche es in ein paar minuten erneut",
      "technical difficulties",
      "please enable js and disable any ad blocker",
      "captcha-delivery.com",
      "captcha",
      "access denied",
      "forbidden"
    ],
    loginIndicators: ["anmelden", "einloggen", "login", "sign in"],
    loginUrlIndicators: ["login", "anmelden", "einloggen"],
    loginIdentifierSelectors: defaultLoginIdentifierSelectors,
    passwordSelectors: defaultPasswordSelectors,
    nextSelectors: defaultNextSelectors,
    submitSelectors: defaultSubmitSelectors
  },
  IMMOSCOUT24: {
    optionalCredentials: false,
    loginUrl: "https://www.immobilienscout24.de/anmelden",
    blockedIndicators: [
      "ich bin kein roboter",
      "fälschlicherweise als roboter identifiziert",
      "security measure",
      "access denied",
      "captcha"
    ],
    loginIndicators: ["anmelden", "einloggen", "konto", "login", "sign in"],
    loginUrlIndicators: ["login", "anmelden", "einloggen"],
    loginIdentifierSelectors: defaultLoginIdentifierSelectors,
    passwordSelectors: defaultPasswordSelectors,
    nextSelectors: defaultNextSelectors,
    submitSelectors: defaultSubmitSelectors
  },
  WG_GESUCHT: {
    optionalCredentials: false,
    loginUrl: "https://www.wg-gesucht.de/mein-wg-gesucht.html",
    validationUrl: "https://www.wg-gesucht.de/mein-wg-gesucht.html",
    navigationTimeoutMs: 45_000,
    blockedIndicators: [
      "access denied",
      "captcha",
      "forbidden",
      "i am not a robot",
      "ich bin kein roboter",
      "security check"
    ],
    loginIndicators: ["anmelden", "einloggen", "login", "passwort", "password"],
    loginUrlIndicators: ["login", "anmelden", "einloggen"],
    loginIdentifierSelectors: defaultLoginIdentifierSelectors,
    passwordSelectors: defaultPasswordSelectors,
    nextSelectors: defaultNextSelectors,
    submitSelectors: defaultSubmitSelectors
  },
  KLEINANZEIGEN: {
    optionalCredentials: false,
    loginUrl: "https://www.kleinanzeigen.de/m-einloggen.html",
    validationUrl: "https://www.kleinanzeigen.de/m-einloggen.html",
    blockedIndicators: ["captcha", "i am not a robot", "ich bin kein roboter", "access denied", "forbidden", "security check"],
    loginIndicators: ["anmelden", "einloggen", "login", "passwort", "password"],
    loginUrlIndicators: ["login", "anmelden", "einloggen", "m-einloggen"],
    loginIdentifierSelectors: defaultLoginIdentifierSelectors,
    passwordSelectors: defaultPasswordSelectors,
    nextSelectors: defaultNextSelectors,
    submitSelectors: defaultSubmitSelectors
  },
  FLATSFORFRIENDZ: {
    optionalCredentials: true,
    loginUrl: "https://app.flatsforfriendz.com/en",
    validationUrl: "https://app.flatsforfriendz.com/en",
    blockedIndicators: [],
    loginIndicators: [],
    loginUrlIndicators: [],
    loginIdentifierSelectors: defaultLoginIdentifierSelectors,
    passwordSelectors: defaultPasswordSelectors,
    nextSelectors: defaultNextSelectors,
    submitSelectors: defaultSubmitSelectors
  },
  INBERLINWOHNEN: {
    optionalCredentials: true,
    loginUrl: "https://inberlinwohnen.de/wohnungsfinder/",
    validationUrl: "https://inberlinwohnen.de/wohnungsfinder/",
    blockedIndicators: [],
    loginIndicators: [],
    loginUrlIndicators: [],
    loginIdentifierSelectors: defaultLoginIdentifierSelectors,
    passwordSelectors: defaultPasswordSelectors,
    nextSelectors: defaultNextSelectors,
    submitSelectors: defaultSubmitSelectors
  }
};

type ManualSourceAuthSession = {
  portal: Portal;
  searchUrl: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  startedAt: Date;
  updatedAt: Date;
  message: string | null;
};

const manualSourceAuthSessions = new Map<Portal, ManualSourceAuthSession>();

function serializeBootstrapSummary(
  portal: Portal,
  status: "idle" | "running",
  config: SourceAuthConfig,
  summary?: {
    message?: string | null;
    startedAt?: Date | null;
    updatedAt?: Date | null;
  }
): PortalSourceAuthBootstrapSummary {
  return {
    portal,
    status,
    loginUrl: config.loginUrl ?? null,
    message: summary?.message ?? null,
    startedAt: summary?.startedAt ? summary.startedAt.toISOString() : null,
    updatedAt: summary?.updatedAt ? summary.updatedAt.toISOString() : null
  };
}

function getContextOptions(sessionState: SourceSessionState | null): BrowserContextOptions {
  return {
    storageState: sessionState ?? undefined,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: {
      width: 1440,
      height: 900
    },
    colorScheme: "light",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
      DNT: "1",
      "Upgrade-Insecure-Requests": "1"
    }
  };
}

async function configureContext(context: BrowserContext, options?: { blockResources?: boolean }) {
  if (options?.blockResources ?? true) {
    await context.route("**/*", async (route) => {
      const resourceType = route.request().resourceType();

      if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
        await route.abort();
        return;
      }

      await route.continue();
    });
  }

  await context.addInitScript(buildStealthInitScript());
}

async function closeManualSourceAuthSession(session: ManualSourceAuthSession | undefined) {
  if (!session) {
    return;
  }

  await session.page.close().catch(() => {});
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
}

async function findVisibleSelector(page: { locator: (selector: string) => any }, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      if (await locator.isVisible({ timeout: 700 })) {
        return locator;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getNavigationTimeoutMs(portal: Portal, fallbackMs: number) {
  return sourceAuthConfigs[portal].navigationTimeoutMs ?? fallbackMs;
}

function getValidationUrl(portal: Portal, searchUrl: string) {
  return sourceAuthConfigs[portal].validationUrl ?? searchUrl;
}

async function gotoWithSoftDomContentLoaded(
  page: {
    goto: Function;
    waitForLoadState: Function;
  },
  url: string,
  timeoutMs: number
) {
  await page.goto(url, {
    waitUntil: "commit",
    timeout: timeoutMs
  });
  await page.waitForLoadState("domcontentloaded", {
    timeout: Math.min(timeoutMs, 7_500)
  }).catch(() => {});
}

async function readPageSnapshot(page: {
  goto: Function;
  waitForLoadState: Function;
  content: Function;
  title: Function;
  url: () => string;
}, url: string, timeoutMs: number) {
  await gotoWithSoftDomContentLoaded(page, url, timeoutMs);
  await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => {});
  const html = await page.content();
  const title = await page.title().catch(() => "");

  return {
    url: page.url(),
    html: html.toLowerCase(),
    text: extractReadablePageText(html),
    title: title.toLowerCase()
  };
}

async function readCurrentPageSnapshot(page: {
  content: Function;
  title: Function;
  url: () => string;
}) {
  const html = await page.content();
  const title = await page.title().catch(() => "");

  return {
    url: page.url(),
    html: html.toLowerCase(),
    text: extractReadablePageText(html),
    title: title.toLowerCase()
  };
}

function extractReadablePageText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isBlocked(config: SourceAuthConfig, text: string, title: string) {
  return config.blockedIndicators.some((needle) => text.includes(needle) || title.includes(needle));
}

function looksLikeLoginForm(html: string) {
  const hasPasswordField = /<input[^>]+type=["']password["'][^>]*>/i.test(html);
  const hasIdentifierField =
    /<input[^>]+type=["']email["'][^>]*>/i.test(html) ||
    /<input[^>]+name=["'][^"']*(email|user|login|identifier)[^"']*["'][^>]*>/i.test(html) ||
    /<input[^>]+id=["'][^"']*(email|user|login|identifier)[^"']*["'][^>]*>/i.test(html);

  return hasPasswordField && hasIdentifierField;
}

function isLoginRequired(config: SourceAuthConfig, currentUrl: string, html: string) {
  const normalizedUrl = currentUrl.toLowerCase();

  if (config.loginUrlIndicators.some((needle) => normalizedUrl.includes(needle))) {
    return true;
  }

  return looksLikeLoginForm(html);
}

function evaluateSnapshot(
  config: SourceAuthConfig,
  snapshot: {
    url: string;
    html: string;
    text: string;
    title: string;
  }
) {
  if (isBlocked(config, snapshot.text, snapshot.title)) {
    return {
      ok: false as const,
      status: "challenge_required" as const,
      errorMessage: "Search page returned an unavailable, blocked, or robot challenge response",
      challengeType:
        snapshot.text.includes("captcha") || snapshot.title.includes("captcha") ? "captcha" : "anti_bot"
    };
  }

  if (isLoginRequired(config, snapshot.url, snapshot.html)) {
    return {
      ok: false as const,
      status: "session_expired" as const,
      errorMessage: "Search page requires an authenticated session",
      challengeType: null
    };
  }

  return {
    ok: true as const
  };
}

async function validateSearchPage(page: {
  goto: Function;
  waitForLoadState: Function;
  content: Function;
  title: Function;
  url: () => string;
}, portal: Portal, searchUrl: string) {
  const config = sourceAuthConfigs[portal];
  const snapshot = await readPageSnapshot(page, getValidationUrl(portal, searchUrl), getNavigationTimeoutMs(portal, 30_000));

  return evaluateSnapshot(config, snapshot);
}

async function validateCurrentPage(page: {
  content: Function;
  title: Function;
  url: () => string;
}, portal: Portal) {
  const config = sourceAuthConfigs[portal];
  const snapshot = await readCurrentPageSnapshot(page);
  return evaluateSnapshot(config, snapshot);
}

async function attemptLogin(
  page: {
    goto: Function;
    waitForLoadState: Function;
    content: Function;
    title: Function;
    url: () => string;
    locator: (selector: string) => any;
    waitForTimeout: (timeout: number) => Promise<void>;
  },
  portal: Portal,
  credentials: SourceCredentials
) {
  const config = sourceAuthConfigs[portal];
  const targetUrl = config.loginUrl ?? sourceAuthConfigs[portal].loginUrl ?? "";

  await gotoWithSoftDomContentLoaded(page, targetUrl, getNavigationTimeoutMs(portal, 20_000));
  await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => {});

  const loginIdentifierField = await findVisibleSelector(page, config.loginIdentifierSelectors);

  if (!loginIdentifierField) {
    return {
      ok: false as const,
      status: "auth_failed" as const,
      errorMessage: "Login form was not detected for this portal",
      challengeType: null
    };
  }

  await loginIdentifierField.fill(credentials.loginIdentifier);

  let passwordField = await findVisibleSelector(page, config.passwordSelectors);

  if (!passwordField) {
    const nextButton = await findVisibleSelector(page, config.nextSelectors);

    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(800);
      passwordField = await findVisibleSelector(page, config.passwordSelectors);
    }
  }

  if (!passwordField) {
    return {
      ok: false as const,
      status: "auth_failed" as const,
      errorMessage: "Password field was not detected for this portal",
      challengeType: null
    };
  }

  await passwordField.fill(credentials.password);

  const submitButton = await findVisibleSelector(page, config.submitSelectors);

  if (submitButton) {
    await Promise.all([
      submitButton.click(),
      page.waitForLoadState("domcontentloaded", { timeout: 12_000 }).catch(() => {})
    ]);
  } else {
    await passwordField.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 12_000 }).catch(() => {});
  }

  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  const html = ((await page.content()) as string).toLowerCase();
  const text = extractReadablePageText(html);
  const title = (await page.title().catch(() => "")).toLowerCase();

  if (isBlocked(config, text, title)) {
    return {
      ok: false as const,
      status: "challenge_required" as const,
      errorMessage: "Login triggered a blocked or challenge response",
      challengeType: text.includes("captcha") || title.includes("captcha") ? "captcha" : "anti_bot"
    };
  }

  if (isLoginRequired(config, page.url(), html)) {
    return {
      ok: false as const,
      status: "auth_failed" as const,
      errorMessage: "Portal rejected the provided credentials",
      challengeType: null
    };
  }

  return {
    ok: true as const
  };
}

export async function runPortalAuthRefresh({
  portal,
  searchUrl,
  credentials,
  sessionState,
  env
}: SourceAuthRunnerInput): Promise<SourceAuthRunnerResult> {
  const config = sourceAuthConfigs[portal];
  const browser = await chromium.launch({
    headless: true,
    proxy: env.SCRAPER_PROXY_URL
      ? {
          server: env.SCRAPER_PROXY_URL
        }
      : undefined
  });
  const context = await browser.newContext(getContextOptions(sessionState));
  await configureContext(context, {
    blockResources: true
  });

  try {
    const page = await context.newPage();
    const validatedAt = new Date();
    const validation = await validateSearchPage(page, portal, searchUrl);

    if (validation.ok) {
      const storageState = (await context.storageState()) as SourceSessionState;
      await page.close();

      return {
        status: "session_valid",
        storageState,
        expiresAt: null,
        authenticatedAt: sessionState ? null : validatedAt,
        validatedAt,
        errorMessage: null,
        challengeType: null
      };
    }

    if (validation.status === "challenge_required") {
      const storageState = (await context.storageState()) as SourceSessionState;
      await page.close();

      return {
        status: "challenge_required",
        storageState,
        expiresAt: null,
        authenticatedAt: null,
        validatedAt,
        errorMessage: validation.errorMessage,
        challengeType: validation.challengeType
      };
    }

    if (!credentials) {
      const storageState = sessionState ? ((await context.storageState()) as SourceSessionState) : null;
      await page.close();

      return {
        status: config.optionalCredentials ? "ready" : "missing_credentials",
        storageState,
        expiresAt: null,
        authenticatedAt: null,
        validatedAt,
        errorMessage: config.optionalCredentials ? null : "Credentials are required before refreshing source auth",
        challengeType: null
      };
    }

    const loginAttempt = await attemptLogin(page, portal, credentials);
    const storageState = (await context.storageState()) as SourceSessionState;

    if (!loginAttempt.ok) {
      await page.close();
      return {
        status: loginAttempt.status,
        storageState,
        expiresAt: null,
        authenticatedAt: null,
        validatedAt,
        errorMessage: loginAttempt.errorMessage,
        challengeType: loginAttempt.challengeType
      };
    }

    const postLoginValidation = await validateSearchPage(page, portal, searchUrl);
    await page.close();

    if (!postLoginValidation.ok) {
      return {
        status: postLoginValidation.status,
        storageState,
        expiresAt: null,
        authenticatedAt: null,
        validatedAt,
        errorMessage: postLoginValidation.errorMessage,
        challengeType: postLoginValidation.challengeType
      };
    }

    return {
      status: "session_valid",
      storageState,
      expiresAt: null,
      authenticatedAt: validatedAt,
      validatedAt,
      errorMessage: null,
      challengeType: null
    };
  } catch (error) {
    return {
      status: "auth_failed",
      storageState: sessionState,
      expiresAt: null,
      authenticatedAt: null,
      validatedAt: new Date(),
      errorMessage: formatRuntimeError(error, "Source auth refresh failed"),
      challengeType: null
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function getManualSessionSummary(portal: Portal, env: ApiEnv) {
  const config = sourceAuthConfigs[portal];
  const session = manualSourceAuthSessions.get(portal);

  if (!session && !env.ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP) {
    return serializeBootstrapSummary(portal, "idle", config, {
      message: getManualBootstrapDisabledMessage(),
      updatedAt: new Date()
    });
  }

  if (!session) {
    return serializeBootstrapSummary(portal, "idle", config);
  }

  if (!session.browser.isConnected()) {
    manualSourceAuthSessions.delete(portal);
    return serializeBootstrapSummary(portal, "idle", config, {
      message: "The manual browser window was closed before the session was captured.",
      startedAt: session.startedAt,
      updatedAt: new Date()
    });
  }

  return serializeBootstrapSummary(portal, "running", config, {
    message:
      session.message ??
      "Finish the login or challenge flow in the opened browser window, then click Save browser session.",
    startedAt: session.startedAt,
    updatedAt: session.updatedAt
  });
}

function getManualBootstrapDisabledMessage() {
  return "Manual browser bootstrap is disabled on this deployment. Run the API locally for 'Open browser login', then save the browser session there.";
}

async function startManualSourceAuth({
  portal,
  searchUrl,
  sessionState,
  env
}: SourceAuthBootstrapInput): Promise<PortalSourceAuthBootstrapSummary> {
  const existing = manualSourceAuthSessions.get(portal);
  await closeManualSourceAuthSession(existing);
  manualSourceAuthSessions.delete(portal);

  const config = sourceAuthConfigs[portal];

  if (!env.ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP) {
    return serializeBootstrapSummary(portal, "idle", config, {
      message: getManualBootstrapDisabledMessage(),
      updatedAt: new Date()
    });
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({
      headless: false,
      proxy: env.SCRAPER_PROXY_URL
        ? {
            server: env.SCRAPER_PROXY_URL
          }
        : undefined
    });
    context = await browser.newContext(getContextOptions(sessionState));
    await configureContext(context, {
      blockResources: false
    });
    page = await context.newPage();

    const now = new Date();
    const targetUrl = config.loginUrl ?? searchUrl;
    const session: ManualSourceAuthSession = {
      portal,
      searchUrl,
      browser,
      context,
      page,
      startedAt: now,
      updatedAt: now,
      message: "Complete the login or challenge flow in the opened browser, then click Save browser session."
    };

    manualSourceAuthSessions.set(portal, session);

    await page.bringToFront().catch(() => {});

    try {
      await gotoWithSoftDomContentLoaded(page, targetUrl, getNavigationTimeoutMs(portal, 20_000));
      await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => {});
      await page.bringToFront().catch(() => {});
      session.updatedAt = new Date();
      session.message = "A browser window has been opened locally. Complete login or solve the challenge there, then click Save browser session.";
    } catch (error) {
      session.updatedAt = new Date();
      session.message = `The browser window opened, but the initial portal page did not load cleanly. You can continue manually in the opened window, then click Save browser session. ${formatRuntimeError(error, "Unknown navigation error.")}`;
    }

    return serializeBootstrapSummary(portal, "running", config, {
      message: session.message,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt
    });
  } catch (error) {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});

    return serializeBootstrapSummary(portal, "idle", config, {
      message: `Unable to open a local browser window for manual login. Make sure the API is running on your local machine with a graphical session. ${formatRuntimeError(error, "Unknown browser launch error.")}`,
      updatedAt: new Date()
    });
  }
}

async function finishManualSourceAuth({
  portal,
  searchUrl,
  env
}: Omit<SourceAuthBootstrapInput, "sessionState" | "env"> & { env: ApiEnv }): Promise<SourceAuthBootstrapCompleteResult> {
  void env;
  const config = sourceAuthConfigs[portal];
  const session = manualSourceAuthSessions.get(portal);

  if (!session || !session.browser.isConnected()) {
    if (session) {
      await closeManualSourceAuthSession(session);
      manualSourceAuthSessions.delete(portal);
    }

    return {
      bootstrap: serializeBootstrapSummary(portal, "idle", config, {
        message: "No manual browser session is currently running for this source.",
        updatedAt: new Date()
      }),
      authResult: null
    };
  }

  const validatedAt = new Date();
  const sessionPageIsUsable =
    typeof session.page.isClosed === "function" ? !session.page.isClosed() : session.browser.isConnected();
  let validation =
    sessionPageIsUsable && isPortalRelevantUrl(session.page.url(), portal, searchUrl)
      ? await validateCurrentPage(session.page, portal)
      : null;

  if (!validation || !validation.ok) {
    validation = await validateSearchPage(session.page, portal, searchUrl);
  }

  const storageState = (await session.context.storageState()) as SourceSessionState;

  if (validation.ok) {
    await closeManualSourceAuthSession(session);
    manualSourceAuthSessions.delete(portal);

    return {
      bootstrap: serializeBootstrapSummary(portal, "idle", config, {
        message: "Browser session captured successfully.",
        startedAt: session.startedAt,
        updatedAt: validatedAt
      }),
      authResult: {
        status: "session_valid",
        storageState,
        expiresAt: null,
        authenticatedAt: validatedAt,
        validatedAt,
        errorMessage: null,
        challengeType: null
      }
    };
  }

  session.updatedAt = validatedAt;
  session.message = validation.errorMessage;

  return {
    bootstrap: serializeBootstrapSummary(portal, "running", config, {
      message: validation.errorMessage,
      startedAt: session.startedAt,
      updatedAt: validatedAt
    }),
    authResult: {
      status: validation.status,
      storageState,
      expiresAt: null,
      authenticatedAt: null,
      validatedAt,
      errorMessage: validation.errorMessage,
      challengeType: validation.challengeType
    }
  };
}

function isPortalRelevantUrl(currentUrl: string, portal: Portal, searchUrl: string) {
  try {
    const current = new URL(currentUrl);
    const search = new URL(searchUrl);
    const loginUrl = sourceAuthConfigs[portal].loginUrl ? new URL(sourceAuthConfigs[portal].loginUrl as string) : null;

    return (
      current.hostname === search.hostname ||
      (loginUrl !== null && current.hostname === loginUrl.hostname)
    );
  } catch {
    return false;
  }
}

async function cancelManualSourceAuth(portal: Portal): Promise<PortalSourceAuthBootstrapSummary> {
  const config = sourceAuthConfigs[portal];
  const session = manualSourceAuthSessions.get(portal);
  await closeManualSourceAuthSession(session);
  manualSourceAuthSessions.delete(portal);

  return serializeBootstrapSummary(portal, "idle", config, {
    message: "Manual browser session closed.",
    updatedAt: new Date()
  });
}

export const sourceAuthBootstrapManager: SourceAuthBootstrapManager = {
  getStatus: getManualSessionSummary,
  start: startManualSourceAuth,
  finish: finishManualSourceAuth,
  cancel: cancelManualSourceAuth
};
