import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface Project {
  uri: vscode.Uri;
  name: string;
  isWorkspaceFile: boolean;
}

interface HistoryRecord {
  uri: string;
  isWorkspaceFile: boolean;
  lastOpened: number;
}

/** Stable key used to dedupe projects. */
export function projectKey(uri: vscode.Uri): string {
  const key = uri.scheme === 'file' ? path.resolve(uri.fsPath) : uri.toString();
  return process.platform === 'linux' ? key : key.toLowerCase();
}

export function projectName(uri: vscode.Uri, isWorkspaceFile: boolean): string {
  const base = path.posix.basename(uri.path);
  return isWorkspaceFile ? base.replace(/\.code-workspace$/, '') : base;
}

/** The project open in this window, if any. */
export function currentProject(): Project | undefined {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && workspaceFile.scheme !== 'untitled') {
    return { uri: workspaceFile, isWorkspaceFile: true, name: projectName(workspaceFile, true) };
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  return folder && { uri: folder, isWorkspaceFile: false, name: projectName(folder, false) };
}

// Shape returned by the internal `_workbench.getRecentlyOpened` command.
interface RecentlyOpened {
  workspaces: Array<{ folderUri?: vscode.Uri; workspace?: { configPath: vscode.Uri } }>;
}

/**
 * Quick Switch's own recent-projects history, kept in a JSON file in global
 * storage so every window reads and writes the same list. Ordered by when a
 * project window was last opened or focused.
 */
export class ProjectHistory {
  private readonly file: string;

  constructor(context: vscode.ExtensionContext) {
    this.file = path.join(context.globalStorageUri.fsPath, 'history.json');
  }

  private async read(): Promise<HistoryRecord[] | undefined> {
    try {
      return JSON.parse(await fs.promises.readFile(this.file, 'utf8')) as HistoryRecord[];
    } catch {
      return undefined;
    }
  }

  private async write(records: HistoryRecord[]): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(records));
    await fs.promises.rename(tmp, this.file);
  }

  /** On first run, start from VS Code's own recent list so the history is not empty. */
  async seed(): Promise<void> {
    if (await this.read()) {
      return;
    }
    let recent: RecentlyOpened | undefined;
    try {
      recent = await vscode.commands.executeCommand<RecentlyOpened>('_workbench.getRecentlyOpened');
    } catch {
      // Internal command unavailable: start with an empty history.
    }
    const now = Date.now();
    const records: HistoryRecord[] = [];
    for (const [i, entry] of (recent?.workspaces ?? []).entries()) {
      const raw = entry.folderUri ?? entry.workspace?.configPath;
      if (raw) {
        const uri = raw instanceof vscode.Uri ? raw : vscode.Uri.from(raw as Parameters<typeof vscode.Uri.from>[0]);
        records.push({ uri: uri.toString(), isWorkspaceFile: !entry.folderUri, lastOpened: now - i });
      }
    }
    await this.write(records);
  }

  async touch(project: Project, maxSize: number): Promise<void> {
    const key = projectKey(project.uri);
    const records = ((await this.read()) ?? []).filter((r) => projectKey(vscode.Uri.parse(r.uri)) !== key);
    records.unshift({ uri: project.uri.toString(), isWorkspaceFile: project.isWorkspaceFile, lastOpened: Date.now() });
    await this.write(records.slice(0, maxSize));
  }

  async remove(uri: vscode.Uri): Promise<void> {
    const key = projectKey(uri);
    await this.write(((await this.read()) ?? []).filter((r) => projectKey(vscode.Uri.parse(r.uri)) !== key));
  }

  async clear(): Promise<void> {
    await this.write([]);
  }

  /** Most recently used first. */
  async list(): Promise<Project[]> {
    const records = ((await this.read()) ?? []).sort((a, b) => b.lastOpened - a.lastOpened);
    return records.map((r) => {
      const uri = vscode.Uri.parse(r.uri);
      return { uri, isWorkspaceFile: r.isWorkspaceFile, name: projectName(uri, r.isWorkspaceFile) };
    });
  }
}
