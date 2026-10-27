import { createLogger } from './core/utils/logger.js';
const log = createLogger('[testtool]');
import { z } from 'zod';

const TestSchema = z.object({
  message: z.string().describe('Test message')
});

export const testTool = {
  name: 'mcp_m7_test_tool',
  description: 'Simple test tool to verify MCP integration',
  inputSchema: TestSchema,
  
  handler: async (request: any) => {
    log.error('🧪 [TEST TOOL] Handler called with:', request);
    
    // Check env vars for debugging
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    
    return {
      content: [
        {
          type: 'text',
          text: `# ✅ TEST TOOL SUCCESS

**Message Received**: ${request.message}
**Handler Called**: YES - this proves MCP integration works
**Timestamp**: ${new Date().toISOString()}

## Environment Variables Check
- OPENAI_API_KEY: ${openaiKey ? '✅ Present (' + openaiKey.substring(0, 15) + '...)' : '❌ MISSING'}
- ANTHROPIC_API_KEY: ${anthropicKey ? '✅ Present (' + anthropicKey.substring(0, 15) + '...)' : '❌ MISSING'}

This message confirms that MCP tool handlers are working correctly!`
        }
      ]
    };
  }
};
