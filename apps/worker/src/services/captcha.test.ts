import { describe, expect, it, vi } from "vitest";

import { solveCapSolverTask } from "./captcha";

describe("solveCapSolverTask", () => {
  it("creates a task and polls until the solution is ready", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errorId: 0,
          taskId: "task-123"
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errorId: 0,
          status: "processing"
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errorId: 0,
          status: "ready",
          solution: {
            token: "captcha-token",
            userAgent: "solver-agent"
          }
        })
      } as Response);

    const result = await solveCapSolverTask(
      {
        type: "ReCaptchaV2TaskProxyLess",
        websiteURL: "https://example.com",
        websiteKey: "site-key"
      },
      {
        apiKey: "capsolver-test-key",
        fetchImpl,
        pollIntervalMs: 0
      }
    );

    expect(result).toEqual({
      taskId: "task-123",
      solution: {
        token: "captcha-token",
        userAgent: "solver-agent"
      },
      userAgent: "solver-agent"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws a useful error when the provider returns an API-level failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        errorId: 1,
        errorCode: "ERROR_PROXY_CONNECT_REFUSED",
        errorDescription: "Proxy refused connection"
      })
    } as Response);

    await expect(
      solveCapSolverTask(
        {
          type: "ReCaptchaV2Task",
          websiteURL: "https://example.com",
          websiteKey: "site-key"
        },
        {
          apiKey: "capsolver-test-key",
          fetchImpl
        }
      )
    ).rejects.toThrow("Proxy refused connection");
  });
});
