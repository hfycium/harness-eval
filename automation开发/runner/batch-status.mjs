export function completedBatchStatus(jobs) {
  if (jobs.some(job => job.status === 'failed')) return 'completed_with_failures';
  if (jobs.some(job => job.status === 'needs_review')) return 'completed_needs_review';
  return jobs.every(job => job.status === 'completed') ? 'completed' : 'needs_reconciliation';
}
