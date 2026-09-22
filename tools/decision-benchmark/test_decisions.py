import json
import math
import time
import unittest
from pathlib import Path

from benchmark import InferenceProcess, materialize
from decisions import (ANSWERS, QUESTIONS, compose, gate, metrics, quality_pass,
                       question_rows, validate_corpus)
from monitor import HealthMonitor


def case(**overrides):
    return {"id": "example", "family": "family", "split": "dev", "expected": "MATCH",
            "title": "Whole flat", "description": "Permanent whole apartment, registration allowed.",
            "preferences": [], "tags": ["test"], "rationale": "Explicit permanent flat",
            "numeric": {"eligibilityState": "MATCH", "reason": "numeric policy"}, **overrides}


def raw(**overrides):
    votes = {"wbs": "no", "temporary": "no", "swap": "no", "room": "no",
             "registration": "yes", "long_term": "yes", "conflict": "no", **overrides}
    return {key: [{answer: .98 if answer == value else .01 for answer in ANSWERS}]
            for key, value in votes.items()}


def sleeping_worker(connection, backend, threads):
    connection.send({"ready": True})
    connection.recv()
    time.sleep(30)


def broken_worker(connection, backend, threads):
    connection.send({"error": "backend_unavailable: fixture"})


def accelerator_worker(connection, backend, threads):
    connection.send({"ready": True, "peakAcceleratorBytes": 3 * 1024**3})
    connection.recv()


class DecisionTests(unittest.TestCase):
    def test_negated_restrictions_are_not_rejects(self):
        result = compose(case(), raw())
        self.assertEqual(result["eligibilityState"], "MATCH")
        self.assertEqual(result["flags"], ["LONG_TERM"])
        self.assertNotIn("fitScore", result)

    def test_each_hard_restriction_rejects(self):
        for key in ("wbs", "swap", "room"):
            with self.subTest(key=key):
                self.assertEqual(compose(case(), raw(**{key: "yes"}))["eligibilityState"], "REJECT")
        self.assertEqual(compose(case(), raw(temporary="yes", long_term="no"))["eligibilityState"], "REJECT")
        self.assertEqual(compose(case(), raw(registration="no"))["flags"], ["LONG_TERM", "NO_REGISTRATION"])

    def test_numeric_policy_overrides_semantics(self):
        self.assertEqual(compose(case(numeric={"eligibilityState": "REJECT", "reason": "rent"}), raw())["eligibilityState"], "REJECT")
        self.assertEqual(compose(case(numeric={"eligibilityState": "UNSURE", "reason": "missing rent"}), raw())["eligibilityState"], "UNSURE")

    def test_preferences_unknown_are_not_met(self):
        for answer, expected in (("unknown", "UNSURE"), ("no", "REJECT"), ("yes", "MATCH")):
            self.assertEqual(compose(case(preferences=["Mi serve un ascensore"]), raw(preferences=answer))["eligibilityState"], expected)

    def test_contradictory_duration_abstains(self):
        self.assertEqual(compose(case(), raw(temporary="yes", long_term="yes"))["eligibilityState"], "UNSURE")

    def test_tail_evidence_survives_neutral_chunks(self):
        data = raw()
        data["wbs"] = [raw(wbs="unknown")["wbs"][0], raw(wbs="yes")["wbs"][0]]
        self.assertEqual(compose(case(), data)["eligibilityState"], "REJECT")

    def test_contradictory_chunks_do_not_select_reject(self):
        data = raw()
        data["wbs"] += raw(wbs="yes")["wbs"]
        self.assertEqual(compose(case(), data)["atoms"]["wbs"], "unknown")
        self.assertEqual(compose(case(), data)["eligibilityState"], "UNSURE")

    def test_low_margin_abstains(self):
        data = raw()
        data["long_term"] = [{"yes": .51, "no": .49, "unknown": .0}]
        self.assertEqual(compose(case(), data)["eligibilityState"], "UNSURE")

    def test_invalid_scores_and_schema_fail_closed(self):
        for bad in (math.nan, math.inf, -.1, 1.1, True, "yes"):
            data = raw()
            data["wbs"][0]["yes"] = bad
            result = materialize(case(), {"scores": data}, {"threshold": .5, "margin": .1})
            self.assertEqual(result["eligibilityState"], "UNSURE")
            self.assertTrue(result["error"])
        for data in ({}, {**raw(), "unexpected": []}):
            with self.assertRaises(ValueError):
                compose(case(), data)

    def test_labels_never_enter_model_questions(self):
        rows = question_rows(case(expected="REJECT", rationale="SECRET LABEL"))
        serialized = json.dumps(rows)
        self.assertNotIn("SECRET LABEL", serialized)
        self.assertNotIn('"expected"', serialized)
        self.assertNotIn('"numeric"', serialized)
        self.assertEqual(len(rows), len(QUESTIONS) - 1)


class CorpusTests(unittest.TestCase):
    def expanded(self):
        source = json.loads(Path(__file__).with_name("corpus.json").read_text())
        return {"cases": [case(id=f'{f["id"]}-{v}', family=f["id"], split=f["split"],
                               expected=f["expected"], description=text, rationale=f["rationale"])
                          for f in source for v, text in enumerate(f["texts"])]}

    def test_150_cases_in_75_disjoint_families(self):
        corpus = self.expanded()
        self.assertEqual(len(validate_corpus(corpus)), 150)
        self.assertEqual(len({c["family"] for c in corpus["cases"]}), 75)
        for split in ("dev", "eval"):
            self.assertEqual({c["expected"] for c in corpus["cases"] if c["split"] == split}, {"MATCH", "REJECT", "UNSURE"})

    def test_family_leak_is_rejected(self):
        corpus = self.expanded()
        corpus["cases"][-1]["family"] = corpus["cases"][0]["family"]
        with self.assertRaisesRegex(ValueError, "Family leaks"):
            validate_corpus(corpus)

    def test_duplicate_text_across_splits_is_rejected(self):
        corpus = self.expanded()
        corpus["cases"][-1]["description"] = corpus["cases"][0]["description"].upper()
        with self.assertRaisesRegex(ValueError, "Text leaks"):
            validate_corpus(corpus)


class MetricsTests(unittest.TestCase):
    def rows(self):
        return [{"id": str(i), "family": str(i // 2), "expected": state, "eligibilityState": state,
                 "latencyMs": 100} for i, state in enumerate(["MATCH"] * 40 + ["REJECT"] * 40 + ["UNSURE"] * 20)]

    def runtime(self):
        return {"cpu": "Intel N150", "machine": "x86_64", "inferenceProcesses": 1,
                "peakRssBytes": 1024**3, "serviceHealthPassed": True, "oomFree": True}

    def test_gate_requires_quality_and_real_target_evidence(self):
        m = metrics(self.rows())
        self.assertTrue(quality_pass(m))
        self.assertEqual(gate(m, self.runtime())["status"], "eligible-for-shadow")
        for change in ({"cpu": "Apple M1"}, {"oomFree": None}, {"serviceHealthPassed": None}, {"peakRssBytes": 3 * 1024**3}):
            self.assertEqual(gate(m, {**self.runtime(), **change})["status"], "not-eligible")

    def test_expanded_budget_is_explicit(self):
        result = gate(metrics(self.rows()), {**self.runtime(), "peakRssBytes": int(2.5 * 1024**3), "memoryLimitBytes": 3 * 1024**3})
        self.assertEqual(result["status"], "eligible-for-shadow")
        self.assertFalse(result["withinInitial2GiB"])

    def test_all_abstentions_cannot_pass(self):
        rows = [{**r, "eligibilityState": "UNSURE"} for r in self.rows()]
        m = metrics(rows)
        self.assertEqual(m["suitableRetention"], 1)
        self.assertEqual(m["coverage"], 0)
        self.assertIsNone(m["rejectPrecision"])
        self.assertFalse(quality_pass(m))

    def test_missing_latency_and_failed_backend_cannot_pass(self):
        rows = self.rows()
        rows[0].update(error="timeout", latencyMs=None)
        self.assertEqual(gate(metrics(rows), self.runtime())["status"], "not-eligible")

    def test_retention_counts_suitable_unsure_as_retained(self):
        rows = self.rows()
        rows[0]["eligibilityState"] = "UNSURE"
        rows[1]["eligibilityState"] = "REJECT"
        m = metrics(rows)
        self.assertEqual(m["falseRejectsOfSuitable"], 1)
        self.assertEqual(m["suitableRetention"], 39 / 40)
        self.assertEqual(m["rejectPrecision"], 40 / 41)

    def test_health_monitor_rejects_external_urls(self):
        for url in ("https://example.com/health", "http://127.0.0.1@example.com", "http://user:pass@localhost"):
            with self.assertRaises(ValueError):
                HealthMonitor(url)


class ProcessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import psutil  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("psutil is installed in the isolated benchmark environment")

    def test_timeout_kills_the_worker(self):
        engine = InferenceProcess("fake", 1, .15, 2 * 1024**3, target=sleeping_worker)
        try:
            self.assertEqual(engine.score(case())["error"], "timeout")
            self.assertFalse(engine.process.is_alive())
            self.assertEqual(engine.score(case())["error"], "timeout")
        finally:
            engine.close()

    def test_unavailable_model_does_not_fall_back_to_network(self):
        engine = InferenceProcess("fake", 1, 1, 2 * 1024**3, target=broken_worker)
        try:
            self.assertIn("backend_unavailable", engine.score(case())["error"])
        finally:
            engine.close()

    def test_accelerator_memory_is_not_hidden_by_low_rss(self):
        engine = InferenceProcess("fake", 1, 1, 2 * 1024**3, target=accelerator_worker)
        try:
            self.assertEqual(engine.score(case())["error"], "memory_limit")
            self.assertGreater(engine.accounted_peak, 2 * 1024**3)
            self.assertFalse(engine.process.is_alive())
        finally:
            engine.close()


if __name__ == "__main__":
    unittest.main()
