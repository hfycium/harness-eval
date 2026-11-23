"""Independently check one archived run and optionally compare one workbook."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def digest(file: Path) -> str:
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read_json(file: Path) -> dict:
    data = json.loads(file.read_text(encoding='utf-8'))
    if not isinstance(data, dict):
        raise ValueError(f'{file.name} is not a JSON object')
    return data


def inside(parent: Path, child: Path) -> bool:
    return child.is_relative_to(parent)


def archive_path(run_dir: Path, value: str) -> Path:
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('invalid archive path')
    relative = Path(value)
    if relative.is_absolute() or any(p in ('..', '.') for p in relative.parts):
        raise ValueError('invalid archive path')
    target = (run_dir / relative).resolve(strict=True)
    if not inside(run_dir / 'artifacts', target) or not target.is_file():
        raise ValueError('artifact outside archive or not a file')
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path, help='New evaluation directory outside the original run')
    parser.add_argument('--artifact', help='Required artifact path as declared in case.json')
    parser.add_argument('--text-expected-file', type=Path, help='Evaluator-side exact expected bytes for a synthetic text task')
    parser.add_argument('--answer', type=Path)
    parser.add_argument('--recalculated-output', type=Path)
    parser.add_argument('--recalculated-from-sha256', help='Operator-declared SHA-256 of source archived artifact')
    parser.add_argument('--recalculation-method', help='Operator-described software/version and method')
    parser.add_argument('--evaluator', type=Path)
    parser.add_argument('--evaluator-revision')
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()
    if args.timeout < 1:
        parser.error('--timeout must be positive')
    if args.text_expected_file and any((args.answer, args.recalculated_output, args.recalculated_from_sha256, args.recalculation_method, args.evaluator, args.evaluator_revision)):
        parser.error('text verification and SpreadsheetBench scoring are separate invocations')
    run_dir = args.run_dir.resolve(strict=True)
    output_dir = args.output_dir.resolve()
    if inside(run_dir, output_dir) or inside(output_dir, run_dir):
        parser.error('output directory must be separate from the original run')
    output_dir.mkdir(parents=True, exist_ok=False)
    verification = {
        'record_version': '0.1', 'checked_at': datetime.now(timezone.utc).isoformat(),
        'run_id': None, 'case_id': None, 'archive_status': 'blocked',
        'task_correctness': 'unknown', 'checks': [], 'artifacts': [],
        'scope': 'archive_integrity_only', 'trace_sha256': None,
    }
    score = {'record_version': '0.1', 'scope': 'single_test_case_smoke',
             'status': 'blocked', 'benchmark_score': None, 'reason': 'not_requested'}
    try:
        run_path, trace_path, case_path = (run_dir / name for name in ('run.json', 'trace.json', 'case.json'))
        run, trace, case = (read_json(file) for file in (run_path, trace_path, case_path))
        verification['run_id'], verification['case_id'] = run.get('run_id'), case.get('case_id')
        verification['trace_sha256'] = digest(trace_path)
        verification['run_sha256'] = digest(run_path)
        verification['case_sha256'] = digest(case_path)
        if not run.get('run_id') or run.get('run_id') != trace.get('run_id'):
            raise ValueError('run_id_mismatch')
        if not case.get('case_id') or run.get('task', {}).get('case_id') != case['case_id'] or trace.get('task', {}).get('case_id') != case['case_id']:
            raise ValueError('case_id_mismatch')
        if run.get('task', {}).get('case_sha256') != digest(case_path):
            raise ValueError('case_sha256_mismatch')
        if trace.get('task', {}).get('case_sha256') != digest(case_path):
            raise ValueError('trace_case_sha256_mismatch')
        if run.get('execution', {}).get('status') != 'completed' or trace.get('execution', {}).get('status') != 'completed':
            raise ValueError('execution_not_completed')
        expected = [x if isinstance(x, str) else x.get('path') for x in case.get('expected_artifacts', []) if isinstance(x, str) or x.get('required', True)]
        if not expected or len(expected) != len(set(expected)):
            raise ValueError('missing_or_duplicate_required_artifacts')
        entries = run.get('artifacts', [])
        if entries != trace.get('artifacts'):
            raise ValueError('trace_artifact_mismatch')
        for name in expected:
            matches = [a for a in entries if a.get('path') == name]
            if len(matches) != 1 or matches[0].get('collection_status') != 'collected':
                raise ValueError(f'artifact_not_collected:{name}')
            entry = matches[0]
            file = archive_path(run_dir, entry['evidence_path'])
            actual = digest(file)
            if actual != entry.get('sha256'):
                raise ValueError(f'artifact_sha256_mismatch:{name}')
            verification['artifacts'].append({'path': name, 'evidence_path': entry['evidence_path'], 'sha256': actual, 'size_bytes': file.stat().st_size})
        verification['archive_status'] = 'passed'
        verification['checks'].append('run_trace_case_and_artifact_hashes_match')
        score['reason'] = 'scoring_dependencies_not_supplied'
        selected = args.artifact or (expected[0] if len(expected) == 1 else None)
        if args.text_expected_file:
            if selected not in expected:
                raise ValueError('selected_artifact_not_required')
            text_expectation = args.text_expected_file.resolve(strict=True)
            if not text_expectation.is_file() or inside(run_dir, text_expectation) or inside(output_dir, text_expectation):
                raise ValueError('invalid_text_expectation')
            item = next(a for a in verification['artifacts'] if a['path'] == selected)
            actual_file = archive_path(run_dir, item['evidence_path'])
            expected_bytes = text_expectation.read_bytes()
            actual_bytes = actual_file.read_bytes()
            actual_sha256 = hashlib.sha256(actual_bytes).hexdigest()
            if actual_sha256 != item['sha256']:
                raise ValueError('artifact_changed_during_verification')
            verification['task_correctness'] = 'passed' if actual_bytes == expected_bytes else 'failed'
            verification['scope'] = 'archive_integrity_and_text_exact'
            verification['text_check'] = {
                'artifact_path': selected, 'actual_sha256': actual_sha256,
                'expected_sha256': hashlib.sha256(expected_bytes).hexdigest(),
                'expected_size_bytes': len(expected_bytes), 'actual_size_bytes': len(actual_bytes),
                'method': 'exact_bytes', 'status': verification['task_correctness'],
            }
            score['reason'] = 'synthetic_task_not_scored'
        dependencies = [selected, args.answer, args.recalculated_output, args.recalculated_from_sha256, args.recalculation_method, args.evaluator, args.evaluator_revision]
        if all(dependencies):
            if selected not in expected:
                raise ValueError('selected_artifact_not_required')
            artifact = next(a for a in verification['artifacts'] if a['path'] == selected)
            if args.recalculated_from_sha256 != artifact['sha256']:
                raise ValueError('recalculation_source_sha256_mismatch')
            answer, recalculated, evaluator = (p.resolve(strict=True) for p in (args.answer, args.recalculated_output, args.evaluator))
            for p in (answer, recalculated, evaluator):
                if not p.is_file() or inside(output_dir, p):
                    raise ValueError('invalid_scoring_dependency')
            score.update({'reason': 'evaluator_not_completed', 'run_id': run['run_id'], 'case_id': case['case_id'],
                          'artifact_sha256': artifact['sha256'], 'recalculated_output_sha256': digest(recalculated),
                          'answer_sha256': digest(answer), 'evaluator_sha256': digest(evaluator),
                          'evaluator_revision': args.evaluator_revision, 'recalculation_method': args.recalculation_method,
                          'recalculation_source': 'operator_declared_not_independently_verified'})
            raw_score = output_dir / 'score-raw.json'
            command = [sys.executable, str(Path(__file__).with_name('score-spreadsheetbench.py')), '--case', str(case_path),
                       '--answer', str(answer), '--recalculated-output', str(recalculated), '--evaluator', str(evaluator),
                       '--evaluator-revision', args.evaluator_revision, '--output', str(raw_score)]
            try:
                proc = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=args.timeout, check=False)
                (output_dir / 'scorer-stdout.log').write_text(proc.stdout, encoding='utf-8')
                (output_dir / 'scorer-stderr.log').write_text(proc.stderr, encoding='utf-8')
                score['scorer_exit_code'] = proc.returncode
                raw = read_json(raw_score) if raw_score.is_file() else {}
                result_codes = {'passed': 0, 'failed': 1, 'blocked': 2}
                raw_status = raw.get('status')
                if raw.get('case_id') == case['case_id'] and raw_status in result_codes and proc.returncode == result_codes[raw_status] and raw.get('benchmark_score') is None:
                    score.update({'status': raw_status, 'reason': raw.get('reason', 'official_single_case_comparison'), 'raw_score_ref': 'score-raw.json'})
                    verification['task_correctness'] = raw_status if raw_status in ('passed', 'failed') else 'unknown'
                    verification['scope'] = 'archive_integrity_and_spreadsheetbench_single_case'
                    verification['spreadsheetbench_check'] = {'status': raw_status, 'reason': score['reason'], 'evaluator_revision': args.evaluator_revision}
                else:
                    score['reason'] = 'evaluator_error_or_invalid_result'
            except subprocess.TimeoutExpired:
                score['reason'] = 'evaluator_timeout'
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        verification['checks'].append(f'blocked:{type(error).__name__}:{error}')
        if verification['archive_status'] == 'passed':
            score['reason'] = 'invalid_scoring_input'
        else:
            score['reason'] = 'archive_check_blocked'
    (output_dir / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output_dir / 'score.json').write_text(json.dumps(score, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'run_id': verification['run_id'], 'archive_status': verification['archive_status'], 'score_status': score['status'], 'output_dir': str(output_dir)}, ensure_ascii=False))
    return 0 if verification['archive_status'] == 'passed' and verification['task_correctness'] != 'failed' and score['status'] != 'failed' and (not args.text_expected_file or verification['task_correctness'] == 'passed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
