import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type { AppConfig } from './config.js';

export type RunPromptOptions = {
  sessionId?: string;
  model?: string;
  agent?: string;
};

export class SharedTerminal extends EventEmitter {
  private running = false;

  constructor(private readonly config: AppConfig) {
    super();
  }

  isRunning(): boolean {
    return this.running;
  }

  async runPrompt(message: string, options: RunPromptOptions): Promise<void> {
    if (this.running) throw new Error('OpenCode is already running a request');
    this.running = true;
    this.emit('activity');

    const args = ['run', message, '--format', 'json'];
    if (options.sessionId) args.push('--session', options.sessionId);
    if (options.model) args.push('--model', options.model);
    if (options.agent) args.push('--agent', options.agent);

    try {
      await this.spawnOpenCode(args);
    } finally {
      this.running = false;
      this.emit('activity');
    }
  }

  dispose(): void {
    // No persistent process is kept in the oc-run architecture.
  }

  private spawnOpenCode(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.startCommand, args, {
        cwd: this.config.cwd,
        env: process.env,
        shell: process.platform === 'win32'
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `oc run exited with code ${code}`));
      });
    });
  }
}
