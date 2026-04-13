import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const page = {
    goto: vi.fn(),
    waitForLoadState: vi.fn(),
    content: vi.fn(),
    title: vi.fn(),
    url: vi.fn(),
    locator: vi.fn(),
    waitForTimeout: vi.fn(),
    bringToFront: vi.fn(),
    close: vi.fn(),
    isClosed: vi.fn()
  };

  const context = {
    route: vi.fn(),
    addInitScript: vi.fn(),
    newPage: vi.fn(),
    storageState: vi.fn(),
    close: vi.fn()
  };

  const browser = {
    newContext: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn()
  };

  return {
    chromium: {
      launch: vi.fn()
    },
    page,
    context,
    browser
  };
});

vi.mock("@playwright/test", () => ({
  chromium: mocks.chromium
}));

import { runPortalAuthRefresh, sourceAuthBootstrapManager } from "./source-auth";

const env = {
  NODE_ENV: "test" as const,
  PORT: 4000,
  DATABASE_URL: "postgres://unused",
  APP_ORIGIN: "http://localhost:3000",
  GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
  GEMINI_API_KEY: "gemini-test-key",
  NOMINATIM_BASE_URL: "https://nominatim.openstreetmap.org",
  SCRAPER_PROXY_URL: undefined,
  PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
  SESSION_SECRET: "1234567890123456",
  ADMIN_GITHUB_LOGIN: "giuva",
  GITHUB_CLIENT_ID: "github-client",
  GITHUB_CLIENT_SECRET: "github-secret",
  ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP: true
};

beforeEach(() => {
  vi.clearAllMocks();

  mocks.page.goto.mockResolvedValue(undefined);
  mocks.page.waitForLoadState.mockResolvedValue(undefined);
  mocks.page.content.mockResolvedValue("<html><body><main>Wohnung in Berlin</main></body></html>");
  mocks.page.title.mockResolvedValue("WG-Gesucht");
  mocks.page.url.mockReturnValue("https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html");
  mocks.page.locator.mockReturnValue({
    first: () => ({
      isVisible: vi.fn().mockResolvedValue(false)
    })
  });
  mocks.page.waitForTimeout.mockResolvedValue(undefined);
  mocks.page.bringToFront.mockResolvedValue(undefined);
  mocks.page.close.mockResolvedValue(undefined);
  mocks.page.isClosed.mockReturnValue(false);

  mocks.context.route.mockResolvedValue(undefined);
  mocks.context.addInitScript.mockResolvedValue(undefined);
  mocks.context.newPage.mockResolvedValue(mocks.page);
  mocks.context.storageState.mockResolvedValue({
    cookies: [],
    origins: []
  });
  mocks.context.close.mockResolvedValue(undefined);

  mocks.browser.newContext.mockResolvedValue(mocks.context);
  mocks.browser.close.mockResolvedValue(undefined);
  mocks.browser.isConnected.mockReturnValue(true);

  mocks.chromium.launch.mockResolvedValue(mocks.browser);
});

afterEach(async () => {
  await sourceAuthBootstrapManager.cancel("WG_GESUCHT");
});

describe("source-auth browser configuration", () => {
  it("blocks heavy resources during automated auth refresh", async () => {
    const result = await runPortalAuthRefresh({
      portal: "WG_GESUCHT",
      searchUrl: "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html",
      credentials: null,
      sessionState: null,
      env
    });

    expect(result.status).toBe("session_valid");
    expect(mocks.context.route).toHaveBeenCalledTimes(1);
    expect(mocks.context.addInitScript).toHaveBeenCalledTimes(1);
    expect(mocks.page.goto).toHaveBeenCalledWith(
      "https://www.wg-gesucht.de/mein-wg-gesucht.html",
      expect.objectContaining({
        waitUntil: "commit",
        timeout: 45_000
      })
    );
    expect(mocks.chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true
      })
    );
  });

  it("leaves resources unblocked during manual bootstrap", async () => {
    const summary = await sourceAuthBootstrapManager.start({
      portal: "WG_GESUCHT",
      searchUrl: "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html",
      sessionState: null,
      env
    });

    expect(summary).toMatchObject({
      portal: "WG_GESUCHT",
      status: "running"
    });
    expect(mocks.context.route).not.toHaveBeenCalled();
    expect(mocks.context.addInitScript).toHaveBeenCalledTimes(1);
    expect(mocks.page.goto).toHaveBeenCalledWith(
      "https://www.wg-gesucht.de/mein-wg-gesucht.html",
      expect.objectContaining({
        waitUntil: "commit",
        timeout: 45_000
      })
    );
    expect(mocks.chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false
      })
    );
  });

  it("returns an idle summary when manual bootstrap is disabled", async () => {
    const summary = await sourceAuthBootstrapManager.start({
      portal: "WG_GESUCHT",
      searchUrl: "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html",
      sessionState: null,
      env: {
        ...env,
        ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP: false
      }
    });

    expect(summary).toMatchObject({
      portal: "WG_GESUCHT",
      status: "idle"
    });
    expect(summary.message).toContain("disabled on this deployment");
    expect(mocks.chromium.launch).not.toHaveBeenCalled();
  });

  it("surfaces the disabled bootstrap notice from status polling", async () => {
    const summary = await sourceAuthBootstrapManager.getStatus("WG_GESUCHT", {
      ...env,
      ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP: false
    });

    expect(summary).toMatchObject({
      portal: "WG_GESUCHT",
      status: "idle"
    });
    expect(summary.message).toContain("disabled on this deployment");
  });
});
