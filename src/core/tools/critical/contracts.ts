#!/usr/bin/env node

import { z } from 'zod';
import { JournalSystem } from '../../../journal/journalSystem.js';
import { SchemaSystem } from '../../../schema/schemaSystem.js';
// v5.0: Memory parameter removed - contracts use schema for persistence

// API Contract types
interface APIContract {
  id: string;
  name: string;
  type: 'function' | 'endpoint' | 'method' | 'class';
  purpose: string;
  parameters?: Parameter[];
  returns?: string;
  usedIn: string[];
  createdAt: Date;
  lastModified: Date;
  tags: string[];
  examples?: string[];
}

interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: any;
}

interface NamingConvention {
  pattern: string;
  description: string;
  examples: string[];
  category: 'crud' | 'query' | 'action' | 'utility';
}

interface DuplicationWarning {
  newName: string;
  existing: APIContract[];
  similarity: number;
  recommendation: string;
}

type ContractType = APIContract['type'];

/** PROJECT_SCHEMA.yaml `api_contracts` section for each contract type */
const CONTRACT_SECTIONS: ReadonlyArray<[section: string, type: ContractType]> = [
  ['functions', 'function'],
  ['endpoints', 'endpoint'],
  ['methods', 'method'],
  ['classes', 'class'],
];

/** STATE-5: register is load → modify → write of one file; two at once would drop one */
let registerQueue: Promise<unknown> = Promise.resolve();

class ContractRegistry {
  // Persisted whole to PROJECT_SCHEMA.yaml, so it is never bounded (MEM-5)
  private contracts = new Map<string, APIContract>();
  private namingConventions: NamingConvention[] = [];
  private loaded: Promise<void>;

  constructor(
    private journal: JournalSystem,
    private schema: SchemaSystem
  ) {
    this.initializeNamingConventions();
    this.loaded = this.loadExistingContracts();
  }

  ready(): Promise<void> {
    return this.loaded;
  }

  private initializeNamingConventions(): void {
    this.namingConventions = [
      {
        pattern: 'get{Entity}By{Field}',
        description: 'Retrieve entity by specific field',
        examples: ['getUserById', 'getOrderByStatus', 'getProductByCategory'],
        category: 'query'
      },
      {
        pattern: 'get{Entity}List',
        description: 'Retrieve list of entities',
        examples: ['getUserList', 'getOrderList', 'getProductList'],
        category: 'query'
      },
      {
        pattern: 'create{Entity}',
        description: 'Create new entity',
        examples: ['createUser', 'createOrder', 'createProduct'],
        category: 'crud'
      },
      {
        pattern: 'update{Entity}',
        description: 'Update existing entity',
        examples: ['updateUser', 'updateOrder', 'updateProduct'],
        category: 'crud'
      },
      {
        pattern: 'delete{Entity}',
        description: 'Delete entity',
        examples: ['deleteUser', 'deleteOrder', 'deleteProduct'],
        category: 'crud'
      },
      {
        pattern: 'validate{Entity}',
        description: 'Validate entity data',
        examples: ['validateUser', 'validateOrder', 'validateProduct'],
        category: 'utility'
      },
      {
        pattern: 'process{Action}',
        description: 'Process business action',
        examples: ['processPayment', 'processOrder', 'processRefund'],
        category: 'action'
      }
    ];
  }

  private async loadExistingContracts(): Promise<void> {
    try {
      const schema = await this.schema.loadSchema();
      const stored = (schema as any)?.api_contracts;
      if (!stored) return;
      for (const [section, type] of CONTRACT_SECTIONS) {
        if (!Array.isArray(stored[section])) continue;
        for (const entry of stored[section]) {
          if (!entry?.name) continue;
          this.contracts.set(entry.name, {
            id: entry.id || this.generateId(),
            name: entry.name,
            type,
            purpose: entry.purpose || '',
            parameters: entry.parameters || [],
            returns: entry.returns,
            usedIn: entry.usedIn || [],
            createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
            lastModified: entry.lastModified ? new Date(entry.lastModified) : new Date(),
            tags: entry.tags || [],
            examples: entry.examples || []
          });
        }
      }
    } catch (error) {
      this.journal.logError({
        type: 'contract_load_error',
        error: `Failed to load existing contracts: ${error}`,
        context: JSON.stringify({ component: 'ContractRegistry' }),
        fixed: false,
        category: 'runtime'
      });
    }
  }

  private generateId(): string {
    return `contract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async registerContract(contract: Omit<APIContract, 'id' | 'createdAt' | 'lastModified'>): Promise<{ 
    success: boolean; 
    warnings?: DuplicationWarning[];
    contract?: APIContract;
    error?: string;
  }> {
    // Check for duplicates
    const warnings = this.checkForDuplicates(contract.name, contract.purpose);
    
    const previous = this.contracts.get(contract.name);
    const fullContract: APIContract = {
      ...contract,
      id: previous?.id ?? this.generateId(),
      createdAt: previous?.createdAt ?? new Date(),
      lastModified: new Date()
    };

    this.contracts.set(fullContract.name, fullContract);

    try {
      await this.updateSchema();
    } catch (error) {
      if (previous) this.contracts.set(previous.name, previous);
      else this.contracts.delete(fullContract.name);
      return {
        success: false,
        error:
          `Contract "${contract.name}" was not saved: PROJECT_SCHEMA.yaml is missing or unreadable. ` +
          `Run mcp_m7_init_project or fix the file (${(error as Error).message})`
      };
    }

    // Log registration
    this.journal.logFeature({
      name: 'API Contract Registration',
      description: `Registered ${contract.type}: ${contract.name}`,
      implementation: `Registered ${contract.type}: ${contract.name}`,
      lessons: [],
      patterns: ['api-contracts'],
      complexity: 'light'
    });

    return {
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      contract: fullContract
    };
  }

  checkForDuplicates(name: string, purpose: string): DuplicationWarning[] {
    const warnings: DuplicationWarning[] = [];
    const existing = Array.from(this.contracts.values());

    // Check exact name match
    const exactMatch = existing.find(c => c.name === name);
    if (exactMatch) {
      warnings.push({
        newName: name,
        existing: [exactMatch],
        similarity: 1.0,
        recommendation: `Exact name match found! Consider using a different name or verify if this is intentional.`
      });
    }

    // Check similar names (fuzzy matching)
    const similarContracts = existing.filter(c => {
      const similarity = this.calculateSimilarity(name.toLowerCase(), c.name.toLowerCase());
      return similarity > 0.7 && c.name !== name;
    });

    if (similarContracts.length > 0) {
      warnings.push({
        newName: name,
        existing: similarContracts,
        similarity: Math.max(...similarContracts.map(c => 
          this.calculateSimilarity(name.toLowerCase(), c.name.toLowerCase())
        )),
        recommendation: `Similar names found. Consider using consistent naming patterns.`
      });
    }

    // Check similar purpose
    const similarPurpose = existing.filter(c => {
      const similarity = this.calculateSimilarity(purpose.toLowerCase(), c.purpose.toLowerCase());
      return similarity > 0.8 && c.name !== name;
    });

    if (similarPurpose.length > 0) {
      warnings.push({
        newName: name,
        existing: similarPurpose,
        similarity: Math.max(...similarPurpose.map(c => 
          this.calculateSimilarity(purpose.toLowerCase(), c.purpose.toLowerCase())
        )),
        recommendation: `Similar functionality already exists. Consider reusing or extending existing methods.`
      });
    }

    return warnings;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Levenshtein distance based similarity
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  suggestName(purpose: string, type: 'function' | 'endpoint' | 'method' | 'class'): string[] {
    const suggestions: string[] = [];
    
    // Extract entities and actions from purpose
    const words = purpose.toLowerCase().split(/[\s,]+/);
    const entities = words.filter(w => /^[a-z]+$/.test(w) && w.length > 2);
    const actions = ['get', 'create', 'update', 'delete', 'process', 'validate', 'check'];
    
    // Match with naming conventions
    this.namingConventions.forEach(convention => {
      entities.forEach(entity => {
        actions.forEach(action => {
          if (convention.pattern.toLowerCase().includes(action)) {
            const suggestion = convention.pattern
              .replace('{Entity}', this.capitalize(entity))
              .replace('{Field}', 'Id')
              .replace('{Action}', this.capitalize(action));
            
            if (!this.contracts.has(suggestion)) {
              suggestions.push(suggestion);
            }
          }
        });
      });
    });

    return suggestions.slice(0, 5); // Return top 5 suggestions
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  findDuplicates(): Array<{ name: string; contracts: APIContract[] }> {
    const groups = new Map<string, APIContract[]>();
    
    Array.from(this.contracts.values()).forEach(contract => {
      const key = contract.purpose.toLowerCase().trim();
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(contract);
    });

    return Array.from(groups.entries())
      .filter(([_, contracts]) => contracts.length > 1)
      .map(([_, contracts]) => ({
        name: contracts[0].purpose,
        contracts
      }));
  }

  getContracts(filter?: { type?: string; tag?: string; searchTerm?: string }): APIContract[] {
    let results = Array.from(this.contracts.values());

    if (filter?.type) {
      results = results.filter(c => c.type === filter.type);
    }

    if (filter?.tag) {
      results = results.filter(c => c.tags.includes(filter.tag!));
    }

    if (filter?.searchTerm) {
      const term = filter.searchTerm.toLowerCase();
      results = results.filter(c => 
        c.name.toLowerCase().includes(term) || 
        c.purpose.toLowerCase().includes(term)
      );
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async updateSchema(): Promise<void> {
    try {
      const contracts = Array.from(this.contracts.values());
      const sections = Object.fromEntries(
        CONTRACT_SECTIONS.map(([section, type]) => [section, contracts.filter(c => c.type === type)])
      );
      
      await this.schema.updateSection('api_contracts' as any, {
        ...sections,
        naming_conventions: this.namingConventions,
        last_updated: new Date().toISOString()
      });
    } catch (error) {
      await this.journal.logError({
        type: 'schema_update_error',
        error: `Failed to update schema: ${error}`,
        context: JSON.stringify({ component: 'ContractRegistry' }),
        fixed: false,
        category: 'runtime'
      });
      throw error;
    }
  }

  formatDuplicatesReport(duplicates: Array<{ name: string; contracts: APIContract[] }>): string {
    if (duplicates.length === 0) {
      return "✅ No duplicate contracts found!";
    }

    let report = `🚨 **API Contract Duplicates Found** (${duplicates.length} groups)\n\n`;

    duplicates.forEach((group, index) => {
      report += `**${index + 1}. ${group.name}**\n`;
      group.contracts.forEach(contract => {
        report += `  - \`${contract.name}\` (${contract.type}) - used in: ${contract.usedIn.join(', ')}\n`;
      });
      report += `  **Recommendation:** Consolidate these into a single method\n\n`;
    });

    return report;
  }
}

export const contractsTool = {
  name: 'mcp_m7_contracts',
  description: 'API contract registry management to prevent duplicate methods',
  inputSchema: z.object({
    action: z.enum(['register', 'check', 'find_duplicates', 'suggest_name', 'list', 'search']),
    contract: z.object({
      name: z.string(),
      type: z.enum(['function', 'endpoint', 'method', 'class']),
      purpose: z.string(),
      parameters: z.array(z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean(),
        description: z.string().optional(),
        defaultValue: z.any().optional()
      })).optional(),
      returns: z.string().optional(),
      usedIn: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      examples: z.array(z.string()).optional()
    }).optional(),
    name: z.string().optional(),
    purpose: z.string().optional(),
    type: z.enum(['function', 'endpoint', 'method', 'class']).optional(),
    filter: z.object({
      type: z.string().optional(),
      tag: z.string().optional(),
      searchTerm: z.string().optional()
    }).optional()
  }),

  handler: async (
    request: any,
    systems: { journal: JournalSystem; schema: SchemaSystem }
  ) => {
    if (request.action === 'register') {
      if (!request.contract) {
        throw new Error('Contract data required for registration');
      }
      const run = registerQueue.then(async () => {
        const registry = new ContractRegistry(systems.journal, systems.schema);
        await registry.ready();
        return registry.registerContract({
          ...request.contract,
          usedIn: request.contract.usedIn || [],
          tags: request.contract.tags || [],
          examples: request.contract.examples || []
        });
      });
      registerQueue = run.catch(() => {});
      const result = await run;

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: `❌ ${result.error}`
        };
      }
      return {
        success: true,
        contract: result.contract,
        warnings: result.warnings,
        message: result.warnings?.length 
          ? `⚠️ Contract registered with ${result.warnings.length} warnings`
          : `✅ Contract "${request.contract.name}" registered successfully`
      };
    }

    const registry = new ContractRegistry(systems.journal, systems.schema);
    await registry.ready();

    switch (request.action) {

      case 'check':
        if (!request.name || !request.purpose) {
          throw new Error('Name and purpose required for duplicate check');
        }
        
        const warnings = registry.checkForDuplicates(request.name, request.purpose);
        
        return {
          success: true,
          hasWarnings: warnings.length > 0,
          warnings,
          message: warnings.length > 0 
            ? `⚠️ Found ${warnings.length} potential conflicts`
            : `✅ No conflicts found for "${request.name}"`
        };

      case 'find_duplicates':
        const duplicates = registry.findDuplicates();
        
        return {
          success: true,
          duplicates,
          count: duplicates.length,
          formatted: registry.formatDuplicatesReport(duplicates),
          message: duplicates.length > 0 
            ? `🚨 Found ${duplicates.length} duplicate groups`
            : `✅ No duplicates found`
        };

      case 'suggest_name':
        if (!request.purpose || !request.type) {
          throw new Error('Purpose and type required for name suggestions');
        }
        
        const suggestions = registry.suggestName(request.purpose, request.type);
        
        return {
          success: true,
          suggestions,
          count: suggestions.length,
          message: suggestions.length > 0 
            ? `💡 Generated ${suggestions.length} name suggestions`
            : `No suggestions available for this purpose`
        };

      case 'list':
        const contracts = registry.getContracts(request.filter);
        
        return {
          success: true,
          contracts,
          count: contracts.length,
          message: `📋 Found ${contracts.length} contracts`
        };

      case 'search':
        if (!request.filter?.searchTerm) {
          throw new Error('Search term required');
        }
        
        const searchResults = registry.getContracts(request.filter);
        
        return {
          success: true,
          contracts: searchResults,
          count: searchResults.length,
          message: `🔍 Found ${searchResults.length} contracts matching "${request.filter.searchTerm}"`
        };

      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
  }
};
