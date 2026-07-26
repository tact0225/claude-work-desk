# claude-work Desk

[日本語README](README.md)

**A file-handoff desk between your WSL-based Claude Code workspace and the Windows desktop.**

If you run Claude Code (CLI) inside WSL, moving files between Windows and your workspace is a constant papercut: Explorer over `\\wsl.localhost\` is slow, Obsidian only shows Markdown, VS Code renders Markdown poorly. This app is a single window that fills that gap — it makes working with Claude Code feel like **tossing files into a chat**.

Note: the UI is currently Japanese-only.

## Features

- **Tree view** of your whole workspace (lazy-loaded, fast)
- **Path bar** (top): paste a folder's full path and hit Enter to browse it — built for peeking into `git worktree` lanes (`~/claude-work-xxx`) with a single paste. WSL paths (`/home/...`, `/mnt/c/...`) work as-is and are converted to UNC automatically. `▾` opens an Explorer-style history (last 20), `⌂` returns to the workspace, `↑` goes up one level. Paste a *file* path and it opens the parent folder and previews that file.
  - While you're outside the workspace the folder name turns blue with a `↗` marker. **The `_inbox/` drop target never moves** — drops always land in your real workspace, even while peeking at a lane.
- **Preview**: rendered Markdown (toggle to source with line numbers, copy buttons on code blocks, draggable table column widths), syntax-highlighted code with line numbers, `.docx`, images, PDF
- **Write mode**: the **入力** (input) button in the preview header turns the pane into an editor for Markdown/text files. Read-only is the default — pressing the button flips it into write mode and the button **inverts to solid blue**, so the writable state is unmistakable. `Ctrl+S` (or `保存`) saves; navigating away with unsaved changes prompts first (the title shows `● 入力中`).
- **Wikilinks**: `[[page-name]]` resolves to a clickable link (`←` button / Alt+← to go back). Targets are matched by *name*, not path, so moving files doesn't break links. Search directories are configured via `wikilinkDirs` in `config.json`. Unresolved links render greyed out rather than disappearing — they mark pages you haven't written yet.
- **Inbox**: drop files anywhere on the window → copied into your workspace's `_inbox/`, with a chat-like receipt feed that fades after a minute. **Ctrl+V** pastes clipboard content (files / screenshots → .png / text → .md)
- **Drag out**: drag any file from the tree straight into Explorer or a chat app
- **Copy WSL path**: right-click → copy `/home/...`-style path, ready to paste into a Claude Code prompt
- **Display settings**: font size (Ctrl+wheel), UI/monospace font pickers, draggable sidebar width — all persisted

## Requirements

- Windows 10/11 + WSL2
- Node.js LTS on the Windows side — https://nodejs.org
- rsync inside WSL (usually preinstalled)

## Setup

From a WSL terminal:

```bash
git clone https://github.com/tact0225/claude-work-desk.git
cd claude-work-desk
bash sync_to_windows.sh
```

This deploys to `%LOCALAPPDATA%\claude-work-desk`, installs dependencies, and creates a desktop shortcut. On first launch, pick your workspace folder (WSL folders are under "Linux" in the dialog sidebar).

To update: `git pull` then re-run `bash sync_to_windows.sh`. Your settings survive redeployment.

## Known limitations

- Must run as a native Windows app (drag & drop from Explorer doesn't reach WSLg windows)
- File changes inside WSL are not auto-detected (the 9P protocol has no change notification) — refresh with F5
- Dragging out of the tree always **copies** (never moves)
- Write mode is a plain textarea (no highlighting, completion, or diff while editing). It's meant for **quick one-line fixes**, not long-form writing or code editing. Saving overwrites in place with no backup, so use it on folders under version control
- No preview for `.xlsx` / `.pptx` / legacy `.doc` (double-click opens the default app)

## Stance

This is the author's daily-driver tool, published as-is. **No support promised.** Issues and PRs are welcome but replies and merges are not guaranteed.

Almost all code was written in collaboration with Claude Code (Anthropic). This project is not affiliated with Anthropic.

## License

MIT
