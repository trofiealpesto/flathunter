import { describe, expect, it } from "vitest";

import { buildSessionCookieValue, normalizeGitHubLogin, parseSessionCookieValue } from "./lib/session";

describe("session cookies", () => {
  it("signs and reads a session payload", () => {
    const value = buildSessionCookieValue(
      {
        login: "giuva",
        name: "Giuva",
        avatarUrl: null,
        expiresAt: new Date(Date.now() + 1000 * 60).toISOString()
      },
      "1234567890123456"
    );

    const parsed = parseSessionCookieValue(value, "1234567890123456");
    expect(parsed?.login).toBe("giuva");
  });

  it("normalizes GitHub logins", () => {
    expect(normalizeGitHubLogin(" GiUvA ")).toBe("giuva");
  });
});

