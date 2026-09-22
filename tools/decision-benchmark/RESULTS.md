# Local decision experiment — 2026-09-21

**No measured server candidate qualifies for a shadow pilot.** Laya multilingual
completes the N150 trial and passes the operational gates with the explicit 3 GiB
budget, but fails quality: 83.3% retention, 65.2% reject precision and 24% coverage.
The implemented GLiClass protocols also fail quality. SemIf + Qwen passes the
synthetic quality thresholds on the Mac, but that historical comparison does not
satisfy the required autonomous server deployment; its N150 performance is unmeasured.
Increasing the memory budget from the initial 2 GiB reference to 3 GiB allowed mini to load on
the N150, but did not resolve its decision coverage limitation. Resource profiles
with one and two inference threads are reported separately below.

## What was measured

The corpus contains 150 authored synthetic cases in 75 families, split into 50
development cases and 100 evaluation cases with no family overlap. Evaluation has
36 MATCH, 44 REJECT and 20 UNSURE labels. Labels have explicit rationales reviewed
against the fixed synthetic profile; they are not independent human annotations of
real listings. Paired paraphrases are correlated observations. These figures must
not be presented as estimated production accuracy.

Only development cases were used to choose the atomic-question protocol and score
thresholds. The initial all-label GLiClass prototype was discarded during development.
The final protocol scores each question independently. Mini's frozen threshold/margin
are 0.35/0.10; edge's are 0.65/0.30. No evaluation-driven prompt or threshold tuning
was performed. Model, corpus and protocol hashes accompany each raw report.

## Complete GLiClass evaluation on the Mac

Apple M1 Pro, 16 GiB RAM; CPU inference, one thread/process, float32. These runs
complete the quality comparison without the N150's long-input timeout.

| Candidate | Suitable retained | Reject precision | Decided | UNSURE | p50 / p95 | Peak process RSS* |
|---|---:|---:|---:|---:|---:|---:|
| Existing deterministic rules | 69.4% | 54.2% | 92% | 8% | 0.009 / 0.012 ms | — |
| GLiClass mini | 100% | 100% | 8% | 92% | 710 / 884 ms | 1.83 GiB |
| GLiClass edge | 5.6% | 44.9% | 98% | 2% | 257 / 306 ms | 1.40 GiB |

The rules baseline is the real existing implementation, measured by the TypeScript
exporter on the same Mac. Its keyword heuristics do not handle several negations;
its numeric MATCH path also accepts cases with unmet semantic requirements.

Mini retained all 36 suitable cases by abstaining on them: **zero MATCH predictions**.
Six of its eight correct rejects were determined by numeric constraints alone.
It therefore does not meet the 70% decision coverage requirement. Edge incorrectly
rejected 34 of 36 suitable cases and all 20 expected-UNSURE cases. Neither constitutes
a safe replacement with this protocol. These results concern the tested checkpoint,
labels and adapter; they do not establish that all possible GLiClass formulations fail.

## Laya multilingual on the N150

The Laya trial runs entirely in LXC 102 on the N150, using the existing isolated
CPU environment, one inference process, two Torch threads and a 3 GiB experimental
budget. The container remains at 4 GiB; no Proxmox allocation was increased.
The Mac is not an inference dependency. Code and multilingual weights are pinned
separately in `models.json`; the weight SHA-256 is
`9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`.

Laya receives the same atomic questions as the other models, expressed as typed
three-option choices, in batches of two. Its native 1,024-token context is respected
with overlapping chunks and exact checks against silent text/question truncation.
It uses CPU float32 and the checkpoint's temperature 1. Raw logits, upstream scores,
configuration, artifact hashes and effective temperature are retained. Upstream's
entropy confidence and action-head probability are recorded, not used as correctness
probabilities or eligibility scores. Summaries remain outside this experiment.

The development set selected threshold/margin **0.50/0.10** from the unchanged
grid. None of the 16 grid combinations met both 95% retention and rejection
precision. At the selected policy, development retained 13/16 suitable cases,
had 12 correct rejects out of 20, and decided 44% of cases. One suitable listing
was rejected for an apartment exchange requirement absent from its text; another
was rejected for an unsupported WBS requirement. These are semantic errors, not
execution failures. The policy was frozen before the separate evaluation, with
no changes to questions, thresholds or chunking based on evaluation results.

| Holdout measure | Laya result | Pilot threshold |
|---|---:|---:|
| Evaluated cases / execution errors | 100 / 0 | 100 / 0 |
| Suitable listings retained | 30 / 36 (83.3%) | >=95% |
| Correct rejects / all rejects | 15 / 23 (65.2%) | >=95% |
| Decided / UNSURE | 24% / 76% | >=70% decided |
| p50 / p95 | 3.19 / 4.78 s | p95 <=5 s |
| Maximum listing latency | 96.76 s | Diagnostic timeout 120 s |
| Peak process RSS, including supervisor | 2.37 GiB | Explicit budget 3 GiB |

Of the 36 suitable cases, only one became MATCH, 29 remained UNSURE and six were
wrongly rejected. Two additional rejects were expected-UNSURE cases. Six of the
15 correct rejections came from deterministic numeric constraints. The operational
gates passed, including health and OOM checks, but every quality threshold failed.
Thus additional RAM would not solve the observed decision errors. This result
applies to the pinned checkpoint and tested question/adapter protocol; it is not
a claim about every possible Laya formulation or a fine-tuned rental model.
No shadow service, production classifier or Finance integration was enabled.

Four long descriptions required four chunks each and took 90.66–96.76 seconds;
their full costs are included in the 100-case distribution. The p95 threshold passes
but does not describe this slow tail. Cold startup took 12.84 seconds, measured
separately from listing latency. The run does **not** meet the initial 2 GiB reference.
The transient systemd cgroup reported a different peak (1.8 GiB, no swap); the gate
uses the more conservative process-RSS measurement of 2.37 GiB.

All 710 LifeHub health probes succeeded; during-inference health p95 was 8.41 ms
against a 100 ms limit. The OOM-kill counter remained zero. On completion, no
benchmark unit remained loaded, LifeHub was active and its health endpoint returned
`ok`. The host had about 4.7 GiB available RAM and LXC 102 had 12 GiB free disk.
The model cache and raw reports remain in the isolated experiment directory for
reproduction; no model remains resident as a background service.

## SemIf + Qwen3.5-4B on the Mac

The checkpoint is the pinned MLX Community 4-bit artifact, not upstream BF16.
SemIf and MLX-LM are installed at recorded Git commits. Development selected a
threshold of 0.80 and margin of 0.30; these were frozen before evaluation.

| Holdout measure | Result |
|---|---:|
| Evaluated cases / execution errors | 100 / 0 |
| Suitable listings retained | 36 / 36 (100%) |
| Correct rejects / all rejects | 38 / 38 (100%) |
| Decided / UNSURE | 72% / 28% |
| p50 / p95 / maximum | 4.03 / 4.81 / 11.23 s |
| Process RSS peak | 1.62 GiB |
| MLX peak active allocations | 3.95 GiB |
| Conservatively accounted sum | 5.57 GiB |

It classified 34 suitable cases as MATCH, rejected 38 unsuitable cases, and
abstained on the other 28. All 20 expected-UNSURE cases remained UNSURE. The eight
abstentions on otherwise decidable cases involved an elevator preference, one
adversarial instruction, a swap described indirectly, and cat/elevator exclusions.
There were no incorrect decisive predictions on this challenge set.

The quality and Mac latency thresholds pass. This is preliminary evidence for the
larger model, not a production accuracy guarantee: 100 synthetic examples represent
only 50 authored families. No compatible CPU deployment of this quantized artifact
was measured on the N150. Mac MLX results cannot establish autonomous homelab
performance, and no shared service or shadow worker was enabled.

MLX allocations are recorded separately because RSS alone misses GPU memory.
Their sum is used conservatively against the experimental 8 GiB budget; overlap is
possible, so 5.57 GiB is not measured total system RAM or an N150 sizing estimate.
The allocator cache limit is separately fixed at 256 MiB. The runner instrumentation
was extended for this measurement without changing the frozen inference protocol.
An initial incomplete evaluation was interrupted for that instrumentation change;
the table uses the subsequent complete run, with no evaluation-driven tuning.

## N150 resource trials

Intel N150, Proxmox LXC 102 with its existing 4 GiB allocation. Initial transient runs
used one CPU inference thread/process, CPUQuota=100%, Nice=10, MemoryMax=3G and
MemorySwapMax=256M. No container allocation or persistent service configuration was
changed. A preliminary 2 GiB mini run stopped at the supervisor's memory limit.

| Candidate | Completed inferences | First failure | Timed p50 / p95** | Peak process RSS* | Health / OOM |
|---|---:|---|---:|---:|---|
| GLiClass mini | 34 / 100 | 30 s timeout on `tail-wbs-negation-1` | 6.66 / 8.16 s | 2.29 GiB | Passed / none |
| GLiClass edge | 34 / 100 | 30 s timeout on `tail-wbs-negation-1` | 1.65 / 2.10 s | 1.67 GiB | Passed / none |

After a timeout the single worker is terminated; the failed request and remaining
65 cases become explicit errors/UNSURE. They remain in quality denominators. Both
runs fail the completeness gate; the N150 figures cannot be used as full-corpus
quality estimates. Mini also fails the latency gate before considering those errors.

*RSS includes inference and supervisor processes, sampled with psutil plus the
worker's OS high-water mark. It differs from systemd's cgroup memory accounting.
**Percentiles cover 35 measured requests, including the timed-out request; the
remaining 65 have no invented latency. These are incomplete-run percentiles.

A follow-up profile used two threads in the same inference process, CPUQuota=200%,
and the same 3 GiB memory budget. It reused the frozen policy without any change
to prompts or thresholds. Edge completed all 100 cases with p50 **937 ms**, p95
**1,168 ms**, no execution errors, and passing health/OOM checks. Its decisions
matched the complete Mac run: 34 of 36 suitable cases were wrongly rejected.
Thus edge passed the operational criteria in this profile but failed quality.
The one-thread timeout is not an intrinsic limit of the N150 hardware.

Mini also completed all 100 cases with two threads when the request timeout was
raised from 30 to 120 seconds for this diagnostic run. The p95 eligibility target
remained 5 seconds. It matched the Mac's decisions (8% coverage, zero MATCH), with
p50 **3.72 s**, p95 **5.93 s**, maximum **88.52 s**, and peak RSS **2.29 GiB**.
It passed memory, completeness and health/OOM checks, but failed quality and p95.
Edge's two-thread peak RSS was **1.61 GiB** and maximum latency **25.10 s**.
For these two-thread profiles, health p95 was 7.24/6.12 ms (mini/edge), with all
probes successful. No checkpoint, question or decision threshold changed between
resource profiles; these are operational comparisons, not further label tuning.

LifeHub's loopback health endpoint was sampled before, during and after each trial;
all probes returned HTTP 200 and latency p95 met the regression criterion. The container's
OOM-kill counter did not increase. This is evidence about LifeHub responsiveness,
not a performance certification of every homelab service. A low-priority public
Qwen checkpoint download overlapped part of the mini trial; no second inference
process ran on the N150. After the trials, LifeHub remained active and no transient
benchmark unit was left running. The temporary MLX download cache was removed from
the server after the Mac's copy passed SHA-256 verification. The final check showed
about 4.7 GiB available host RAM and 13 GiB free container disk.

During inference, health p95 was 8.34 ms for mini and 5.41 ms for edge. Mini had one
242 ms maximum sample; the criterion is p95 <=100 ms for these runs, not a maximum
latency bound. The monitor retained all 290/108 samples, respectively.

## Integration consequence

Only 8 of these 100 cases reach the LLM under the current worker routing. They are
all expected-UNSURE numeric/missing-data cases. Mini, SemIf and Laya leave them UNSURE,
so replacing only that LLM path leaves this corpus's earlier deterministic errors unchanged.
Changing the text-rule routing needs a separate, explicit design and evaluation;
the experiment has not changed it.

No compatible archived LLM decisions were available for these new synthetic inputs.
The optional archive adapter requires exact input hashes and treats missing records
as unavailable. The original 12-case corpus is preserved as a separate smoke check,
not relabeled as ground truth or expanded by copying its expectations.

Summaries, translations, ranking, notifications, API and database behavior remain
unchanged. A shared internal service and the Finance/Fisco/Menu/Posta extensions
remain conditional on a candidate passing the intended homelab evaluation.
No production token/cost savings were measured; keeping a generated summary per
listing can still dominate hosted-model usage.

See [README.md](README.md) for commands and pinned sources. Full raw scores, logits,
timings, model metadata, frozen policies and health samples are in the ignored
`.decision-benchmark/` artifacts. [Curated metadata and decisions](measurements.json)
and a [per-case comparison](case-results.csv) are retained alongside this report.

Validation: all 26 Python benchmark tests passed after the Laya extension, including
complete long-input coverage, exact token limits, oversized preferences and unsafe
question truncation. The earlier 73 worker tests, 28 shared-package tests and worker
TypeScript typecheck passed; that code was not modified for Laya. Runtime error
tests cover timeouts, unavailable models, invalid responses and accelerator memory.

The resolved dependency sets are in `environments/`: Python 3.12.3 on the Mac and
Python 3.13.5 on the N150. Recreate the matching environment, prepare the pinned
checkpoint, export the corpus once, fit thresholds on development, and then reuse
that exact exported artifact for evaluation. Re-exporting also repeats baseline
timings, so its artifact hash changes even when the authored text is unchanged.
