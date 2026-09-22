"""Download pinned public weights; inference itself runs with HF_HUB_OFFLINE=1."""
import argparse
import shutil
from pathlib import Path

from backends import MODEL_FILES, MODELS

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("model", choices=MODELS)
args = parser.parse_args()
spec = MODELS[args.model]

from huggingface_hub import constants, snapshot_download

cache = Path(constants.HF_HUB_CACHE)
cache.mkdir(parents=True, exist_ok=True)
required = (7 if spec["backend"] == "semif" else 3) * 1024**3
if shutil.disk_usage(cache).free < required:
    raise SystemExit(f"Not enough free disk: need {required // 1024**3} GiB including safety margin. Set HF_HOME to another volume.")
snapshot = snapshot_download(spec["model"], revision=spec["revision"],
    allow_patterns=[spec["subfolder"] + "/*"] if spec.get("subfolder") else MODEL_FILES)
print(snapshot)
