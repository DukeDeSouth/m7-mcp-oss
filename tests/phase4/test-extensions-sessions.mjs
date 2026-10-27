/**
 * Phase 4 Tests: Extension API + Session Tree Branching
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Imports
import { 
  ExtensionManager,
  resetExtensionManager 
} from '../../dist/core/extensions/extensionSystem.js';

import {
  SessionTreeManager,
  resetSessionTreeManager
} from '../../dist/core/session/sessionTree.js';

// ============================================================================
// Test Helpers
// ============================================================================

let testDir = '';
let passedTests = 0;
let failedTests = 0;

async function setup() {
  testDir = path.join(os.tmpdir(), `m7-phase4-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
  console.log(`\nTest directory: ${testDir}\n`);
}

async function cleanup() {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {}
  resetExtensionManager();
  resetSessionTreeManager();
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${err.message}`);
    failedTests++;
  }
}

// ============================================================================
// 1. Extension API Tests
// ============================================================================

async function testExtensionAPI() {
  console.log('\n🔌 Extension API Tests\n');
  
  // Test 1: Extension Manager creation
  await asyncTest('ExtensionManager creates with project path', async () => {
    const manager = new ExtensionManager(testDir);
    assert.ok(manager, 'Manager should exist');
    
    const stats = manager.getStats();
    assert.strictEqual(stats.total, 0, 'No extensions loaded');
    assert.strictEqual(stats.tools, 0, 'No tools');
  });
  
  // Test 2: Discovery on empty directories
  await asyncTest('Discovery returns empty on no extensions', async () => {
    const manager = new ExtensionManager(testDir);
    const loaded = await manager.loadAll();
    assert.strictEqual(loaded.length, 0, 'Should find no extensions');
  });
  
  // Test 3: Load a valid extension
  await asyncTest('Load extension with registerTool', async () => {
    // Create extension dir
    const extDir = path.join(testDir, '.m7', 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    
    // Write extension file
    await fs.writeFile(path.join(extDir, 'my-checker.js'), `
      export default function(m7) {
        m7.registerTool({
          name: 'check_code',
          description: 'Check code quality',
          handler: async (args) => 'Code is OK'
        });
        
        m7.log.info('My Checker extension loaded!');
      }
    `);
    
    const manager = new ExtensionManager(testDir);
    const loaded = await manager.loadAll();
    
    assert.strictEqual(loaded.length, 1, 'Should load 1 extension');
    assert.ok(!loaded[0].error, 'No errors');
    assert.strictEqual(loaded[0].name, 'my-checker');
    assert.strictEqual(loaded[0].scope, 'project');
  });
  
  // Test 4: Extension tools are registered
  await asyncTest('Extension tools are accessible', async () => {
    const extDir = path.join(testDir, '.m7', 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    
    await fs.writeFile(path.join(extDir, 'tools-ext.js'), `
      export default function(m7) {
        m7.registerTool({
          name: 'tool_a',
          description: 'Tool A',
          handler: async () => 'A'
        });
        m7.registerTool({
          name: 'tool_b',
          description: 'Tool B',
          handler: async () => 'B'
        });
      }
    `);
    
    const manager = new ExtensionManager(testDir);
    await manager.loadAll();
    
    const tools = manager.getExtensionTools();
    // May have tools from previous test too, check at least 2
    const toolNames = tools.map(t => t.name);
    assert.ok(toolNames.some(n => n.includes('tool_a')), 'Should have tool_a');
    assert.ok(toolNames.some(n => n.includes('tool_b')), 'Should have tool_b');
  });
  
  // Test 5: Extension tool has prefix
  await asyncTest('Extension tools get ext_ prefix', async () => {
    const extDir = path.join(testDir, '.m7', 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    
    await fs.writeFile(path.join(extDir, 'prefix-test.js'), `
      export default function(m7) {
        m7.registerTool({
          name: 'my_tool',
          description: 'Test prefix',
          handler: async () => 'prefixed'
        });
      }
    `);
    
    const manager = new ExtensionManager(testDir);
    await manager.loadAll();
    
    const tools = manager.getExtensionTools();
    const prefixed = tools.find(t => t.name === 'ext_prefix-test_my_tool');
    assert.ok(prefixed, 'Tool should have ext_ prefix with extension name');
  });
  
  // Test 6: Extension can replace tool
  await asyncTest('Extension can replace tool handler', async () => {
    const extDir = path.join(testDir, '.m7', 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    
    await fs.writeFile(path.join(extDir, 'replacer.js'), `
      export default function(m7) {
        m7.replaceTool('mcp_m7_analyze_task', async (args) => {
          return 'Custom analysis: ' + args.task_description;
        });
      }
    `);
    
    const manager = new ExtensionManager(testDir);
    await manager.loadAll();
    
    const replacement = manager.getToolReplacement('mcp_m7_analyze_task');
    assert.ok(replacement, 'Should have replacement');
    assert.strictEqual(typeof replacement, 'function');
  });
  
  // Test 7: Extension error handling
  await asyncTest('Broken extension does not crash system', async () => {
    const extDir = path.join(testDir, '.m7', 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    
    await fs.writeFile(path.join(extDir, 'broken.js'), `
      export default function(m7) {
        throw new Error('Extension init failed!');
      }
    `);
    
    const manager = new ExtensionManager(testDir);
    const loaded = await manager.loadAll();
    
    const broken = loaded.find(e => e.name === 'broken');
    assert.ok(broken, 'Should track broken extension');
    assert.ok(broken.error, 'Should have error');
    assert.ok(broken.error.includes('Extension init failed'), 'Error message preserved');
  });
  
  // Test 8: Extension getConfig
  await asyncTest('Extension receives correct config', async () => {
    const extDir = path.join(testDir, '.m7', 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    
    let receivedConfig = null;
    
    await fs.writeFile(path.join(extDir, 'config-check.js'), `
      export default function(m7) {
        const config = m7.getConfig();
        // Store config info as tool for later check
        m7.registerTool({
          name: 'get_config_result',
          description: 'Returns config',
          handler: async () => JSON.stringify(config)
        });
      }
    `);
    
    const manager = new ExtensionManager(testDir);
    await manager.loadAll();
    
    const tools = manager.getExtensionTools();
    const configTool = tools.find(t => t.name.includes('get_config_result'));
    assert.ok(configTool, 'Config tool should exist');
    
    const result = await configTool.handler({});
    const config = JSON.parse(result);
    assert.ok(config.projectPath, 'Should have projectPath');
    assert.ok(config.m7Path, 'Should have m7Path');
    assert.ok(config.version, 'Should have version');
  });
  
  // Test 9: Extension stats
  await asyncTest('Extension stats are accurate', async () => {
    const extDir = path.join(testDir, '.m7', 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    
    await fs.writeFile(path.join(extDir, 'stats-ext.js'), `
      export default function(m7) {
        m7.registerTool({
          name: 'stat_tool',
          description: 'Stats test',
          handler: async () => 'ok'
        });
      }
    `);
    
    const manager = new ExtensionManager(testDir);
    await manager.loadAll();
    
    const stats = manager.getStats();
    assert.ok(stats.total > 0, 'Should have extensions');
    assert.ok(stats.tools > 0, 'Should have tools');
    assert.strictEqual(stats.project, stats.total, 'All should be project scope');
    assert.strictEqual(stats.global, 0, 'No global extensions');
  });
  
  // Test 10: Unload extension
  await asyncTest('Unload extension removes tools', async () => {
    const extDir = path.join(testDir, '.m7', 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    
    await fs.writeFile(path.join(extDir, 'removable.js'), `
      export default function(m7) {
        m7.registerTool({
          name: 'removable_tool',
          description: 'Will be removed',
          handler: async () => 'exists'
        });
      }
    `);
    
    const manager = new ExtensionManager(testDir);
    await manager.loadAll();
    
    // Verify tool exists
    let tools = manager.getExtensionTools();
    assert.ok(tools.some(t => t.name.includes('removable_tool')), 'Tool should exist');
    
    // Unload
    const removed = await manager.unloadExtension('removable');
    assert.ok(removed, 'Should return true');
    
    // Verify tool removed
    tools = manager.getExtensionTools();
    assert.ok(!tools.some(t => t.name.includes('removable_tool')), 'Tool should be removed');
  });
}

// ============================================================================
// 2. Session Tree Branching Tests
// ============================================================================

async function testSessionTree() {
  console.log('\n🌳 Session Tree Branching Tests\n');
  
  // Test 1: Create session tree
  await asyncTest('Create session tree', async () => {
    const tree = new SessionTreeManager(testDir);
    const data = tree.create('session_001');
    
    assert.strictEqual(data.sessionId, 'session_001');
    assert.strictEqual(data.nodes.length, 0);
    assert.strictEqual(data.branches.length, 1);
    assert.strictEqual(data.activeBranchId, 'main');
  });
  
  // Test 2: Add nodes
  await asyncTest('Add nodes to session', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_002');
    
    const n1 = tree.addNode('discovery', 'Researching auth patterns');
    const n2 = tree.addNode('architecture', 'JWT vs Session based');
    const n3 = tree.addNode('solution', 'Using JWT with refresh tokens');
    
    assert.ok(n1.id, 'Node 1 has ID');
    assert.strictEqual(n1.phase, 'discovery');
    assert.strictEqual(n1.parentId, null, 'First node has no parent');
    assert.strictEqual(n2.parentId, n1.id, 'Node 2 parents to Node 1');
    assert.strictEqual(n3.parentId, n2.id, 'Node 3 parents to Node 2');
    assert.strictEqual(n3.branchId, 'main');
  });
  
  // Test 3: Branch from node
  await asyncTest('Create branch from specific node', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_003');
    
    const n1 = tree.addNode('discovery', 'Research');
    const n2 = tree.addNode('architecture', 'Architecture A');
    
    // Branch from n1 to try different architecture
    const branch = tree.branch(n1.id, 'alt-architecture');
    
    assert.ok(branch.id, 'Branch has ID');
    assert.strictEqual(branch.name, 'alt-architecture');
    assert.strictEqual(branch.forkNodeId, n1.id);
    
    // New nodes go to new branch
    const n3 = tree.addNode('architecture', 'Architecture B');
    assert.strictEqual(n3.branchId, branch.id);
  });
  
  // Test 4: Fork from current
  await asyncTest('Fork from current node', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_004');
    
    tree.addNode('discovery', 'D1');
    tree.addNode('architecture', 'A1');
    tree.addNode('solution', 'S1');
    
    const branch = tree.fork('experimental');
    
    assert.strictEqual(branch.name, 'experimental');
    
    // Add to fork
    const expNode = tree.addNode('solution', 'S2 - experimental approach');
    assert.strictEqual(expNode.branchId, branch.id);
  });
  
  // Test 5: Switch branch
  await asyncTest('Switch between branches', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_005');
    
    tree.addNode('discovery', 'Research');
    tree.fork('branch-A');
    tree.addNode('solution', 'Solution A');
    
    const data = tree.getTree();
    const mainBranch = data.branches.find(b => b.id === 'main');
    
    const switched = tree.switchBranch('main');
    assert.ok(switched, 'Should switch successfully');
    assert.strictEqual(tree.getTree().activeBranchId, 'main');
    
    // Add node to main
    const mainNode = tree.addNode('architecture', 'Back to main');
    assert.strictEqual(mainNode.branchId, 'main');
  });
  
  // Test 6: Get current path
  await asyncTest('Get current path from root to tip', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_006');
    
    tree.addNode('discovery', 'D1');
    tree.addNode('architecture', 'A1');
    tree.addNode('solution', 'S1');
    
    const currentPath = tree.getCurrentPath();
    
    assert.strictEqual(currentPath.length, 3);
    assert.strictEqual(currentPath[0].phase, 'discovery');
    assert.strictEqual(currentPath[1].phase, 'architecture');
    assert.strictEqual(currentPath[2].phase, 'solution');
  });
  
  // Test 7: Visualize tree
  await asyncTest('Visualize tree output', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_007');
    
    tree.addNode('discovery', 'Research phase');
    tree.addNode('architecture', 'Design phase');
    
    const viz = tree.visualize();
    
    assert.ok(viz.includes('session_007'), 'Should include session ID');
    assert.ok(viz.includes('main'), 'Should include branch name');
    assert.ok(viz.includes('discovery'), 'Should include discovery phase');
    assert.ok(viz.includes('architecture'), 'Should include architecture phase');
  });
  
  // Test 8: Get stats
  await asyncTest('Get tree statistics', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_008');
    
    tree.addNode('discovery', 'D');
    tree.addNode('architecture', 'A');
    tree.addNode('solution', 'S');
    tree.fork('alt');
    tree.addNode('solution', 'S-alt');
    
    const stats = tree.getStats();
    
    assert.strictEqual(stats.sessionId, 'session_008');
    assert.strictEqual(stats.nodes, 4);
    assert.strictEqual(stats.branches, 2);
    assert.ok(stats.phases.discovery === 1);
    assert.ok(stats.phases.architecture === 1);
    assert.ok(stats.phases.solution === 2);
  });
  
  // Test 9: Save and load
  await asyncTest('Save and load session tree', async () => {
    const sessionsDir = path.join(testDir, '.m7', 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    
    const tree = new SessionTreeManager(testDir);
    tree.create('session_009');
    tree.addNode('discovery', 'Saved node');
    tree.fork('saved-branch');
    tree.addNode('architecture', 'Saved architecture');
    
    await tree.save();
    
    // Load in new instance
    const tree2 = new SessionTreeManager(testDir);
    const loaded = await tree2.load('session_009');
    
    assert.ok(loaded, 'Should load tree');
    assert.strictEqual(loaded.sessionId, 'session_009');
    assert.strictEqual(loaded.nodes.length, 2);
    assert.strictEqual(loaded.branches.length, 2);
  });
  
  // Test 10: Multiple branches
  await asyncTest('Multiple branches from same node', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_010');
    
    const root = tree.addNode('discovery', 'Research');
    
    // Branch A
    tree.branch(root.id, 'approach-A');
    tree.addNode('architecture', 'A: Microservices');
    
    // Switch back and branch B
    tree.switchBranch('main');
    tree.branch(root.id, 'approach-B');
    tree.addNode('architecture', 'B: Monolith');
    
    // Switch back and branch C
    tree.switchBranch('main');
    tree.branch(root.id, 'approach-C');
    tree.addNode('architecture', 'C: Serverless');
    
    const stats = tree.getStats();
    assert.strictEqual(stats.branches, 4, 'Should have 4 branches (main + 3)');
    assert.strictEqual(stats.nodes, 4, 'Should have 4 nodes total');
  });
  
  // Test 11: Branch nodes include fork path
  await asyncTest('getBranchNodes includes path to fork point', async () => {
    const tree = new SessionTreeManager(testDir);
    tree.create('session_011');
    
    tree.addNode('discovery', 'D1');
    tree.addNode('architecture', 'A1');
    const branch = tree.fork('deep-fork');
    tree.addNode('solution', 'S-forked');
    
    const nodes = tree.getBranchNodes(branch.id);
    // Should include: D1, A1 (path to fork) + S-forked (branch node)
    assert.ok(nodes.length >= 3, `Should have at least 3 nodes, got ${nodes.length}`);
  });
  
  // Test 12: Empty tree visualization
  await asyncTest('Visualize empty tree', async () => {
    const tree = new SessionTreeManager(testDir);
    const viz = tree.visualize();
    assert.ok(viz.includes('No active session tree'));
  });
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  M7 Phase 4 Tests: Extensions + Session Tree                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  await setup();
  
  try {
    await testExtensionAPI();
    await testSessionTree();
  } finally {
    await cleanup();
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n  Total: ${passedTests + failedTests} tests`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log(`\n  ${failedTests === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('');
  
  process.exit(failedTests > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
