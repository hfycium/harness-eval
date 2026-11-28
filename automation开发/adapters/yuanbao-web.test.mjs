import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { YuanbaoWebAdapter, yuanbaoArtifactFormat, yuanbaoCapabilityAdmission } from './yuanbao-web.mjs';

const hash = async path => createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
test('only the reviewed frozen file case is admitted by capability mapping', async () => {
  const evidence = { caseSha256: await hash('../../cases/smoke/yuanbao-web-text/case.json'), promptSha256: await hash('../../cases/smoke/yuanbao-web-text/prompt.md'), inputSha256: await hash('../../cases/smoke/yuanbao-web-text/input.txt') };
  assert.equal(yuanbaoCapabilityAdmission(evidence).status, 'ready');
  for (const field of Object.keys(evidence)) assert.equal(yuanbaoCapabilityAdmission({ ...evidence, [field]: 'changed' }).status, 'not_admitted');
  assert.equal(yuanbaoCapabilityAdmission(undefined).status, 'not_admitted');
});
test('unknown TXT cases and declared command capabilities remain blocked', () => {
  const adapter = new YuanbaoWebAdapter();
  const task = { case_id: 'other', capabilities: ['native_command'], input_destination: 'input.txt', expected_artifacts: ['result.txt'] };
  const result = adapter.preflight({ entry_id: 'yuanbao-web-playwright' }, { task, interactive: true, timeoutSeconds: 900, taskEvidence: {} });
  assert.equal(result.status, 'not_admitted');
  assert.ok(result.missing.includes('task_capability_not_reviewed'));
});
test('reviewed XLSX case is bound to all three exact hashes and matching artifact format', async () => {
  const evidence = { caseSha256: await hash('../../cases/smoke/yuanbao-web-xlsx/case.json'), promptSha256: await hash('../../cases/smoke/yuanbao-web-xlsx/prompt.md'), inputSha256: await hash('../../cases/public/spreadsheetbench-59196/inputs/sample_data_200/spreadsheet/59196/1_59196_input.xlsx') };
  const admission = yuanbaoCapabilityAdmission(evidence);
  assert.equal(admission.capability, 'xlsx_file_roundtrip');
  for (const field of Object.keys(evidence)) assert.equal(yuanbaoCapabilityAdmission({ ...evidence, [field]: 'changed' }).status, 'not_admitted');
  assert.equal(yuanbaoArtifactFormat(['outputs/result.xlsx'], admission.capability), 'xlsx');
  assert.equal(yuanbaoArtifactFormat(['outputs/result.txt'], admission.capability), null);
  assert.equal(yuanbaoArtifactFormat(['outputs/result.xlsx'], 'unknown'), null);
  assert.equal(yuanbaoArtifactFormat(['a.xlsx', 'b.xlsx'], admission.capability), null);
});
