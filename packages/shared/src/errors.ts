type ErrorWithCause = {
  cause?: unknown;
  message?: unknown;
};

function toMessage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getDeepestCause(error: unknown): unknown {
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const cause = (current as ErrorWithCause).cause;

    if (cause == null) {
      break;
    }

    current = cause;
  }

  return current;
}

export function formatRuntimeError(error: unknown, fallback = "Unknown error"): string {
  const primaryMessage = toMessage((error as ErrorWithCause | null)?.message) ?? fallback;
  const deepestMessage = toMessage((getDeepestCause(error) as ErrorWithCause | null)?.message);

  const preferredMessage =
    primaryMessage.startsWith("Failed query:") && deepestMessage && deepestMessage !== primaryMessage
      ? deepestMessage
      : primaryMessage;

  if (preferredMessage.toLowerCase().includes("cached plan must not change result type")) {
    return "Database query plan is stale after a schema change. Restart the API and worker processes, then run the source again.";
  }

  if (preferredMessage === "Gemini request timed out.") {
    return "Gemini request timed out. Retry after checking the network connection or lowering the LLM workload for this run.";
  }

  return preferredMessage;
}
