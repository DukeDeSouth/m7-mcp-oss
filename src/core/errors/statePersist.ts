/**
 * B1 persist error — failed write must fail the tool call (STATE-1).
 * Reused by MEM-3, CYC-7 per FIX_PLAN.
 */
export class StatePersistError extends Error {
  readonly code = 'STATE_PERSIST_FAILED' as const;

  constructor(
    readonly filePath: string,
    causeMessage: string
  ) {
    super(`Failed to persist state to ${filePath}: ${causeMessage}`);
    this.name = 'StatePersistError';
  }
}
