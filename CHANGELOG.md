# Changelog

[日本語版はこちら / Japanese version](CHANGELOG.ja.md)

## v0.10.0

**Folder tabs along the bottom. The folders you keep coming back to are one click away — including the ones the tree will never show you.**

### Folder tabs (like sheet tabs in Excel)

- A row of tabs at the bottom of the window. One tab per folder; clicking one moves the tree there.
- The point is the folders you cannot otherwise reach: `~/.claude`, a `memory/` folder outside the workspace, a worktree lane. Hidden folders are filtered out **by name, among a folder's children**, so a hidden folder works perfectly well as the folder you are *looking at* — which is exactly what a tab makes it.
- **Three ways to add one.** Right-click a folder in the tree → **Open in a tab** (the folder you want as a tab is almost always the one you are already looking at, and having no entry point there was the whole problem). Click `＋` at the end of the tab row to pin the folder you are viewing. Right-click `＋` for the rest: the **worktree lanes** found next to your workspace, the current folder, or **any folder from a picker**. Lanes are measured every time you open that menu, so a lane you removed is simply gone and a new one shows up without any bookkeeping; if lane detection fails the other items still appear.
- `＋` sits **immediately after the last tab**, not pinned to the right edge. With one tab open, an edge-pinned `＋` is separated from the tabs by the entire width of the window and stops reading as "add a tab" — which is exactly how it failed in practice. Left-click adds; it does not open a menu, because a button that opens a menu reads as "choose something", not "add one".
- Adding a folder that already has a tab does not create a second one — it switches to the tab that exists and **flashes it once**, so the press is visibly not a no-op.
- **Each tab remembers where you were**: which folders were expanded, which file was selected (the preview comes back with it), and where the tree was scrolled. Switching away and back puts you where you left off rather than at a folded-up root.
- Right-click a tab: **Rename** (the label only — the path never moves), **Copy path**, **Close tab**. `Ctrl+Tab` / `Ctrl+Shift+Tab` step through them and `Ctrl+1`–`Ctrl+9` jump to the nth.
- The first tab is the workspace and **cannot be closed**; `⌂` always returns to it, even after the path bar has carried it somewhere else. Its label follows the folder it is on, so it never claims to be somewhere it is not.
- **Switching tabs never moves where dropped files land.** Tabs change what you are looking at, and nothing else. The `↗` marker and the "files still land in `_inbox`" tooltip work exactly as before while you are outside the workspace.
- Entering a tab while you have **unsaved edits** asks first, and cancelling cancels the switch itself — the same confirmation that already guarded opening another file.
- A tab pointing at a folder that has gone away (a removed lane, a deleted folder) gets a `⚠` and **stays put**. Removing it automatically would mean WSL blinking out for one second costs you your tabs; closing one is your call. On startup the same applies: a dead tab keeps its `⚠` and only the *view* falls back to the workspace.
- **Nothing is ever saved before the tabs have been read.** Opening the app before WSL is up stops at the workspace picker, where the tab list is still empty — writing that out on exit would replace last night's tabs with nothing, with no way back. The guard sits inside the save itself, not at the one caller that happens to exist today.
- **Cancelling a close leaves everything exactly as it was.** Closing a tab with unsaved edits asks first, and that question comes *before* the tab is removed — asking afterwards means "no" leaves you with a tab that is already gone and already saved as gone.
- Closing a tab while a switch is still running is refused, and a switch requested while another is running is remembered instead of dropped (holding `Ctrl+Tab` moves one tab per press rather than swallowing one).
- The path bar now asks about unsaved edits too. Navigating drops the tab's memory of the selected file, so continuing to edit a file that is no longer anywhere in the tree used to lose the draft on the next tab switch.

### The path bar

- **`Go` is gone.** Enter does the same thing, and the width it was taking now belongs to the path field.
- **The `▾` history stays**, and it holds *only* history now. Tabs and history turned out to be different things, not duplicates: a tab is a place you decided to keep, history is where you just were. The worktree lanes moved out of this menu and live under `＋` alone — one entrance per thing. The last entry clears the list, and an empty history says so rather than opening a blank box. `↓` in the path field opens it too.
- History is recorded **only when you go somewhere from the path bar**. Switching tabs does not push — a tab you flip back and forth would otherwise fill the history with the same two folders and leave nothing to go back to. Capped at 20 entries, and a corrupt saved list falls back to empty instead of breaking the button.
- Enter / `↑` / a history entry all **rewrite the current tab** instead of opening a new one, the way a browser does — otherwise holding `↑` would breed a tab per level.

### Double-clicking a folder opens it in a tab

- Double-clicking a **folder** in the tree opens it in a tab — the shortest possible version of the thing tabs are for. It used to toggle the folder open and shut (two clicks cancelling out) *and* hand it to Explorer, which nobody was asking for. It runs the same code as the right-click **Open in a tab**, so an existing tab wins instead of a duplicate, and unsaved edits are confirmed first exactly the same way. Right-click still has **Open** and **Show in Explorer** for the Explorer route.
- The second click of a double-click no longer toggles the folder, so it does not flash open and shut on the way to the tab.
- Double-clicking a **file** is unchanged: it opens in your default app.

### Implementation

- Tabs live in `localStorage`, not `config.json`: the paths differ between machines, and this repository is public — personal paths have no business being baked into a shipped default. Corrupt saved data is caught and falls back to a single workspace tab rather than refusing to start.
- Restoring the expanded folders replaces the contents of the open-folder set instead of clearing it, so the 2-second diff-apply and the polling loop keep working off the same state they always did (no full redraw, no lost scroll position).
- Restoring the selection waits for the expansion to finish loading. Expanding a folder reads its children asynchronously, so restoring the selected file without waiting would silently miss anything below the top level. The wait is bounded, so a cyclic symlink cannot hang it.
- Pinning the current folder cannot go through the ordinary "already have a tab for this?" check. Navigating rewrites the active tab's path, so the folder you are viewing is *always* the active tab's folder — wired naively, `＋` would match itself every time and never add anything. The check therefore ignores the active tab: another tab on the same folder wins the click, otherwise the current place becomes a new tab.
- A new `choose-folder` IPC backs the folder picker. It deliberately does **not** reuse `choose-root`, which rewrites the workspace — "adding a tab quietly moved where my files land" is the one failure this feature must never have.

### Checks

- `test-watch.js` now runs the startup path through the real tab code (`loadTabs` / `startingTab` / `saveTabs`): the first tab is always the workspace, a tab whose folder has gone away keeps its `⚠` while the view falls back, a live tab is restored under its normalized path (a WSL-style path would never reach `readDir` as-is), corrupt saved data still boots, and a pre-v0.10 `browseRoot` is migrated into a tab exactly once.
- The tab operations themselves — `captureTab` / `activateTab` / `closeTab` / `goHome` / `addTab` / `pinCurrentTab` / `stepTab` / `gotoPath` — plus the ways to add a tab (`＋` left-click vs right-click, and the tree's **Open in a tab**) — are run for real against a fake filesystem and a fake DOM, because the startup path alone never touches any of them and **both of the bugs above came out of exactly that blind spot**. The suite is checked by mutation: dropping the captured expansion, dropping the index shift after a close, dropping the restored active tab, moving the discard prompt after the removal, removing the save guard, removing the path-bar prompt, dropping a switch requested mid-switch, closing mid-switch, skipping the restored selection or scroll, turning `＋` back into a menu, letting `＋` match its own tab (the no-op button), dropping the flash, putting **Open in a tab** on file rows, recording history on tab switches, removing the history cap, removing the folder double-click, mixing up which row type gets it, and letting the double-click skip the unsaved-edit prompt — 35 deliberate breakages, all of which the suite now fails on.
- `grabFn` (the helper that lifts a function out of `app.js` to run it for real) now finds the body after the parameter list. It used to start counting braces at the first `{` it saw, which is the destructured default argument in `activateTab(i, { force = false } = {})` — it would have lifted half a function and died with a syntax error nobody could read.

---

## v0.9.0

**You can see what the agent changed. No more re-reading the whole article.**

### Diff (since you opened it)

- The preview header has a **Diff** button. It lays out, in one column, only the lines that changed **between the moment you opened the file and now** — deletions in red, additions in green.
- The baseline is **pinned at the moment you opened the file**. Auto-refresh re-reads the file but never moves it, so if the agent rewrote the file five times, all five passes show up **in one screen**. A diff that only covers the last write would leave you tracking the changes yourself, which is the problem this feature exists to remove.
- **Reopening the same file never moves the baseline.** Clicking the row again, double-clicking it to hand the file to your editor (a double-click fires two clicks first), stepping away with `←` and coming back, clicking a row in the drop feed — all of them go through "open". Re-taking the baseline there means that the moment you see the `●` and reach for your editor, the changes you had not read yet are gone with no way back. The guard sits inside "open" itself rather than at the four call sites, because a fifth call site would otherwise arrive unguarded.
- Unchanged runs collapse to `… N unchanged lines …`, keeping 3 lines of context on each side. The point is to read the changes, not the article.
- The Diff button carries a `●` whenever something changed, so you notice without pressing it (same convention as the unread marks in the tree).
- **Reviewed** advances the baseline to the current content and closes the diff. From then on, the diff runs from that moment. It is also the way out when the rewrite was too large to diff: move the baseline to now, and the next rewrite diffs again.
- Your own saves in write mode are folded into the baseline — your edits mixing into the agent's would defeat the purpose. But if the `●` is lit when you enter write mode, you get **one confirmation first**: saving from there would carry changes you never looked at into the baseline, out of reach forever.
- Markdown and code only (not images, PDFs, or docx), and **never in write mode** — the collision between your unsaved buffer and an external change is handled carefully elsewhere, and a diff view has no business in the middle of it. Entering write mode from the diff closes the diff. So does a file growing past 4 MB while the diff is open (otherwise the diff view springs back on its own once the file shrinks again).
- If the agent reverts its edits while you are looking at the diff, the view **drops back to the file**. Being stranded on a "nothing changed" screen means pressing the button again just to read the article, which reads as broken. It is not a silent drop, though: a toast in the corner says so once.
- **A difference of trailing blank lines alone is treated as noise and never lights the `●`.** A formatter or editor adding or removing the final newline would otherwise produce one red line with no characters in it — routine wear in day-to-day writing. Only the trailing run is dropped: blank lines inside the text (a paragraph split or joined) still show up as they did.
- A blank line added or removed inside the text renders as `(blank line)`. A bare red or green band tells you nothing about what happened.

### Implementation

- The diff is a line-level LCS written by hand — **no new dependency**. The target is long-form Japanese Markdown, where line granularity is enough (no word-level highlighting).
- Matching prefixes and suffixes are trimmed before the LCS runs, so editing part of an article shrinks the comparison to the part that actually differs.
- There is a size guard. A naive LCS is O(N×M) in both time and memory, so if the trimmed line counts multiply out past **4,000,000 cells** (about 16 MB as an Int32Array) the computation is skipped and the view says the change is too large to display. Freezing silently would be the worst outcome.
- File contents are always escaped before rendering — HTML inside a note never reaches the DOM as markup.

### Checks

- Added `test-diff.js`, run from `check.sh` on every pass. It covers no-change / additions only / deletions only / replacement / insertion at the top / append at the end, the boundaries of the collapse, the size guard firing, empty-file round trips, and line-ending normalization — plus a structural assertion that **the auto-refresh path never touches the baseline** (if that slips, the diff still renders and still looks fine, it just quietly shows one pass instead of all of them).
- The fixes above are regression-tested too: that opening the same file twice in a row leaves the baseline alone (while stepping away and back re-takes it, and a Windows case-only path difference still counts as the same file), that trailing blank lines alone never light the `●`, that **blank lines inside the text still show up in the diff** (the guarantee that the noise filter did not cut too deep), and that the diff view folds itself away when the file stops being editable or the difference disappears.
- The thresholds are **checked against the documentation** as well (`check.sh` step 9). `DIFF_CONTEXT` and `DIFF_MAX_CELLS` are copied by hand into the README and the changelog, and the tests read them from the source, so nothing notices when changing the context width turns the README into a quiet lie. Rot in prose does not show up by running the app, so the numbers are pulled out of the source and matched against all six places; a mismatch fails the build before it ships.

---

## v0.8.0

**There are installers now. No terminal required, on Windows and macOS alike.**

### Distribution

- [Releases](https://github.com/tact0225/claude-work-desk/releases/latest) now carries a **Windows installer (.exe)** and a **macOS disk image (.dmg, universal — Apple Silicon and Intel)**. Download, double-click, done. No git clone, no terminal.
- Builds run on GitHub Actions per tag and attach to the Release automatically — no hand-built, hand-uploaded artifacts, so a release can't silently ship without them.
- The binaries are not code-signed (certificates cost money; the code is open instead). First launch takes one extra step: **More info → Run anyway** on Windows SmartScreen, **right-click → Open** on macOS Gatekeeper. Documented in the README.
- The app has an icon now (an arrow dropping into a tray — the handoff window).
- The terminal route (`sync_to_windows.sh` / `setup_mac.sh`) still works exactly as before.

---

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
- **No deploy-copy step on macOS, unlike the Windows path** (the Mac version ships all the same). `sync_to_windows.sh` copies into `%LOCALAPPDATA%` because WSL and Windows are separate filesystems; on macOS the clone *is* the runtime, so **`git pull` alone updates the app**.
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
