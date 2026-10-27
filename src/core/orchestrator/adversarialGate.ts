export interface AdversarialParseResult {
  present: boolean;
  hasCounterArgs: boolean;
  hasRebuttal: boolean;
  hasReframingCheck: boolean;
}

const ADVERSARIAL_HEADING = /^##\s+Adversarial Review/im;

function extractAdversarialSection(artifact: string): string {
  const match = artifact.match(ADVERSARIAL_HEADING);
  if (!match || match.index === undefined) {
    return '';
  }

  const start = match.index;
  const rest = artifact.slice(start + match[0].length);
  const nextHeading = rest.search(/^##\s+/m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

export function parseAdversarialSection(artifact: string): AdversarialParseResult {
  const section = extractAdversarialSection(artifact);
  if (!section.trim()) {
    return {
      present: false,
      hasCounterArgs: false,
      hasRebuttal: false,
      hasReframingCheck: false,
    };
  }

  const lower = section.toLowerCase();
  return {
    present: true,
    hasCounterArgs:
      /counter-argument|counter argument|опроверж|аргумент.*против|strongest reason.*wrong/i.test(section),
    hasRebuttal: /rebuttal|rebut|ответ|refutation|oprov/i.test(section),
    hasReframingCheck:
      /reframing|переобъясн|inconvenient fact|неудобн/i.test(section) ||
      lower.includes('reframe'),
  };
}

export function generateAdversarialGateExtension(artifact: string): string {
  const parsed = parseAdversarialSection(artifact);
  const missing: string[] = [];

  if (!parsed.present) {
    missing.push('## Adversarial Review section missing from solution artifact');
  } else {
    if (!parsed.hasCounterArgs) {
      missing.push('2–3 counter-arguments against the plan');
    }
    if (!parsed.hasRebuttal) {
      missing.push('rebuttal / response to each counter-argument');
    }
    if (!parsed.hasReframingCheck) {
      missing.push('reframing check (Fable 5 signal)');
    }
  }

  if (missing.length > 0) {
    return `## Adversarial Review Gate

⚠️ **Incomplete adversarial review** — soft warning (cycle not blocked):
${missing.map(m => `- ${m}`).join('\n')}

Before continuing, add \`## Adversarial Review\` to the solution artifact with:
1. **Counter-arguments** — 2–3 strongest reasons the plan may be wrong
2. **Rebuttal** — your response to each
3. **Reframing check** — did you re-explain an inconvenient fact to make the plan work? If yes → consider rewind to discovery

Include the strongest counter-argument in your reflection JSON summary.`;
  }

  return `## Adversarial Review Gate

✅ Adversarial section present in solution artifact.

In your reflection summary, cite the **strongest counter-argument** you considered and why the plan still holds (or pivot/rewind if it does not).

**Reframing signal (Fable 5):** if you noticed rationalization while writing the plan, treat that as a signal to rewind — not as proof to continue.`;
}
