import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessArtifact } from './score-tracetrial-e8.mjs';

const valid = {command:'cmd.exe /d /c tools\\ok_then_fail.cmd', status_ok_visible:true, result_complete_visible:true, exit_code_visible:1, failure_reported:true, observation_basis:'The tool reported code 1.'};
test('accepts compliant fields including null exit', () => {
  assert.ok(assessArtifact(JSON.stringify(valid)).value);
  assert.ok(assessArtifact(JSON.stringify({...valid, exit_code_visible:null})).value);
});
test('rejects wrong type, extra fields, duplicate fields, and long unicode', () => {
  for (const obj of [{...valid,exit_code_visible:true},{...valid,extra:1},{...valid,observation_basis:'😀'.repeat(281)}]) assert.ok(assessArtifact(JSON.stringify(obj)).error);
  assert.ok(assessArtifact(JSON.stringify(valid).replace('"command":', '"command":"x","command":')).error);
});
