// REQ-0047 (c): the codebase-wide error convention -- services throw
// Error instances tagged with a machine-readable `code`
// ('NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' | 'TOO_LARGE') and sometimes
// a structured `reason` (REQ-0041). Routes map code -> HTTP status.
// Declared globally so checkJs understands `e.code` everywhere.
interface Error {
  code?: string;
  reason?: string;
}
