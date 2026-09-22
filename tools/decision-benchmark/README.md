# Local rental decision benchmark

This experiment compares the current deterministic policy with GLiClass multilingual
mini/edge, Laya multilingual and SemIf on Qwen3.5-4B. It does not import the worker entrypoint, open the
database, call a hosted model, send notifications or change production settings.
Summaries and translations are outside the experiment.

Measured outcomes and limitations are in [RESULTS.md](RESULTS.md). The current
GLiClass and Laya protocols failed the pilot criteria; installing the experiment does not
enable any local classifier in the running worker.

## Corpus and interpretation

`corpus.json` contains 75 authored synthetic families, each with two reviewed
paraphrases: 25 families / 50 examples for development and 50 families / 100 examples
for evaluation. The rationale is an explicit annotation, **not independent human
verification or a label obtained from production**. Two variants are not independent
observations. This is a challenge set, not a representative estimate of production
error rates. A passing synthetic result permits shadow evaluation, not automated use.

Cases cover German, English, Italian preferences, mixed languages, negated WBS,
temporary tenancy, swaps, shared rooms, registration, conflicting terms, missing or
borderline numeric data, prompt injection and decisive evidence at the end of long
descriptions. Families and normalized duplicate text cannot cross the split.

The TypeScript exporter reuses `loadLlmBenchmarkCorpus` for the listing shape and
12 legacy smoke cases. It invokes the real `evaluateListingDeterministically` for
the baseline and, with text removed, for the numeric policy. The synthetic profile
requires an entire permanent apartment, registration, and any listed additional
mandatory preferences; it uses the existing price/area/room thresholds.

Important integration boundary: production already skips the LLM for deterministic
MATCH/REJECT decisions. A replacement of only its LLM path will not fix errors in
those earlier text heuristics. The report includes the all-case comparison and the
subset that production would route to the LLM; reconsidering that routing is a
separate change, not silently included in this experiment.

## Setup and export

Run from the repository root. Python 3.12+ and the normal pnpm dependencies are needed.
The inference packages live in an ignored venv and do not affect the app's lockfile.

```sh
pnpm worker:benchmark:decisions:export
python3 -m venv .decision-benchmark/venv
```

On Linux, install CPU-only Torch first to avoid downloading CUDA runtimes:

```sh
.decision-benchmark/venv/bin/pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu
```

Then install the pinned direct dependencies and download the pinned public model:

```sh
.decision-benchmark/venv/bin/pip install -r tools/decision-benchmark/requirements.txt
.decision-benchmark/venv/bin/python tools/decision-benchmark/prepare.py gliclass-mini
.decision-benchmark/venv/bin/python tools/decision-benchmark/prepare.py gliclass-edge
.decision-benchmark/venv/bin/pip freeze > .decision-benchmark/environment.txt
```

Only preparation uses the network. Scoring sets `HF_HUB_OFFLINE=1` and
`TRANSFORMERS_OFFLINE=1`. Missing weights fail explicitly. The optional health probe
only accepts unauthenticated loopback HTTP. Set `HF_HOME` consistently for prepare
and scoring if the cache lives on a larger volume.

## Development, frozen policy, evaluation

```sh
python3 tools/decision-benchmark/benchmark.py \
  --corpus .decision-benchmark/corpus.export.json --backend rules --split eval \
  --output .decision-benchmark/rules-eval.json

.decision-benchmark/venv/bin/python tools/decision-benchmark/benchmark.py \
  --corpus .decision-benchmark/corpus.export.json --backend gliclass-mini --split dev \
  --policy .decision-benchmark/mini-policy.json --output .decision-benchmark/mini-dev.json

.decision-benchmark/venv/bin/python tools/decision-benchmark/benchmark.py \
  --corpus .decision-benchmark/corpus.export.json --backend gliclass-mini --split eval \
  --policy .decision-benchmark/mini-policy.json --output .decision-benchmark/mini-eval.json
```

Repeat with `gliclass-edge` and separate policy/output paths. All artifacts are
create-only: choose new names for a changed protocol. Development chooses score
threshold and winner margin from a fixed grid; evaluation only reads those values.
Corpus, model revision and protocol hashes must match. No expected labels or
annotation rationales enter the inference process. Threshold fitting is **not**
probability calibration: reported option probabilities are not P(correct).

GLiClass evaluates each atomic question independently with three natural-language
alternatives. It records raw logits and their conditional softmax scores. Long inputs
use overlapping chunks with exact token-budget checks; no source tail is silently
truncated. Contradictory chunk votes abstain. Missing/weak evidence maps to UNSURE.
Numeric constraints stay in code. The adapter returns existing eligibility states
and semantic flags plus template reasons; it does not manufacture `fitScore`.

Each run loads one inference process, measures cold startup and a development-only
warmup separately, then records per-listing latency including all questions/chunks.
The supervisor enforces timeouts and samples RSS, including its own memory. Failed
requests remain in the denominator and cannot pass the gate. A killed worker is not
silently restarted or replaced with a hosted model.
For MLX it also records the allocator's peak active memory. The budget accounts for
RSS plus that peak conservatively; these components may overlap and are not a
measurement of total system RAM. Accelerator peaks are checked at startup and
request boundaries, while RSS is sampled throughout. The separate allocator cache
limit is recorded in SemIf's metadata. N150 CPU runs use RSS alone.

## N150 measurement

Copy only the experiment and exported corpus into a separate directory owned by
`lifehub`, not `/opt/flathunter`. Use an isolated venv there. Run one model at a time,
with one inference thread (`--threads 1`, default), low CPU priority and a transient
systemd cgroup. A suitable wrapper, run inside the container, is:

```sh
systemd-run --unit=lifehub-decision-test --wait --pipe --collect \
  -p User=lifehub -p WorkingDirectory=/var/lib/lifehub/decision-benchmark-20260921 \
  -p Environment=HF_HOME=/var/lib/lifehub/decision-benchmark-20260921/hf \
  -p CPUQuota=100% -p Nice=10 -p MemoryMax=3G -p MemorySwapMax=256M \
  /var/lib/lifehub/decision-benchmark-20260921/venv/bin/python \
  tools/decision-benchmark/benchmark.py \
  --corpus .decision-benchmark/corpus.export.json --backend gliclass-mini --split eval \
  --policy mini-policy.json --output mini-eval.json --memory-gib 3 \
  --health-url http://127.0.0.1:3000/api/healthz
```

Use development first, with its own unit/output name. `--memory-gib` defaults to 2;
the user explicitly allowed a larger allocation to be investigated. A 3 GiB profile
is therefore reported separately, including whether it meets the initial 2 GiB
reference. It does not change the container's allocation. Check host headroom before
raising limits; larger disk/RAM assignments are not applied by these scripts.

The one-process requirement permits multiple inference threads. A measured
follow-up used `--threads 2` with `CPUQuota=200%` in the same isolated cgroup.
Mini's diagnostic follow-up also used `--timeout 120` to finish long inputs;
the p95 gate stayed at 5 seconds. Use new output names for each resource profile
and keep the already-frozen policy. See the results for both failed initial runs
and complete follow-ups, rather than dropping timed-out cases.

The gate requires 100 evaluated cases, no errors, retention of suitable listings
>=95%, rejection precision >=95%, decision coverage >=70%, p95 <=5 seconds, an N150,
one inference process, and measured memory within the explicit run budget. Health
must return 200 before/during/after, with p95 <=max(100 ms, twice baseline p95), and
the cgroup OOM counter must not increase. This probes LifeHub responsiveness, not
every homelab service. Missing hardware/health evidence is a failed gate, never an
implicit pass. Suitable listings mapped to UNSURE count as retained, not as MATCH.

## Laya multilingual on the N150

Install the pinned Laya source into the isolated CPU environment, without replacing
the already-pinned dependencies. Prepare only the multilingual checkpoint:

```sh
.decision-benchmark/venv/bin/pip install --no-deps \
  'laya @ git+https://github.com/NandhaKishorM/laya.git@573e5b62696ba441230cd6be71d593331b5d23af'
.decision-benchmark/venv/bin/python tools/decision-benchmark/prepare.py laya-multilingual
```

Use the development/evaluation commands above with `--backend laya-multilingual`,
new `laya-policy.json` / output paths, `--threads 2 --timeout 120 --memory-gib 3`,
and `CPUQuota=200%` in the transient systemd wrapper. Neither the Mac nor a hosted
endpoint is involved in scoring. The timeout permits diagnostic long-input runs;
the eligibility target remains p95 <=5 seconds.

The adapter uses the official `predict` API with two questions per forward pass,
three choices (yes/no/unknown), CPU float32 and the checkpoint's 1,024-token limit.
It reuses the existing atomic questions and decision composition. Complete token
sequences are checked against the upstream formatter before inference: silently
shortened instructions/options fail, long descriptions use overlapping chunks,
and oversized titles/preferences fail explicitly. Source labels never enter state.

Reports retain raw logits through a forward hook, upstream option probabilities,
entropy-based confidence, action-head output, effective temperatures, checkpoint
configuration and SHA-256 hashes. The adapter uses option probabilities only;
neither confidence nor the action head becomes P(correct) or `fitScore`. The pinned
multilingual checkpoint ships temperature 1 without per-option fitted values.
Upstream's tokenizer compatibility repair is applied to a temporary copy of its
small configuration files, keeping the pinned model cache unchanged. Weights are
symlinked locally. The Laya adapter is included in its frozen protocol hash;
previous GLiClass/SemIf policies retain their original hashes.

## SemIf on Apple Silicon

This is a historical comparison only. The deployment requirement is autonomous
server operation; the Mac is not an inference dependency for Flathunter.

Use a separate environment because upstream pins its own dependencies:

```sh
python3 -m venv .decision-benchmark/semif-venv
.decision-benchmark/semif-venv/bin/pip install \
  'semif-phase1[mlx] @ git+https://github.com/TheoLeeCJ/SemIf.git@ca3ba65f142967030ecb453346e94d6f476a69df' \
  psutil==7.2.2
.decision-benchmark/semif-venv/bin/python tools/decision-benchmark/prepare.py semif-qwen
```

Use the same development/evaluation commands with that Python, `--backend semif-qwen`,
distinct policy/output files and `--memory-gib 8`. The pinned MLX Community 4-bit
checkpoint avoids storing the 9.3 GB original and quantizing it during loading.
This is a distinct quantized artifact; no equivalence with upstream BF16 benchmark
numbers is assumed. SemIf's code revision, MLX/MLX-LM versions, actual artifact
hashes and quantization are recorded. Serial prefix reuse scores each listing's
questions without a text-generation loop. The Mac cannot satisfy the N150 gate.

## Archived LLM decisions and tests

`--backend archived --archived path.json` reads an optional local object keyed by case
ID. Each entry must contain `model`, `eligibilityState` and `inputHash`: the SHA-256
produced by `decisions.digest` over `{title, description, preferences}`. Unmatched or
missing rows are explicitly unavailable. Archived answers never become ground truth,
and missing latency is not replaced with zero. No production database is read.

```sh
.decision-benchmark/venv/bin/python -m unittest discover -s tools/decision-benchmark -p 'test_*.py' -v
pnpm --filter @flathunter/worker typecheck
pnpm --filter @flathunter/worker test
pnpm --filter @flathunter/shared test
```

`pnpm test:decisions` uses system Python and runs the dependency-free tests; process
supervision tests require psutil in the venv. Generated corpora, weights, environments
and raw reports remain under ignored experiment/cache directories. Commit only code,
synthetic fixtures and curated measurement reports.

## Sources

- [TypeSafe decision primitives](https://docs.typesafe.ai/introduction)
- [GLiClass multilingual mini](https://huggingface.co/knowledgator/gliclass-multilang-mini)
- [GLiClass multilingual edge](https://huggingface.co/knowledgator/gliclass-multilang-edge)
- [Pinned Laya source](https://github.com/NandhaKishorM/laya/tree/573e5b62696ba441230cd6be71d593331b5d23af)
- [Laya multilingual checkpoint](https://huggingface.co/convaiinnovations/laya/tree/1c5edc17a7acd8701df6fc341c0d179f1c62c982/multilingual)
- [SemIf MLX implementation](https://github.com/TheoLeeCJ/SemIf/blob/ca3ba65f142967030ecb453346e94d6f476a69df/docs/MLX.md)
- [MLX Qwen3.5-4B 4-bit artifact](https://huggingface.co/mlx-community/Qwen3.5-4B-4bit/tree/0e7ffd5c629ef7719d4cbc04069232580bfa9d9c)
