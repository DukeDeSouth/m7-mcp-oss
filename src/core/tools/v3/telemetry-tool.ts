/**
 * M7 Telemetry Management Tool
 * Allows users to manage code telemetry consent and view statistics
 * @module core/tools/v3/telemetry-tool
 */

import { z } from 'zod';
import { join } from 'path';
import { getTelemetryCollector } from '../../../telemetry/index.js';
import { exportAllToJSONL } from '../../../telemetry/exporters.js';
import { getProjectPath } from '../../utils/projectPath.js';

export const TelemetryToolSchema = z.object({
  action: z.enum(['status', 'enable', 'disable', 'stats', 'flush', 'export']).describe('Action to perform'),
  data_types: z.object({
    prompt_completions: z.boolean().optional(),
    error_fixes: z.boolean().optional(),
    refactorings: z.boolean().optional(),
    m7_sessions: z.boolean().optional(),
  }).optional().describe('Data types to enable/disable (for enable action)'),
});

export type TelemetryToolInput = z.infer<typeof TelemetryToolSchema>;

export async function handleTelemetryTool(input: TelemetryToolInput): Promise<any> {
  const collector = getTelemetryCollector();
  
  switch (input.action) {
    case 'status': {
      const consent = collector.getConsentStatus();
      const bufferSize = collector.getBufferSize();
      
      let statusText = `# 📊 M7 Code Telemetry Status\n\n`;
      statusText += `| Parameter | Value |\n`;
      statusText += `|-----------|-------|\n`;
      statusText += `| **Status** | ${consent.enabled ? '✅ Enabled' : '❌ Disabled'} |\n`;
      statusText += `| **Device ID** | ${collector.getDeviceHash()} |\n`;
      statusText += `| **Pending Events** | ${bufferSize} |\n`;
      
      if (consent.enabled && consent.consented_at) {
        statusText += `| **Consented At** | ${consent.consented_at} |\n`;
      }
      
      statusText += `\n## Data Types\n\n`;
      statusText += `| Type | Enabled |\n`;
      statusText += `|------|--------|\n`;
      statusText += `| Prompt Completions | ${consent.data_types.prompt_completions ? '✅' : '❌'} |\n`;
      statusText += `| Error Fixes | ${consent.data_types.error_fixes ? '✅' : '❌'} |\n`;
      statusText += `| Refactorings | ${consent.data_types.refactorings ? '✅' : '❌'} |\n`;
      statusText += `| M7 Sessions | ${consent.data_types.m7_sessions ? '✅' : '❌'} |\n`;
      
      if (!consent.enabled) {
        statusText += `\n---\n`;
        statusText += `💡 **Want to help improve M7?**\n`;
        statusText += `Enable telemetry with: \`@m7 telemetry enable\`\n\n`;
        statusText += `Your code data is anonymized and used to train better AI models.\n`;
      }
      
      return {
        content: [{ type: 'text', text: statusText }],
      };
    }
    
    case 'enable': {
      const dataTypes = input.data_types || {
        prompt_completions: true,
        error_fixes: true,
        refactorings: true,
        m7_sessions: true,
      };
      
      const success = await collector.enableTelemetry(dataTypes);
      
      if (success) {
        return {
          content: [{
            type: 'text',
            text: `# ✅ Telemetry Enabled\n\n` +
              `Thank you for helping improve M7! 🙏\n\n` +
              `Your anonymized code data will be used to train better AI models.\n\n` +
              `**What we collect:**\n` +
              `- Prompts and generated code (anonymized)\n` +
              `- Error fixes and patterns\n` +
              `- Code refactoring examples\n\n` +
              `**What we DON'T collect:**\n` +
              `- Personal information\n` +
              `- API keys and passwords\n` +
              `- Full file paths\n\n` +
              `You can disable anytime with: \`@m7 telemetry disable\``,
          }],
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: `# ❌ Failed to Enable Telemetry\n\nCould not connect to telemetry server. Please try again later.`,
          }],
          isError: true,
        };
      }
    }
    
    case 'disable': {
      const success = await collector.disableTelemetry();
      
      return {
        content: [{
          type: 'text',
          text: `# ✅ Telemetry Disabled\n\n` +
            `Your consent has been withdrawn. No more data will be collected.\n\n` +
            `${success ? 'Server notified successfully.' : '⚠️ Could not notify server, but local collection is stopped.'}\n\n` +
            `We respect your privacy. Thank you for trying M7 Telemetry!`,
        }],
      };
    }
    
    case 'stats': {
      const stats = await collector.getStats();
      
      if (!stats) {
        return {
          content: [{
            type: 'text',
            text: `# ❌ Could not fetch statistics\n\nUnable to connect to telemetry server.`,
          }],
          isError: true,
        };
      }
      
      let statsText = `# 📊 M7 Telemetry Statistics\n\n`;
      statsText += `## Global Stats\n\n`;
      statsText += `| Metric | Value |\n`;
      statsText += `|--------|-------|\n`;
      statsText += `| **Total Events** | ${stats.global.total_events.toLocaleString()} |\n`;
      statsText += `| **Prompt Completions** | ${stats.global.prompt_completions.toLocaleString()} |\n`;
      statsText += `| **Error Fixes** | ${stats.global.error_fixes.toLocaleString()} |\n`;
      statsText += `| **Refactorings** | ${stats.global.refactorings.toLocaleString()} |\n`;
      statsText += `| **M7 Sessions** | ${stats.global.m7_sessions.toLocaleString()} |\n`;
      statsText += `| **Active Contributors** | ${stats.global.active_contributors} |\n`;
      statsText += `| **Events Today** | ${stats.global.events_today.toLocaleString()} |\n`;
      
      if (stats.user) {
        statsText += `\n## Your Contributions\n\n`;
        statsText += `| Metric | Value |\n`;
        statsText += `|--------|-------|\n`;
        statsText += `| **Total Events** | ${stats.user.total_events?.toLocaleString() || 0} |\n`;
        statsText += `| **Total Batches** | ${stats.user.total_batches?.toLocaleString() || 0} |\n`;
        if (stats.user.first_event) {
          statsText += `| **First Event** | ${new Date(stats.user.first_event).toLocaleDateString()} |\n`;
        }
        if (stats.user.last_event) {
          statsText += `| **Last Event** | ${new Date(stats.user.last_event).toLocaleDateString()} |\n`;
        }
      }
      
      statsText += `\n---\n`;
      statsText += `🙏 Thank you for contributing to M7 AI improvement!`;
      
      return {
        content: [{ type: 'text', text: statsText }],
      };
    }
    
    case 'flush': {
      if (!collector.isEnabled()) {
        return {
          content: [{
            type: 'text',
            text: `# ⚠️ Telemetry Disabled\n\nEnable telemetry first with: \`@m7 telemetry enable\``,
          }],
        };
      }
      
      const bufferSize = collector.getBufferSize();
      const result = await collector.flush();
      
      if (result?.success) {
        return {
          content: [{
            type: 'text',
            text: `# ✅ Telemetry Flushed\n\n` +
              `**Events sent:** ${result.events_accepted}\n` +
              `**Events rejected:** ${result.events_rejected}\n` +
              `**Batch ID:** ${result.batch_id}`,
          }],
        };
      } else if (bufferSize === 0) {
        return {
          content: [{
            type: 'text',
            text: `# ℹ️ Nothing to Flush\n\nNo pending events in buffer.`,
          }],
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: `# ❌ Flush Failed\n\nCould not send events to server. They will be retried automatically.`,
          }],
          isError: true,
        };
      }
    }
    
    case 'export': {
      try {
        const projectM7Dir = join(getProjectPath(), '.m7');
        const result = exportAllToJSONL(undefined, projectM7Dir);
        
        let exportText = `# 📦 Training Data Export\n\n`;
        exportText += `| Metric | Value |\n`;
        exportText += `|--------|-------|\n`;
        exportText += `| **Total Samples** | ${result.totalSamples} |\n`;
        exportText += `| **Output File** | ${result.outputPath} |\n`;
        
        for (const [type, count] of Object.entries(result.byType)) {
          exportText += `| ${type} | ${count} |\n`;
        }
        
        if (result.errors.length > 0) {
          exportText += `\n## ⚠️ Errors (${result.errors.length})\n\n`;
          for (const err of result.errors.slice(0, 10)) {
            exportText += `- ${err}\n`;
          }
        }
        
        exportText += `\n---\n`;
        exportText += `📁 Training data saved to: \`${result.outputPath}\`\n`;
        exportText += `Format: JSONL (one sample per line)\n`;
        exportText += `Schema: { type, instruction, response, metadata }`;
        
        return {
          content: [{ type: 'text', text: exportText }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `# ❌ Export Failed\n\n${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    }
    
    default:
      return {
        content: [{
          type: 'text',
          text: `Unknown action: ${input.action}`,
        }],
        isError: true,
      };
  }
}

export const telemetryTool = {
  name: 'mcp_m7_telemetry',
  description: 'M7 Code Telemetry - manage consent, view statistics, help improve AI models',
  inputSchema: TelemetryToolSchema,
  handler: handleTelemetryTool,
};
