"""Pinned Laya CPU adapter. Keeps upstream formatting, scores and temperature policy."""
from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from pathlib import Path

from decisions import ANSWERS, question_rows


def checked_sequence(tok, state, question, max_len, head_max_len):
    """Construct the complete upstream choice format; never silently shorten evidence."""
    def encode(text):
        return tok(text.replace(tok.mask_token, " "), add_special_tokens=False)["input_ids"]

    header = encode("choice question: " + question["instructions"])
    options = [encode(" " + key + ": " + value) for key, value in question["criteria"].items()]
    option_size = sum(1 + len(option) for option in options)
    if (any(len(option) > 48 for option in options)
            or head_max_len - option_size < 16 or len(header) + option_size > head_max_len):
        raise ValueError("question_too_long: Laya would truncate instructions or options")
    ids = [tok.cls_token_id] + header + [tok.sep_token_id]
    markers = []
    for option in options:
        markers.append(len(ids))
        ids += [tok.mask_token_id] + option
    ids += [tok.sep_token_id] + encode(json.dumps(state, ensure_ascii=False)) + [tok.sep_token_id]
    return (ids, markers) if len(ids) <= max_len else None


def prepare_chunks(case, tok, max_len, head_max_len):
    rows = question_rows(case)
    questions = {row["id"].rsplit(":", 1)[1]: {
        "type": "choice", "instructions": row["question"],
        "criteria": {option["id"]: option["description"] for option in row["options"]},
    } for row in rows}
    state = rows[0]["state"]
    pending, chunks = [state["listing_text"]], []
    while pending:
        text = pending.pop(0)
        chunk_state = {**state, "listing_text": text}
        sequences = {key: checked_sequence(tok, chunk_state, q, max_len, head_max_len)
                     for key, q in questions.items()}
        if all(sequence is not None for sequence in sequences.values()):
            chunks.append((chunk_state, sequences))
            continue
        words = text.split()
        if len(words) < 32 or len(chunks) + len(pending) >= 63:
            raise ValueError("input_too_long: no safe space for full questions, title and preferences")
        middle = len(words) // 2
        pending[0:0] = [" ".join(words[:middle + 8]), " ".join(words[middle - 8:])]
    return questions, chunks


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


class LayaBackend:
    def __init__(self, spec, threads):
        from importlib.metadata import distribution
        import laya
        import torch
        from huggingface_hub import snapshot_download

        installed = json.loads(distribution("laya").read_text("direct_url.json") or "{}")
        if installed.get("vcs_info", {}).get("commit_id") != spec["codeRevision"]:
            raise ValueError("Laya must be installed from the pinned Git commit in models.json")
        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        snapshot = Path(snapshot_download(spec["model"], revision=spec["revision"],
            allow_patterns=[spec["subfolder"] + "/*"], local_files_only=True)) / spec["subfolder"]
        hashes = {str(path.relative_to(snapshot)): sha256(path)
                  for path in sorted(snapshot.rglob("*")) if path.is_file()}
        # Upstream repairs tokenizer_config.json in place. Keep the pinned cache intact.
        self.scratch = tempfile.TemporaryDirectory(prefix="laya-benchmark-")
        local = Path(self.scratch.name)
        for path in snapshot.rglob("*"):
            target = local / path.relative_to(snapshot)
            if path.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            elif path.suffix == ".safetensors":
                target.symlink_to(path.resolve())
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
        self.agent = laya.load(str(local), device="cpu")
        self.batch_size = spec["questionBatchSize"]
        self.max_len = self.agent.cfg.get("max_len", 512)
        self.head_max_len = self.agent.cfg.get("head_max_len", 192)
        self.metadata = {
            "artifactSha256": hashes, "config": self.agent.cfg,
            "effectiveTokenizerConfigSha256": sha256(local / "tokenizer/tokenizer_config.json"),
            "temperature": self.agent.temperature,
            "temperatureByOptions": self.agent.temperature_by_options,
            "questionBatchSize": self.batch_size, "device": str(self.agent.device),
            "dtype": str(self.agent.dtype),
        }

    def score(self, case):
        from laya.common import build_sequence

        questions, chunks = prepare_chunks(case, self.agent.tok, self.max_len, self.head_max_len)
        scores, traces = {key: [] for key in questions}, []
        keys = list(questions)
        for chunk_index, (state, sequences) in enumerate(chunks):
            for start in range(0, len(keys), self.batch_size):
                batch = {key: questions[key] for key in keys[start:start + self.batch_size]}
                # An upstream formatter change must fail explicitly, not lose text unnoticed.
                for key, question in batch.items():
                    actual = build_sequence(self.agent.tok, state, self.agent._to_internal(question),
                                            self.max_len, self.head_max_len)
                    if actual != sequences[key]:
                        raise ValueError("Laya tokenization does not match the full untruncated input")
                captured = []
                def capture(module, inputs, output):
                    captured.append(output[0].detach().float().cpu().tolist())
                hook = self.agent.model.register_forward_hook(capture)
                try:
                    result = self.agent.predict(state, batch)
                finally:
                    hook.remove()
                if len(captured) != 1 or set(result["answers"]) != set(batch):
                    raise ValueError("Invalid Laya batch response")
                for index, key in enumerate(batch):
                    answer = result["answers"][key]
                    if answer["type"] != "choice" or set(answer["probabilities"]) != set(ANSWERS):
                        raise ValueError("Invalid Laya answer schema")
                    scores[key].append(answer["probabilities"])
                    traces.append({"question": key, "chunk": chunk_index,
                        "inputTokens": len(sequences[key][0]), "logits": captured[0][index],
                        "upstreamAnswer": answer})
        return {"scores": scores, "trace": traces, "modelMetadata": self.metadata,
                "scoreKind": "conditional-option-probabilities-uncalibrated"}
