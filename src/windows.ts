import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { currentProject } from './history';

export interface OpenWindow {
  pid: number;
  uri: vscode.Uri;
  isWorkspaceFile: boolean;
  openedAt: number;
}

interface WindowRecord {
  pid: number;
  uri: string;
  isWorkspaceFile: boolean;
  openedAt: number;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * VS Code has no API to enumerate other windows, so every window running this
 * extension registers its project in a shared folder (one file per extension
 * host process). Stale entries from crashed windows are pruned on read.
 */
export class WindowRegistry implements vscode.Disposable {
  private readonly dir: string;
  private readonly file: string;

  constructor(
    context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.dir = path.join(context.globalStorageUri.fsPath, 'windows');
    this.file = path.join(this.dir, `${process.pid}.json`);
  }

  /** Writes (or clears) this window's entry from the current workspace. */
  register(): void {
    const project = currentProject();
    if (!project) {
      this.unregister();
      return;
    }
    const record: WindowRecord = { pid: process.pid, uri: project.uri.toString(), isWorkspaceFile: project.isWorkspaceFile, openedAt: Date.now() };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(record));
    } catch (error) {
      this.log.error('Failed to register window', error);
    }
  }

  unregister(): void {
    try {
      fs.rmSync(this.file, { force: true });
    } catch (error) {
      this.log.error('Failed to unregister window', error);
    }
  }

  /** All open project windows, this one included, ordered by when they were opened. */
  async list(): Promise<OpenWindow[]> {
    let files: string[];
    try {
      files = await fs.promises.readdir(this.dir);
    } catch {
      return [];
    }
    const windows: OpenWindow[] = [];
    for (const name of files.filter((f) => f.endsWith('.json'))) {
      const file = path.join(this.dir, name);
      try {
        const record = JSON.parse(await fs.promises.readFile(file, 'utf8')) as WindowRecord;
        if (!isAlive(record.pid)) {
          await fs.promises.rm(file, { force: true });
          continue;
        }
        windows.push({ ...record, uri: vscode.Uri.parse(record.uri) });
      } catch {
        // Partially written or corrupt entry: skip it.
      }
    }
    return windows.sort((a, b) => a.openedAt - b.openedAt);
  }

  dispose(): void {
    this.unregister();
  }
}
