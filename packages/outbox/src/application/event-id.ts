export interface DeriveOutboxEventIdInput {
  readonly source: string;
  readonly type: string;
  readonly tenantId: string | null;
  readonly occurrenceId: string;
}

export function deriveOutboxEventId(input: DeriveOutboxEventIdInput): string {
  const tenantPart = input.tenantId ?? 'platform';
  return `${input.source}:${input.type}:${tenantPart}:${input.occurrenceId}`;
}
