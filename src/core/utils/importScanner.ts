// Context7 Auto-Check: Import Scanner Utility

export interface ImportCheckResult {
  hasUncheckedImports: boolean;
  uncheckedLibraries: string[];
  suggestions: string[];
}

import { BoundedSet } from './boundedMap.js';

// Track verified libraries in memory (LRU, max 500 libraries)
const verifiedLibraries = new BoundedSet<string>(500, [
  // Node.js built-ins
  'fs', 'path', 'crypto', 'util', 'stream', 'events', 'os', 'child_process',
  // Common verified libraries
  'zod', '@modelcontextprotocol/sdk',
  // Add more as they get verified
]);

export async function scanAndCheckImports(
  content: string,
  fileType: 'typescript' | 'javascript' = 'typescript'
): Promise<ImportCheckResult> {
  // Extract imports using regex
  const importRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/gm;
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
  
  const imports = new Set<string>();
  
  // Find all imports
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const libName = match[1];
    // Skip relative imports and aliases
    if (!libName.startsWith('.') && !libName.startsWith('@/') && !libName.startsWith('~')) {
      // Extract package name (handle scoped packages)
      const packageName = libName.startsWith('@') 
        ? libName.split('/').slice(0, 2).join('/')
        : libName.split('/')[0];
      imports.add(packageName);
    }
  }
  
  // Also check CommonJS requires
  while ((match = requireRegex.exec(content)) !== null) {
    const libName = match[1];
    if (!libName.startsWith('.') && !libName.startsWith('@/') && !libName.startsWith('~')) {
      const packageName = libName.startsWith('@') 
        ? libName.split('/').slice(0, 2).join('/')
        : libName.split('/')[0];
      imports.add(packageName);
    }
  }
  
  // Check each import against verified list
  const uncheckedLibraries: string[] = [];
  
  for (const lib of imports) {
    if (!verifiedLibraries.has(lib)) {
      uncheckedLibraries.push(lib);
    }
  }
  
  return {
    hasUncheckedImports: uncheckedLibraries.length > 0,
    uncheckedLibraries,
    suggestions: uncheckedLibraries.map(lib => 
      `Use @context7 to verify: mcp_context7_resolve-library-id "${lib}"`
    )
  };
}

// Helper to mark library as verified (called after Context7 check)
export function markLibraryAsVerified(libraryName: string): void {
  verifiedLibraries.add(libraryName);
}

// Helper to get all verified libraries
export function getVerifiedLibraries(): string[] {
  return Array.from(verifiedLibraries).sort();
}

// Helper to check if specific library is verified
export function isLibraryVerified(libraryName: string): boolean {
  return verifiedLibraries.has(libraryName);
}

