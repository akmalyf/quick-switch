import * as os from 'node:os';
import * as vscode from 'vscode';
import { currentProject, Project, ProjectHistory, projectKey, projectName } from './history';
import { WindowRegistry } from './windows';

const CONFIG = 'quickSwitch';

const newWindowButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('empty-window'), tooltip: 'Open in New Window' };
const revealButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: 'Reveal in File Explorer' };
const removeButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('close'), tooltip: 'Remove from History' };
const openFolderButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('new-folder'), tooltip: 'Open Folder...' };

const openFolderItem: vscode.QuickPickItem = { label: '$(new-folder) Open Folder...', alwaysShow: true };

interface ProjectItem extends vscode.QuickPickItem {
  project: Project;
  isOpen: boolean;
}

let registry: WindowRegistry;
let history: ProjectHistory;
let log: vscode.LogOutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel('Quick Switch', { log: true });
  registry = new WindowRegistry(context, log);
  history = new ProjectHistory(context);
  registry.register();
  void history.seed().then(recordCurrent, (error) => log.error('Failed to seed project history', error));

  // Source control status items (branch, sync) use priority 10000; higher priority sits further left.
  const statusBarItem = vscode.window.createStatusBarItem('quickSwitch.project', vscode.StatusBarAlignment.Left, 10001);
  statusBarItem.name = 'Quick Switch';
  statusBarItem.command = `${CONFIG}.switch`;
  const updateStatusBar = (): void => {
    const project = currentProject();
    statusBarItem.text = `$(window) ${project?.name ?? 'No Project'}`;
    statusBarItem.tooltip = project ? `${displayPath(project.uri)}\nClick to switch project` : 'Switch project';
    if (vscode.workspace.getConfiguration(CONFIG).get<boolean>('showStatusBarItem', true)) {
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  };
  updateStatusBar();

  context.subscriptions.push(
    log,
    registry,
    statusBarItem,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG}.showStatusBarItem`)) {
        updateStatusBar();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      registry.register();
      updateStatusBar();
      void recordCurrent();
    }),
    // Focusing a window bumps its project to the top of the history.
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void recordCurrent();
      }
    }),
    vscode.commands.registerCommand(`${CONFIG}.switch`, showSwitcher),
    vscode.commands.registerCommand(`${CONFIG}.nextWindow`, () => cycleWindow(1)),
    vscode.commands.registerCommand(`${CONFIG}.previousWindow`, () => cycleWindow(-1)),
    vscode.commands.registerCommand(`${CONFIG}.clearHistory`, clearHistory),
  );
}

export function deactivate(): void {
  registry?.unregister();
}

async function recordCurrent(): Promise<void> {
  const project = currentProject();
  if (!project) {
    return;
  }
  try {
    await history.touch(project, vscode.workspace.getConfiguration(CONFIG).get<number>('historySize', 50));
  } catch (error) {
    log.error('Failed to update project history', error);
  }
}

async function clearHistory(): Promise<void> {
  const choice = await vscode.window.showWarningMessage('Clear the Quick Switch project history?', { modal: true }, 'Clear');
  if (choice === 'Clear') {
    await history.clear();
    await recordCurrent();
  }
}

function displayPath(uri: vscode.Uri): string {
  if (uri.scheme !== 'file') {
    return uri.toString();
  }
  const home = os.homedir();
  return uri.fsPath.startsWith(home) ? `~${uri.fsPath.slice(home.length)}` : uri.fsPath;
}

function toItem(project: Project, isOpen: boolean): ProjectItem {
  const buttons: vscode.QuickInputButton[] = [];
  if (!isOpen) {
    buttons.push(newWindowButton);
  }
  if (project.uri.scheme === 'file') {
    buttons.push(revealButton);
  }
  if (!isOpen) {
    buttons.push(removeButton);
  }
  const icon = isOpen ? 'window' : project.isWorkspaceFile ? 'root-folder' : 'folder';
  return { project, isOpen, label: `$(${icon}) ${project.name}`, description: displayPath(project.uri), buttons };
}

async function collectItems(): Promise<Array<ProjectItem | vscode.QuickPickItem>> {
  const [windows, recent] = await Promise.all([registry.list(), history.list()]);

  // Every project is shown once, open windows first; the current one is left out.
  const seen = new Set<string>();
  const current = currentProject();
  if (current) {
    seen.add(projectKey(current.uri));
  }
  const take = (projects: Project[]): Project[] =>
    projects.filter((project) => {
      const key = projectKey(project.uri);
      return !seen.has(key) && !!seen.add(key);
    });

  const open = take(windows.map((w) => ({ uri: w.uri, isWorkspaceFile: w.isWorkspaceFile, name: projectName(w.uri, w.isWorkspaceFile) })));
  const rest = take(recent);

  const items: Array<ProjectItem | vscode.QuickPickItem> = [];
  if (open.length) {
    items.push({ label: 'Open Windows', kind: vscode.QuickPickItemKind.Separator }, ...open.map((p) => toItem(p, true)));
  }
  if (rest.length) {
    items.push({ label: 'Recent Projects', kind: vscode.QuickPickItemKind.Separator }, ...rest.map((p) => toItem(p, false)));
  }
  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, openFolderItem);
  return items;
}

async function showSwitcher(): Promise<void> {
  const quickPick = vscode.window.createQuickPick<ProjectItem | vscode.QuickPickItem>();
  quickPick.title = 'Quick Switch';
  quickPick.placeholder = 'Switch to project';
  quickPick.matchOnDescription = true;
  quickPick.buttons = [openFolderButton];
  quickPick.busy = true;
  quickPick.show();

  const refresh = async (): Promise<void> => {
    quickPick.items = await collectItems();
    quickPick.busy = false;
  };

  quickPick.onDidAccept(() => {
    const item = quickPick.selectedItems[0] as ProjectItem | undefined;
    quickPick.hide();
    if (item === openFolderItem) {
      void openFolder();
    } else if (item?.project) {
      void openProject(item.project, item.isOpen);
    }
  });
  quickPick.onDidTriggerButton((button) => {
    if (button === openFolderButton) {
      quickPick.hide();
      void openFolder();
    }
  });
  quickPick.onDidTriggerItemButton(async ({ item, button }) => {
    const { project } = item as ProjectItem;
    if (button === newWindowButton) {
      quickPick.hide();
      await openProject(project, true);
    } else if (button === revealButton) {
      await vscode.commands.executeCommand('revealFileInOS', project.uri);
    } else if (button === removeButton) {
      await history.remove(project.uri);
      await refresh();
    }
  });
  quickPick.onDidHide(() => quickPick.dispose());

  await refresh();
}

/** Pick a folder (or a .code-workspace file on macOS) that is not in the list yet. */
async function openFolder(): Promise<void> {
  const canPickFiles = process.platform === 'darwin';
  const [uri] =
    (await vscode.window.showOpenDialog({
      title: 'Open Project',
      openLabel: 'Open',
      canSelectFolders: true,
      canSelectFiles: canPickFiles,
      canSelectMany: false,
      filters: canPickFiles ? { 'Code Workspace': ['code-workspace'] } : undefined,
      defaultUri: currentProject()?.uri,
    })) ?? [];
  if (!uri) {
    return;
  }
  const isWorkspaceFile = uri.path.endsWith('.code-workspace');
  const windows = await registry.list();
  const isOpen = windows.some((w) => projectKey(w.uri) === projectKey(uri));
  await openProject({ uri, isWorkspaceFile, name: projectName(uri, isWorkspaceFile) }, isOpen);
}

async function openProject(project: Project, forceNewWindow = false): Promise<void> {
  // A project already open in another window is opened with forceNewWindow, which just focuses that window.
  if (!forceNewWindow && currentProject()) {
    const openIn = vscode.workspace.getConfiguration(CONFIG).get<string>('openIn', 'ask');
    if (openIn === 'newWindow') {
      forceNewWindow = true;
    } else if (openIn === 'ask') {
      const choice = await vscode.window.showInformationMessage(
        `Open "${project.name}"`,
        { modal: true, detail: 'Open the project in this window or in a new window?' },
        'This Window',
        'New Window',
      );
      if (!choice) {
        return;
      }
      forceNewWindow = choice === 'New Window';
    }
  }

  await vscode.commands.executeCommand('vscode.openFolder', project.uri, { forceNewWindow });
}

/** Cycle through open project windows in the order they were opened. */
async function cycleWindow(step: 1 | -1): Promise<void> {
  const windows = await registry.list();
  const current = windows.findIndex((w) => w.pid === process.pid);
  if (windows.length < 2 || current < 0) {
    // Fall back to VS Code's own window switcher (also covers windows without this extension).
    await vscode.commands.executeCommand('workbench.action.quickSwitchWindow');
    return;
  }
  const target = windows[(current + step + windows.length) % windows.length];
  await vscode.commands.executeCommand('vscode.openFolder', target.uri, { forceNewWindow: true });
}
