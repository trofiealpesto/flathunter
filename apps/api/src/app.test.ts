import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensurePortalSource, getSettings, markPortalRun, upsertListing, type Database } from "@flathunter/db";
import { canonicalizeListingUrl } from "@flathunter/shared";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app";
import { buildSessionCookieValue } from "./lib/session";
import * as schema from "../../../packages/db/src/schema";

function readSetCookieValue(header: string | string[] | undefined, name: string) {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = values.find((value) => value.startsWith(`${name}=`));

  if (!cookie) {
    return null;
  }

  return cookie.slice(name.length + 1).split(";")[0] ?? null;
}

async function applyMigrations(exec: (sql: string) => Promise<unknown>) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(currentDir, "../../../packages/db/drizzle/migrations");
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const migration = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const pgLiteSafeMigration = migration.replace(/DO \$\$ BEGIN\s+(CREATE TYPE[\s\S]*?;)\s+EXCEPTION[\s\S]*?END \$\$;/g, "$1");

    await exec(pgLiteSafeMigration);
  }
}

describe("api app", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: Database;
  const fetchImpl = vi.fn<typeof fetch>();
  const sourceAuthRunner = vi.fn();
  const sourceAuthBootstrap = {
    getStatus: vi.fn(),
    start: vi.fn(),
    finish: vi.fn(),
    cancel: vi.fn()
  };

  beforeEach(async () => {
    fetchImpl.mockReset();
    fetchImpl.mockImplementation(fetch);
    sourceAuthRunner.mockReset();
    sourceAuthBootstrap.getStatus.mockReset();
    sourceAuthBootstrap.start.mockReset();
    sourceAuthBootstrap.finish.mockReset();
    sourceAuthBootstrap.cancel.mockReset();
    sourceAuthRunner.mockResolvedValue({
      status: "session_valid",
      storageState: {
        cookies: [],
        origins: []
      },
      expiresAt: null,
      authenticatedAt: new Date("2026-04-01T10:00:00.000Z"),
      validatedAt: new Date("2026-04-01T10:00:00.000Z"),
      errorMessage: null,
      challengeType: null
    });
    sourceAuthBootstrap.getStatus.mockResolvedValue({
      portal: "WG_GESUCHT",
      status: "idle",
      loginUrl: "https://www.wg-gesucht.de/mein-wg-gesucht.html",
      message: null,
      startedAt: null,
      updatedAt: null
    });
    sourceAuthBootstrap.start.mockResolvedValue({
      portal: "WG_GESUCHT",
      status: "running",
      loginUrl: "https://www.wg-gesucht.de/mein-wg-gesucht.html",
      message: "A browser window has been opened locally.",
      startedAt: "2026-04-01T10:10:00.000Z",
      updatedAt: "2026-04-01T10:10:00.000Z"
    });
    sourceAuthBootstrap.finish.mockResolvedValue({
      bootstrap: {
        portal: "WG_GESUCHT",
        status: "idle",
        loginUrl: "https://www.wg-gesucht.de/mein-wg-gesucht.html",
        message: "Browser session captured successfully.",
        startedAt: "2026-04-01T10:10:00.000Z",
        updatedAt: "2026-04-01T10:11:00.000Z"
      },
      authResult: {
        status: "session_valid",
        storageState: {
          cookies: [],
          origins: []
        },
        expiresAt: null,
        authenticatedAt: new Date("2026-04-01T10:11:00.000Z"),
        validatedAt: new Date("2026-04-01T10:11:00.000Z"),
        errorMessage: null,
        challengeType: null
      }
    });
    sourceAuthBootstrap.cancel.mockResolvedValue({
      portal: "WG_GESUCHT",
      status: "idle",
      loginUrl: "https://www.wg-gesucht.de/mein-wg-gesucht.html",
      message: "Manual browser session closed.",
      startedAt: null,
      updatedAt: "2026-04-01T10:12:00.000Z"
    });
    const client = new PGlite();
    await applyMigrations((sql) => client.exec(sql));
    db = drizzle(client, { schema }) as unknown as Database;

    app = await buildApp({
      db,
      env: {
        NODE_ENV: "test",
        PORT: 4000,
        DATABASE_URL: "postgres://unused",
        APP_ORIGIN: "http://localhost:3000",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        NOMINATIM_BASE_URL: "https://nominatim.openstreetmap.org",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        SESSION_SECRET: "1234567890123456",
        ADMIN_GITHUB_LOGIN: "giuva",
        GITHUB_CLIENT_ID: "github-client",
        GITHUB_CLIENT_SECRET: "github-secret",
        ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP: true
      },
      fetchImpl,
      sourceAuthRunner,
      sourceAuthBootstrap
    });

    await getSettings(db);
    await ensurePortalSource(db, {
      portal: "IMMOWELT",
      searchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
      enabled: true,
      scrapeIntervalMinutes: 30
    });
    await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "listing-1",
      url: "https://www.immowelt.de/expose/listing-1?foo=bar",
      canonicalUrl: canonicalizeListingUrl("https://www.immowelt.de/expose/listing-1?foo=bar"),
      title: "Sunny 3-room apartment",
      description: "Great Berlin apartment",
      addressLine: "Alexanderplatz 1, Berlin",
      city: "Berlin",
      district: "Mitte",
      neighborhood: "Mitte",
      latitude: 52.5219,
      longitude: 13.4132,
      geoSource: "portal_coordinates",
      rentCold: 1400,
      rentWarm: 1650,
      sizeSqm: 74,
      rooms: 3,
      floor: "2",
      availableFrom: "2026-05-01",
      isFurnished: false,
      hasBalcony: true,
      hasElevator: false,
      rawPayload: {
        source: "live"
      }
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects protected routes without a session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/listings"
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns the session payload when signed cookie is present", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      cookies: {
        fh_session: cookie
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      user: {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null
      }
    });
  });

  it("redirects GitHub OAuth starts from alternate browser origins to the configured app origin", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/github/start",
      headers: {
        referer: "http://192.168.1.20:3000/"
      }
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("http://localhost:3000/api/auth/github/start?canonical=1");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("starts GitHub OAuth on the configured app origin after canonical redirect", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/github/start?canonical=1",
      headers: {
        referer: "http://192.168.1.20:3000/"
      }
    });

    const location = new URL(String(response.headers.location));

    expect(response.statusCode).toBe(302);
    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/login/oauth/authorize");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/github/callback");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(readSetCookieValue(response.headers["set-cookie"], "fh_github_state")).toBeTruthy();
  });

  it("redirects invalid GitHub OAuth callbacks back to the login screen", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/github/callback?code=github-code&state=missing-cookie"
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("http://localhost:3000/?auth_error=oauth_state");
  });

  it("issues a session after a valid GitHub OAuth callback", async () => {
    const startResponse = await app.inject({
      method: "GET",
      url: "/api/auth/github/start?canonical=1"
    });
    const oauthState = new URL(String(startResponse.headers.location)).searchParams.get("state");
    const stateCookie = readSetCookieValue(startResponse.headers["set-cookie"], "fh_github_state");

    expect(oauthState).toBeTruthy();
    expect(stateCookie).toBeTruthy();

    fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "github-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url === "https://api.github.com/user") {
        return new Response(JSON.stringify({ login: "GiUvA", name: "Giuva", avatar_url: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/api/auth/github/callback?code=github-code&state=${oauthState}`,
      cookies: {
        fh_github_state: stateCookie as string
      }
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe("http://localhost:3000/");
    expect(readSetCookieValue(callbackResponse.headers["set-cookie"], "fh_session")).toBeTruthy();
  });

  it("lists data for authenticated requests", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/listings",
      cookies: {
        fh_session: cookie
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0]?.sourceMode).toBe("live");
  });

  it("generates English analyst output on demand for a listing", async () => {
    fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      expect(url).toContain("/models/gemini-2.5-flash:generateContent");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      sourceLanguage: "en",
                      translatedTitle: "Sunny 3-room apartment",
                      translatedDescription: "Great Berlin apartment",
                      eligibilityState: "MATCH",
                      reason: "Clear apartment fit.",
                      flags: ["LONG_TERM"],
                      fitScore: 82,
                      summary: "Bright Berlin apartment with a strong long-term fit.",
                      fitNote: "Suitable for the configured search because the price, size, and apartment framing line up."
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/listings/1/llm-analysis",
      cookies: {
        fh_session: cookie
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 1,
      llmAnalysisStatus: "ready",
      llmAnalysis: expect.objectContaining({
        summary: "Bright Berlin apartment with a strong long-term fit.",
        model: "gemini-2.5-flash",
        translationModel: null
      })
    });
  });

  it("drafts, records, and lists contact attempts for a listing", async () => {
    fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain(":generateContent");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      subject: "Bewerbung: 3-Zimmer-Wohnung in Mitte",
                      body: "Sehr geehrte Damen und Herren, hiermit bewerbe ich mich um die Wohnung. Mit freundlichen Grüßen"
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const draftResponse = await app.inject({
      method: "POST",
      url: "/api/listings/1/contact-message",
      cookies: {
        fh_session: cookie
      }
    });

    expect(draftResponse.statusCode).toBe(200);
    expect(draftResponse.json()).toEqual({
      subject: "Bewerbung: 3-Zimmer-Wohnung in Mitte",
      body: "Sehr geehrte Damen und Herren, hiermit bewerbe ich mich um die Wohnung. Mit freundlichen Grüßen"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/listings/1/contact-attempts",
      cookies: {
        fh_session: cookie
      },
      payload: {
        channel: "EMAIL",
        status: "SENT",
        messageSubject: "Bewerbung: 3-Zimmer-Wohnung in Mitte",
        messageBody: "Sehr geehrte Damen und Herren, ..."
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      listingId: 1,
      channel: "EMAIL",
      status: "SENT"
    });

    const listingResponse = await app.inject({
      method: "GET",
      url: "/api/listings/1",
      cookies: {
        fh_session: cookie
      }
    });
    expect(listingResponse.json().userStatus).toBe("CONTACTED");

    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/listings/1/contact-attempts",
      cookies: {
        fh_session: cookie
      }
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toHaveLength(1);

    const missingResponse = await app.inject({
      method: "POST",
      url: "/api/listings/99999/contact-attempts",
      cookies: {
        fh_session: cookie
      },
      payload: {
        channel: "EMAIL"
      }
    });
    expect(missingResponse.statusCode).toBe(404);
  });

  it("returns a readable error when English analyst generation fails", async () => {
    fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/models/gemini-2.5-flash:generateContent");
      return new Response(
        JSON.stringify({
          error: {
            message: "API key not valid. Please pass a valid API key."
          }
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    });

    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/listings/1/llm-analysis",
      cookies: {
        fh_session: cookie
      }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      message: expect.stringContaining("evaluation failed")
    });

    const listing = await app.inject({
      method: "GET",
      url: "/api/listings/1",
      cookies: {
        fh_session: cookie
      }
    });

    expect(listing.statusCode).toBe(200);
    expect(listing.json()).toMatchObject({
      id: 1,
      llmAnalysisStatus: "error"
    });
  });

  it("persists settings patches", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const update = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      cookies: {
        fh_session: cookie
      },
      payload: {
        scoring: {
          maxWarmRent: 1900
        }
      }
    });

    expect(update.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/api/settings",
      cookies: {
        fh_session: cookie
      }
    });

    expect(response.json().scoring.maxWarmRent).toBe(1900);
  });

  it("resets listing ingestion from settings without changing settings", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    await markPortalRun(db, "IMMOWELT", {
      mode: "live",
      status: "success",
      listingsFound: 1,
      listingsUpserted: 1,
      failedDetails: 0,
      errorMessage: null
    });

    const update = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      cookies: {
        fh_session: cookie
      },
      payload: {
        scoring: {
          maxWarmRent: 2050
        }
      }
    });

    expect(update.statusCode).toBe(200);

    const reset = await app.inject({
      method: "POST",
      url: "/api/settings/reset-listings",
      cookies: {
        fh_session: cookie
      }
    });

    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({
      deletedListings: 1,
      resetSources: 1
    });

    const listings = await app.inject({
      method: "GET",
      url: "/api/listings",
      cookies: {
        fh_session: cookie
      }
    });
    const settings = await app.inject({
      method: "GET",
      url: "/api/settings",
      cookies: {
        fh_session: cookie
      }
    });
    const sources = await app.inject({
      method: "GET",
      url: "/api/sources",
      cookies: {
        fh_session: cookie
      }
    });

    expect(listings.statusCode).toBe(200);
    expect(listings.json()).toHaveLength(0);
    expect(settings.json().scoring.maxWarmRent).toBe(2050);
    expect(sources.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          portal: "IMMOWELT",
          lastRunAt: null,
          lastStatus: null,
          lastListingsFound: null,
          lastListingsUpserted: null
        })
      ])
    );
  });

  it("returns dashboard analytics for authenticated requests", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/stats/dashboard",
      cookies: {
        fh_session: cookie
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().totals.listings).toBe(1);
    expect(response.json().portalBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          portal: "IMMOWELT",
          count: 1
        })
      ])
    );
  });

  it("lists and updates sources for authenticated requests", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/sources",
      cookies: {
        fh_session: cookie
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toHaveLength(5);
    expect(listResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          portal: "FLATSFORFRIENDZ",
          capabilities: expect.objectContaining({
            sourceKind: "public_api",
            readiness: "experimental",
            cloudCompatible: true,
            requiresAuthSetup: false
          })
        }),
        expect.objectContaining({
          portal: "IMMOWELT"
        }),
        expect.objectContaining({
          portal: "WG_GESUCHT"
        }),
        expect.objectContaining({
          portal: "KLEINANZEIGEN"
        }),
        expect.objectContaining({
          portal: "INBERLINWOHNEN",
          capabilities: expect.objectContaining({
            sourceKind: "scraping",
            readiness: "secondary",
            cloudCompatible: true,
            requiresAuthSetup: false
          })
        })
      ])
    );

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/api/sources/IMMOWELT",
      cookies: {
        fh_session: cookie
      },
      payload: {
        enabled: false,
        scrapeIntervalMinutes: 45
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().enabled).toBe(false);
    expect(patchResponse.json().scrapeIntervalMinutes).toBe(45);
  });

  it("does not enable auth-required sources without a valid session", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const response = await app.inject({
      method: "PATCH",
      url: "/api/sources/WG_GESUCHT",
      cookies: {
        fh_session: cookie
      },
      payload: {
        enabled: true
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: "This source requires a valid authenticated session. Save credentials and refresh the session before enabling it."
    });
  });

  it("returns 404 for retired source management routes", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const responses = await Promise.all([
      app.inject({
        method: "PATCH",
        url: "/api/sources/IMMOSCOUT24",
        cookies: {
          fh_session: cookie
        },
        payload: {
          enabled: true
        }
      }),
      app.inject({
        method: "GET",
        url: "/api/sources/IMMOSCOUT24/auth",
        cookies: {
          fh_session: cookie
        }
      }),
      app.inject({
        method: "POST",
        url: "/api/sources/IMMOSCOUT24/auth/bootstrap/start",
        cookies: {
          fh_session: cookie
        }
      }),
      app.inject({
        method: "POST",
        url: "/api/sources/IMMOSCOUT24/auth/refresh",
        cookies: {
          fh_session: cookie
        }
      })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        message: "Source not found"
      });
    }
  });

  it("does not expose auth flows for public-api sources", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const responses = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/sources/FLATSFORFRIENDZ/auth",
        cookies: {
          fh_session: cookie
        }
      }),
      app.inject({
        method: "POST",
        url: "/api/sources/FLATSFORFRIENDZ/auth/refresh",
        cookies: {
          fh_session: cookie
        }
      }),
      app.inject({
        method: "POST",
        url: "/api/sources/FLATSFORFRIENDZ/auth/bootstrap/start",
        cookies: {
          fh_session: cookie
        }
      })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        message: "Source auth not found"
      });
    }
  });

  it("stores, refreshes, and deletes source auth summaries for authenticated requests", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const putResponse = await app.inject({
      method: "PUT",
      url: "/api/sources/WG_GESUCHT/auth",
      cookies: {
        fh_session: cookie
      },
      payload: {
        authMode: "FORM_CREDENTIALS",
        loginIdentifier: "hello@example.com",
        password: "super-secret"
      }
    });

    expect(putResponse.statusCode).toBe(200);
    expect(putResponse.json()).toMatchObject({
      portal: "WG_GESUCHT",
      hasCredentials: true,
      authStatus: "ready",
      loginIdentifier: "hello@example.com"
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/sources/WG_GESUCHT/auth",
      cookies: {
        fh_session: cookie
      }
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      portal: "WG_GESUCHT",
      hasCredentials: true,
      authStatus: "ready"
    });

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/sources/WG_GESUCHT/auth/refresh",
      cookies: {
        fh_session: cookie
      }
    });

    expect(refreshResponse.statusCode).toBe(200);
    expect(refreshResponse.json()).toMatchObject({
      portal: "WG_GESUCHT",
      hasCredentials: true,
      authStatus: "session_valid"
    });

    const afterRefreshSourcesResponse = await app.inject({
      method: "GET",
      url: "/api/sources",
      cookies: {
        fh_session: cookie
      }
    });

    expect(afterRefreshSourcesResponse.statusCode).toBe(200);
    expect(afterRefreshSourcesResponse.json().find((source: { portal: string }) => source.portal === "WG_GESUCHT")).toMatchObject({
      portal: "WG_GESUCHT",
      enabled: true,
      authStatus: "session_valid",
      capabilities: {
        sourceKind: "scraping",
        cloudCompatible: false,
        readiness: "secondary",
        requiresAuthSetup: true
      }
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/sources/WG_GESUCHT/auth",
      cookies: {
        fh_session: cookie
      }
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      portal: "WG_GESUCHT",
      hasCredentials: false,
      authStatus: "missing_credentials"
    });

    const afterDeleteSourcesResponse = await app.inject({
      method: "GET",
      url: "/api/sources",
      cookies: {
        fh_session: cookie
      }
    });

    expect(afterDeleteSourcesResponse.statusCode).toBe(200);
    expect(afterDeleteSourcesResponse.json().find((source: { portal: string }) => source.portal === "WG_GESUCHT")).toMatchObject({
      portal: "WG_GESUCHT",
      enabled: false,
      authStatus: "missing_credentials"
    });
  });

  it("marks auth refresh failures without enabling the source", async () => {
    sourceAuthRunner.mockResolvedValueOnce({
      status: "auth_failed",
      storageState: null,
      expiresAt: null,
      authenticatedAt: null,
      validatedAt: new Date("2026-04-01T10:05:00.000Z"),
      errorMessage: "Portal rejected the provided credentials",
      challengeType: null
    });

    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    await app.inject({
      method: "PUT",
      url: "/api/sources/WG_GESUCHT/auth",
      cookies: {
        fh_session: cookie
      },
      payload: {
        authMode: "FORM_CREDENTIALS",
        loginIdentifier: "hello@example.com",
        password: "super-secret"
      }
    });

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/sources/WG_GESUCHT/auth/refresh",
      cookies: {
        fh_session: cookie
      }
    });

    expect(refreshResponse.statusCode).toBe(200);
    expect(refreshResponse.json()).toMatchObject({
      portal: "WG_GESUCHT",
      authStatus: "auth_failed",
      lastAuthError: "Portal rejected the provided credentials"
    });

    const sourcesResponse = await app.inject({
      method: "GET",
      url: "/api/sources",
      cookies: {
        fh_session: cookie
      }
    });

    expect(sourcesResponse.json().find((source: { portal: string }) => source.portal === "WG_GESUCHT")).toMatchObject({
      portal: "WG_GESUCHT",
      enabled: false,
      authStatus: "auth_failed"
    });
  });

  it("starts, finishes, and cancels manual source auth bootstrap", async () => {
    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/sources/WG_GESUCHT/auth/bootstrap",
      cookies: {
        fh_session: cookie
      }
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      portal: "WG_GESUCHT",
      status: "idle"
    });
    expect(sourceAuthBootstrap.getStatus).toHaveBeenCalledWith(
      "WG_GESUCHT",
      expect.objectContaining({
        ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP: true
      })
    );

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/sources/WG_GESUCHT/auth/bootstrap/start",
      cookies: {
        fh_session: cookie
      }
    });

    expect(startResponse.statusCode).toBe(200);
    expect(startResponse.json()).toMatchObject({
      portal: "WG_GESUCHT",
      status: "running"
    });

    const finishResponse = await app.inject({
      method: "POST",
      url: "/api/sources/WG_GESUCHT/auth/bootstrap/finish",
      cookies: {
        fh_session: cookie
      }
    });

    expect(finishResponse.statusCode).toBe(200);
    expect(finishResponse.json()).toMatchObject({
      bootstrap: {
        portal: "WG_GESUCHT",
        status: "idle"
      },
      authSummary: {
        portal: "WG_GESUCHT",
        authStatus: "session_valid"
      }
    });

    const cancelResponse = await app.inject({
      method: "DELETE",
      url: "/api/sources/WG_GESUCHT/auth/bootstrap",
      cookies: {
        fh_session: cookie
      }
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toMatchObject({
      portal: "WG_GESUCHT",
      status: "idle"
    });
  });

  it("returns cached office geocoding candidates for authenticated requests", async () => {
    fetchImpl.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          display_name: "Alexanderplatz 1, Mitte, Berlin, Deutschland",
          lat: "52.5219",
          lon: "13.4132",
          address: {
            suburb: "Mitte"
          }
        }
      ]
    } as Response);

    const cookie = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/geo/search",
      cookies: {
        fh_session: cookie
      },
      payload: {
        query: "Alexanderplatz 1"
      }
    });

    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/geo/search",
      cookies: {
        fh_session: cookie
      },
      payload: {
        query: "Alexanderplatz 1"
      }
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstResponse.json()[0]).toMatchObject({
      label: "Alexanderplatz 1, Mitte",
      district: "Mitte",
      provider: "nominatim"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
