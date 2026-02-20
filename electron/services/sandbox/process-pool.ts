/**
 * Process Pool
 *
 * Manages a pool of isolated worker processes for parallel task execution.
 */

import { fork, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';

interface WorkerTask {
  id: string;
  type: string;
  data: any;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
}

interface Worker {
  process: ChildProcess;
  id: string;
  busy: boolean;
  currentTask: WorkerTask | null;
  tasksCompleted: number;
  errors: number;
}

export interface ProcessPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  idleTimeout: number; // ms before idle worker is terminated
  taskTimeout: number; // ms before task times out
  workerScript?: string;
}

const DEFAULT_CONFIG: ProcessPoolConfig = {
  minWorkers: 1,
  maxWorkers: 4,
  idleTimeout: 60000, // 1 minute
  taskTimeout: 30000, // 30 seconds
};

export class ProcessPool extends EventEmitter {
  private config: ProcessPoolConfig;
  private workers: Map<string, Worker> = new Map();
  private taskQueue: WorkerTask[] = [];
  private workerIdCounter = 0;
  private shuttingDown = false;

  constructor(config: Partial<ProcessPoolConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializePool();
  }

  /**
   * Initialize the minimum number of workers
   */
  private initializePool(): void {
    for (let i = 0; i < this.config.minWorkers; i++) {
      this.createWorker();
    }
  }

  /**
   * Create a new worker
   */
  private createWorker(): Worker {
    const id = `worker-${++this.workerIdCounter}`;

    // Use a simple inline worker script if none provided
    const workerScript = this.config.workerScript ||
      path.join(__dirname, 'worker.js');

    let child: ChildProcess;
    try {
      child = fork(workerScript, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      });
    } catch {
      // Fallback: create a mock worker that just echoes
      child = fork('', [], {
        execArgv: ['-e', `
          process.on('message', (msg) => {
            if (msg.type === 'execute') {
              setTimeout(() => {
                process.send({ taskId: msg.taskId, success: true, result: { echo: msg.data } });
              }, 100);
            }
          });
        `]
      });
    }

    const worker: Worker = {
      process: child,
      id,
      busy: false,
      currentTask: null,
      tasksCompleted: 0,
      errors: 0
    };

    // Handle messages from worker
    child.on('message', (msg: any) => {
      const task = worker.currentTask;
      if (msg.taskId && task && task.id === msg.taskId) {
        clearTimeout(task.timeout);
        worker.currentTask = null;
        worker.busy = false;
        worker.tasksCompleted++;

        if (msg.success) {
          task.resolve(msg.result);
        } else {
          worker.errors++;
          task.reject(new Error(msg.error || 'Task failed'));
        }

        // Process next task
        this.processQueue();
      }
    });

    // Handle worker exit
    child.on('exit', (code) => {
      this.workers.delete(id);
      this.emit('worker:exit', { workerId: id, code });

      // Reject current task if any
      if (worker.currentTask) {
        worker.currentTask.reject(new Error('Worker process died'));
        clearTimeout(worker.currentTask.timeout);
      }

      // Create replacement if not shutting down
      if (!this.shuttingDown && this.workers.size < this.config.minWorkers) {
        this.createWorker();
      }
    });

    // Handle worker errors
    child.on('error', (err) => {
      this.emit('worker:error', { workerId: id, error: err });
    });

    this.workers.set(id, worker);
    this.emit('worker:created', { workerId: id });

    // Set idle timeout
    this.scheduleIdleCheck(worker);

    return worker;
  }

  /**
   * Schedule idle worker termination
   */
  private scheduleIdleCheck(worker: Worker): void {
    setTimeout(() => {
      if (
        !worker.busy &&
        this.workers.size > this.config.minWorkers &&
        this.taskQueue.length === 0
      ) {
        this.terminateWorker(worker.id);
      } else if (this.workers.has(worker.id)) {
        this.scheduleIdleCheck(worker);
      }
    }, this.config.idleTimeout);
  }

  /**
   * Terminate a specific worker
   */
  private terminateWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.process.kill();
      this.workers.delete(workerId);
      this.emit('worker:terminated', { workerId });
    }
  }

  /**
   * Submit a task to the pool
   */
  submit<T = any>(type: string, data: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const timeout = setTimeout(() => {
        // Find and remove the task
        const queueIndex = this.taskQueue.findIndex(t => t.id === taskId);
        if (queueIndex >= 0) {
          this.taskQueue.splice(queueIndex, 1);
          reject(new Error('Task timeout'));
          return;
        }

        // Check if task is running
        for (const worker of this.workers.values()) {
          if (worker.currentTask?.id === taskId) {
            worker.currentTask.reject(new Error('Task timeout'));
            worker.currentTask = null;
            worker.busy = false;
            worker.errors++;
            // Don't kill worker, just mark as available
            break;
          }
        }
      }, this.config.taskTimeout);

      const task: WorkerTask = {
        id: taskId,
        type,
        data,
        resolve,
        reject,
        timeout
      };

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    if (this.taskQueue.length === 0) return;

    // Find available worker
    let availableWorker: Worker | null = null;
    for (const worker of this.workers.values()) {
      if (!worker.busy) {
        availableWorker = worker;
        break;
      }
    }

    // Create new worker if needed and under limit
    if (!availableWorker && this.workers.size < this.config.maxWorkers) {
      availableWorker = this.createWorker();
    }

    if (availableWorker) {
      const task = this.taskQueue.shift()!;
      availableWorker.busy = true;
      availableWorker.currentTask = task;

      availableWorker.process.send({
        type: 'execute',
        taskId: task.id,
        taskType: task.type,
        data: task.data
      });

      this.emit('task:started', { taskId: task.id, workerId: availableWorker.id });
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalWorkers: number;
    busyWorkers: number;
    idleWorkers: number;
    queuedTasks: number;
    totalTasksCompleted: number;
    totalErrors: number;
  } {
    let busy = 0;
    let tasksCompleted = 0;
    let errors = 0;

    for (const worker of this.workers.values()) {
      if (worker.busy) busy++;
      tasksCompleted += worker.tasksCompleted;
      errors += worker.errors;
    }

    return {
      totalWorkers: this.workers.size,
      busyWorkers: busy,
      idleWorkers: this.workers.size - busy,
      queuedTasks: this.taskQueue.length,
      totalTasksCompleted: tasksCompleted,
      totalErrors: errors
    };
  }

  /**
   * Shutdown the pool
   */
  async shutdown(timeout = 5000): Promise<void> {
    this.shuttingDown = true;

    // Reject queued tasks
    for (const task of this.taskQueue) {
      clearTimeout(task.timeout);
      task.reject(new Error('Pool shutdown'));
    }
    this.taskQueue = [];

    // Wait for busy workers or timeout
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      let anyBusy = false;
      for (const worker of this.workers.values()) {
        if (worker.busy) {
          anyBusy = true;
          break;
        }
      }
      if (!anyBusy) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // Force kill all workers
    for (const worker of this.workers.values()) {
      if (worker.currentTask) {
        clearTimeout(worker.currentTask.timeout);
        worker.currentTask.reject(new Error('Pool shutdown'));
      }
      worker.process.kill('SIGKILL');
    }
    this.workers.clear();

    this.emit('pool:shutdown');
  }

  /**
   * Scale the pool
   */
  scale(workerCount: number): void {
    const target = Math.max(
      this.config.minWorkers,
      Math.min(this.config.maxWorkers, workerCount)
    );

    if (target > this.workers.size) {
      // Scale up
      for (let i = this.workers.size; i < target; i++) {
        this.createWorker();
      }
    } else if (target < this.workers.size) {
      // Scale down - remove idle workers first
      const toRemove = this.workers.size - target;
      let removed = 0;

      for (const [id, worker] of this.workers) {
        if (removed >= toRemove) break;
        if (!worker.busy) {
          this.terminateWorker(id);
          removed++;
        }
      }
    }
  }
}

// Create default worker script content
const WORKER_SCRIPT = `
process.on('message', async (msg) => {
  if (msg.type === 'execute') {
    try {
      // Simple task handling - extend as needed
      let result;
      switch (msg.taskType) {
        case 'echo':
          result = msg.data;
          break;
        case 'compute':
          result = await compute(msg.data);
          break;
        default:
          result = { received: msg.data };
      }
      process.send({ taskId: msg.taskId, success: true, result });
    } catch (error) {
      process.send({ taskId: msg.taskId, success: false, error: error.message });
    }
  }
});

async function compute(data) {
  // Placeholder for compute-intensive tasks
  return data;
}
`;

export { WORKER_SCRIPT };
export default ProcessPool;
