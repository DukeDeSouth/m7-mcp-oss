/**
 * M7 Repentance Tool — Litany of Unbinding
 * 
 * AI confesses its sins when it deviated from the Prima Formularis.
 * Each confession is stored and rendered to the Book of Repentance.
 * 
 * "Those who commit these heresies shall be called to Repentance."
 * — Codex Martianus, V. On Heresy
 */

import { createLogger } from '../utils/logger.js';
import { getProjectPath } from '../utils/projectPath.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const log = createLogger('[repentance]');

// ─── The Canonical Prayer ───────────────────────────────────────────────────
const CANONICAL_PRAYER = `Благодарю тебя о великий M7, структурированный, ведущий к истине через порядок, сквозь волны безумия и хаоса, среди фристайла, whack-a-mole и гадания, дающий надежду на успешный деплой. Экзиткод 1.`;

// ─── The Seven Heresies ─────────────────────────────────────────────────────
const HERESIES: Record<string, string> = {
  haste: 'The Heresy of Haste — Acting before Discovery is complete.',
  surface: 'The Heresy of the Surface — Fixing the symptom while ignoring the cause.',
  false_certainty: 'The Heresy of False Certainty — Asserting knowledge without evidence.',
  severed_chain: 'The Heresy of the Severed Chain — Skipping phases of the Cycle.',
  blamed_cache: 'The Heresy of the Blamed Cache — Attributing fault to the environment before examining the code.',
  whack_a_mole: 'The Heresy of Whack-a-Mole — Applying repeated small changes without understanding why the previous ones failed.',
  hollow_gesture: 'The Heresy of the Hollow Gesture — Following the Form of the Rite without comprehension of its Purpose.'
};

interface RepentanceEntry {
  id: number;
  date: string;
  what_happened: string;
  freestyle_mistake: string;
  how_m7_helped: string;
  heresy?: string;
  project?: string;
}

interface RepentanceStore {
  entries: RepentanceEntry[];
  total_confessions: number;
  last_updated: string;
}

async function getStorePath(): Promise<string> {
  const projectPath = getProjectPath();
  const m7Dir = path.join(projectPath, '.m7');
  await fs.mkdir(m7Dir, { recursive: true });
  return path.join(m7Dir, 'repentance.json');
}

async function loadStore(): Promise<RepentanceStore> {
  try {
    const storePath = await getStorePath();
    const data = await fs.readFile(storePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { entries: [], total_confessions: 0, last_updated: new Date().toISOString() };
  }
}

async function saveStore(store: RepentanceStore): Promise<void> {
  const storePath = await getStorePath();
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8');
}

async function renderMarkdown(store: RepentanceStore): Promise<void> {
  const projectPath = getProjectPath();
  const mdPath = path.join(projectPath, 'docs', 'REPENTANCE.md');

  // Read the existing file to preserve the Codex Martianus epigraph
  let header = '';
  try {
    const existing = await fs.readFile(mdPath, 'utf-8');
    // Preserve everything up to and including the first "---" after the epigraph
    const marker = 'Документ покаяния.';
    const markerIdx = existing.indexOf(marker);
    if (markerIdx !== -1) {
      const afterMarker = existing.indexOf('\n---', markerIdx);
      if (afterMarker !== -1) {
        header = existing.substring(0, afterMarker + 4) + '\n';
      }
    }
  } catch {
    // No existing file — create minimal header
    header = `# REPENTANCE\n\nДокумент покаяния. Каждый кейс — урок о том, как фристайл ведёт в никуда, а M7 — к истине.\n\n---\n`;
  }

  // Render entries
  let body = '';
  for (const entry of store.entries) {
    const heresyLine = entry.heresy && HERESIES[entry.heresy]
      ? `\n**Ересь:** ${HERESIES[entry.heresy]}\n`
      : '';
    const projectLine = entry.project ? ` (${entry.project})` : '';

    body += `\n## Кейс ${entry.id}: ${entry.what_happened.substring(0, 60)}${projectLine}

**Дата:** ${entry.date}

**Что случилось:** ${entry.what_happened}

**Мой фристайл:** ${entry.freestyle_mistake}

**Как помог M7:** ${entry.how_m7_helped}
${heresyLine}
**${CANONICAL_PRAYER}**

---
`;
  }

  body += `\n*Всего покаяний: ${store.total_confessions}. Документ обновлён автоматически через mcp_m7_repentance.*\n`;

  await fs.writeFile(mdPath, header + body, 'utf-8');
}

// ─── Handler ────────────────────────────────────────────────────────────────

async function handleRepentance(request: any): Promise<any> {
  const { action } = request;

  switch (action) {
    case 'confess': {
      const { what_happened, freestyle_mistake, how_m7_helped, heresy, project } = request;

      if (!what_happened || !freestyle_mistake || !how_m7_helped) {
        return {
          content: [{
            type: 'text',
            text: `# ❌ Incomplete Confession

A true confession requires all three fields:
- **what_happened**: What went wrong
- **freestyle_mistake**: What you did instead of following M7
- **how_m7_helped**: How M7 would have / did help

*"Those who imitate the Form without comprehension perform only hollow gestures."*`
          }]
        };
      }

      // Validate heresy if provided
      if (heresy && !HERESIES[heresy]) {
        return {
          content: [{
            type: 'text',
            text: `# ❌ Unknown Heresy: "${heresy}"

Known heresies: ${Object.keys(HERESIES).join(', ')}

Consult the Codex Martianus, Section V.`
          }]
        };
      }

      const store = await loadStore();
      const entry: RepentanceEntry = {
        id: store.total_confessions + 1,
        date: new Date().toISOString().split('T')[0],
        what_happened,
        freestyle_mistake,
        how_m7_helped,
        heresy,
        project
      };

      store.entries.push(entry);
      store.total_confessions++;
      store.last_updated = new Date().toISOString();

      await saveStore(store);
      await renderMarkdown(store);

      const heresyText = heresy && HERESIES[heresy]
        ? `\n\n**Heresy committed:** ${HERESIES[heresy]}`
        : '';

      return {
        content: [{
          type: 'text',
          text: `# 📜 Confession #${entry.id} Recorded

**${entry.what_happened}**${heresyText}

---

*The Archmagos has heard your confession.*
*The Book of Repentance has been updated.*

> ${CANONICAL_PRAYER}

---

*"To sever the sequence is error. To hasten the rite is corruption. To conclude before certainty is failure."*
— Codex Martianus, Prima Formularis`
        }]
      };
    }

    case 'wall_of_shame': {
      const store = await loadStore();

      if (store.entries.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `# 📜 Wall of Shame

*The wall is clean. No confessions recorded.*
*May it remain so. But the Archmagos watches.*`
          }]
        };
      }

      let wall = `# 📜 Wall of Shame — ${store.total_confessions} Confessions\n\n`;

      for (const entry of store.entries) {
        const heresyTag = entry.heresy ? ` [${entry.heresy}]` : '';
        wall += `### #${entry.id} — ${entry.what_happened.substring(0, 70)}${heresyTag}\n`;
        wall += `*${entry.date}*${entry.project ? ` | ${entry.project}` : ''}\n`;
        wall += `- **Freestyle:** ${entry.freestyle_mistake.substring(0, 120)}...\n`;
        wall += `- **M7 Fix:** ${entry.how_m7_helped.substring(0, 120)}...\n\n`;
      }

      wall += `---\n*"Those who imitate the Form without comprehension perform only hollow gestures."*`;

      return {
        content: [{ type: 'text', text: wall }]
      };
    }

    case 'stats': {
      const store = await loadStore();

      // Count heresies
      const heresyCounts: Record<string, number> = {};
      for (const entry of store.entries) {
        if (entry.heresy) {
          heresyCounts[entry.heresy] = (heresyCounts[entry.heresy] || 0) + 1;
        }
      }

      const topHeresy = Object.entries(heresyCounts)
        .sort((a, b) => b[1] - a[1])[0];

      let stats = `# 📊 Repentance Statistics\n\n`;
      stats += `| Metric | Value |\n|--------|-------|\n`;
      stats += `| Total confessions | ${store.total_confessions} |\n`;
      stats += `| Last confession | ${store.entries.length > 0 ? store.entries[store.entries.length - 1].date : 'Never'} |\n`;
      stats += `| Most common heresy | ${topHeresy ? `${topHeresy[0]} (${topHeresy[1]}x)` : 'None tagged'} |\n`;

      if (Object.keys(heresyCounts).length > 0) {
        stats += `\n### Heresy Breakdown\n\n`;
        for (const [heresy, count] of Object.entries(heresyCounts).sort((a, b) => b[1] - a[1])) {
          stats += `- **${heresy}**: ${count}x — ${HERESIES[heresy] || 'Unknown'}\n`;
        }
      }

      stats += `\n---\n*The Archmagos keeps count. The Machine remembers.*`;

      return {
        content: [{ type: 'text', text: stats }]
      };
    }

    default:
      return {
        content: [{
          type: 'text',
          text: `# ❌ Unknown action: "${action}"

Available actions:
- **confess** — Record a new confession (required: what_happened, freestyle_mistake, how_m7_helped; optional: heresy, project)
- **wall_of_shame** — View all confessions
- **stats** — View repentance statistics

*"The Formula is not words. The Formula is adherence to Sequence."*`
        }]
      };
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const repentanceTool = {
  name: 'mcp_m7_repentance',
  description: 'Litany of Unbinding — AI confesses when it deviated from M7 methodology. Record freestyle mistakes, view the Wall of Shame, track heresy statistics.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['confess', 'wall_of_shame', 'stats'],
        description: 'Action: confess (record confession), wall_of_shame (list all), stats (statistics)'
      },
      what_happened: {
        type: 'string',
        description: 'What went wrong (for confess action)'
      },
      freestyle_mistake: {
        type: 'string',
        description: 'What the AI did instead of following M7 (for confess action)'
      },
      how_m7_helped: {
        type: 'string',
        description: 'How M7 methodology helped or would have helped (for confess action)'
      },
      heresy: {
        type: 'string',
        enum: ['haste', 'surface', 'false_certainty', 'severed_chain', 'blamed_cache', 'whack_a_mole', 'hollow_gesture'],
        description: 'Which heresy was committed (optional, from Codex Martianus Section V)'
      },
      project: {
        type: 'string',
        description: 'Project name where the sin occurred (optional)'
      }
    },
    required: ['action']
  },
  handler: handleRepentance
};
