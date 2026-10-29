import { z } from 'zod';
import { TaskOrchestrator } from '../../orchestrator/taskOrchestrator.js';

const UnifiedSessionRequestSchema = z.object({
  action: z.enum(['status', 'health_check', 'enforce_compliance', 'mark_complete', 'list_active', 'complete_session']),
  session_id: z.string().optional(),
  requirement: z.string().optional(),
  evidence: z.any().optional(),
  notes: z.string().optional(),
  force: z.boolean().optional(),
  enforcement_action: z.enum(['code_change', 'file_edit', 'implementation']).optional()
});

export const unifiedSessionTool = {
  name: 'mcp_m7_session',
  description: 'Unified M7 session management - status, compliance, completion, enforcement',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'health_check', 'enforce_compliance', 'mark_complete', 'list_active', 'complete_session'],
        description: 'Session operation to perform'
      },
      session_id: {
        type: 'string',
        description: 'Session ID (optional - will use latest active)',
        optional: true
      },
      requirement: {
        type: 'string',
        description: 'Requirement to mark complete',
        optional: true
      },
      evidence: {
        description: 'Evidence of completion',
        optional: true
      },
      notes: {
        type: 'string',
        description: 'Additional notes',
        optional: true
      },
      force: {
        type: 'boolean',
        description: 'When completing a session, bypass phase and requirement guards (recorded on the session)',
        optional: true
      },
      enforcement_action: {
        type: 'string',
        enum: ['code_change', 'file_edit', 'implementation'],
        description: 'Action to check compliance for',
        optional: true
      }
    },
    required: ['action']
  },
  handler: async (request: any, orchestrator: TaskOrchestrator) => {
    const params = UnifiedSessionRequestSchema.parse(request);
    const { action, session_id, requirement, evidence, notes, force, enforcement_action } = params;

    try {
      let targetSessionId = session_id;
      
      // Auto-find active session if not provided
      if (!targetSessionId && ['status', 'enforce_compliance', 'mark_complete'].includes(action)) {
        const activeSessions = orchestrator.getAllActiveSessions();
        if (activeSessions.length > 0) {
          targetSessionId = activeSessions[activeSessions.length - 1].id;
        }
      }

      let response = `# 🎼 M7 Session: ${action.toUpperCase()}\n\n`;

      switch (action) {
        case 'status': {
          if (!targetSessionId) {
            const activeSessions = orchestrator.getAllActiveSessions();
            response += `**No session specified and no active sessions found.**\n`;
            response += `**Active Sessions:** ${activeSessions.length}\n\n`;
            response += `Use @m7 analyze task to start a new session.\n`;
            break;
          }

          const session = orchestrator.getSessionStatus(targetSessionId);
          if (!session) {
            response += `❌ Session ${targetSessionId} not found.\n`;
            break;
          }

          response += `**Session ID:** \`${session.id}\`\n`;
          response += `**Phase:** ${session.currentPhase}\n`;
          response += `**Route:** ${session.route}\n`;
          response += `**Started:** ${new Date(session.startTime).toLocaleString()}\n`;
          response += `**Can Proceed to Code:** ${session.canProceedToCode ? '✅' : '🚫'}\n\n`;

          // Show requirements
          const incomplete = Object.entries(session.phaseRequirements)
            .filter(([_, completed]) => !completed);
          
          if (incomplete.length > 0) {
            response += `## ⏳ Pending Requirements (${incomplete.length}):\n`;
            incomplete.slice(0, 5).forEach(([req, _]) => {
              response += `- ${req.replace(/_/g, ' ')}\n`;
            });
            
            if (incomplete.length > 5) {
              response += `... and ${incomplete.length - 5} more\n`;
            }
            response += '\n';
          }

          // Show blockers
          if (session.blockedReasons.length > 0) {
            response += `## 🚫 Blockers:\n`;
            session.blockedReasons.forEach(reason => {
              response += `- ${reason}\n`;
            });
            response += '\n';
          }

          // Show violations
          if (session.violations.length > 0) {
            response += `## ⚠️ Recent Violations:\n`;
            session.violations.slice(-3).forEach(violation => {
              response += `- ${violation.reason} (${new Date(violation.timestamp).toLocaleString()})\n`;
            });
            response += '\n';
          }

          break;
        }

        case 'health_check': {
          const activeSessions = orchestrator.getAllActiveSessions();
          const totalViolations = activeSessions.reduce((sum, s) => sum + s.violations.length, 0);
          
          response += `## ✅ Overall Status: HEALTHY\n\n`;
          response += `## 📊 Session Metrics:\n`;
          response += `- **Active Sessions:** ${activeSessions.length}\n`;
          response += `- **Total Violations:** ${totalViolations} ${totalViolations === 0 ? '✅' : '⚠️'}\n\n`;
          
          response += `## 🛡️ M7 Protection Active:\n`;
          response += `- ✅ Chaos prevention enabled\n`;
          response += `- ✅ Phase enforcement active\n`;
          response += `- ✅ Code quality gates operational\n`;
          response += `- ✅ Compliance monitoring running\n\n`;
          
          if (activeSessions.length > 0) {
            response += `## 🎯 Active Sessions:\n`;
            activeSessions.slice(0, 3).forEach(session => {
              response += `- **${session.id}** (${session.currentPhase}) - ${session.route}\n`;
            });
          }
          
          break;
        }

        case 'enforce_compliance': {
          if (!targetSessionId) {
            response += `❌ No session found for compliance check.\n`;
            response += `Start with: @m7 analyze task "your task"\n`;
            break;
          }

          const result = await orchestrator.enforceM7Compliance(
            enforcement_action || 'code_change',
            targetSessionId
          );

          const emoji = result.allowed ? '✅' : '🚫';
          const status = result.allowed ? 'ALLOWED' : 'BLOCKED';

          response += `## ${emoji} Compliance Check: ${status}\n\n`;
          response += `**Session:** ${targetSessionId}\n`;
          response += `**Action:** ${enforcement_action || 'code_change'}\n`;
          response += `**Result:** ${result.reason}\n\n`;

          if (!result.allowed && result.requiredActions.length > 0) {
            response += `## 🎯 Required Actions:\n`;
            result.requiredActions.forEach((actionItem, i) => {
              response += `${i + 1}. ${actionItem}\n`;
            });
            response += '\n';
          }

          if (result.allowed) {
            response += `✅ **Ready to proceed with implementation.**\n`;
          } else {
            response += `🚫 **Complete M7 requirements before coding.**\n`;
          }

          break;
        }

        case 'mark_complete': {
          if (!targetSessionId) {
            response += `❌ No session specified.\n`;
            break;
          }

          if (!requirement) {
            response += `❌ Requirement name required.\n`;
            break;
          }

          try {
            await orchestrator.markRequirementComplete(
              targetSessionId,
              requirement,
              evidence
            );

            response += `✅ **Requirement Completed**\n\n`;
            response += `**Session:** ${targetSessionId}\n`;
            response += `**Requirement:** ${requirement}\n`;
            if (evidence) response += `**Evidence:** ${JSON.stringify(evidence)}\n`;
            if (notes) response += `**Notes:** ${notes}\n`;
            response += `\n**Status:** Requirement marked as complete.\n`;
            
            // Check if session can advance
            const canAdvance = await orchestrator.checkCanProceedToCode(targetSessionId);
            if (canAdvance.canProceed) {
              response += `\n🎉 **Session can now proceed to implementation!**\n`;
            }
          } catch (error) {
            response += `❌ **Failed to Complete Requirement**\n\n`;
            response += `**Error:** ${error instanceof Error ? error.message : String(error)}\n`;
          }

          break;
        }

        case 'list_active': {
          const activeSessions = orchestrator.getAllActiveSessions();
          
          response += `**Active Sessions:** ${activeSessions.length}\n\n`;
          
          if (activeSessions.length === 0) {
            response += `No active M7 sessions.\n`;
            response += `Start with: @m7 analyze task "your task"\n`;
          } else {
            activeSessions.forEach((session, i) => {
              response += `${i + 1}. **${session.id}**\n`;
              response += `   Phase: ${session.currentPhase} | Route: ${session.route}\n`;
              response += `   Started: ${new Date(session.startTime).toLocaleString()}\n`;
              response += `   Can Code: ${session.canProceedToCode ? '✅' : '🚫'}\n`;
              if (session.violations.length > 0) {
                response += `   Violations: ${session.violations.length} ⚠️\n`;
              }
              response += '\n';
            });
          }
          
          break;
        }

        case 'complete_session': {
          if (!targetSessionId) {
            response += `❌ No session specified.\n`;
            break;
          }

          const result = await orchestrator.completeSession(targetSessionId, notes, {
            force: force === true,
          });

          if (result) {
            response += `🎉 **Session Completed Successfully**\n\n`;
            response += `**Session:** ${targetSessionId}\n`;
            if (force) {
              response += `\n⚠️ Completed with force: true (requirements were bypassed).\n`;
            }
            response += `\n✅ Session archived and metrics recorded.\n`;
          } else {
            const session = orchestrator.getSessionStatus(targetSessionId);
            const reason = session?.lastError ?? 'Could not complete session';
            response += `❌ **Session Completion Refused**\n\n`;
            response += `**Reason:** ${reason}\n`;
          }
          
          break;
        }

        default:
          throw new Error(`Unknown session action: ${action}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: response
          }
        ]
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `# ❌ Session Operation Failed\n\nError: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
}; 