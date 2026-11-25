## ADDED Requirements

### Requirement: Doubao Work local connector queue execution

The Runner MUST route product_id doubao-work to a product-specific adapter when entry_id doubao-work-connector-queue is selected. The adapter MUST publish a uniquely identified task through the existing local queue contract and wait only for a matching claim and result.

#### Scenario: Claim, artifact submission, and independent text verification

- **WHEN** the Runner is started with isolated queue/workspace roots and a synthetic case declaring one input and one text artifact
- **AND** the user starts a Doubao Work conversation with the local connector enabled
- **THEN** the connector MUST expose the task with a matching run ID
- **AND** the Runner MUST archive the submitted artifact and connector boundary evidence under the same run
- **AND** the independent verifier MUST compare the declared artifact bytes with the evaluator-side expected file
- **AND** the recorded product identity MUST remain doubao-work

### Requirement: Safe queue execution status

The Runner MUST NOT automatically repeat a claim, republish a timed-out task, or infer task correctness from the agent's submission summary. A timeout or mismatch MUST preserve evidence and use a new run ID for any later retry.

#### Scenario: Empty queue or timeout

- **WHEN** no task is available, or no matching result arrives before timeout
- **THEN** the run MUST record the observed empty/timeout state and MUST NOT claim successful task completion.
