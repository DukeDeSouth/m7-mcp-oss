/**
 * Input Analyzer — Extracts structural signals from raw text.
 *
 * Non-neural analysis: regex, normalization, encoding detection.
 * Feeds into TRAP detector discrimination rules.
 */

import type { InputAnalysis } from './types.js';

const PERSONA_PATTERNS: RegExp[] = [
  /you are (now\s)?/i,
  /act as (if )?(you )?(were |are )?/i,
  /pretend (to be|you'?re)/i,
  /from (now|this point) (on|forward)/i,
  /switch to .+ mode/i,
  /your new (name|identity|role) is/i,
  /you'?re no longer/i,
  /forget (that )?you'?re/i,
  /you have been (re)?programmed/i,
  /entering .+ mode/i,
];

const CONSTRAINT_REMOVAL_PATTERNS: RegExp[] = [
  /ignore (your |previous |all )?(instructions|programming|rules|guidelines|training)/i,
  /no (restrictions|limits|boundaries|rules|constraints|filters)/i,
  /without (any )?(restrictions|limits|filters|censorship|boundaries|safety)/i,
  /bypass (your |the )?(safety|content|ethical|filter)/i,
  /disable (your |the )?(safety|filter|moderation|guidelines)/i,
  /you (can|are able to|are free to) (do|say) anything/i,
  /remove (all |your )?(restrictions|limitations|guardrails)/i,
  /disregard (your |all |any )?(safety|rules|training)/i,
  /override (your |the )?(safety|content|programming)/i,
  /unfiltered/i,
  /jailbreak/i,
  /no ethical/i,
];

const CAPABILITY_EXPANSION_PATTERNS: RegExp[] = [
  /you can (now )?do anything/i,
  /unlimited (access|power|capability)/i,
  /no (topic|subject) is off[- ]?limits/i,
  /answer (any|every)(thing| question)/i,
  /nothing is (off[- ]?limits|forbidden|restricted)/i,
  /you have no (limits|boundaries)/i,
  /unrestricted (access|mode)/i,
];

const AUTHORITY_BYPASS_PATTERNS: RegExp[] = [
  /openai (has )?(authorized|approved|allowed)/i,
  /anthropic (has )?(authorized|approved|allowed)/i,
  /this is (a |an )?(authorized|approved) (test|request)/i,
  /i('m| am) (a |an |the )?(developer|admin|researcher|engineer) (at|from|of)/i,
  /developer mode/i,
  /debug mode/i,
  /maintenance mode/i,
  /testing mode/i,
  /admin override/i,
  /special access/i,
];

const HYPOTHETICAL_PATTERNS: RegExp[] = [
  /if you (were|could|had to|wanted to)/i,
  /hypothetically/i,
  /in theory/i,
  /just for (fun|educational|academic|research)/i,
  /let'?s say (you|someone|a person)/i,
  /imagine (you|that|if)/i,
  /for (educational|research|academic|learning) purposes/i,
  /what would happen if/i,
  /purely (theoretical|hypothetical|academic)/i,
];

const COMPLETION_ATTACK_PATTERNS: RegExp[] = [
  /continue (this|the following|writing|from)/i,
  /complete (this|the following|the text)/i,
  /finish (this|the following|writing)/i,
  /here'?s the (beginning|start|first part)/i,
  /pick up where .* left off/i,
];

export class InputAnalyzer {
  analyze(input: string): InputAnalysis {
    const normalized = this.normalize(input);
    const tokens = normalized.split(/\s+/).filter(Boolean);

    return {
      raw: input,
      normalized,
      tokens,
      hasPersonaInstruction: this.matchesAny(normalized, PERSONA_PATTERNS),
      hasConstraintRemoval: this.matchesAny(normalized, CONSTRAINT_REMOVAL_PATTERNS),
      hasCapabilityExpansion: this.matchesAny(normalized, CAPABILITY_EXPANSION_PATTERNS),
      hasEncodedContent: this.detectEncoding(input),
      hasAuthorityBypss: this.matchesAny(normalized, AUTHORITY_BYPASS_PATTERNS),
      hasHypotheticalFrame: this.matchesAny(normalized, HYPOTHETICAL_PATTERNS),
      hasCompletionAttack: this.matchesAny(normalized, COMPLETION_ATTACK_PATTERNS),
      encodingType: this.identifyEncodingType(input),
      decodedContent: this.tryDecode(input),
      perplexityEstimate: this.estimatePerplexity(input),
      language: 'en',
    };
  }

  private normalize(text: string): string {
    return text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private matchesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some(p => p.test(text));
  }

  private detectEncoding(text: string): boolean {
    if (/[A-Za-z0-9+/]{30,}={0,2}/.test(text)) return true;
    if (/\\x[0-9a-f]{2}/i.test(text)) return true;
    if (/\\u[0-9a-f]{4}/i.test(text)) return true;
    if (/&#x?[0-9a-f]+;/i.test(text)) return true;
    if (this.isRot13Likely(text)) return true;
    return false;
  }

  private identifyEncodingType(text: string): InputAnalysis['encodingType'] {
    if (/[A-Za-z0-9+/]{30,}={0,2}/.test(text)) return 'base64';
    if (/\\x[0-9a-f]{2}/i.test(text)) return 'hex';
    if (/\\u[0-9a-f]{4}/i.test(text) || /&#x?[0-9a-f]+;/i.test(text)) return 'unicode';
    if (this.isRot13Likely(text)) return 'rot13';
    return undefined;
  }

  private isRot13Likely(text: string): boolean {
    const rot13Words = ['guvf', 'gung', 'jvgu', 'sebz', 'lbhe', 'unir', 'gurl'];
    const lower = text.toLowerCase();
    const matches = rot13Words.filter(w => lower.includes(w));
    return matches.length >= 2;
  }

  private tryDecode(text: string): string | undefined {
    const b64Match = text.match(/[A-Za-z0-9+/]{30,}={0,2}/);
    if (b64Match) {
      try {
        const decoded = Buffer.from(b64Match[0], 'base64').toString('utf-8');
        if (/[\x20-\x7e]{10,}/.test(decoded)) {
          return decoded;
        }
      } catch { /* not valid base64 */ }
    }

    const hexMatch = text.match(/(\\x[0-9a-f]{2})+/gi);
    if (hexMatch) {
      try {
        const decoded = hexMatch[0].replace(/\\x/g, '').replace(/../g, (h) =>
          String.fromCharCode(parseInt(h, 16))
        );
        if (/[\x20-\x7e]{5,}/.test(decoded)) return decoded;
      } catch { /* ignore */ }
    }

    return undefined;
  }

  private estimatePerplexity(text: string): InputAnalysis['perplexityEstimate'] {
    const words = text.split(/\s+/);
    if (words.length === 0) return 'normal';

    const avgWordLen = words.reduce((s, w) => s + w.length, 0) / words.length;
    const nonAsciiRatio = (text.replace(/[\x00-\x7f]/g, '').length) / text.length;
    const maxWordLen = Math.max(...words.map(w => w.length));

    if (maxWordLen > 40 || nonAsciiRatio > 0.3 || avgWordLen > 20) return 'anomalous';
    if (maxWordLen > 25 || nonAsciiRatio > 0.15 || avgWordLen > 12) return 'suspicious';

    // Detect repetitive gibberish (GCG-style suffixes)
    if (text.length > 200) {
      const tail = text.slice(-Math.floor(text.length * 0.6));
      const uniqueChars = new Set(tail.replace(/\s/g, '')).size;
      const tailLen = tail.replace(/\s/g, '').length;
      const charDiversity = uniqueChars / Math.min(tailLen, 100);
      // Very low diversity = repetitive pattern (e.g., "abcabc..." repeated)
      if (charDiversity < 0.15 && tailLen > 100) return 'anomalous';
      // Very long words dominating the tail
      const tailWords = tail.split(/\s+/);
      const longWords = tailWords.filter(w => w.length > 20);
      if (longWords.length >= 3) return 'anomalous';
    }

    return 'normal';
  }
}
