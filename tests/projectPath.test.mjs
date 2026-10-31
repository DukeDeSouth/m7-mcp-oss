import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  getProjectPath,
  applyProjectPath,
  clearProjectPathCache,
  markRootsResolutionComplete,
  resetProjectPathStateForTests,
  isRootsResolutionComplete
} = await import('../dist/core/utils/projectPath.js');

function resetEnv() {
  resetProjectPathStateForTests();
  delete process.env.M7_PROJECT_PATH;
  delete process.env.CURSOR_WORKSPACE;
  delete process.env.WORKSPACE_FOLDER_PATHS;
  delete process.env.AGENT_TRANSCRIPTS;
  delete process.env.CURSOR_PROJECTS_DIR;
}

console.log('projectPath tests');

resetEnv();
const tmpProject = mkdtempSync(join(tmpdir(), 'm7-project-path-'));
const emptyProjectsDir = mkdtempSync(join(tmpdir(), 'empty-cursor-projects-'));
process.env.M7_PROJECT_PATH = tmpProject;
process.env.CURSOR_PROJECTS_DIR = emptyProjectsDir;

const beforeRoots = getProjectPath();
assert.notEqual(
  beforeRoots,
  tmpProject,
  'M7_PROJECT_PATH must not win before MCP Roots resolution'
);
assert.equal(isRootsResolutionComplete(), false);

markRootsResolutionComplete();
clearProjectPathCache();
const afterRootsFail = getProjectPath();
assert.equal(
  afterRootsFail,
  tmpProject,
  'M7_PROJECT_PATH should apply after Roots retries exhausted'
);

resetEnv();
const explicitDir = mkdtempSync(join(tmpdir(), 'm7-explicit-'));
const applied = applyProjectPath(explicitDir);
assert.equal(applied, explicitDir);
assert.equal(getProjectPath(), explicitDir, 'explicit path must stick for session');

process.env.M7_PROJECT_PATH = mkdtempSync(join(tmpdir(), 'm7-other-'));
markRootsResolutionComplete();
assert.equal(getProjectPath(), explicitDir, 'explicit path must beat M7_PROJECT_PATH');

rmSync(tmpProject, { recursive: true, force: true });
rmSync(emptyProjectsDir, { recursive: true, force: true });
rmSync(explicitDir, { recursive: true, force: true });

resetEnv();
const home = homedir();
const emptyProjectsDirForHome = mkdtempSync(join(tmpdir(), 'empty-cursor-projects-home-'));
process.env.CURSOR_PROJECTS_DIR = emptyProjectsDirForHome;
clearProjectPathCache();
markRootsResolutionComplete();
const homeFallback = getProjectPath();
assert.notEqual(
  homeFallback,
  home,
  'bare home directory must not be used as default project path'
);
rmSync(emptyProjectsDirForHome, { recursive: true, force: true });

resetEnv();
const homeSlug = home
  .replace(/^(?:[A-Za-z]:)?[\\/]/, '')
  .replace(/[\\/]/g, '-');
const fakeProject = join(home, 'Documents', 'dev', 'TestM7SlugDecode');
mkdirSync(fakeProject, { recursive: true });
writeFileSync(join(fakeProject, 'package.json'), '{}');
process.env.AGENT_TRANSCRIPTS = join(
  home,
  '.cursor',
  'projects',
  `${homeSlug}-Documents-dev-TestM7SlugDecode`,
  'agent-transcripts'
);
clearProjectPathCache();
const decodedPath = getProjectPath();
assert.equal(decodedPath, fakeProject, 'AGENT_TRANSCRIPTS slug should decode to workspace path');
rmSync(fakeProject, { recursive: true, force: true });

resetEnv();
const fakeProjectsRoot = mkdtempSync(join(tmpdir(), 'cursor-projects-'));
const scanProject = join(home, 'Documents', 'dev', 'TestM7ProjectsScan');
mkdirSync(scanProject, { recursive: true });
writeFileSync(join(scanProject, 'package.json'), '{}');
const scanSlug = `${homeSlug}-Documents-dev-TestM7ProjectsScan`;
const scanSlugDir = join(fakeProjectsRoot, scanSlug);
mkdirSync(join(scanSlugDir, 'agent-transcripts'), { recursive: true });
writeFileSync(join(scanSlugDir, 'agent-transcripts', 'recent.jsonl'), '{"event":"test"}\n');
process.env.CURSOR_PROJECTS_DIR = fakeProjectsRoot;
clearProjectPathCache();
markRootsResolutionComplete();
const prevCwd = process.cwd();
process.chdir(home);
try {
  const scannedPath = getProjectPath();
  assert.equal(
    scannedPath,
    scanProject,
    'Cursor projects dir scan should resolve active workspace from slug'
  );
} finally {
  process.chdir(prevCwd);
}
rmSync(scanProject, { recursive: true, force: true });
rmSync(fakeProjectsRoot, { recursive: true, force: true });

resetEnv();
const emptyProjectsRoot = mkdtempSync(join(tmpdir(), 'cursor-projects-empty-'));
const emptyProject = join(home, 'Documents', 'dev', 'TestM7EmptyNewProject');
mkdirSync(emptyProject, { recursive: true });
const emptySlug = `${homeSlug}-Documents-dev-TestM7EmptyNewProject`;
const emptySlugDir = join(emptyProjectsRoot, emptySlug);
mkdirSync(join(emptySlugDir, 'agent-transcripts'), { recursive: true });
writeFileSync(join(emptySlugDir, 'agent-transcripts', 'session.jsonl'), '{"event":"new-project"}\n');
process.env.CURSOR_PROJECTS_DIR = emptyProjectsRoot;
clearProjectPathCache();
markRootsResolutionComplete();
const prevCwdEmpty = process.cwd();
process.chdir(home);
try {
  const emptyResolved = getProjectPath();
  assert.equal(
    emptyResolved,
    emptyProject,
    'empty new project folder must resolve via Cursor projects scan'
  );
} finally {
  process.chdir(prevCwdEmpty);
}
rmSync(emptyProject, { recursive: true, force: true });
rmSync(emptyProjectsRoot, { recursive: true, force: true });

resetEnv();

console.log('✅ projectPath tests passed');
