export type MemoryLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface ConsolidationRecord {
  id: string;
  level: MemoryLevel;
  content: string;
  needsConsolidation?: boolean;
  consolidatedFrom?: string;
  confidence: number;
  source: string;
}

export const CONSOLIDATED_ID_SUFFIX = '__cL2';

export const CONSOLIDATION_MIN_LEVEL: MemoryLevel = 'L2';

const RATIONALE_HEADER = '## Decision Rationale';
const CITATIONS_HEADER = '## Citations';

export interface ConsolidationParseResult {
  rationale: string;
  citationIds: string[];
}

export interface ConsolidationValidationResult {
  valid: boolean;
  errors: string[];
}

export function requiresConsolidation(targetLevel: MemoryLevel): boolean {
  const order: MemoryLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4'];
  return order.indexOf(targetLevel) >= order.indexOf(CONSOLIDATION_MIN_LEVEL);
}

export function makeConsolidatedRecordId(sourceId: string, targetLevel: MemoryLevel = 'L2'): string {
  if (targetLevel === 'L2') {
    return `${sourceId}${CONSOLIDATED_ID_SUFFIX}`;
  }
  return `${sourceId}__c${targetLevel}`;
}

export function buildConsolidationPlaceholder(sourceId: string, originalPreview: string): string {
  const preview = originalPreview.replace(/\s+/g, ' ').trim().slice(0, 120);
  return [
    '# Consolidation Pending',
    '',
    `Source record: \`${sourceId}\` (full content retained at lower tier)`,
    '',
    'This L2 entry awaits host-mediated consolidation.',
    '',
    `Original preview: ${preview}${originalPreview.length > 120 ? '…' : ''}`,
    '',
    RATIONALE_HEADER,
    '(pending — host model must fill on consolidate)',
    '',
    CITATIONS_HEADER,
    '- (pending)',
  ].join('\n');
}

export function buildConsolidationInstruction(
  consolidated: ConsolidationRecord,
  original: ConsolidationRecord | null
): string {
  const originalNote = original
    ? `Original \`${original.id}\` stays at **${original.level}** with full content (${original.content.length} chars).`
    : `Original record \`${consolidated.consolidatedFrom ?? 'unknown'}\` remains at lower tier.`;

  return [
    '## Consolidation Required',
    '',
    `Record \`${consolidated.id}\` was promoted to **${consolidated.level}** and needs consolidation.`,
    originalNote,
    '',
    'Compress the knowledge into a shorter L2 summary. Required markdown structure:',
    '',
    '```markdown',
    RATIONALE_HEADER,
    '<condensed decision rationale — why this matters>',
    '',
    CITATIONS_HEADER,
    '- <source-record-id>',
    '- <another-id-if-needed>',
    '```',
    '',
    'Rules:',
    '- Consolidated content MUST be shorter than the original',
    '- Citations must reference existing memory record IDs',
    '- Do NOT change confidence or source — MCP preserves metadata',
    '',
    'Submit via: `mcp_m7_memory action="consolidate" id="<L2-id>" content="<markdown>"`',
  ].join('\n');
}

export function parseConsolidatedContent(content: string): ConsolidationParseResult | null {
  const rationaleIdx = content.indexOf(RATIONALE_HEADER);
  const citationsIdx = content.indexOf(CITATIONS_HEADER);

  if (rationaleIdx === -1 || citationsIdx === -1 || citationsIdx <= rationaleIdx) {
    return null;
  }

  const rationale = content
    .slice(rationaleIdx + RATIONALE_HEADER.length, citationsIdx)
    .trim();

  const citationsBlock = content.slice(citationsIdx + CITATIONS_HEADER.length);
  const citationIds: string[] = [];
  for (const line of citationsBlock.split('\n')) {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    const token = (bullet?.[1] ?? trimmed).replace(/^`|`$/g, '').trim();
    if (!token || token.startsWith('(') || token === 'pending') {
      continue;
    }
    citationIds.push(token);
  }

  return { rationale, citationIds };
}

export function validateConsolidation(
  original: ConsolidationRecord | null,
  consolidated: ConsolidationRecord,
  proposedContent: string,
  recordExists: (id: string) => boolean
): ConsolidationValidationResult {
  const errors: string[] = [];

  if (!consolidated.needsConsolidation) {
    errors.push('record does not need consolidation');
  }

  const parsed = parseConsolidatedContent(proposedContent);
  if (!parsed) {
    errors.push(`content must include "${RATIONALE_HEADER}" and "${CITATIONS_HEADER}" sections`);
  } else {
    if (parsed.rationale.length < 10) {
      errors.push('decision rationale too short (min 10 chars)');
    }
    if (parsed.citationIds.length === 0) {
      errors.push('at least one citation ID required');
    }
    for (const citeId of parsed.citationIds) {
      if (!recordExists(citeId)) {
        errors.push(`citation ID not found: ${citeId}`);
      }
    }
  }

  if (original) {
    if (proposedContent.length >= original.content.length) {
      errors.push(
        `consolidated content must be shorter than original (${proposedContent.length} >= ${original.content.length})`
      );
    }
  } else if (proposedContent.length >= consolidated.content.length) {
    errors.push('consolidated content must be shorter than pending placeholder');
  }

  if (/^\s*#\s*Consolidation Pending/i.test(proposedContent)) {
    errors.push('content still looks like pending placeholder');
  }

  return { valid: errors.length === 0, errors };
}
