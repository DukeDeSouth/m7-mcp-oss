#!/usr/bin/env node

import { z } from 'zod';
import { JournalSystem } from '../../journal/journalSystem.js';
import { ProductionGate } from './productionGate.js';
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';
// v5.0: Uses UnifiedMemoryCore instead of MemorySystem

// Import existing lock system types
interface LockRequirements {
  requireTests: boolean;
  requireManualConfirmation: boolean;
  requireRegressionCheck: boolean;
  requirePlaywrightValidation?: boolean;
  requireCodeReview?: boolean;
  requirePerformanceCheck?: boolean;
  customChecks?: CustomCheck[];
  minimumWaitTime?: number; // minutes
}

interface CustomCheck {
  id: string;
  name: string;
  description: string;
  command?: string;
  validator?: (result: any) => boolean;
  required: boolean;
}

// Enhanced Lock System Types
interface EnhancedLockRequirements extends LockRequirements {
  stageSpecificRequirements?: {
    [stage: string]: Partial<LockRequirements>;
  };
  autoActivateOnStage?: string[];
  productionGate?: {
    enabled: boolean;
    config?: any;
  };
}

interface DeploymentContext {
  sessionId: string;
  deploymentId: string;
  fromStage: string;
  targetStage: string;
  businessRationale: string;
  impactAssessment?: string;
  emergencyContacts: string[];
  startedAt: Date;
  estimatedDuration: number;
}

interface StageTransitionRequest {
  sessionId: string;
  fromStage: string;
  targetStage: string;
  changes: string[];
  businessRationale: string;
  emergencyContacts?: string[];
}

interface StageTransitionResult {
  success: boolean;
  gateActivated: boolean;
  lockActivated: boolean;
  deploymentId?: string;
  gateId?: string;
  estimatedDuration: number;
  requiredChecks: string[];
  nextSteps: string[];
  message: string;
}

// Stage-specific requirements configuration
const STAGE_REQUIREMENTS: Record<string, Partial<LockRequirements>> = {
  planning: {
    requireManualConfirmation: true,
    minimumWaitTime: 0
  },
  development: {
    requireTests: true,
    requireManualConfirmation: false,
    minimumWaitTime: 0
  },
  testing: {
    requireTests: true,
    requireRegressionCheck: true,
    requireManualConfirmation: true,
    minimumWaitTime: 15 // 15 minutes
  },
  staging: {
    requireTests: true,
    requireRegressionCheck: true,
    requirePlaywrightValidation: true,
    requireManualConfirmation: true,
    minimumWaitTime: 30, // 30 minutes
    customChecks: [
      {
        id: 'staging_smoke_test',
        name: 'Staging Environment Smoke Test',
        description: 'Basic functionality test in staging environment',
        command: '@playwright browser_snapshot',
        required: true
      }
    ]
  },
  production: {
    requireTests: true,
    requireRegressionCheck: true,
    requirePlaywrightValidation: true,
    requireCodeReview: true,
    requirePerformanceCheck: true,
    requireManualConfirmation: true,
    minimumWaitTime: 60, // 1 hour
    customChecks: [] // Will be populated by ProductionGate
  }
};

export class EnhancedLockSystem {
  private locks: Map<string, any> = new Map(); // Existing locks from base system
  private productionGate: ProductionGate;
  private globalLockEnabled: boolean = true;
  private memoryCore: UnifiedMemoryCore | null = null;

  constructor(
    private journal: JournalSystem
  ) {
    this.productionGate = new ProductionGate(journal);
    this.loadExistingLocks();
  }

  private async loadExistingLocks(): Promise<void> {
    try {
      // v5.0: Use UnifiedMemoryCore
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      const lockData = await this.memoryCore.cascadeSearch('session_locks', { limit: 20 });
      if (lockData && Array.isArray(lockData)) {
        lockData.forEach((memory: any) => {
          if (memory.data?.sessionId) {
            this.locks.set(memory.data.sessionId, memory.data);
          }
        });
      }
    } catch (error) {
      this.journal.logError({
        type: 'enhanced_lock_load_error',
        error: `Failed to load existing enhanced locks: ${error}`,
        context: JSON.stringify({ component: 'EnhancedLockSystem' }),
        fixed: false,
        category: 'runtime'
      });
    }
  }

  async lockSessionForStage(
    sessionId: string,
    targetStage: string,
    context: DeploymentContext
  ): Promise<StageTransitionResult> {
    
    // Get stage-specific requirements
    const stageRequirements = this.getStageRequirements(targetStage);
    
    // Check if production gate should be activated
    const shouldActivateProductionGate = 
      (targetStage === 'staging' || targetStage === 'production') &&
      this.isProductionGateStage(targetStage);

    let gateActivated = false;
    let gateId: string | undefined;
    let productionGateChecks: string[] = [];

    // Activate production gate if required
    if (shouldActivateProductionGate) {
      try {
        const gateResult = await this.productionGate.activateGate(
          sessionId,
          targetStage as 'staging' | 'production',
          context
        );
        
        if (gateResult.success) {
          gateActivated = true;
          gateId = gateResult.gateId;
          productionGateChecks = gateResult.requiredChecks;
          
          // Add production gate checks to lock requirements
          stageRequirements.customChecks = [
            ...(stageRequirements.customChecks || []),
            ...productionGateChecks.map(checkId => ({
              id: `production_gate_${checkId}`,
              name: `Production Gate: ${checkId}`,
              description: `Complete production gate check: ${checkId}`,
              required: true
            }))
          ];
        }
      } catch (error) {
        this.journal.logError({
          type: 'production_gate_activation_error',
          error: `Failed to activate production gate: ${error}`,
          context: JSON.stringify({ sessionId, targetStage }),
          fixed: false,
          category: 'runtime'
        });
      }
    }

    // Create enhanced lock with stage requirements
    const lockReason = `Stage transition to ${targetStage}${gateActivated ? ' with production gate' : ''}`;
    const lockResult = await this.createEnhancedLock(
      sessionId,
      lockReason,
      stageRequirements,
      context
    );

    // Calculate estimated duration
    const estimatedDuration = this.calculateEstimatedDuration(stageRequirements);

    // Generate next steps
    const nextSteps = this.generateNextSteps(stageRequirements, gateActivated);

    // Generate required checks list
    const requiredChecks = this.generateRequiredChecks(stageRequirements);

    return {
      success: lockResult.success,
      gateActivated,
      lockActivated: lockResult.success,
      deploymentId: context.deploymentId,
      gateId,
      estimatedDuration,
      requiredChecks,
      nextSteps,
      message: this.generateTransitionMessage(targetStage, gateActivated, estimatedDuration)
    };
  }

  private getStageRequirements(stage: string): LockRequirements {
    const baseRequirements = STAGE_REQUIREMENTS[stage] || {};
    
    // Ensure all required fields are present
    return {
      requireTests: baseRequirements.requireTests || false,
      requireManualConfirmation: baseRequirements.requireManualConfirmation || false,
      requireRegressionCheck: baseRequirements.requireRegressionCheck || false,
      requirePlaywrightValidation: baseRequirements.requirePlaywrightValidation || false,
      requireCodeReview: baseRequirements.requireCodeReview || false,
      requirePerformanceCheck: baseRequirements.requirePerformanceCheck || false,
      customChecks: baseRequirements.customChecks || [],
      minimumWaitTime: baseRequirements.minimumWaitTime || 0
    };
  }

  private isProductionGateStage(stage: string): boolean {
    return ['staging', 'production'].includes(stage);
  }

  private async createEnhancedLock(
    sessionId: string,
    reason: string,
    requirements: LockRequirements,
    context: DeploymentContext
  ): Promise<{ success: boolean; message: string }> {
    
    if (this.locks.has(sessionId)) {
      return {
        success: false,
        message: `Session ${sessionId} is already locked`
      };
    }

    const lock = {
      sessionId,
      lockedAt: new Date(),
      lockReason: reason,
      requirements,
      context,
      completedChecks: this.initializeChecks(requirements),
      unlockAttempts: [],
      forceUnlocked: false,
      stageTransition: true,
      targetStage: context.targetStage
    };

    this.locks.set(sessionId, lock);
    await this.persistLock(lock);

    // Log enhanced lock creation
    this.journal.logFeature({
      name: 'Enhanced Session Lock',
      description: `Locked session ${sessionId} for stage transition: ${reason}`,
      implementation: `Stage-aware lock with ${Object.keys(lock.completedChecks).length} checks for ${context.targetStage}`,
      lessons: [],
      patterns: ['enhanced-session-locking', 'stage-aware-deployment'],
      complexity: 'medium'
    });

    return {
      success: true,
      message: `🔒 Enhanced lock activated for stage transition to ${context.targetStage}`
    };
  }

  private initializeChecks(requirements: LockRequirements): Record<string, any> {
    const checks: Record<string, any> = {};

    if (requirements.requireTests) {
      checks.tests = { completed: false, stage_requirement: true };
    }

    if (requirements.requireManualConfirmation) {
      checks.manual_confirmation = { completed: false, stage_requirement: true };
    }

    if (requirements.requireRegressionCheck) {
      checks.regression_check = { completed: false, stage_requirement: true };
    }

    if (requirements.requirePlaywrightValidation) {
      checks.playwright_validation = { completed: false, stage_requirement: true };
    }

    if (requirements.requireCodeReview) {
      checks.code_review = { completed: false, stage_requirement: true };
    }

    if (requirements.requirePerformanceCheck) {
      checks.performance_check = { completed: false, stage_requirement: true };
    }

    if (requirements.customChecks) {
      requirements.customChecks.forEach(check => {
        checks[check.id] = { 
          completed: false, 
          stage_requirement: true,
          custom: true,
          config: check
        };
      });
    }

    return checks;
  }

  private async persistLock(lock: any): Promise<void> {
    try {
      // v5.0: Use UnifiedMemoryCore
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      await this.memoryCore.store(
        JSON.stringify({
          type: 'enhanced_session_lock',
          ...lock
        }),
        {
          level: 'L1',
          source: 'runtime',
          contextKeys: ['lock', 'session', lock.sessionId],
          confidence: 1.0
        }
      );
    } catch (error) {
      this.journal.logError({
        type: 'enhanced_lock_persist_error',
        error: `Failed to persist enhanced lock: ${error}`,
        context: JSON.stringify({ sessionId: lock.sessionId }),
        fixed: false,
        category: 'runtime'
      });
    }
  }

  private calculateEstimatedDuration(requirements: LockRequirements): number {
    let duration = requirements.minimumWaitTime || 0;

    // Add time estimates for different check types
    if (requirements.requireTests) duration += 10; // 10 minutes
    if (requirements.requireRegressionCheck) duration += 20; // 20 minutes
    if (requirements.requirePlaywrightValidation) duration += 15; // 15 minutes
    if (requirements.requireCodeReview) duration += 30; // 30 minutes
    if (requirements.requirePerformanceCheck) duration += 25; // 25 minutes
    if (requirements.requireManualConfirmation) duration += 5; // 5 minutes

    // Add time for custom checks
    if (requirements.customChecks) {
      duration += requirements.customChecks.length * 10; // 10 minutes per custom check
    }

    return duration; // in minutes
  }

  private generateNextSteps(requirements: LockRequirements, gateActivated: boolean): string[] {
    const steps: string[] = [];

    if (gateActivated) {
      steps.push('🚪 Production gate activated - enhanced security checks required');
    }

    if (requirements.requireTests) {
      steps.push('🧪 Run test suite: `npm test` or `yarn test`');
    }

    if (requirements.requireRegressionCheck) {
      steps.push('🔄 Run regression tests to verify no functionality broken');
    }

    if (requirements.requirePlaywrightValidation) {
      steps.push('🎭 Run Playwright E2E tests: `@playwright browser_snapshot`');
    }

    if (requirements.requirePerformanceCheck) {
      steps.push('⚡ Run performance benchmarks and verify no degradation');
    }

    if (requirements.requireCodeReview) {
      steps.push('👥 Complete code review process with team approval');
    }

    if (requirements.requireManualConfirmation) {
      steps.push('✋ Provide manual confirmation that changes work as expected');
    }

    if (requirements.customChecks && requirements.customChecks.length > 0) {
      requirements.customChecks.forEach(check => {
        let step = `• ${check.name}`;
        if (check.command) {
          step += `: \`${check.command}\``;
        }
        steps.push(step);
      });
    }

    if (requirements.minimumWaitTime && requirements.minimumWaitTime > 0) {
      steps.push(`⏱️ Wait minimum ${requirements.minimumWaitTime} minutes before deployment`);
    }

    if (steps.length === 0) {
      steps.push('✅ No additional requirements - ready to proceed');
    }

    return steps;
  }

  private generateRequiredChecks(requirements: LockRequirements): string[] {
    const checks: string[] = [];

    if (requirements.requireTests) checks.push('tests');
    if (requirements.requireManualConfirmation) checks.push('manual_confirmation');
    if (requirements.requireRegressionCheck) checks.push('regression_check');
    if (requirements.requirePlaywrightValidation) checks.push('playwright_validation');
    if (requirements.requireCodeReview) checks.push('code_review');
    if (requirements.requirePerformanceCheck) checks.push('performance_check');

    if (requirements.customChecks) {
      checks.push(...requirements.customChecks.map(c => c.id));
    }

    return checks;
  }

  private generateTransitionMessage(
    targetStage: string,
    gateActivated: boolean,
    estimatedDuration: number
  ): string {
    const durationText = estimatedDuration > 0 
      ? ` (estimated ${estimatedDuration} minutes)`
      : '';

    if (gateActivated) {
      return `🚪 Production gate activated for ${targetStage} deployment${durationText}. Enhanced security checks required.`;
    }

    return `🔒 Stage transition lock activated for ${targetStage}${durationText}. Complete required checks to proceed.`;
  }

  // Integration methods with existing lock system
  async completeStageCheck(
    sessionId: string,
    checkId: string,
    result?: any,
    evidence?: string
  ): Promise<{ success: boolean; message: string; remainingChecks: string[] }> {
    
    const lock = this.locks.get(sessionId);
    if (!lock) {
      throw new Error(`No enhanced lock found for session ${sessionId}`);
    }

    // If this is a production gate check, delegate to production gate
    if (checkId.startsWith('production_gate_')) {
      const actualCheckId = checkId.replace('production_gate_', '');
      
      try {
        const gateResult = await this.productionGate.completeCheck(
          sessionId,
          actualCheckId,
          result,
          evidence
        );

        // Update local lock
        lock.completedChecks[checkId] = {
          completed: true,
          timestamp: new Date(),
          result,
          evidence,
          production_gate_check: true
        };

        await this.persistLock(lock);

        return gateResult;
      } catch (error) {
        throw new Error(`Production gate check failed: ${error}`);
      }
    }

    // Handle regular stage checks
    if (!lock.completedChecks.hasOwnProperty(checkId)) {
      throw new Error(`Check "${checkId}" is not required for this stage transition`);
    }

    lock.completedChecks[checkId] = {
      completed: true,
      timestamp: new Date(),
      result,
      evidence
    };

    await this.persistLock(lock);

    // Log check completion
    this.journal.logFeature({
      name: 'Enhanced Lock Check Completed',
      description: `Completed stage check "${checkId}" for session ${sessionId}`,
      implementation: `Stage check ${checkId} completed for ${lock.targetStage} transition`,
      lessons: [],
      patterns: ['enhanced-session-locking', 'stage-aware-deployment'],
      complexity: 'light'
    });

    const remainingChecks = Object.entries(lock.completedChecks)
      .filter(([_, check]) => !(check as any)?.completed)
      .map(([checkId, _]) => checkId);

    return {
      success: true,
      message: `✅ Stage check "${checkId}" completed. ${remainingChecks.length} checks remaining.`,
      remainingChecks
    };
  }

  async getStageTransitionStatus(sessionId: string): Promise<any> {
    const lock = this.locks.get(sessionId);
    const gateStatus = await this.productionGate.checkGateStatus(sessionId);

    if (!lock && !gateStatus) {
      return null;
    }

    const result: any = {
      sessionId,
      hasLock: !!lock,
      hasGate: !!gateStatus,
    };

    if (lock) {
      const totalChecks = Object.keys(lock.completedChecks).length;
      const completedCount = Object.values(lock.completedChecks)
        .filter((check: any) => check.completed).length;
      
      result.lockStatus = {
        progress: totalChecks > 0 ? (completedCount / totalChecks) * 100 : 0,
        targetStage: lock.targetStage,
        lockedAt: lock.lockedAt,
        completedChecks: Object.entries(lock.completedChecks)
          .filter(([_, check]) => (check as any).completed)
          .map(([checkId, _]) => checkId),
        remainingChecks: Object.entries(lock.completedChecks)
          .filter(([_, check]) => !(check as any).completed)
          .map(([checkId, _]) => checkId)
      };
    }

    if (gateStatus) {
      result.gateStatus = gateStatus;
    }

    return result;
  }

  formatStageTransitionReport(sessionId: string): string {
    const lock = this.locks.get(sessionId);
    
    if (!lock) {
      return `❓ **No stage transition lock found for session ${sessionId}**`;
    }

    let report = `🔒 **Stage Transition Lock - ${sessionId}**\n\n`;
    
    report += `**Target Stage:** ${lock.targetStage}\n`;
    report += `**Locked At:** ${lock.lockedAt.toLocaleString()}\n`;
    report += `**Reason:** ${lock.lockReason}\n\n`;

    if (lock.context?.businessRationale) {
      report += `**Business Rationale:** ${lock.context.businessRationale}\n\n`;
    }

    const totalChecks = Object.keys(lock.completedChecks).length;
    const completedCount = Object.values(lock.completedChecks)
      .filter((check: any) => check.completed).length;
    const progress = totalChecks > 0 ? (completedCount / totalChecks) * 100 : 0;

    report += `**Progress:** ${progress.toFixed(1)}% (${completedCount}/${totalChecks})\n\n`;

    // Add production gate status if applicable
    const isGateActive = this.productionGate.isGateActiveForSession(sessionId);
    if (isGateActive) {
      report += `🚪 **Production Gate:** Active\n`;
      report += this.productionGate.formatGateReport(sessionId) + '\n\n';
    }

    return report;
  }

  // Public API methods
  isGlobalLockEnabled(): boolean {
    return this.globalLockEnabled;
  }

  enableGlobalLock(): void {
    this.globalLockEnabled = true;
  }

  disableGlobalLock(): void {
    this.globalLockEnabled = false;
  }
}
