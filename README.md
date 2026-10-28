# Quick Switch Project

Jump between your projects in VS Code with one shortcut — a fast, searchable project switcher with its own recent-projects history and next/previous window cycling.

## Features

- **Switch Project popup** — open project windows first, then your recent projects. Fuzzy search on project name and path.
- **Per-item actions** — open in a new window, reveal in Finder / Explorer, remove from history.
- **Open Folder...** — open a project that is not in the list yet, right from the popup (last item, or the button in the popup header).
- **Next / Previous Project Window** — cycle through open project windows without touching the mouse.
- **Status bar item** — shows the current project name next to the git branch; click it to open the switcher.
- **Own history** — shared by all VS Code windows, ordered by when a project was last opened or focused.

## Shortcuts

| Command | macOS | Windows / Linux |
|---|---|---|
| Quick Switch: Switch Project... | `⌘⌥P` | `Ctrl+Alt+P` |
| Quick Switch: Next Project Window | ``⌘⌥` `` | `Ctrl+Alt+]` |
| Quick Switch: Previous Project Window | ``⌘⇧⌥` `` | `Ctrl+Alt+[` |
| Quick Switch: Clear Project History | – | – |

Rebind them in **Preferences: Open Keyboard Shortcuts**.

## Settings

| Setting | Default | Description |
|---|---|---|
| `quickSwitch.openIn` | `ask` | Where to open a project that is not open yet: `ask`, `newWindow` or `currentWindow`. |
| `quickSwitch.showStatusBarItem` | `true` | Show the current project name in the status bar. |
| `quickSwitch.historySize` | `50` | Maximum number of projects kept in the history. |

## How it works

- The history lives in the extension's global storage and is shared by every window. On first run it is seeded once from VS Code's own recent list.
- VS Code has no API to list other windows, so each window running this extension registers itself in global storage. Selecting a project that is already open focuses its window instead of opening it twice.
- If only one window is registered, Next / Previous Project Window falls back to VS Code's built-in window switcher.

## Development

```bash
npm install
npm run package   # typecheck, bundle and build the .vsix
```

## License

[MIT](LICENSE)
