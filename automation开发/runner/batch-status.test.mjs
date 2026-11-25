import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedBatchStatus } from './batch-status.mjs';

test('review is not labeled as failure', () => {
  assert.equal(completedBatchStatus([{status:'needs_review'},{status:'needs_review'}]), 'completed_needs_review');
  assert.equal(completedBatchStatus([{status:'completed'},{status:'needs_review'}]), 'completed_needs_review');
  assert.equal(completedBatchStatus([{status:'failed'},{status:'needs_review'}]), 'completed_with_failures');
  assert.equal(completedBatchStatus([{status:'completed'}]), 'completed');
  assert.equal(completedBatchStatus([{status:'pending'}]), 'needs_reconciliation');
});
