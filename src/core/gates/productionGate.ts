#!/usr/bin/env node

import { z } from 'zod';
import { JournalSystem } from '../../journal/journalSystem.js';
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';
// v5.0: Uses UnifiedMemoryCore instead of MemorySystem

// Production Gate Types
interface ProductionGateConfig {
  autoActivateOnStages: Array<'staging' | 'production'>;
  mandatoryChecks: ProductionCheck[];
  approvalChain: ApprovalLevel[];
  rollbackStrategy: RollbackStrategy;
  timeoutMinutes: number;
  emergencyOverride: {
    enabled: boolean;
    requiresToken: boolean;
    auditLevel: 'full' | 'minimal';
  };
}

interface ProductionCheck {
  id: string;
  name: string;
  description: string;
  type: 'automated' | 'manual' | 'hybrid';
  command?: string;
  validator?: string; // Serialized function name
  timeout: number;
  required: boolean;
  evidence_required: boolean;
  category: 'security' | 'performance' | 'business' | 'technical';
}

interface ApprovalLevel {
  level: number;
  roles: string[];
  requiredApprovals: number;
  timeoutMinutes: number;
}

interface RollbackStrategy {
  autoRollbackTriggers: string[];
  rollbackTimeoutMinutes: number;
  verificationRequired: boolean;
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

interface GateActivationResult {
  success: boolean;
  gateId: string;
  deploymentId: string;
  requiredChecks: string[];
  estimatedDuration: number;
  nextSteps: string[];
  emergencyOverrideAvailable: boolean;
}

interface GateStatus {
  gateId: string;
  isActive: boolean;
  progress: number;
  completedChecks: string[];
  blockedChecks: string[];
  currentStep: string;
  estimatedTimeRemaining: number;
  canProceed: boolean;
}

interface CheckResult {
  success: boolean;
  checkId: string;
  result: any;
  evidence?: string;
  message: string;
  remainingChecks: string[];
}

// Default Production Checks Configuration
export const DEFAULT_PRODUCTION_CHECKS: ProductionCheck[] = [
  {
    id: 'security_scan',
    name: 'Security Vulnerability Scan',
    description: 'Scan for known vulnerabilities in dependencies',
    type: 'automated',
    command: 'npm audit --audit-level moderate',
    timeout: 300, // 5 minutes
    required: true,
    evidence_required: false,
    category: 'security'
  },
  {
    id: 'performance_benchmark',
    name: 'Performance Regression Test',
    description: 'Ensure no performance degradation compared to baseline',
    type: 'automated', 
    command: 'npm run benchmark:production',
    timeout: 600, // 10 minutes
    required: true,
    evidence_required: true,
    category: 'performance'
  },
  {
    id: 'database_migration_test',
    name: 'Database Migration Verification',
    description: 'Test database migrations on production-like dataset',
    type: 'hybrid',
    timeout: 1200, // 20 minutes
    required: true,
    evidence_required: true,
    category: 'technical'
  },
  {
    id: 'rollback_verification',
    name: 'Rollback Process Verification',
    description: 'Verify that rollback can be executed successfully',
    type: 'manual',
    timeout: 300, // 5 minutes
    required: true,
    evidence_required: true,
    category: 'technical'
  },
  {
    id: 'business_approval',
    name: 'Business Stakeholder Sign-off',
    description: 'Product owner or business stakeholder approval for production deployment',
    type: 'manual',
    timeout: 7200, // 2 hours
    required: true,
    evidence_required: true,
    category: 'business'
  },
  {
    id: 'final_smoke_test',
    name: 'Production Environment Smoke Test',
    description: 'Basic functionality test in production-like environment',
    type: 'automated',
    command: '@playwright browser_snapshot && @playwright run_smoke_tests',
    timeout: 900, // 15 minutes
    required: true,
    evidence_required: true,
    category: 'technical'
  }
];

// Default Configuration
const DEFAULT_PRODUCTION_GATE_CONFIG: ProductionGateConfig = {
  autoActivateOnStages: ['staging', 'production'],
  mandatoryChecks: DEFAULT_PRODUCTION_CHECKS,
  approvalChain: [
    {
      level: 1,
      roles: ['tech_lead', 'senior_developer'],
      requiredApprovals: 1,
      timeoutMinutes: 60
    },
    {
      level: 2,
      roles: ['product_owner', 'business_stakeholder'],
      requiredApprovals: 1,
      timeoutMinutes: 120
    }
  ],
  rollbackStrategy: {
    autoRollbackTriggers: [
      'performance_degradation_20_percent',
      'error_rate_increase_5_percent',
      'security_vulnerability_detected',
      'business_critical_failure'
    ],
    rollbackTimeoutMinutes: 15,
    verificationRequired: true
  },
  timeoutMinutes: 240, // 4 hours
  emergencyOverride: {
    enabled: true,
    requiresToken: true,
    auditLevel: 'full'
  }
};

interface ActiveGate {
  gateId: string;
  sessionId: string;
  deploymentId: string;
  config: ProductionGateConfig;
  context: DeploymentContext;
  activatedAt: Date;
  completedChecks: Record<string, {
    completed: boolean;
    timestamp?: Date;
    result?: any;
    evidence?: string;
    approver?: string;
  }>;
  status: 'active' | 'completed' | 'failed' | 'emergency_override';
  emergencyOverrideUsed: boolean;
}

export class ProductionGate {
  private activeGates: Map<string, ActiveGate> = new Map();
  private config: ProductionGateConfig;
  private memoryCore: UnifiedMemoryCore | null = null;

  constructor(
    private journal: JournalSystem,
    config?: Partial<ProductionGateConfig>
  ) {
    this.config = { ...DEFAULT_PRODUCTION_GATE_CONFIG, ...config };
    this.loadExistingGates();
  }

  private async loadExistingGates(): Promise<void> {
    try {
      // v5.0: Use UnifiedMemoryCore
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      const gateData = await this.memoryCore.cascadeSearch('production_gates', { limit: 20 });
      if (gateData && Array.isArray(gateData)) {
        gateData.forEach((memory: any) => {
          if (memory.data?.gateId && memory.data.status === 'active') {
            this.activeGates.set(memory.data.gateId, memory.data);
          }
        });
      }
    } catch (error) {
      this.journal.logError({
        type: 'gate_load_error',
        error: `Failed to load existing gates: ${error}`,
        context: JSON.stringify({ component: 'ProductionGate' }),
        fixed: false,
        category: 'runtime'
      });
    }
  }

  private async persistGate(gate: ActiveGate): Promise<void> {
    try {
      // v5.0: Use UnifiedMemoryCore
      if (!this.memoryCore) {
        this.memoryCore = await getMemoryCore();
      }
      await this.memoryCore.store(
        JSON.stringify({
          type: 'production_gate',
          ...gate
        }),
        {
          level: 'L2',
          source: 'runtime',
          contextKeys: ['gate', 'production', gate.gateId],
          confidence: 1.0
        }
      );
    } catch (error) {
      this.journal.logError({
        type: 'gate_persist_error',
        error: `Failed to persist gate: ${error}`,
        context: JSON.stringify({ gateId: gate.gateId }),
        fixed: false,
        category: 'runtime'
      });
    }
  }

  async activateGate(
    sessionId: string,
    targetStage: 'staging' | 'production',
    context: DeploymentContext
  ): Promise<GateActivationResult> {
    
    // Check if stage requires gate activation
    if (!this.config.autoActivateOnStages.includes(targetStage)) {
      return {
        success: false,
        gateId: '',
        deploymentId: context.deploymentId,
        requiredChecks: [],
        estimatedDuration: 0,
        nextSteps: [`Stage ${targetStage} does not require production gate`],
        emergencyOverrideAvailable: false
      };
    }

    // Generate unique gate ID
    const gateId = `gate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Initialize completed checks tracking
    const completedChecks: Record<string, any> = {};
    this.config.mandatoryChecks.forEach(check => {
      completedChecks[check.id] = {
        completed: false,
        timestamp: undefined,
        result: undefined,
        evidence: undefined
      };
    });

    // Create active gate
    const activeGate: ActiveGate = {
      gateId,
      sessionId,
      deploymentId: context.deploymentId,
      config: this.config,
      context,
      activatedAt: new Date(),
      completedChecks,
      status: 'active',
      emergencyOverrideUsed: false
    };

    // Store gate
    this.activeGates.set(gateId, activeGate);
    await this.persistGate(activeGate);

    // Calculate estimated duration
    const estimatedDuration = this.config.mandatoryChecks.reduce(
      (total, check) => total + check.timeout, 0
    );

    // Generate next steps
    const nextSteps = this.generateNextSteps(activeGate);

    // Log gate activation
    this.journal.logFeature({
      name: 'Production Gate Activated',
      description: `Activated production gate for ${targetStage} deployment`,
      implementation: `Gate ${gateId} activated with ${this.config.mandatoryChecks.length} required checks`,
      lessons: [],
      patterns: ['production-gate', 'deployment-safety'],
      complexity: 'medium'
    });

    return {
      success: true,
      gateId,
      deploymentId: context.deploymentId,
      requiredChecks: this.config.mandatoryChecks.map(c => c.id),
      estimatedDuration,
      nextSteps,
      emergencyOverrideAvailable: this.config.emergencyOverride.enabled
    };
  }

  async checkGateStatus(sessionId: string): Promise<GateStatus | null> {
    // Find active gate for session
    const activeGate = Array.from(this.activeGates.values()).find(
      gate => gate.sessionId === sessionId && gate.status === 'active'
    );

    if (!activeGate) {
      return null;
    }

    const totalChecks = this.config.mandatoryChecks.length;
    const completedCount = Object.values(activeGate.completedChecks)
      .filter(check => check.completed).length;
    
    const progress = totalChecks > 0 ? (completedCount / totalChecks) * 100 : 0;

    const completedChecks = Object.entries(activeGate.completedChecks)
      .filter(([_, check]) => check.completed)
      .map(([checkId, _]) => checkId);

    const blockedChecks = Object.entries(activeGate.completedChecks)
      .filter(([_, check]) => !check.completed)
      .map(([checkId, _]) => checkId);

    const currentStep = blockedChecks.length > 0 ? blockedChecks[0] : 'all_completed';
    
    // Calculate estimated time remaining
    const remainingChecks = this.config.mandatoryChecks
      .filter(check => blockedChecks.includes(check.id));
    const estimatedTimeRemaining = remainingChecks.reduce(
      (total, check) => total + check.timeout, 0
    );

    const canProceed = blockedChecks.length === 0;

    return {
      gateId: activeGate.gateId,
      isActive: true,
      progress,
      completedChecks,
      blockedChecks,
      currentStep,
      estimatedTimeRemaining,
      canProceed
    };
  }

  async completeCheck(
    sessionId: string,
    checkId: string,
    result: any,
    evidence?: string,
    approver?: string
  ): Promise<CheckResult> {
    
    // Find active gate
    const activeGate = Array.from(this.activeGates.values()).find(
      gate => gate.sessionId === sessionId && gate.status === 'active'
    );

    if (!activeGate) {
      throw new Error(`No active production gate found for session ${sessionId}`);
    }

    if (!activeGate.completedChecks.hasOwnProperty(checkId)) {
      throw new Error(`Check "${checkId}" is not required for this gate`);
    }

    if (activeGate.completedChecks[checkId].completed) {
      throw new Error(`Check "${checkId}" is already completed`);
    }

    // Get check configuration
    const checkConfig = this.config.mandatoryChecks.find(c => c.id === checkId);
    if (!checkConfig) {
      throw new Error(`Check configuration not found for "${checkId}"`);
    }

    // Validate evidence if required
    if (checkConfig.evidence_required && !evidence) {
      throw new Error(`Evidence is required for check "${checkId}"`);
    }

    // Complete the check
    activeGate.completedChecks[checkId] = {
      completed: true,
      timestamp: new Date(),
      result,
      evidence,
      approver
    };

    // Update gate status if all checks completed
    const allCompleted = Object.values(activeGate.completedChecks)
      .every(check => check.completed);
    
    if (allCompleted) {
      activeGate.status = 'completed';
    }

    await this.persistGate(activeGate);

    // Log check completion
    this.journal.logFeature({
      name: 'Production Gate Check Completed',
      description: `Completed check "${checkConfig.name}" for production gate`,
      implementation: `Check ${checkId} completed by ${approver || 'system'}`,
      lessons: [],
      patterns: ['production-gate', 'deployment-safety'],
      complexity: 'light'
    });

    const remainingChecks = Object.entries(activeGate.completedChecks)
      .filter(([_, check]) => !check.completed)
      .map(([checkId, _]) => checkId);

    return {
      success: true,
      checkId,
      result,
      evidence,
      message: `✅ Check "${checkConfig.name}" completed. ${remainingChecks.length} checks remaining.`,
      remainingChecks
    };
  }

  async requestEmergencyOverride(
    sessionId: string,
    reason: string,
    token?: string
  ): Promise<{ success: boolean; message: string; gateId?: string }> {
    
    if (!this.config.emergencyOverride.enabled) {
      return {
        success: false,
        message: '🚫 Emergency override is disabled for this gate configuration'
      };
    }

    // Find active gate
    const activeGate = Array.from(this.activeGates.values()).find(
      gate => gate.sessionId === sessionId && gate.status === 'active'
    );

    if (!activeGate) {
      return {
        success: false,
        message: '❌ No active production gate found for emergency override'
      };
    }

    // Validate token if required
    if (this.config.emergencyOverride.requiresToken && !token) {
      return {
        success: false,
        message: '🔑 Emergency override token is required'
      };
    }

    // TODO: Validate token against secure store
    // For now, accept any non-empty token
    if (this.config.emergencyOverride.requiresToken && token && token.length < 8) {
      return {
        success: false,
        message: '🚫 Invalid emergency override token'
      };
    }

    // Execute emergency override
    activeGate.status = 'emergency_override';
    activeGate.emergencyOverrideUsed = true;

    await this.persistGate(activeGate);

    // Log emergency override with full audit
    this.journal.logError({
      type: 'emergency_override',
      error: `Production gate emergency override used: ${reason}`,
      context: JSON.stringify({
        gateId: activeGate.gateId,
        sessionId,
        reason,
        tokenUsed: !!token,
        auditLevel: this.config.emergencyOverride.auditLevel,
        timestamp: new Date()
      }),
      fixed: false,
      category: 'security'
    });

    return {
      success: true,
      message: `⚠️ Emergency override activated for gate ${activeGate.gateId}. All checks bypassed.`,
      gateId: activeGate.gateId
    };
  }

  private generateNextSteps(gate: ActiveGate): string[] {
    const steps: string[] = [];
    const pendingChecks = this.config.mandatoryChecks.filter(
      check => !gate.completedChecks[check.id]?.completed
    );

    if (pendingChecks.length === 0) {
      steps.push('🎉 All production checks completed! Ready for deployment.');
      return steps;
    }

    // Add steps for each pending check
    pendingChecks.slice(0, 3).forEach(check => { // Show first 3 steps
      let step = `• ${check.name}`;
      
      if (check.type === 'automated' && check.command) {
        step += `: Run \`${check.command}\``;
      } else if (check.type === 'manual') {
        step += ': Manual verification required';
      } else {
        step += ': Review and complete';
      }
      
      if (check.evidence_required) {
        step += ' (evidence required)';
      }
      
      steps.push(step);
    });

    if (pendingChecks.length > 3) {
      steps.push(`... and ${pendingChecks.length - 3} more checks`);
    }

    steps.push(`\n📊 Progress: ${Object.values(gate.completedChecks).filter(c => c.completed).length}/${this.config.mandatoryChecks.length} checks completed`);

    if (this.config.emergencyOverride.enabled) {
      steps.push(`\n⚠️ Emergency override available if needed`);
    }

    return steps;
  }

  formatGateReport(sessionId: string): string {
    const activeGate = Array.from(this.activeGates.values()).find(
      gate => gate.sessionId === sessionId
    );

    if (!activeGate) {
      return `❓ **No production gate found for session ${sessionId}**`;
    }

    let report = `🚪 **Production Gate ${activeGate.gateId}**\n\n`;
    
    report += `**Status:** ${this.getStatusEmoji(activeGate.status)} ${activeGate.status.toUpperCase()}\n`;
    report += `**Target Stage:** ${activeGate.context.targetStage}\n`;
    report += `**Activated:** ${activeGate.activatedAt.toLocaleString()}\n`;
    report += `**Deployment:** ${activeGate.deploymentId}\n\n`;

    if (activeGate.context.businessRationale) {
      report += `**Business Rationale:** ${activeGate.context.businessRationale}\n\n`;
    }

    const totalChecks = this.config.mandatoryChecks.length;
    const completedCount = Object.values(activeGate.completedChecks)
      .filter(check => check.completed).length;
    const progress = totalChecks > 0 ? (completedCount / totalChecks) * 100 : 0;

    report += `**Progress:** ${progress.toFixed(1)}% (${completedCount}/${totalChecks})\n\n`;

    // Completed checks
    const completedChecks = Object.entries(activeGate.completedChecks)
      .filter(([_, check]) => check.completed);

    if (completedChecks.length > 0) {
      report += `**✅ Completed Checks:**\n`;
      completedChecks.forEach(([checkId, checkData]) => {
        const checkConfig = this.config.mandatoryChecks.find(c => c.id === checkId);
        const checkName = checkConfig?.name || checkId;
        report += `  • ${checkName}`;
        if (checkData.timestamp) {
          report += ` (${checkData.timestamp.toLocaleTimeString()})`;
        }
        if (checkData.approver) {
          report += ` - by ${checkData.approver}`;
        }
        report += `\n`;
      });
      report += `\n`;
    }

    // Pending checks
    const pendingChecks = Object.entries(activeGate.completedChecks)
      .filter(([_, check]) => !check.completed);

    if (pendingChecks.length > 0) {
      report += `**⏳ Pending Checks:**\n`;
      pendingChecks.forEach(([checkId, _]) => {
        const checkConfig = this.config.mandatoryChecks.find(c => c.id === checkId);
        const checkName = checkConfig?.name || checkId;
        report += `  • ${checkName}`;
        if (checkConfig?.command) {
          report += ` - \`${checkConfig.command}\``;
        }
        report += `\n`;
      });
    }

    if (activeGate.status === 'completed') {
      report += `\n🎉 **Gate completed! Deployment can proceed.**`;
    } else if (activeGate.status === 'emergency_override') {
      report += `\n⚠️ **Emergency override was used - full audit required.**`;
    } else if (pendingChecks.length > 0) {
      report += `\n📋 **Next:** Complete ${pendingChecks[0][0]} check`;
    }

    return report;
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'active': return '🟡';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'emergency_override': return '⚠️';
      default: return '❓';
    }
  }

  // Public API for integration
  getAllActiveGates(): Array<{ sessionId: string; gateId: string; status: string; progress: number }> {
    return Array.from(this.activeGates.values())
      .filter(gate => gate.status === 'active')
      .map(gate => {
        const totalChecks = this.config.mandatoryChecks.length;
        const completedCount = Object.values(gate.completedChecks)
          .filter(check => check.completed).length;
        const progress = totalChecks > 0 ? (completedCount / totalChecks) * 100 : 0;

        return {
          sessionId: gate.sessionId,
          gateId: gate.gateId,
          status: gate.status,
          progress
        };
      });
  }

  isGateActiveForSession(sessionId: string): boolean {
    return Array.from(this.activeGates.values()).some(
      gate => gate.sessionId === sessionId && gate.status === 'active'
    );
  }

  getGateIdForSession(sessionId: string): string | null {
    const gate = Array.from(this.activeGates.values()).find(
      gate => gate.sessionId === sessionId && gate.status === 'active'
    );
    return gate?.gateId || null;
  }
}
