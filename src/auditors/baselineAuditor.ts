import path from 'path';
import { promises as fs } from 'fs';
import { getProjectPath } from '../core/utils/projectPath.js';

export interface AuditReport {
  timestamp: number;
  duration: number;
  projectHealth: 'healthy' | 'warning' | 'critical';
  issues: AuditIssue[];
  recommendations: string[];
  summary: string;
}

export interface AuditIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'structure' | 'dependencies' | 'config' | 'security' | 'performance';
  description: string;
  location?: string;
  solution?: string;
}

export interface QuickCheckResult {
  passed: boolean;
  duration: number;
  reason?: string;
}

export class BaselineAuditor {
  private dataPath: string;

  constructor(projectPath?: string) {
    // Используем проектную папку .m7/ вместо глобальной ~/.m7-mcp
    const basePath = projectPath || getProjectPath();
    this.dataPath = path.join(basePath, '.m7');
  }

  async quickCheck(): Promise<QuickCheckResult> {
    const startTime = Date.now();
    
    try {
      // Basic structure checks
      const hasPackageJson = await this.fileExists('package.json');
      const hasSrcDir = await this.directoryExists('src');
      
      if (!hasPackageJson) {
        return {
          passed: false,
          duration: Date.now() - startTime,
          reason: 'No package.json found - not a valid Node.js project'
        };
      }

      if (!hasSrcDir) {
        return {
          passed: false,
          duration: Date.now() - startTime,
          reason: 'No src directory found - incomplete project structure'
        };
      }

      return {
        passed: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        passed: false,
        duration: Date.now() - startTime,
        reason: `Audit failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async performFullAudit(_context?: any): Promise<AuditReport> {
    const startTime = Date.now();
    
    try {
      const quickResult = await this.quickCheck();
      const issues: AuditIssue[] = [];
      const recommendations: string[] = [];

      // Structure audit
      if (!quickResult.passed) {
        issues.push({
          severity: 'critical',
          category: 'structure',
          description: quickResult.reason || 'Project structure check failed',
          solution: 'Ensure package.json and src directory exist'
        });
      }

      // Dependencies audit
      await this.auditDependencies(issues, recommendations);
      
      // Config audit
      await this.auditConfiguration(issues, recommendations);

      const projectHealth = this.determineProjectHealth(issues);
      
      return {
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        projectHealth,
        issues,
        recommendations,
        summary: this.generateSummary(projectHealth, issues.length)
      };
    } catch (error) {
      return {
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        projectHealth: 'critical',
        issues: [{
          severity: 'critical',
          category: 'structure',
          description: error instanceof Error ? error.message : 'Unknown audit error'
        }],
        recommendations: ['Fix critical errors before proceeding'],
        summary: 'Audit failed to complete'
      };
    }
  }

  async performIncrementalAudit(context?: any): Promise<AuditReport> {
    // Base implementation delegates to full audit
    // IncrementalAuditor can override this method
    return this.performFullAudit(context);
  }

  private async auditDependencies(issues: AuditIssue[], recommendations: string[]): Promise<void> {
    try {
      const packageJsonPath = path.resolve('package.json');
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      if (!packageJson.dependencies && !packageJson.devDependencies) {
        issues.push({
          severity: 'medium',
          category: 'dependencies',
          description: 'No dependencies defined',
          solution: 'Ensure all required dependencies are listed'
        });
      }

      recommendations.push('Keep dependencies up to date');
    } catch {
      // Package.json issues already handled in structure audit
    }
  }

  private async auditConfiguration(issues: AuditIssue[], recommendations: string[]): Promise<void> {
    const configFiles = ['tsconfig.json', '.gitignore', 'README.md'];
    
    for (const configFile of configFiles) {
      const exists = await this.fileExists(configFile);
      if (!exists) {
        issues.push({
          severity: 'low',
          category: 'config',
          description: `Missing ${configFile}`,
          solution: `Create ${configFile} with appropriate configuration`
        });
      }
    }

    recommendations.push('Ensure all configuration files are present and valid');
  }

  private determineProjectHealth(issues: AuditIssue[]): 'healthy' | 'warning' | 'critical' {
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const highIssues = issues.filter(i => i.severity === 'high').length;
    
    if (criticalIssues > 0) return 'critical';
    if (highIssues > 2) return 'critical';
    if (issues.length > 5) return 'warning';
    
    return 'healthy';
  }

  private generateSummary(health: string, issueCount: number): string {
    return `Project health: ${health}. Found ${issueCount} issues.`;
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(path.resolve(filePath));
      return stats.isFile();
    } catch {
      return false;
    }
  }

  protected async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(path.resolve(dirPath));
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  protected formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }
} 