# Changelog

[日本語版はこちら / Japanese version](CHANGELOG.ja.md)

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
