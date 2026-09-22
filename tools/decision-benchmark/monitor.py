"""Read-only loopback health sampling during the isolated N150 experiment."""
from __future__ import annotations

import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from decisions import percentile


def oom_count():
    path = Path("/sys/fs/cgroup/memory.events")
    if not path.exists():
        return None
    values = dict(line.split() for line in path.read_text().splitlines())
    return int(values["oom_kill"]) if "oom_kill" in values else None


class HealthMonitor:
    def __init__(self, url):
        parsed = urlparse(url)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.username or parsed.password:
            raise ValueError("Health monitor only accepts unauthenticated loopback HTTP")
        self.url, self.samples = url, []
        self.before_oom = oom_count()
        self.stop_event = threading.Event()
        self.thread = None

    def sample(self, phase):
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(self.url, timeout=2) as response:
                ok = response.status == 200
                response.read(4096)
        except Exception:
            ok = False
        self.samples.append({"phase": phase, "at": time.time(), "ok": ok,
                             "latencyMs": (time.perf_counter() - started) * 1000})

    def start(self):
        for _ in range(5):
            self.sample("before")
            time.sleep(.2)

        def collect():
            while not self.stop_event.is_set():
                self.sample("during")
                self.stop_event.wait(1)
        self.thread = threading.Thread(target=collect, daemon=True)
        self.thread.start()

    def finish(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(3)
        for _ in range(5):
            self.sample("after")
            time.sleep(.2)
        before = [s["latencyMs"] for s in self.samples if s["phase"] == "before"]
        active = [s["latencyMs"] for s in self.samples if s["phase"] != "before"]
        limit = max(100, percentile(before, .95) * 2)
        after_oom = oom_count()
        return {
            "serviceHealthPassed": all(s["ok"] for s in self.samples) and percentile(active, .95) <= limit,
            "oomFree": self.before_oom == after_oom if self.before_oom is not None and after_oom is not None else None,
            "healthEvidence": {"url": self.url, "samples": self.samples, "latencyLimitMs": limit,
                               "oomBefore": self.before_oom, "oomAfter": after_oom},
        }
