import { formatRuntimeError } from "@flathunter/shared";

import { readWorkerEnv } from "./config";
import { log } from "./lib/logger";
import { runWorkerOnce } from "./index";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const env = readWorkerEnv();
  let stopRequested = false;

  const requestStop = () => {
    stopRequested = true;
  };

  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  log("starting worker dev loop", {
    intervalMs: env.WORKER_DEV_INTERVAL_MS
  });

  while (!stopRequested) {
    try {
      await runWorkerOnce();
    } catch (error) {
      log("worker loop iteration failed", {
        error: formatRuntimeError(error)
      });
    }

    if (stopRequested) {
      break;
    }

    log("sleeping before next scrape loop", {
      intervalMs: env.WORKER_DEV_INTERVAL_MS
    });

    await sleep(env.WORKER_DEV_INTERVAL_MS);
  }

  log("worker dev loop stopped");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
