import json
import re
import unittest

from laya_backend import checked_sequence, prepare_chunks


class WordTokenizer:
    mask_token, mask_token_id, cls_token_id, sep_token_id = "[MASK]", 1, 2, 3

    def __init__(self):
        self.vocabulary = {}

    def __call__(self, text, add_special_tokens=False):
        return {"input_ids": [self.vocabulary.setdefault(word, len(self.vocabulary) + 4)
                              for word in re.findall(r"\w+|[^\w\s]", text)]}


class LayaInputTests(unittest.TestCase):
    def case(self, **changes):
        return {"id": "test", "title": "Wohnung", "description": "Kein WBS erforderlich.",
                "preferences": [], "expected": "REJECT", "rationale": "LABEL SECRET", **changes}

    def test_long_input_keeps_every_word_and_tail(self):
        words = [f"word{i}" for i in range(1200)] + ["WBS", "erforderlich."]
        questions, chunks = prepare_chunks(self.case(description=" ".join(words)), WordTokenizer(), 256, 192)
        self.assertGreater(len(chunks), 1)
        seen = set()
        for state, sequences in chunks:
            seen.update(state["listing_text"].split())
            for ids, markers in sequences.values():
                self.assertLessEqual(len(ids), 256)
                self.assertEqual(len(markers), 3)
                self.assertTrue(all(ids[position] == 1 for position in markers))
        self.assertEqual(seen, set(words))
        self.assertTrue(chunks[-1][0]["listing_text"].endswith("WBS erforderlich."))
        self.assertNotIn("LABEL SECRET", json.dumps([questions, chunks]))
        self.assertNotIn("expected", json.dumps([questions, chunks]))

    def test_question_and_option_truncation_fail_explicitly(self):
        tok = WordTokenizer()
        q = {"instructions": "question " * 200, "criteria": {"yes": "fine", "no": "bad", "unknown": "unclear"}}
        with self.assertRaisesRegex(ValueError, "question_too_long"):
            checked_sequence(tok, {}, q, 1024, 192)
        q["instructions"] = "Short question"
        q["criteria"]["yes"] = "option " * 49
        with self.assertRaisesRegex(ValueError, "question_too_long"):
            checked_sequence(tok, {}, q, 1024, 192)

    def test_oversized_preferences_fail_instead_of_disappearing(self):
        with self.assertRaisesRegex(ValueError, "input_too_long"):
            prepare_chunks(self.case(preferences=["ascensore " * 500]), WordTokenizer(), 256, 192)

    def test_exact_token_limit_and_preferences(self):
        tok = WordTokenizer()
        questions, chunks = prepare_chunks(self.case(preferences=["Voglio un ascensore"]), tok, 1024, 192)
        self.assertIn("preferences", questions)
        state, sequences = chunks[0]
        self.assertEqual(state["additional_mandatory_preferences"], ["Voglio un ascensore"])
        key = next(iter(questions))
        size = len(sequences[key][0])
        self.assertEqual(checked_sequence(tok, state, questions[key], size, 192), sequences[key])
        self.assertIsNone(checked_sequence(tok, state, questions[key], size - 1, 192))


if __name__ == "__main__":
    unittest.main()
