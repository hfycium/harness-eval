"""Score one SpreadsheetBench test instance with its official comparator.

This reports a single-instance smoke result. It never reports a benchmark-level
soft/hard score, which requires all three test cases per task.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from datetime import datetime, timezone


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", required=True, type=Path)
    parser.add_argument("--answer", required=True, type=Path)
    parser.add_argument("--recalculated-output", required=True, type=Path)
    parser.add_argument("--evaluator", required=True, type=Path,
                        help="Path to the pinned official evaluation/evaluation.py")
    parser.add_argument("--evaluator-revision", required=True,
                        help="Git commit or release identifier for the evaluator source")
    parser.add_argument("--output", required=True, type=Path)
    options = parser.parse_args()

    case = json.loads(options.case.read_text(encoding="utf-8"))
    evaluator_path = options.evaluator.resolve(strict=True)
    if evaluator_path.name != "evaluation.py" or evaluator_path.parent.name != "evaluation":
        parser.error("--evaluator must be the official evaluation/evaluation.py")
    for name, file in (("answer", options.answer), ("recalculated output", options.recalculated_output)):
        if not file.is_file():
            parser.error(f"{name} file does not exist: {file}")

    spec = importlib.util.spec_from_file_location("spreadsheetbench_official_evaluation", evaluator_path)
    if spec is None or spec.loader is None:
        parser.error("Could not load the official evaluator module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    passed, detail = module.compare_workbooks(
        str(options.answer), str(options.recalculated_output),
        case["instruction_type"], case["answer_position"]
    )
    if detail:
        status = "blocked"
        reason = "official_comparator_error"
        exit_code = 2
    else:
        status = "passed" if passed else "failed"
        reason = "official_single_case_comparison"
        exit_code = 0 if passed else 1

    result = {
        "record_version": "0.2",
        "scored_at": datetime.now(timezone.utc).isoformat(),
        "case_id": case["case_id"],
        "dataset_task_id": case["dataset_task_id"],
        "scope": "single_test_case_smoke",
        "status": status,
        "reason": reason,
        "benchmark_score": None,
        "score_explanation": "One of three official test cases was compared; benchmark soft/hard scores are not computed.",
        "evaluator": {
            "revision": options.evaluator_revision,
            "path": str(evaluator_path),
            "sha256": sha256(evaluator_path),
        },
        "answer": {"path": str(options.answer), "sha256": sha256(options.answer)},
        "output": {"path": str(options.recalculated_output), "sha256": sha256(options.recalculated_output)},
        "detail": detail,
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
