"""Pinned local inference implementations; imported only by the isolated worker."""
from __future__ import annotations

import json
from pathlib import Path

from decisions import ANSWERS, question_rows

MODELS = json.loads(Path(__file__).with_name("models.json").read_text())
MODEL_FILES = ["*.json", "*.safetensors", "*.model", "*.txt", "*.tiktoken", "*.jinja"]


class GLiClassBackend:
    def __init__(self, spec, threads):
        import torch
        from gliclass import GLiClassModel
        from gliclass.pipeline import UniEncoderZeroShotClassificationPipeline
        from huggingface_hub import snapshot_download
        from transformers import AutoTokenizer

        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        # Model preparation is a separate, explicitly online command.
        snapshot = snapshot_download(spec["model"], revision=spec["revision"],
                                     allow_patterns=MODEL_FILES, local_files_only=True)
        self.tokenizer = AutoTokenizer.from_pretrained(snapshot, local_files_only=True, trust_remote_code=False)
        self.model = GLiClassModel.from_pretrained(snapshot, local_files_only=True, dtype=torch.float32).eval()
        self.pipeline = UniEncoderZeroShotClassificationPipeline(
            self.model, self.tokenizer, device="cpu", max_length=1024, progress_bar=False)
        self.torch = torch

    def score(self, case):
        questions = question_rows(case)
        scores, traces = {}, []
        for question in questions:
            key = question["id"].rsplit(":", 1)[1]
            scores[key] = []
            labels = [option["description"] for option in question["options"]]
            prompt = question["question"] + "\n"

            def formatted(text):
                content = (f'Title: {case["title"]}\nListing: {text}\n'
                           + "Additional mandatory preferences: " + "; ".join(case["preferences"]))
                return self.pipeline.prepare_input(content, labels, prompt=prompt)

            # Split before tokenization truncation; every source word is retained.
            pending, chunks = [case["description"]], []
            while pending:
                text = pending.pop(0)
                encoded = self.tokenizer(formatted(text), truncation=False)["input_ids"]
                if len(encoded) <= 1024:
                    chunks.append(text)
                    continue
                words = text.split()
                if len(words) < 32 or len(chunks) + len(pending) >= 63:
                    raise ValueError("input_too_long: no safe space for labels and full text")
                middle = len(words) // 2
                pending[0:0] = [" ".join(words[:middle + 8]), " ".join(words[middle - 8:])]

            for text in chunks:
                inputs = self.tokenizer(formatted(text), truncation=False, return_tensors="pt")
                with self.torch.inference_mode():
                    logits = self.model(**inputs, max_num_classes=3).logits[0][:3]
                    values = self.torch.softmax(logits, dim=-1).tolist()
                traces.append({"question": key, "inputTokens": inputs["input_ids"].shape[-1], "logits": logits.tolist()})
                scores[key].append(dict(zip(ANSWERS, values)))
        return {"scores": scores, "trace": traces, "scoreKind": "conditional-option-probabilities-uncalibrated"}


class SemIfBackend:
    def __init__(self, spec, threads):
        from importlib.metadata import distribution
        from semif_phase1 import mlx_backend

        source = distribution("semif-phase1").read_text("direct_url.json")
        installed = json.loads(source or "{}")
        if installed.get("vcs_info", {}).get("commit_id") != spec["codeRevision"]:
            raise ValueError("SemIf must be installed from the pinned Git commit in models.json")
        self.backend = mlx_backend
        self.model, self.tokenizer, self.metadata = mlx_backend.load_model(
            spec["model"], spec["revision"], None, cache_limit_mib=256)

    def score(self, case):
        # Serial prefix reuse avoids multiplying the full listing prefill by question count.
        scorer = self.backend.SerialPrefixScorer(self.model, self.tokenizer, self.metadata, 4096)
        scores, traces = {}, []
        for row in question_rows(case):
            result = scorer.score(row)
            key = row["id"].rsplit(":", 1)[1]
            scores[key] = [dict(zip(result["option_ids"], result["probabilities"]))]
            traces.append(result)
        return {"scores": scores, "trace": traces, "scoreKind": "conditional-option-probabilities-uncalibrated"}


def load_backend(name, threads):
    spec = MODELS[name]
    return (GLiClassBackend if spec["backend"] == "gliclass" else SemIfBackend)(spec, threads)
