import { createHash } from 'node:crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';
import { getProjectPath } from '../utils/projectPath.js';
import { isFeatureEnabled } from '../config/featureFlags.js';
import { getTaskGraphManager } from '../task-graph/index.js';
import type { FogOfWarEntry } from '../../memory/memorySystem.js';
import { getBlockingUnknowns } from '../../memory/fogBoundary.js';
import type { CycleState } from './types/cycle.js';

const log = createLogger('[frontierReconSpawner]');

function pathSlug(entryPath: string): string {
  const slug = entryPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return slug || 'path';
}

function pathHash8(entryPath: string): string {
  return createHash('sha256').update(entryPath).digest('hex').slice(0, 8);
}

function reconTaskId(entryPath: string): string {
  return `recon_${pathSlug(entryPath)}_${pathHash8(entryPath)}`;
}

export async function spawnReconTasksForBlockingUnknowns(
  cycleState: CycleState,
  entries: FogOfWarEntry[]
): Promise<string[]> {
  if (!isFeatureEnabled('taskGraph')) {
    return [];
  }

  const already = new Set(cycleState.spawnedReconTaskIds ?? []);
  const blocking = getBlockingUnknowns(entries);
  if (blocking.length === 0) {
    return [];
  }

  const graphManager = getTaskGraphManager();
  await graphManager.initialize();

  const projectPath = getProjectPath();
  const created: string[] = [];

  for (const entry of blocking) {
    const taskId = reconTaskId(entry.path);
    if (already.has(taskId)) {
      continue;
    }

    const slug = pathSlug(entry.path);
    const hash = pathHash8(entry.path);
    const folder = `m7-cycles/recon-${slug}-${hash}`;
    const folderAbs = path.join(projectPath, folder);

    try {
      await fs.mkdir(folderAbs, { recursive: true });
      await graphManager.createTask({
        id: taskId,
        title: `Recon: ${entry.path}`,
        folder,
        parentTaskId: cycleState.taskId,
      });
      created.push(taskId);
      log.debug(`Spawned recon task ${taskId} for ${entry.path}`);
    } catch (err) {
      log.warn(`Failed to spawn recon for ${entry.path}:`, err);
    }
  }

  return created;
}

export { reconTaskId };
