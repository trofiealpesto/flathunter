type JsonRecord = Record<string, unknown>;

export type CapSolverTask = JsonRecord & {
  type: string;
};

export type CapSolverSolution = JsonRecord;

export type CapSolverOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  createTaskUrl?: string;
  getTaskResultUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

export type CapSolverSolveResult = {
  taskId: string;
  solution: CapSolverSolution;
  userAgent: string | null;
};

type CapSolverCreateTaskResponse = {
  errorId?: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: string | number;
};

type CapSolverTaskResultResponse = {
  errorId?: number;
  errorCode?: string;
  errorDescription?: string;
  status?: string;
  solution?: JsonRecord;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCapSolverError(payload: { errorCode?: string; errorDescription?: string }, fallback: string) {
  return new Error(payload.errorDescription || payload.errorCode || fallback);
}

export async function solveCapSolverTask(task: CapSolverTask, options: CapSolverOptions): Promise<CapSolverSolveResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createTaskUrl = options.createTaskUrl ?? "https://api.capsolver.com/createTask";
  const getTaskResultUrl = options.getTaskResultUrl ?? "https://api.capsolver.com/getTaskResult";
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const maxPollAttempts = options.maxPollAttempts ?? 20;

  const createTaskResponse = await fetchImpl(createTaskUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      clientKey: options.apiKey,
      task
    })
  });

  if (!createTaskResponse.ok) {
    throw new Error(`CapSolver createTask failed with status ${createTaskResponse.status}`);
  }

  const createTaskPayload = (await createTaskResponse.json()) as CapSolverCreateTaskResponse;

  if ((createTaskPayload.errorId ?? 0) !== 0 || !createTaskPayload.taskId) {
    throw buildCapSolverError(createTaskPayload, "CapSolver createTask failed");
  }

  const taskId = String(createTaskPayload.taskId);

  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(pollIntervalMs);
    }

    const resultResponse = await fetchImpl(getTaskResultUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientKey: options.apiKey,
        taskId
      })
    });

    if (!resultResponse.ok) {
      throw new Error(`CapSolver getTaskResult failed with status ${resultResponse.status}`);
    }

    const resultPayload = (await resultResponse.json()) as CapSolverTaskResultResponse;

    if ((resultPayload.errorId ?? 0) !== 0) {
      throw buildCapSolverError(resultPayload, "CapSolver getTaskResult failed");
    }

    if (resultPayload.status === "ready" && resultPayload.solution) {
      const userAgent =
        typeof resultPayload.solution.userAgent === "string" ? resultPayload.solution.userAgent : null;

      return {
        taskId,
        solution: resultPayload.solution,
        userAgent
      };
    }

    if (resultPayload.status === "failed") {
      throw buildCapSolverError(resultPayload, "CapSolver returned a failed task result");
    }
  }

  throw new Error("CapSolver task timed out");
}
