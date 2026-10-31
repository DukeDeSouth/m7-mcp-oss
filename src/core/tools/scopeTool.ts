import { z } from 'zod';
import { ScopeGuard } from '../guards/scopeGuard.js';
import { TaskOrchestrator } from '../orchestrator/taskOrchestrator.js';

const ScopeRequestSchema = z.object({
  action: z.enum(['status', 'set-budget', 'extend', 'rollback', 'visualize']),
  sessionId: z.string().optional(),
  budget: z.object({
    files: z.number().optional(),
    lines: z.number().optional(),
    breaking: z.number().optional(),
    minutes: z.number().optional()
  }).optional(),
  reason: z.string().optional()
});

export function createScopeTool(scopeGuard: ScopeGuard, orchestrator: TaskOrchestrator) {
  return {
    name: 'mcp_m7_scope',
    description: 'Manage task scope and prevent scope creep',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'set-budget', 'extend', 'rollback', 'visualize'],
          description: 'Scope management action'
        },
        sessionId: {
          type: 'string',
          description: 'Session ID (optional, uses latest)'
        },
        budget: {
          type: 'object',
          properties: {
            files: { type: 'number' },
            lines: { type: 'number' },
            breaking: { type: 'number' },
            minutes: { type: 'number' }
          },
          description: 'Budget modifications'
        },
        reason: {
          type: 'string',
          description: 'Reason for extension or override'
        }
      },
      required: ['action']
    },
    handler: async (request: any) => {
      const { action, sessionId, budget, reason } = ScopeRequestSchema.parse(request);
      
      // Get session ID
      await orchestrator.ready();
      const targetSessionId = sessionId || orchestrator.getAllActiveSessions()[0]?.id;
      if (!targetSessionId) {
        return {
          content: [{
            type: 'text',
            text: '❌ No active M7 session found. Start with: @m7 analyze task "description"'
          }]
        };
      }

      switch (action) {
        case 'status': {
          const status = scopeGuard.getStatus(targetSessionId);
          return {
            content: [{
              type: 'text',
              text: `# 📊 Scope Status

${status.visualization || 'No visualization available'}

**Level:** ${status.level.toUpperCase()} ${getStatusEmoji(status.level)}
${status.message ? `\n**Message:** ${status.message}` : ''}

## Detailed Metrics:
- **Files:** ${status.metrics?.filesUsed || 0}/${status.metrics?.filesMax || 0}
- **Lines:** ${status.metrics?.linesUsed || 0}/${status.metrics?.linesMax || 0}
- **Breaking Changes:** ${status.metrics?.breakingUsed || 0}/${status.metrics?.breakingMax || 0}
- **Time:** ${status.metrics?.timeUsed || 0}/${status.metrics?.timeMax || 0} minutes`
            }]
          };
        }

        case 'extend': {
          if (!reason) {
            return {
              content: [{
                type: 'text',
                text: '❌ Extension reason required. Example: @m7 scope extend reason="Need to fix related security issue"'
              }]
            };
          }

          const extension = {
            maxFiles: budget?.files,
            maxLines: budget?.lines,
            maxBreaking: budget?.breaking,
            maxMinutes: budget?.minutes
          };

          const approved = await scopeGuard.requestExtension(targetSessionId, extension, reason);
          
          return {
            content: [{
              type: 'text',
              text: approved 
                ? `✅ Scope extension approved: ${reason}\n\n${scopeGuard.getVisualization(targetSessionId)}`
                : '❌ Scope extension denied'
            }]
          };
        }

        case 'visualize': {
          const visualization = scopeGuard.getVisualization(targetSessionId);
          return {
            content: [{
              type: 'text',
              text: `# 📊 Scope Visualization\n\n${visualization}`
            }]
          };
        }

        case 'rollback': {
          return {
            content: [{
              type: 'text',
              text: `# 🔄 Rollback Instructions

To rollback changes from this session:

\`\`\`bash
# Check current status
git status

# Rollback to last commit
git reset --hard HEAD

# Or rollback specific files
git checkout -- <file1> <file2>
\`\`\`

**Note:** This will discard all uncommitted changes. Consider stashing first:
\`\`\`bash
git stash save "Scope exceeded - saving work"
\`\`\``
            }]
          };
        }

        default:
          return { 
            content: [{
              type: 'text', 
              text: '❌ Unknown action'
            }]
          };
      }
    }
  };
}

function getStatusEmoji(level: string): string {
  switch (level) {
    case 'green': return '🟢';
    case 'yellow': return '🟡';
    case 'orange': return '🟠';
    case 'red': return '🔴';
    default: return '⚪';
  }
} 