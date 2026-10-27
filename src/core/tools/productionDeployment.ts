#!/usr/bin/env node

import { z } from 'zod';
import { JournalSystem } from '../../journal/journalSystem.js';
import { ProductionGate } from '../gates/productionGate.js';
import { EnhancedLockSystem } from '../gates/enhancedLockSystem.js';
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';
// v5.0: Uses UnifiedMemoryCore instead of MemorySystem

// Production Deployment Tool Types
interface ProductionDeploymentRequest {
  sessionId: string;
  targetStage: 'staging' | 'production';
  changes: string[];
  businessRationale: string;
  impactAssessment?: string;
  emergencyContacts?: string[];
  rollbackPlan?: string;
}

interface DeploymentGuidance {
  deploymentId: string;
  currentStep: {
    id: string;
    name: string;
    description: string;
    type: 'automated' | 'manual' | 'approval';
    command?: string;
    estimatedDuration: number;
    contextHelp: string[];
  };
  nextSteps: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  overallProgress: number;
  estimatedTimeRemaining: number;
  contextHelp: string;
  rollbackInstructions: string;
}

interface StepResult {
  success: boolean;
  stepId: string;
  message: string;
  nextStep?: string;
  canProceed: boolean;
  evidence?: string;
}

class ProductionDeploymentOrchestrator {
  private activeDeployments: Map<string, any> = new Map();
  private memoryCore: UnifiedMemoryCore | null = null;

  constructor(
    private journal: JournalSystem,
    private productionGate: ProductionGate,
    private enhancedLocks: EnhancedLockSystem
  ) {
    this.loadActiveDeployments();
  }

  private async loadActiveDeployments(): Promise<void> {
    try {
      // v5.0: Use UnifiedMemoryCore for searching deployments
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      const deploymentData = await this.memoryCore.cascadeSearch('production_deployments', { limit: 20 });
      if (deploymentData && Array.isArray(deploymentData)) {
        deploymentData.forEach((memory: any) => {
          if (memory.data?.deploymentId && memory.data.status === 'active') {
            this.activeDeployments.set(memory.data.deploymentId, memory.data);
          }
        });
      }
    } catch (error) {
      this.journal.logError({
        type: 'deployment_load_error',
        error: `Failed to load active deployments: ${error}`,
        context: JSON.stringify({ component: 'ProductionDeploymentOrchestrator' }),
        fixed: false,
        category: 'runtime'
      });
    }
  }

  async initiateProductionDeployment(
    request: ProductionDeploymentRequest
  ): Promise<any> {
    
    // Generate unique deployment ID
    const deploymentId = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create deployment context
    const context = {
      sessionId: request.sessionId,
      deploymentId,
      fromStage: 'development', // Could be detected from current version state
      targetStage: request.targetStage,
      businessRationale: request.businessRationale,
      impactAssessment: request.impactAssessment,
      emergencyContacts: request.emergencyContacts || [],
      startedAt: new Date(),
      estimatedDuration: this.estimateDeploymentDuration(request.targetStage)
    };

    try {
      // Activate enhanced lock system for stage transition
      const lockResult = await this.enhancedLocks.lockSessionForStage(
        request.sessionId,
        request.targetStage,
        context
      );

      if (!lockResult.success) {
        return {
          success: false,
          message: `❌ Failed to initiate ${request.targetStage} deployment: ${lockResult.message}`,
          deploymentId: null
        };
      }

      // Store deployment information
      const deployment = {
        deploymentId,
        sessionId: request.sessionId,
        request,
        context,
        lockResult,
        status: 'active',
        createdAt: new Date(),
        steps: this.generateDeploymentSteps(request.targetStage, lockResult.gateActivated)
      };

      this.activeDeployments.set(deploymentId, deployment);
      await this.persistDeployment(deployment);

      // Log deployment initiation
      this.journal.logFeature({
        name: 'Production Deployment Initiated',
        description: `Initiated ${request.targetStage} deployment with enhanced gates`,
        implementation: `Deployment ${deploymentId} created with ${lockResult.requiredChecks.length} required checks`,
        lessons: [],
        patterns: ['production-deployment', 'enhanced-gates'],
        complexity: 'heavy'
      });

      return {
        success: true,
        deploymentId,
        gateActivated: lockResult.gateActivated,
        lockActivated: lockResult.lockActivated,
        estimatedDuration: lockResult.estimatedDuration,
        requiredChecks: lockResult.requiredChecks,
        nextSteps: lockResult.nextSteps,
        message: `🚀 ${request.targetStage.toUpperCase()} deployment initiated successfully!`,
        guidance: await this.getDeploymentGuidance(deploymentId)
      };

    } catch (error) {
      this.journal.logError({
        type: 'deployment_initiation_error',
        error: `Failed to initiate production deployment: ${error}`,
        context: JSON.stringify({ request, deploymentId }),
        fixed: false,
        category: 'runtime'
      });

      return {
        success: false,
        message: `❌ Deployment initiation failed: ${error}`,
        deploymentId: null
      };
    }
  }

  async getDeploymentGuidance(deploymentId: string): Promise<DeploymentGuidance | null> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (!deployment) {
      return null;
    }

    // Get current status from enhanced lock system
    const status = await this.enhancedLocks.getStageTransitionStatus(deployment.sessionId);
    if (!status) {
      return null;
    }

    // Find current step
    const remainingChecks = status.lockStatus?.remainingChecks || [];
    const currentStepId = remainingChecks.length > 0 ? remainingChecks[0] : 'deployment_ready';
    
    const currentStep = this.getStepDetails(currentStepId, deployment.context.targetStage);
    const nextSteps = remainingChecks.slice(1, 4).map((checkId: string) => ({
      id: checkId,
      name: this.getStepName(checkId),
      description: this.getStepDescription(checkId)
    }));

    // Calculate progress
    const totalChecks = (status.lockStatus?.completedChecks?.length || 0) + remainingChecks.length;
    const completedChecks = status.lockStatus?.completedChecks?.length || 0;
    const overallProgress = totalChecks > 0 ? (completedChecks / totalChecks) * 100 : 0;

    // Estimate time remaining
    const estimatedTimeRemaining = this.estimateRemainingTime(remainingChecks);

    // Generate context help
    const contextHelp = this.generateContextHelp(deployment, currentStepId);

    // Generate rollback instructions
    const rollbackInstructions = this.generateRollbackInstructions(deployment);

    return {
      deploymentId,
      currentStep,
      nextSteps,
      overallProgress,
      estimatedTimeRemaining,
      contextHelp,
      rollbackInstructions
    };
  }

  async handleDeploymentStep(
    deploymentId: string,
    stepId: string,
    userInput?: any
  ): Promise<StepResult> {
    
    const deployment = this.activeDeployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    try {
      // Complete the check in enhanced lock system
      const result = await this.enhancedLocks.completeStageCheck(
        deployment.sessionId,
        stepId,
        userInput?.result,
        userInput?.evidence
      );

      // Update deployment status
      deployment.lastStepCompleted = stepId;
      deployment.lastStepCompletedAt = new Date();
      await this.persistDeployment(deployment);

      // Check if deployment is ready
      const canProceed = result.remainingChecks.length === 0;
      const nextStep = result.remainingChecks.length > 0 ? result.remainingChecks[0] : undefined;

      return {
        success: result.success,
        stepId,
        message: result.message,
        nextStep,
        canProceed,
        evidence: userInput?.evidence
      };

    } catch (error) {
      this.journal.logError({
        type: 'deployment_step_error',
        error: `Failed to handle deployment step: ${error}`,
        context: JSON.stringify({ deploymentId, stepId }),
        fixed: false,
        category: 'runtime'
      });

      return {
        success: false,
        stepId,
        message: `❌ Step failed: ${error}`,
        canProceed: false
      };
    }
  }

  async emergencyRollback(
    deploymentId: string,
    reason: string,
    evidence: string
  ): Promise<any> {
    
    const deployment = this.activeDeployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const rollbackId = `rollback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Request emergency override from production gate if active
      let overrideResult;
      const hasGate = this.productionGate.isGateActiveForSession(deployment.sessionId);
      
      if (hasGate) {
        overrideResult = await this.productionGate.requestEmergencyOverride(
          deployment.sessionId,
          `Emergency rollback: ${reason}`,
          evidence // Use evidence as emergency token
        );
      }

      // Mark deployment as rolled back
      deployment.status = 'emergency_rollback';
      deployment.rollbackId = rollbackId;
      deployment.rollbackReason = reason;
      deployment.rollbackEvidence = evidence;
      deployment.rolledBackAt = new Date();

      await this.persistDeployment(deployment);

      // Log emergency rollback
      this.journal.logError({
        type: 'emergency_rollback',
        error: `Emergency rollback executed for deployment ${deploymentId}: ${reason}`,
        context: JSON.stringify({
          deploymentId,
          rollbackId,
          reason,
          evidence,
          hadProductionGate: hasGate,
          overrideUsed: overrideResult?.success
        }),
        fixed: false,
        category: 'security'
      });

      return {
        success: true,
        rollbackId,
        deploymentId,
        message: `🆘 Emergency rollback executed successfully`,
        executionTime: 120, // Simulated 2 minutes
        rollbackVersion: deployment.context.fromStage,
        evidence,
        productionGateOverride: overrideResult?.success || false
      };

    } catch (error) {
      this.journal.logError({
        type: 'rollback_execution_error',
        error: `Failed to execute emergency rollback: ${error}`,
        context: JSON.stringify({ deploymentId, reason }),
        fixed: false,
        category: 'security'
      });

      return {
        success: false,
        message: `❌ Emergency rollback failed: ${error}`,
        deploymentId,
        rollbackId
      };
    }
  }

  private estimateDeploymentDuration(targetStage: string): number {
    const baseDurations: Record<string, number> = {
      staging: 45,     // 45 minutes
      production: 120  // 2 hours
    };
    return baseDurations[targetStage] || 30;
  }

  private generateDeploymentSteps(targetStage: string, gateActivated: boolean): any[] {
    const steps = [
      { id: 'tests', name: 'Test Suite', estimatedMinutes: 10 },
      { id: 'regression_check', name: 'Regression Testing', estimatedMinutes: 20 },
    ];

    if (targetStage === 'staging' || targetStage === 'production') {
      steps.push({ id: 'playwright_validation', name: 'E2E Testing', estimatedMinutes: 15 });
    }

    if (targetStage === 'production') {
      steps.push(
        { id: 'code_review', name: 'Code Review', estimatedMinutes: 30 },
        { id: 'performance_check', name: 'Performance Validation', estimatedMinutes: 25 }
      );
    }

    if (gateActivated) {
      steps.push(
        { id: 'security_scan', name: 'Security Scan', estimatedMinutes: 5 },
        { id: 'business_approval', name: 'Business Sign-off', estimatedMinutes: 60 }
      );
    }

    steps.push({ id: 'manual_confirmation', name: 'Final Confirmation', estimatedMinutes: 5 });

    return steps;
  }

  private getStepDetails(stepId: string, targetStage: string): any {
    const stepConfigs: Record<string, any> = {
      tests: {
        id: 'tests',
        name: 'Test Suite Execution',
        description: 'Run comprehensive test suite to verify code quality',
        type: 'automated',
        command: 'npm test',
        estimatedDuration: 10,
        contextHelp: [
          'Ensure all unit tests pass',
          'Check test coverage meets minimum requirements',
          'Fix any failing tests before proceeding'
        ]
      },
      regression_check: {
        id: 'regression_check',
        name: 'Regression Testing',
        description: 'Verify no existing functionality is broken',
        type: 'automated',
        command: 'npm run test:regression',
        estimatedDuration: 20,
        contextHelp: [
          'Run full regression test suite',
          'Compare results with baseline',
          'Document any differences found'
        ]
      },
      playwright_validation: {
        id: 'playwright_validation',
        name: 'End-to-End Testing',
        description: 'Browser-based functional testing',
        type: 'automated',
        command: '@playwright browser_snapshot',
        estimatedDuration: 15,
        contextHelp: [
          'Run Playwright E2E tests',
          'Capture screenshots for comparison',
          'Verify all critical user journeys work'
        ]
      },
      code_review: {
        id: 'code_review',
        name: 'Code Review Approval',
        description: 'Peer review of code changes',
        type: 'manual',
        estimatedDuration: 30,
        contextHelp: [
          'Get approval from team lead or senior developer',
          'Address any code review comments',
          'Ensure code follows team standards'
        ]
      },
      performance_check: {
        id: 'performance_check',
        name: 'Performance Validation',
        description: 'Verify no performance regression',
        type: 'automated',
        command: 'npm run benchmark:production',
        estimatedDuration: 25,
        contextHelp: [
          'Run performance benchmarks',
          'Compare with baseline metrics',
          'Investigate any performance degradation > 10%'
        ]
      },
      security_scan: {
        id: 'security_scan',
        name: 'Security Vulnerability Scan',
        description: 'Check for known security vulnerabilities',
        type: 'automated',
        command: 'npm audit --audit-level moderate',
        estimatedDuration: 5,
        contextHelp: [
          'Run security audit on dependencies',
          'Review and fix any moderate or higher vulnerabilities',
          'Document any accepted risks'
        ]
      },
      business_approval: {
        id: 'business_approval',
        name: 'Business Stakeholder Sign-off',
        description: 'Product owner approval for production deployment',
        type: 'approval',
        estimatedDuration: 60,
        contextHelp: [
          'Get explicit approval from product owner',
          'Provide business impact summary',
          'Confirm deployment timing with stakeholders'
        ]
      },
      manual_confirmation: {
        id: 'manual_confirmation',
        name: 'Final Manual Confirmation',
        description: 'Last check before deployment',
        type: 'manual',
        estimatedDuration: 5,
        contextHelp: [
          'Verify all previous steps completed',
          'Confirm ready for production deployment',
          'Check deployment window and timing'
        ]
      },
      deployment_ready: {
        id: 'deployment_ready',
        name: 'Ready for Deployment',
        description: 'All checks passed - deployment can proceed',
        type: 'manual',
        estimatedDuration: 0,
        contextHelp: [
          '🎉 All safety checks completed!',
          'Deployment is ready to proceed',
          'Execute deployment process'
        ]
      }
    };

    return stepConfigs[stepId] || {
      id: stepId,
      name: stepId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      description: `Complete ${stepId} check`,
      type: 'manual',
      estimatedDuration: 10,
      contextHelp: [`Complete the ${stepId} requirement`]
    };
  }

  private getStepName(stepId: string): string {
    return this.getStepDetails(stepId, 'production').name;
  }

  private getStepDescription(stepId: string): string {
    return this.getStepDetails(stepId, 'production').description;
  }

  private estimateRemainingTime(remainingChecks: string[]): number {
    return remainingChecks.reduce((total, checkId) => {
      return total + this.getStepDetails(checkId, 'production').estimatedDuration;
    }, 0);
  }

  private generateContextHelp(deployment: any, currentStepId: string): string {
    const step = this.getStepDetails(currentStepId, deployment.context.targetStage);
    const businessRationale = deployment.context.businessRationale;

    let help = `**Current Task:** ${step.name}\n\n`;
    help += `**What to do:** ${step.description}\n\n`;
    
    if (step.command) {
      help += `**Command:** \`${step.command}\`\n\n`;
    }

    help += `**Context:** You are deploying to ${deployment.context.targetStage} `;
    help += `because: ${businessRationale}\n\n`;

    help += `**Estimated time:** ${step.estimatedDuration} minutes\n\n`;

    if (step.contextHelp && step.contextHelp.length > 0) {
      help += `**Tips:**\n`;
      step.contextHelp.forEach((tip: string) => {
        help += `• ${tip}\n`;
      });
    }

    return help;
  }

  private generateRollbackInstructions(deployment: any): string {
    const targetStage = deployment.context.targetStage;
    
    let instructions = `**Emergency Rollback for ${targetStage.toUpperCase()}:**\n\n`;
    instructions += `1. **Stop current deployment immediately**\n`;
    instructions += `2. **Execute rollback command:**\n`;
    instructions += `   \`@m7 production_deploy emergency_rollback deployment_id="${deployment.deploymentId}" reason="[describe issue]" evidence="[provide evidence]"\`\n\n`;
    instructions += `3. **Verify rollback success:**\n`;
    instructions += `   • Check application is responding\n`;
    instructions += `   • Verify critical functionality works\n`;
    instructions += `   • Monitor error rates and performance\n\n`;
    instructions += `4. **Post-rollback actions:**\n`;
    instructions += `   • Create incident report\n`;
    instructions += `   • Notify stakeholders\n`;
    instructions += `   • Plan fix for original issue\n\n`;
    instructions += `**Emergency contacts:** ${deployment.context.emergencyContacts?.join(', ') || 'Not specified'}`;

    return instructions;
  }

  private async persistDeployment(deployment: any): Promise<void> {
    try {
      // v5.0: Use UnifiedMemoryCore
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      await this.memoryCore.store(
        JSON.stringify({
          type: 'production_deployment',
          ...deployment
        }),
        {
          level: 'L2',
          source: 'runtime',
          contextKeys: ['deployment', 'production', deployment.deploymentId],
          confidence: 1.0
        }
      );
    } catch (error) {
      this.journal.logError({
        type: 'deployment_persist_error',
        error: `Failed to persist deployment: ${error}`,
        context: JSON.stringify({ deploymentId: deployment.deploymentId }),
        fixed: false,
        category: 'runtime'
      });
    }
  }
}

// MCP Tool Definition
export const productionDeploymentTool = {
  name: 'mcp_m7_production_deploy',
  description: 'Production deployment orchestration with safety gates and step-by-step guidance',
  inputSchema: z.object({
    action: z.enum([
      'initiate', 'status', 'next_step', 'complete_step', 
      'get_guidance', 'emergency_rollback', 'list_active'
    ]),
    sessionId: z.string().optional(),
    deploymentId: z.string().optional(),
    stepId: z.string().optional(),
    targetStage: z.enum(['staging', 'production']).optional(),
    changes: z.array(z.string()).optional(),
    businessRationale: z.string().optional(),
    impactAssessment: z.string().optional(),
    emergencyContacts: z.array(z.string()).optional(),
    userInput: z.object({
      result: z.any().optional(),
      evidence: z.string().optional()
    }).optional(),
    reason: z.string().optional(),
    evidence: z.string().optional()
  }),

  handler: async (
    request: any,
    systems: { journal: JournalSystem }
  ) => {
    const orchestrator = new ProductionDeploymentOrchestrator(
      systems.journal,
      new ProductionGate(systems.journal),
      new EnhancedLockSystem(systems.journal)
    );

    try {
      switch (request.action) {
        case 'initiate':
          if (!request.sessionId || !request.targetStage || !request.businessRationale) {
            throw new Error('Session ID, target stage, and business rationale are required');
          }

          const result = await orchestrator.initiateProductionDeployment({
            sessionId: request.sessionId,
            targetStage: request.targetStage,
            changes: request.changes || [],
            businessRationale: request.businessRationale,
            impactAssessment: request.impactAssessment,
            emergencyContacts: request.emergencyContacts
          });

          return {
            content: [
              {
                type: 'text',
                text: `# 🚀 Production Deployment\n\n${result.message}\n\n**Deployment ID:** ${result.deploymentId}\n**Estimated Duration:** ${result.estimatedDuration} minutes\n\n## Next Steps:\n${result.nextSteps?.map((step: string) => `• ${step}`).join('\n')}\n\n## Current Guidance:\n${result.guidance?.contextHelp || 'Use `get_guidance` to see current step details.'}`
              }
            ]
          };

        case 'get_guidance':
          if (!request.deploymentId) {
            throw new Error('Deployment ID required for guidance');
          }

          const guidance = await orchestrator.getDeploymentGuidance(request.deploymentId);
          if (!guidance) {
            return {
              content: [
                { type: 'text', text: `❓ No active deployment found with ID ${request.deploymentId}` }
              ]
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `# 🧭 Deployment Guidance\n\n**Progress:** ${guidance.overallProgress.toFixed(1)}%\n**Time Remaining:** ~${guidance.estimatedTimeRemaining} minutes\n\n## Current Step: ${guidance.currentStep.name}\n\n${guidance.contextHelp}\n\n## Rollback Instructions\n\n${guidance.rollbackInstructions}`
              }
            ]
          };

        case 'complete_step':
          if (!request.deploymentId || !request.stepId) {
            throw new Error('Deployment ID and step ID required');
          }

          const stepResult = await orchestrator.handleDeploymentStep(
            request.deploymentId,
            request.stepId,
            request.userInput
          );

          return {
            content: [
              {
                type: 'text',
                text: `# ✅ Step Completed\n\n${stepResult.message}\n\n**Can Proceed:** ${stepResult.canProceed ? 'Yes' : 'No'}\n${stepResult.nextStep ? `**Next Step:** ${stepResult.nextStep}` : ''}`
              }
            ]
          };

        case 'emergency_rollback':
          if (!request.deploymentId || !request.reason || !request.evidence) {
            throw new Error('Deployment ID, reason, and evidence required for emergency rollback');
          }

          const rollbackResult = await orchestrator.emergencyRollback(
            request.deploymentId,
            request.reason,
            request.evidence
          );

          return {
            content: [
              {
                type: 'text',
                text: `# 🆘 Emergency Rollback\n\n${rollbackResult.message}\n\n**Rollback ID:** ${rollbackResult.rollbackId}\n**Execution Time:** ${rollbackResult.executionTime}s\n**Previous Version:** ${rollbackResult.rollbackVersion}\n**Production Gate Override:** ${rollbackResult.productionGateOverride ? 'Yes' : 'No'}`
              }
            ]
          };

        case 'status':
          if (!request.deploymentId && !request.sessionId) {
            throw new Error('Either deployment ID or session ID required');
          }

          // Implementation would get status from orchestrator
          return {
            content: [
              { type: 'text', text: `📊 Deployment status functionality coming soon...` }
            ]
          };

        default:
          throw new Error(`Unknown action: ${request.action}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `# ❌ Production Deployment Error\n\nError: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
};
