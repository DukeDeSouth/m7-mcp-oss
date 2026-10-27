/**
 * Index Generator
 * Генерирует INDEX.md файл на основе собранной информации о проекте
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('[IndexGenerator]');

import {
  IndexGenerator,
  ProjectIndex,
  IndexGeneratorOptions,
  IndexSection,
  ValidationResult,
  DEFAULT_INDEX_SECTIONS
} from './types.js';

export class DefaultIndexGenerator implements IndexGenerator {

  async generate(index: ProjectIndex, options: IndexGeneratorOptions): Promise<string> {
    log.debug('Generating INDEX.md...');
    
    const sections = options.sections.length > 0 ? options.sections : DEFAULT_INDEX_SECTIONS;
    const enabledSections = sections
      .filter(section => section.enabled)
      .sort((a, b) => a.priority - b.priority);

    let content = this.generateHeader(index);
    
    for (const section of enabledSections) {
      const sectionContent = await this.generateSection(section, index);
      if (sectionContent.trim()) {
        content += '\n\n' + sectionContent;
      }
    }

    content += this.generateFooter(index, options);

    return content;
  }

  async generateSection(section: IndexSection, index: ProjectIndex): Promise<string> {
    switch (section.id) {
      case 'overview':
        return this.generateOverviewSection(index);
      case 'quick_start':
        return this.generateQuickStartSection(index);
      case 'deployment':
        return this.generateDeploymentSection(index);
      case 'git_info':
        return this.generateGitInfoSection(index);
      case 'structure':
        return this.generateStructureSection(index);
      case 'documentation':
        return this.generateDocumentationSection(index);
      case 'configuration':
        return this.generateConfigurationSection(index);
      case 'tech_stack':
        return this.generateTechStackSection(index);
      case 'important_notes':
        return this.generateImportantNotesSection(index);
      default:
        return section.content || '';
    }
  }

  async saveToFile(content: string, filePath: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf-8');
    log.debug(`INDEX.md saved to: ${filePath}`);
  }

  async validateIndex(index: ProjectIndex): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    // Проверяем обязательные поля
    if (!index.project.name) {
      errors.push('Project name is missing');
      score -= 20;
    }

    if (!index.project.description || index.project.description === 'No description available') {
      warnings.push('Project description is missing or generic');
      score -= 10;
    }

    if (index.project.techStack.length === 0) {
      warnings.push('Technology stack not detected');
      score -= 5;
    }

    // Проверяем документацию
    const criticalDocs = index.documentation.filter(doc => doc.priority === 'critical');
    const missingCriticalDocs = criticalDocs.filter(doc => doc.status === 'missing');
    
    if (missingCriticalDocs.length > 0) {
      warnings.push(`Missing critical documentation: ${missingCriticalDocs.map(d => d.name).join(', ')}`);
      score -= missingCriticalDocs.length * 5;
    }

    // Проверяем конфигурацию
    const criticalConfigs = index.configuration.filter(config => config.critical);
    const missingCriticalConfigs = criticalConfigs.filter(config => config.status === 'missing');
    
    if (missingCriticalConfigs.length > 0) {
      warnings.push(`Missing critical configuration: ${missingCriticalConfigs.map(c => c.name).join(', ')}`);
      score -= missingCriticalConfigs.length * 3;
    }

    // Проверяем Git информацию
    if (!index.git.repository) {
      suggestions.push('Consider adding Git repository information');
      score -= 2;
    }

    // Проверяем деплой информацию
    if (!index.deployment.method) {
      suggestions.push('Consider documenting deployment method');
      score -= 3;
    }

    // Предложения по улучшению
    if (index.quickStart.length === 1 && index.quickStart[0].includes('README')) {
      suggestions.push('Add specific quick start commands');
    }

    if (index.importantNotes.length === 0) {
      suggestions.push('Consider adding important notes for developers');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
      score: Math.max(0, score)
    };
  }

  // Генераторы секций

  private generateHeader(index: ProjectIndex): string {
    const statusEmoji = {
      development: '🚧',
      production: '🚀',
      maintenance: '🔧',
      archived: '📦'
    };

    return `# 📋 ${index.project.name} - Project Index

## 📅 Last Updated: ${index.project.lastUpdated}
## 🎯 Version: ${index.project.version}
## 📊 Status: ${statusEmoji[index.project.status]} ${index.project.status.charAt(0).toUpperCase() + index.project.status.slice(1)}

---`;
  }

  private generateOverviewSection(index: ProjectIndex): string {
    let content = `## 🎯 PROJECT OVERVIEW

**${index.project.name}** - ${index.project.description}`;

    if (index.project.domain) {
      content += `\n\n**Domain:** ${index.project.domain}`;
    }

    if (index.project.techStack.length > 0) {
      content += `\n\n**Technology Stack:** ${index.project.techStack.join(', ')}`;
    }

    return content;
  }

  private generateQuickStartSection(index: ProjectIndex): string {
    if (index.quickStart.length === 0) return '';

    let content = `## 🚀 QUICK START

### Getting Started
\`\`\`bash`;

    index.quickStart.forEach((command, i) => {
      content += `\n# ${i + 1}. ${this.getCommandDescription(command)}
${command}`;
    });

    content += '\n```';

    return content;
  }

  private generateDeploymentSection(index: ProjectIndex): string {
    if (!index.deployment.method && !index.deployment.server && !index.deployment.url) {
      return '';
    }

    let content = `## 🚀 DEPLOYMENT INFORMATION`;

    if (index.deployment.method) {
      content += `\n\n**Method:** ${index.deployment.method}`;
    }

    if (index.deployment.server) {
      content += `\n**Server:** ${index.deployment.server}`;
    }

    if (index.deployment.url) {
      content += `\n**URL:** ${index.deployment.url}`;
    }

    if (index.deployment.environment) {
      content += `\n**Environment:** ${index.deployment.environment}`;
    }

    if (index.deployment.deployScript) {
      content += `\n\n**Deploy Command:**
\`\`\`bash
${index.deployment.deployScript}
\`\`\``;
    }

    if (index.deployment.lastDeploy) {
      content += `\n\n**Last Deploy:** ${index.deployment.lastDeploy}`;
    }

    return content;
  }

  private generateGitInfoSection(index: ProjectIndex): string {
    if (!index.git.repository && !index.git.branch) {
      return '';
    }

    let content = `## 📂 GIT REPOSITORY`;

    if (index.git.repository) {
      content += `\n\n**Repository:** ${index.git.repository}`;
    }

    if (index.git.branch) {
      content += `\n**Current Branch:** ${index.git.branch}`;
    }

    if (index.git.lastCommit) {
      content += `\n**Last Commit:** ${index.git.lastCommit}`;
    }

    if (index.git.contributors && index.git.contributors.length > 0) {
      content += `\n\n**Contributors:**`;
      index.git.contributors.slice(0, 5).forEach(contributor => {
        content += `\n- ${contributor}`;
      });
      
      if (index.git.contributors.length > 5) {
        content += `\n- ... and ${index.git.contributors.length - 5} more`;
      }
    }

    return content;
  }

  private generateStructureSection(index: ProjectIndex): string {
    let content = `## 📁 PROJECT STRUCTURE

### Key Directories
| Directory | Purpose | Files | Importance |
|-----------|---------|-------|------------|`;

    index.structure.directories.forEach(dir => {
      const importanceEmoji = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🟢'
      };

      content += `\n| \`${dir.path}\` | ${dir.purpose} | ${dir.fileCount} | ${importanceEmoji[dir.importance]} ${dir.importance} |`;
    });

    if (index.structure.keyFiles.length > 0) {
      content += `\n\n### Key Files
${index.structure.keyFiles.map(file => `- \`${file}\``).join('\n')}`;
    }

    content += `\n\n### Statistics
- **Total Files:** ${index.structure.totalFiles}
- **Total Directories:** ${index.structure.totalDirectories}`;

    return content;
  }

  private generateDocumentationSection(index: ProjectIndex): string {
    if (index.documentation.length === 0) return '';

    let content = `## 📚 DOCUMENTATION INDEX

### Core Documentation
| Document | Status | Purpose | Last Updated |
|----------|--------|---------|--------------|`;

    // Группируем по категориям
    const categories = ['core', 'api', 'deployment', 'development', 'user', 'methodology'];
    
    categories.forEach(category => {
      const docs = index.documentation.filter(doc => doc.category === category);
      if (docs.length === 0) return;

      docs.forEach(doc => {
        const statusEmoji = {
          current: '✅',
          outdated: '⚠️',
          missing: '❌',
          draft: '📝'
        };

        const priorityEmoji = {
          critical: '🔴',
          high: '🟠',
          medium: '🟡',
          low: '🟢'
        };

        content += `\n| [\`${doc.name}\`](${doc.path}) | ${statusEmoji[doc.status]} ${doc.status} | ${doc.purpose} | ${doc.lastUpdated || 'Unknown'} |`;
      });
    });

    // Показываем отсутствующие критические документы
    const missingCritical = index.documentation.filter(doc => 
      doc.status === 'missing' && doc.priority === 'critical'
    );

    if (missingCritical.length > 0) {
      content += `\n\n### ❌ Missing Critical Documents
${missingCritical.map(doc => `- **${doc.name}** - ${doc.purpose}`).join('\n')}`;
    }

    return content;
  }

  private generateConfigurationSection(index: ProjectIndex): string {
    if (index.configuration.length === 0) return '';

    let content = `## ⚙️ CONFIGURATION FILES

### Critical Configuration
| File | Status | Purpose |
|------|--------|---------|`;

    // Сначала критические файлы
    const criticalConfigs = index.configuration.filter(config => config.critical);
    criticalConfigs.forEach(config => {
      const statusEmoji = {
        current: '✅',
        outdated: '⚠️',
        missing: '❌'
      };

      content += `\n| [\`${config.name}\`](${config.path}) | ${statusEmoji[config.status]} ${config.status} | ${config.purpose} |`;
    });

    // Затем дополнительные файлы
    const additionalConfigs = index.configuration.filter(config => !config.critical && config.status === 'current');
    if (additionalConfigs.length > 0) {
      content += `\n\n### Additional Configuration
${additionalConfigs.map(config => `- [\`${config.name}\`](${config.path}) - ${config.purpose}`).join('\n')}`;
    }

    return content;
  }

  private generateTechStackSection(index: ProjectIndex): string {
    if (index.project.techStack.length === 0) return '';

    let content = `## 🛠️ TECHNOLOGY STACK

### Technologies Used
${index.project.techStack.map(tech => `- **${tech}**`).join('\n')}`;

    // Добавляем информацию о версиях из package.json если доступно
    content += `\n\n### Package Information
- **Version:** ${index.project.version}
- **Status:** ${index.project.status}`;

    return content;
  }

  private generateImportantNotesSection(index: ProjectIndex): string {
    if (index.importantNotes.length === 0) return '';

    let content = `## ⚠️ IMPORTANT NOTES

### Development Notes
${index.importantNotes.map(note => `- ${note}`).join('\n')}`;

    return content;
  }

  private generateFooter(index: ProjectIndex, options: IndexGeneratorOptions): string {
    let content = `\n\n---

## 📊 INDEX STATISTICS

- **Generated:** ${index.generatedAt}
- **Generator:** ${index.generatedBy}`;

    if (options.includeMetrics) {
      content += `
- **Documentation Files:** ${index.documentation.length}
- **Configuration Files:** ${index.configuration.length}
- **Project Directories:** ${index.structure.directories.length}`;
    }

    content += `

## 🔄 UPDATING THIS INDEX

This index is automatically generated. To update:

\`\`\`bash
# Update project index
@m7 project index update

# Or regenerate completely
@m7 project index generate --force
\`\`\`

---
*This index helps AI assistants understand your project structure and requirements quickly.*`;

    return content;
  }

  private getCommandDescription(command: string): string {
    if (command.includes('install')) return 'Install dependencies';
    if (command.includes('dev') || command.includes('start')) return 'Start development server';
    if (command.includes('build')) return 'Build for production';
    if (command.includes('test')) return 'Run tests';
    if (command.includes('docker-compose')) return 'Start with Docker Compose';
    if (command.includes('docker build')) return 'Build Docker image';
    if (command.includes('docker run')) return 'Run Docker container';
    return 'Run command';
  }
}
