/**
 * Document Generator
 * Generates documentation from scan results
 */

import { TypeScanner } from '../scanners/TypeScanner.js';
import { DocumentationScanner } from '../scanners/DocumentationScanner.js';
import { ProjectScanner } from '../scanners/ProjectScanner.js';

export class DocumentGenerator {
  private typeScanner: TypeScanner;
  private docScanner: DocumentationScanner;
  private projectScanner: ProjectScanner;
  
  constructor(private projectPath: string) {
    this.typeScanner = new TypeScanner(projectPath);
    this.docScanner = new DocumentationScanner(projectPath);
    this.projectScanner = new ProjectScanner(projectPath);
  }
  
  /**
   * Generate FIELD_DICTIONARY.md from TypeScript types
   */
  async generateFieldDictionary(): Promise<string> {
    const scanResult = await this.typeScanner.scan();
    
    if (!scanResult.success) {
      throw new Error(`Type scan failed: ${scanResult.errors?.join(', ')}`);
    }
    
    const { interfaces, types, enums, classes } = scanResult.data;
    
    let content = `# 📖 FIELD DICTIONARY
**Auto-generated:** ${new Date().toISOString()}  
**Scan time:** ${scanResult.scan_time_ms}ms

---

## 📊 Summary

- **Interfaces:** ${interfaces.length}
- **Type Aliases:** ${types.length}
- **Enums:** ${enums.length}
- **Classes:** ${classes.length}

---

## 📚 Interfaces

`;
    
    // Add interfaces
    for (const iface of interfaces.filter(i => i.exported)) {
      content += `### ${iface.name}\n\n`;
      
      if (iface.description) {
        content += `${iface.description}\n\n`;
      }
      
      content += `**File:** \`${iface.file}\`\n\n`;
      
      if (iface.extends && iface.extends.length > 0) {
        content += `**Extends:** ${iface.extends.map(e => `\`${e}\``).join(', ')}\n\n`;
      }
      
      if (iface.fields.length > 0) {
        content += `**Fields:**\n\n`;
        content += `| Field | Type | Optional | Description |\n`;
        content += `|-------|------|----------|-------------|\n`;
        
        for (const field of iface.fields) {
          const optional = field.optional ? '✅' : '❌';
          const desc = field.description || '-';
          content += `| \`${field.name}\` | \`${field.type}\` | ${optional} | ${desc} |\n`;
        }
        content += `\n`;
      }
      
      content += `---\n\n`;
    }
    
    // Add type aliases
    if (types.filter(t => t.exported).length > 0) {
      content += `## 🎨 Type Aliases\n\n`;
      
      for (const type of types.filter(t => t.exported)) {
        content += `### ${type.name}\n\n`;
        
        if (type.description) {
          content += `${type.description}\n\n`;
        }
        
        content += `**File:** \`${type.file}\`\n\n`;
        content += `**Definition:**\n\`\`\`typescript\n${type.type}\n\`\`\`\n\n`;
        content += `---\n\n`;
      }
    }
    
    // Add enums
    if (enums.filter(e => e.exported).length > 0) {
      content += `## 🔢 Enums\n\n`;
      
      for (const enumInfo of enums.filter(e => e.exported)) {
        content += `### ${enumInfo.name}\n\n`;
        
        if (enumInfo.description) {
          content += `${enumInfo.description}\n\n`;
        }
        
        content += `**File:** \`${enumInfo.file}\`\n\n`;
        content += `**Members:**\n\n`;
        content += `| Name | Value |\n`;
        content += `|------|-------|\n`;
        
        for (const member of enumInfo.members) {
          const value = member.value !== undefined ? `\`${member.value}\`` : '-';
          content += `| \`${member.name}\` | ${value} |\n`;
        }
        content += `\n---\n\n`;
      }
    }
    
    // Add classes
    if (classes.filter(c => c.exported).length > 0) {
      content += `## 🏛️ Classes\n\n`;
      
      for (const cls of classes.filter(c => c.exported)) {
        content += `### ${cls.name}\n\n`;
        
        if (cls.description) {
          content += `${cls.description}\n\n`;
        }
        
        content += `**File:** \`${cls.file}\`\n\n`;
        
        if (cls.properties.length > 0) {
          content += `**Properties:**\n\n`;
          content += `| Property | Type | Optional | Readonly |\n`;
          content += `|----------|------|----------|----------|\n`;
          
          for (const prop of cls.properties) {
            const optional = prop.optional ? '✅' : '❌';
            const readonly = prop.readonly ? '✅' : '❌';
            content += `| \`${prop.name}\` | \`${prop.type}\` | ${optional} | ${readonly} |\n`;
          }
          content += `\n`;
        }
        
        if (cls.methods.length > 0) {
          content += `**Methods:**\n\n`;
          
          for (const method of cls.methods) {
            const params = method.parameters
              .map(p => `${p.name}: ${p.type}`)
              .join(', ');
            
            content += `- \`${method.name}(${params}): ${method.returnType}\`\n`;
            if (method.description) {
              content += `  - ${method.description}\n`;
            }
          }
          content += `\n`;
        }
        
        content += `---\n\n`;
      }
    }
    
    content += `\n---\n\n*Generated by Knowledge Hub v1.0.0 (Phase 2)*\n`;
    
    return content;
  }
  
  /**
   * Generate INDEX.md from project scan
   */
  async generateProjectIndex(): Promise<string> {
    const [projectScan, docScan] = await Promise.all([
      this.projectScanner.scan(),
      this.docScanner.scan()
    ]);
    
    if (!projectScan.success) {
      throw new Error(`Project scan failed: ${projectScan.errors?.join(', ')}`);
    }
    
    const project = projectScan.data;
    
    let content = `# 📚 ${project.name} - Project Index

**Version:** ${project.version}  
**Generated:** ${new Date().toISOString()}

${project.description}

---

## 📊 Project Statistics

- **Total Files:** ${project.statistics.total_files}
- **Total Directories:** ${project.statistics.directories_count}
- **Languages:** ${project.statistics.languages_count}
- **Dependencies:** ${project.tech_stack.dependencies.total}

---

## 💻 Tech Stack

### Languages

`;
    
    for (const lang of project.tech_stack.languages.slice(0, 5)) {
      content += `- **${lang.name}**: ${lang.files} files, ${lang.lines} lines (${lang.percentage.toFixed(1)}%)\n`;
    }
    
    if (project.tech_stack.frameworks.length > 0) {
      content += `\n### Frameworks\n\n`;
      for (const fw of project.tech_stack.frameworks) {
        content += `- ${fw}\n`;
      }
    }
    
    if (project.tech_stack.tools.length > 0) {
      content += `\n### Tools\n\n`;
      for (const tool of project.tech_stack.tools) {
        content += `- ${tool}\n`;
      }
    }
    
    content += `\n---\n\n## 📁 Project Structure\n\n`;
    content += this.renderStructure(project.structure, 0, 2);
    
    if (docScan.success && docScan.data.documents.length > 0) {
      content += `\n---\n\n## 📖 Documentation\n\n`;
      content += `**Total Documents:** ${docScan.data.total_files}  \n`;
      content += `**Total Size:** ${this.formatBytes(docScan.data.total_size)}\n\n`;
      
      // Group by directory
      const grouped = new Map<string, typeof docScan.data.documents>();
      
      for (const doc of docScan.data.documents) {
        const dir = doc.path.split('/')[0] || 'root';
        if (!grouped.has(dir)) {
          grouped.set(dir, []);
        }
        grouped.get(dir)!.push(doc);
      }
      
      for (const [dir, docs] of grouped) {
        content += `\n### ${dir}\n\n`;
        for (const doc of docs) {
          content += `- [${doc.title}](${doc.path}) (${doc.lines} lines)\n`;
        }
      }
    }
    
    content += `\n---\n\n*Generated by Knowledge Hub v1.0.0 (Phase 2)*\n`;
    
    return content;
  }
  
  /**
   * Generate PROJECT_STRUCTURE.md
   */
  async generateProjectStructure(): Promise<string> {
    const scanResult = await this.projectScanner.scan();
    
    if (!scanResult.success) {
      throw new Error(`Project scan failed: ${scanResult.errors?.join(', ')}`);
    }
    
    const project = scanResult.data;
    
    let content = `# 📁 ${project.name} - Project Structure

**Generated:** ${new Date().toISOString()}

---

## 📊 Overview

${project.description}

**Statistics:**
- Files: ${project.statistics.total_files}
- Directories: ${project.statistics.directories_count}
- Size: ${this.formatBytes(project.statistics.total_size)}
- Languages: ${project.statistics.languages_count}

---

## 🗂️ Directory Structure

`;
    
    content += this.renderStructure(project.structure, 0, 5);
    
    content += `\n---\n\n*Generated by Knowledge Hub v1.0.0 (Phase 2)*\n`;
    
    return content;
  }
  
  // Helper methods
  
  private renderStructure(
    node: any,
    depth: number,
    maxDepth: number
  ): string {
    if (depth >= maxDepth) return '';
    
    let result = '';
    const indent = '  '.repeat(depth);
    
    if (node.type === 'directory') {
      result += `${indent}- 📁 **${node.name}**/\n`;
      
      if (node.children) {
        for (const child of node.children) {
          result += this.renderStructure(child, depth + 1, maxDepth);
        }
      }
    } else {
      const size = node.size ? ` (${this.formatBytes(node.size)})` : '';
      result += `${indent}- 📄 ${node.name}${size}\n`;
    }
    
    return result;
  }
  
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

