export function log(message: string, payload?: Record<string, unknown>) {
  const data = payload ? ` ${JSON.stringify(payload)}` : "";
  // eslint-disable-next-line no-console
  console.log(`[worker] ${message}${data}`);
}

