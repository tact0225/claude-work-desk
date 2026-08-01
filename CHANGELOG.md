# Changelog

[日本語版はこちら / Japanese version](CHANGELOG.ja.md)

## v0.7.1

**The inbox feed panel is now resizable by dragging.**

- Drag the border between the tree and the inbox feed up or down to resize the panel. The size is remembered across restarts (same convention as the sidebar width).
- Clamped to a 60px minimum and to a range that keeps the tree usable.

---

## v0.7.0

**Worktree lanes are now one click away in the path bar's ▾. No more digging up paths in a terminal.**

### Path bar

- The history dropdown (▾) now lists **worktree lanes** at the top. It picks up folders sitting **next to** your workspace named `<workspace-name>-<slug>` — but only those whose `.git` is a **file** pointing at a `worktrees/` gitdir (i.e. actual linked worktrees). A name-prefix match alone would drag in unrelated neighbors like `claude-work-desk`, so the contents are checked too. Click a lane to browse it.
- Lanes are re-detected every time you open ▾ — retired lanes disappear on their own, new lanes show up the next time you look. No git command is invoked, so it works as-is across WSL (`\\wsl.localhost\...`).
- With no lanes present, nothing changes — the section simply isn't there.

---

## v0.6.0

**It runs on macOS now.**

### macOS support

- One script: `bash setup_mac.sh` runs the self-check, installs dependencies, and drops a "claude-work Desk.command" launcher on your desktop — double-click it from then on. Re-running is idempotent, and running it anywhere but macOS stops immediately.
- **Nothing is deployed anywhere, unlike the Windows path.** `sync_to_windows.sh` copies into `%LOCALAPPDATA%` because WSL and Windows are separate filesystems; on macOS the clone *is* the runtime, so **`git pull` alone updates the app**.
- Default fonts now resolve through a **fallback chain instead of an OS branch** — Windows names first, macOS names after, and whatever isn't installed is skipped naturally. The UI chain reaches `-apple-system` and Hiragino, the monospace chain reaches `SF Mono` and `Menlo`. Mac fonts were added to the font pickers too.
- The "Default" font labels no longer name OS-specific fonts (Segoe UI / Consolas) in any of the 8 languages. The OS decides what the default resolves to, so naming one was simply wrong on the other platform.
- Zoom (`Ctrl/Cmd`+wheel, `+` / `-` / `0`) now responds to **Cmd** as well — matching Save and Paste, which already did.

### Checks

- `check.sh` now **actually runs** on macOS. `grep -P` is a GNU extension that BSD grep does not have, so on a Mac those checks would have failed outright, been swallowed by `|| true`, and quietly passed as **checks that never ran**. Rewritten with POSIX `-E` only; what they detect is unchanged.
- Added a check that the default font chains match. `:root` in `renderer/styles.css` and `FALLBACK_*` in `renderer/app.js` hold the same string twice, and the latter overwrites the former at startup — so **editing only one leaves the old chain in place until you touch the font settings**, which nobody would notice. Now it fails the build.

### Docs

- Both READMEs gained macOS setup instructions and per-OS paths for `user-config.json`. The "must run as a native Windows app" caveat is now split into **the WSLg drag-and-drop problem** and **the missing change notification over WSL**, so it is clear which parts do not apply to macOS.

---

## v0.5.0

**The tree now keeps itself up to date. You no longer press F5.**

### Auto-refresh

- The tree and the open preview are re-checked **every 2 seconds**, so whatever your agent writes shows up on its own.
- Rows are **diffed, not rebuilt** — scroll position, selected row and expanded folders stay exactly where they were. A folder with no changes produces zero DOM mutations.
- A preview whose file changed on disk is **re-read while keeping its scroll position**.
- In write mode the editor buffer is **never touched**. The title flags the external change instead, and the file is re-read when you leave write mode.
- Polling stops while the window is minimised and fires once immediately when you restore it.

> **Why polling?** Over WSL there is no OS change notification to listen to — `fs.watch` against `\\wsl.localhost\…` fails outright. Freshness is therefore a 2-second poll: a few seconds late rather than instant. F5 or ⟳ still forces a full refresh.

### New-file highlight

- Right-click a folder → **Show new files** to watch it. Watch as many folders as you like.
- Files that appear after that are marked, and **the mark stays until you click the file** — it does not fade on a timer. It also survives a restart.
- A watched folder keeps its own mark while anything directly under it is unread, so you notice even when the folder is collapsed.
- **Direct children only — not recursive.** Watching `todo/` does not pull in `todo/done/`. Watch that folder separately if you want it.
- The workspace root cannot be watched, and a folder with more than 1000 direct files is refused.

### Staying honest about failure

- The sidebar footer shows the **time of the last check**. It reads "waiting" while the workspace is unreachable, and turns red with the reason after three consecutive failures. Click it to refresh now or restart polling.
- The next interval is `max(2000ms, last scan × 20)`, so a heavy folder slows the refresh down instead of loading the machine.
- A tick that fails to read a folder changes nothing — a momentary WSL hiccup can't be mistaken for "everything was deleted, so everything is new".
- Unread marks are only cleared when a file is genuinely gone (its parent is readable and it is not there), never merely because the folder could not be read.

### Tests

`test-watch.js` added and wired into `check.sh` as a step. **24 → 87 checks**, covering the real IPC handlers, every start-up path of the renderer, the polling layer, and row identity in the tree diff (so a return to full redraw fails the build).

---

## Earlier releases

Reconstructed from release commits.

| Version | Change |
| --- | --- |
| v0.4.3 | Removed internal folder names from the shipped defaults |
| v0.4.2 | Notes on migrating from Obsidian; link checking moved into monthly maintenance |
| v0.4.1 | README: added "why this exists" |
| v0.4.0 | The drop target folder is now configurable |
| v0.3.1 | Fixed the drop-receipt feed; README gained 9 screenshots |
| v0.3.0 | UI in 8 languages; English README brought to the front |
| v0.2.2 | Code blocks in the preview now wrap |
| v0.1.0 | First public release |
