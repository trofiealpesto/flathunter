import { describe, expect, it } from "vitest";

import { getRecommendedLlmTimeoutProfile } from "./llm";

describe("getRecommendedLlmTimeoutProfile", () => {
  it("keeps flash-lite lean for classifier hot paths", () => {
    expect(getRecommendedLlmTimeoutProfile("gemini-2.5-flash-lite", "gemini-2.5-flash")).toEqual({
      classificationTimeoutMs: 18_000,
      classificationRetryTimeoutMs: 28_000,
      analystTimeoutMs: 55_000
    });
  });

  it("allocates a larger budget for flash and pro-class requests", () => {
    expect(getRecommendedLlmTimeoutProfile("gemini-2.5-flash", "gemini-2.5-pro")).toEqual({
      classificationTimeoutMs: 24_000,
      classificationRetryTimeoutMs: 36_000,
      analystTimeoutMs: 75_000
    });
  });
});
