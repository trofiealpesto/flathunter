"""Offline benchmark. No route, database, notification or enrichment is modified."""
from __future__ import annotations

import argparse
import contextlib
import importlib.metadata
import json
import multiprocessing
import os
import platform
import resource
import sys
import time
from pathlib import Path

from decisions import PROMPT_VERSION, compose, digest, gate, metrics, quality_pass, validate_corpus

HERE = Path(__file__).resolve().parent
MODELS = json.loads((HERE / "models.json").read_text())


def worker(connection, backend, threads):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    os.environ["OMP_NUM_THREADS"] = str(threads)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from backends import load_backend
            started = time.perf_counter()
            if MODELS[backend]["backend"] == "laya":
                from laya_backend import LayaBackend
                model = LayaBackend(MODELS[backend], threads)
            else:
                model = load_backend(backend, threads)
        def accelerator_peak():
            if backend == "semif-qwen":
                import mlx.core as mx
                return mx.get_peak_memory()
            return 0
        versions = {}
        for package in ("gliclass", "laya", "torch", "transformers", "huggingface-hub", "numpy", "mlx", "mlx-lm", "semif-phase1"):
            try:
                versions[package] = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError:
                pass
        connection.send({"ready": True, "loadMs": (time.perf_counter() - started) * 1000,
                         "versions": versions, "peakAcceleratorBytes": accelerator_peak()})
        while True:
            case = connection.recv()
            if case is None:
                break
            started = time.perf_counter()
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    answer = model.score(case)
                response = {**answer, "latencyMs": (time.perf_counter() - started) * 1000}
            except Exception as error:
                response = {"error": f"{type(error).__name__}: {error}", "latencyMs": (time.perf_counter() - started) * 1000}
            peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            response["peakRssBytes"] = int(peak if sys.platform == "darwin" else peak * 1024)
            response["peakAcceleratorBytes"] = accelerator_peak()
            connection.send(response)
    except (EOFError, BrokenPipeError):
        pass
    except Exception as error:
        connection.send({"error": f"backend_unavailable: {type(error).__name__}: {error}"})
    finally:
        connection.close()


class InferenceProcess:
    def __init__(self, backend, threads, timeout, max_memory, target=worker):
        import psutil
        self.psutil = psutil
        ctx = multiprocessing.get_context("spawn")
        self.connection, child = ctx.Pipe()
        self.process = ctx.Process(target=target, args=(child, backend, threads), daemon=True)
        self.process.start()
        child.close()
        self.timeout, self.max_memory = timeout, max_memory
        self.peak, self.accelerator_peak, self.accounted_peak, self.failed = 0, 0, 0, None
        self.ready = self.receive(180)
        if self.ready.get("error"):
            self.failed = self.ready["error"]

    def receive(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                rss = self.psutil.Process(self.process.pid).memory_info().rss
                # Include the supervisor; GPU allocator memory is tracked separately.
                self.peak = max(self.peak, rss + self.psutil.Process().memory_info().rss)
                self.accounted_peak = self.peak + self.accelerator_peak
                if self.accounted_peak > self.max_memory:
                    self.failed = "memory_limit"
                    self.close()
                    return {"error": self.failed}
            except self.psutil.NoSuchProcess:
                pass
            if self.connection.poll(.05):
                try:
                    result = self.connection.recv()
                    self.peak = max(self.peak, result.get("peakRssBytes", 0) + self.psutil.Process().memory_info().rss)
                    self.accelerator_peak = max(self.accelerator_peak, result.get("peakAcceleratorBytes", 0))
                    # A conservative bound, not a claim that CPU/GPU peaks are disjoint.
                    self.accounted_peak = self.peak + self.accelerator_peak
                    if self.accounted_peak > self.max_memory:
                        self.failed = "memory_limit"
                        self.close()
                        return {"error": self.failed}
                    return result
                except EOFError:
                    break
            if not self.process.is_alive():
                break
        self.failed = "timeout" if self.process.is_alive() else f"backend_exited:{self.process.exitcode}"
        self.close()
        return {"error": self.failed, "latencyMs": timeout * 1000 if self.failed == "timeout" else None}

    def score(self, case):
        if self.failed:
            return {"error": self.failed, "latencyMs": None}
        # Explicit allowlist: no labels/baseline/rationale enter the inference process.
        self.connection.send({key: case[key] for key in ("id", "title", "description", "preferences")})
        return self.receive(self.timeout)

    def close(self):
        if self.process.is_alive():
            if not self.failed:
                try:
                    self.connection.send(None)
                    self.process.join(3)
                except (EOFError, BrokenPipeError):
                    pass
            if self.process.is_alive():
                self.process.terminate()
            self.process.join(2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(2)


def materialize(case, response, policy):
    row = {key: case[key] for key in ("id", "family", "expected", "tags")}
    row.update(response)
    if not response.get("error"):
        try:
            row.update(compose(case, response["scores"], policy["threshold"], policy["margin"]))
        except (ValueError, TypeError, KeyError) as error:
            row["error"] = f"invalid_response: {error}"
    if row.get("error"):
        row.update(eligibilityState="UNSURE", flags=[], reason="Inference failed; review required.")
    return row


def calibrate(cases, responses):
    # Development set only. Quality gates first, coverage second, precision third.
    candidates = []
    for threshold in (.35, .5, .65, .8):
        for margin in (.05, .1, .2, .3):
            policy = {"threshold": threshold, "margin": margin}
            m = metrics([materialize(case, response, policy) for case, response in zip(cases, responses)])
            key = (quality_pass(m), (m["suitableRetention"] or 0) >= .95 and (m["rejectPrecision"] or 0) >= .95,
                   m["coverage"], m["rejectPrecision"] or 0, threshold, margin)
            candidates.append((key, policy))
    return max(candidates, key=lambda candidate: candidate[0])[1]


def cpu_name():
    if sys.platform == "linux":
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    return platform.processor()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--backend", choices=["rules", "archived", *MODELS], required=True)
    parser.add_argument("--split", choices=["dev", "eval"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--policy", type=Path, help="Create on dev; required and read-only on eval")
    parser.add_argument("--archived", type=Path, help="Local export keyed by case ID with inputHash, model and eligibilityState")
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--memory-gib", type=float, default=2)
    parser.add_argument("--health-url", help="Read-only loopback health endpoint, sampled before/during/after")
    args = parser.parse_args()
    if args.output.exists() or args.threads < 1 or args.timeout <= 0 or args.memory_gib <= 0:
        parser.error("Use a new output path and positive resource limits")
    data = json.loads(args.corpus.read_text())
    all_cases = validate_corpus(data)
    cases = [case for case in all_cases if case["split"] == args.split]
    input_hash = digest(data)
    model_backend = args.backend in MODELS
    spec = MODELS.get(args.backend)
    protocol_files = ["decisions.py", "backends.py"]
    if spec and spec["backend"] == "laya":
        protocol_files.append("laya_backend.py")
    protocol_hash = digest({name: (HERE / name).read_text() for name in protocol_files})
    if model_backend and not args.policy:
        parser.error("Model runs require --policy")
    policy = {"threshold": .5, "margin": .1}
    if model_backend and args.split == "eval":
        frozen = json.loads(args.policy.read_text())
        if (frozen["backend"] != args.backend or frozen["corpusHash"] != input_hash
                or frozen["protocolHash"] != protocol_hash or frozen["model"] != spec):
            parser.error("Frozen policy does not match corpus, backend, protocol and checkpoint")
        policy = frozen["policy"]
    elif model_backend and args.policy.exists():
        parser.error("Development policy must be a new file; never overwrite frozen thresholds")

    started = time.time()
    runtime = {"machine": platform.machine(), "cpu": cpu_name(), "platform": platform.platform(),
               "threads": args.threads, "inferenceProcesses": 1 if model_backend else 0,
               "memoryLimitBytes": int(args.memory_gib * 1024**3), "timeoutSeconds": args.timeout,
               "peakRssBytes": None, "serviceHealthPassed": None, "oomFree": None}
    rows, responses = [], []
    engine = None
    health = None
    try:
        if args.health_url:
            from monitor import HealthMonitor
            health = HealthMonitor(args.health_url)
            health.start()
        if model_backend:
            engine = InferenceProcess(args.backend, args.threads, args.timeout, runtime["memoryLimitBytes"])
            runtime["startup"] = engine.ready
            # Same development-only warmup even on evaluation, outside latency percentiles.
            warmup = engine.score(next(case for case in all_cases if case["split"] == "dev"))
            runtime["warmup"] = {key: warmup.get(key) for key in ("latencyMs", "error")}
            for index, case in enumerate(cases):
                responses.append(engine.score(case))
                if (index + 1) % 10 == 0:
                    print(f"{args.backend} {args.split}: {index + 1}/{len(cases)}", file=sys.stderr, flush=True)
            if args.split == "dev":
                policy = calibrate(cases, responses)
                frozen = {"backend": args.backend, "model": spec, "corpusHash": input_hash,
                          "protocolHash": protocol_hash, "policy": policy, "calibratedOn": "dev"}
                args.policy.parent.mkdir(parents=True, exist_ok=True)
                with args.policy.open("x") as destination:
                    json.dump(frozen, destination, indent=2)
            rows = [materialize(case, response, policy) for case, response in zip(cases, responses)]
            runtime["peakRssBytes"] = engine.peak
            runtime["peakAcceleratorBytes"] = engine.accelerator_peak
            runtime["peakMemoryAccountedBytes"] = engine.accounted_peak
            runtime["workerFailure"] = engine.failed
        elif args.backend == "rules":
            rows = [{**{key: case[key] for key in ("id", "family", "expected", "tags")}, **case["deterministic"]} for case in cases]
        else:
            if not args.archived:
                parser.error("--archived is required for the archived backend")
            archived = json.loads(args.archived.read_text())
            for case in cases:
                saved = archived.get(case["id"], {})
                matches = saved.get("inputHash") == digest({key: case[key] for key in ("title", "description", "preferences")})
                valid = matches and saved.get("eligibilityState") in ("MATCH", "REJECT", "UNSURE") and saved.get("model")
                rows.append({**{key: case[key] for key in ("id", "family", "expected", "tags")},
                             "eligibilityState": saved["eligibilityState"] if valid else "UNSURE",
                             "model": saved.get("model"), "latencyMs": None,
                             "error": None if valid else "missing_or_mismatched_archive"})
    finally:
        if engine:
            engine.close()
        if health:
            runtime.update(health.finish())
    m = metrics(rows)
    routed = [row for case, row in zip(cases, rows) if case["deterministic"]["shouldRunSemanticClassifier"]]
    existing_pipeline = [row if case["deterministic"]["shouldRunSemanticClassifier"] else {
        **{key: case[key] for key in ("id", "family", "expected", "tags")}, **case["deterministic"]
    } for case, row in zip(cases, rows)]
    report = {"schemaVersion": 1, "backend": args.backend, "split": args.split,
              "startedAt": started, "finishedAt": time.time(), "model": spec, "policy": policy,
              "corpusHash": input_hash, "protocolHash": protocol_hash, "promptVersion": PROMPT_VERSION,
              "runnerSourceHash": digest(Path(__file__).read_text()),
              "provenance": data["provenance"], "runtime": runtime, "metrics": m,
              "productionRouting": {"llmCandidates": len(routed), "llmCandidateMetrics": metrics(routed),
                                    "existingPipelineWithCandidate": metrics(existing_pipeline)},
              "gate": gate(m, {**runtime, "peakRssBytes": runtime.get("peakMemoryAccountedBytes", runtime["peakRssBytes"])})
                      if args.split == "eval" and model_backend else {"status": "not-applicable"},
              "rows": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as destination:
        json.dump(report, destination, ensure_ascii=False, indent=2, allow_nan=False)
    print(json.dumps({"metrics": m, "gate": report["gate"]}, indent=2))


if __name__ == "__main__":
    main()
