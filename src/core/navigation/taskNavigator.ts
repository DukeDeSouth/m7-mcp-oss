// Task Navigation System - tracks position in task hierarchy and preserves context

export interface TaskNode {
  level: number;
  task: string;
  taskId: string;
  whyNeeded: string;
  parentTask: string;
  criticalContext: string[];
  returnPoint: {
    file?: string;
    lineNumber?: number;
    nextAction: string;
  };
  timestamp: Date;
}

export interface ContextSnapshot {
  taskId: string;
  mainGoal: string;
  currentContext: Map<string, string>;
  decisions: Array<{decision: string, reasoning: string}>;
  completedSteps: string[];
  nextSteps: string[];
}

export interface NavigationStatus {
  currentTask: TaskNode;
  depth: number;
  path: TaskNode[];
  mainMission: string;
  progress: number;
}

export interface RoadmapItem {
  step: string;
  estimatedTime: string;
  completed: boolean;
  milestone?: string;
}

export class TaskNavigator {
  private navigationStack: TaskNode[] = [];
  private roadmap: RoadmapItem[] = [];
  private contextSnapshots: Map<string, ContextSnapshot> = new Map();
  private mainGoal: string = '';
  private startTime: Date = new Date();

  constructor(mainGoal: string, initialRoadmap?: RoadmapItem[]) {
    this.mainGoal = mainGoal;
    if (initialRoadmap) {
      this.roadmap = initialRoadmap;
    }
  }

  // Push new subtask and save current context
  push(subtask: TaskNode): string {
    // Save context before diving deeper
    const currentContext = this.captureContext();
    if (this.getCurrentTask()) {
      this.contextSnapshots.set(this.getCurrentTask()!.taskId, currentContext);
    }

    this.navigationStack.push(subtask);
    
    return this.formatPushConfirmation(subtask);
  }

  // Pop from stack and restore context
  pop(): { task: TaskNode; context: ContextSnapshot; nextAction: string } | null {
    const completedTask = this.navigationStack.pop();
    if (!completedTask) return null;

    const parentTask = this.getCurrentTask();
    const restoredContext = parentTask 
      ? this.contextSnapshots.get(parentTask.taskId)
      : null;

    return {
      task: completedTask,
      context: restoredContext || this.createEmptyContext(),
      nextAction: parentTask?.returnPoint.nextAction || 'Continue with main goal'
    };
  }

  // Get current position in task hierarchy
  whereAmI(): NavigationStatus {
    const currentTask = this.getCurrentTask();
    if (!currentTask) {
      return {
        currentTask: this.createRootTask(),
        depth: 0,
        path: [],
        mainMission: this.mainGoal,
        progress: this.calculateProgress()
      };
    }

    return {
      currentTask,
      depth: this.navigationStack.length,
      path: [...this.navigationStack],
      mainMission: this.mainGoal,
      progress: this.calculateProgress()
    };
  }

  // Format navigation breadcrumb for display
  formatNavigationBreadcrumb(status: NavigationStatus): string {
    let output = `## 🗺️ M7 Navigation: Where You Are\n\n`;
    output += `**Main Mission**: ${status.mainMission}\n`;
    output += `**Current Depth**: Level ${status.depth} of ${status.depth}\n`;
    output += `**You are here**: ${status.currentTask.task}\n\n`;

    if (status.path.length > 0) {
      output += `**Path taken**:\n`;
      status.path.forEach((node, index) => {
        const indent = '  '.repeat(index);
        const marker = index === status.path.length - 1 ? '📍' : '└─';
        output += `${index + 1}. ${indent}${marker} ${node.task}\n`;
      });
    }

    output += `\n**Why this matters**: ${status.currentTask.whyNeeded}\n\n`;

    const nextSteps = this.getNextSteps();
    if (nextSteps.length > 0) {
      output += `**Next steps after this**:\n`;
      nextSteps.forEach(step => {
        output += `- ${step}\n`;
      });
    }

    output += `\n**Progress**: [${this.generateProgressBar(status.progress)}] ${status.progress}%`;

    return output;
  }

  // Update roadmap progress
  markStepComplete(stepIndex: number): void {
    if (this.roadmap[stepIndex]) {
      this.roadmap[stepIndex].completed = true;
    }
  }

  // Get current roadmap status
  getRoadmapStatus(): string {
    let output = `## 📍 Roadmap Progress\n\n`;
    
    this.roadmap.forEach((item, index) => {
      const status = item.completed ? '✅' : '⏳';
      const milestone = item.milestone ? ` 🎯 **${item.milestone}**` : '';
      output += `${index + 1}. ${status} ${item.step} (${item.estimatedTime})${milestone}\n`;
    });

    return output;
  }

  // Save important context for later
  saveContext(key: string, value: string): void {
    const current = this.getCurrentTask();
    if (current) {
      const snapshot = this.contextSnapshots.get(current.taskId) || this.createEmptyContext();
      snapshot.currentContext.set(key, value);
      this.contextSnapshots.set(current.taskId, snapshot);
    }
  }

  // Get time elapsed
  getElapsedTime(): string {
    const now = new Date();
    const elapsed = now.getTime() - this.startTime.getTime();
    const minutes = Math.floor(elapsed / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  }

  // Private helper methods
  private getCurrentTask(): TaskNode | null {
    return this.navigationStack[this.navigationStack.length - 1] || null;
  }

  private captureContext(): ContextSnapshot {
    const currentTask = this.getCurrentTask();
    return {
      taskId: currentTask?.taskId || 'root',
      mainGoal: this.mainGoal,
      currentContext: new Map(),
      decisions: [],
      completedSteps: this.roadmap.filter(r => r.completed).map(r => r.step),
      nextSteps: this.roadmap.filter(r => !r.completed).slice(0, 3).map(r => r.step)
    };
  }

  private createEmptyContext(): ContextSnapshot {
    return {
      taskId: 'unknown',
      mainGoal: this.mainGoal,
      currentContext: new Map(),
      decisions: [],
      completedSteps: [],
      nextSteps: []
    };
  }

  private createRootTask(): TaskNode {
    return {
      level: 0,
      task: 'Root Task',
      taskId: 'root',
      whyNeeded: 'Starting point',
      parentTask: '',
      criticalContext: [],
      returnPoint: {
        nextAction: 'Begin implementation'
      },
      timestamp: new Date()
    };
  }

  private calculateProgress(): number {
    if (this.roadmap.length === 0) return 0;
    const completed = this.roadmap.filter(r => r.completed).length;
    return Math.round((completed / this.roadmap.length) * 100);
  }

  private getNextSteps(): string[] {
    const steps: string[] = [];
    
    // Current task completion
    const current = this.getCurrentTask();
    if (current) {
      steps.push(`Complete: ${current.task}`);
    }

    // Return to parent
    if (this.navigationStack.length > 1) {
      const parent = this.navigationStack[this.navigationStack.length - 2];
      steps.push(`Return to: ${parent.task}`);
    }

    // Next roadmap items
    const nextRoadmapItems = this.roadmap
      .filter(r => !r.completed)
      .slice(0, 2)
      .map(r => r.step);
    steps.push(...nextRoadmapItems);

    return steps;
  }

  private formatPushConfirmation(subtask: TaskNode): string {
    return `📥 Context saved. Diving into: ${subtask.task}\n` +
           `Depth: ${this.navigationStack.length}\n` +
           `Parent will wait at: ${subtask.returnPoint.file || 'checkpoint'}`;
  }

  private generateProgressBar(progress: number): string {
    const total = 20;
    const filled = Math.floor((progress / 100) * total);
    const empty = total - filled;
    return '='.repeat(filled) + '-'.repeat(empty);
  }
} 