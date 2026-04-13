import { describe, expect, it } from "vitest";

import { formatRuntimeError } from "./errors";

describe("formatRuntimeError", () => {
  it("returns the plain error message when no nested cause exists", () => {
    expect(formatRuntimeError(new Error("simple failure"))).toBe("simple failure");
  });

  it("prefers the nested cause for drizzle-style query wrapper errors", () => {
    const error = new Error("Failed query: insert into listings ...");
    error.cause = new Error('duplicate key value violates unique constraint "listings_canonical_url_idx"');

    expect(formatRuntimeError(error)).toBe(
      'duplicate key value violates unique constraint "listings_canonical_url_idx"'
    );
  });

  it("returns a restart hint for cached-plan schema-change errors", () => {
    const error = new Error("Failed query: insert into listings ...");
    error.cause = new Error("cached plan must not change result type");

    expect(formatRuntimeError(error)).toBe(
      "Database query plan is stale after a schema change. Restart the API and worker processes, then run the source again."
    );
  });

  it("returns a Gemini hint for provider timeouts", () => {
    expect(formatRuntimeError(new Error("Gemini request timed out."))).toBe(
      "Gemini request timed out. Retry after checking the network connection or lowering the LLM workload for this run."
    );
  });
});
