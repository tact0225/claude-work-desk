# Changelog

[日本語版はこちら / Japanese version](CHANGELOG.ja.md)

## v0.13.0

**The diff can now show the whole file. Read it top to bottom taking only the red lines and you have the old version; take only the green ones and you have the new one, start to finish.**

### A full text / changes only toggle in the diff view

- The diff view has a new toggle: **Full text** and **Changes only**. **Full text** shows every line, changed or not. **Read down the page taking only the red lines and you get the old version in full**; **take only the green ones and you get the new version in full.**
- **Why this is needed**: showing only the changed spots tells you *what* was touched, but not **whether the rewrite was any better**. The surrounding text is cut away, so there is nothing to read the two versions against each other with. After an agent rewrites an article, the job is not "review the changes" — it is "**read both through and decide which one is better**", and that needed a view that supports it.
- **Full text shows the file as it is** — frontmatter, code blocks, image links and blank lines all included. The prose filter (added in v0.11, below) is **not applied to the full text view**: filtered, "full text" would be a lie, because **taking only the green lines would not give you the new version**. Worse, anything filtered out that did not change is not even announced — the view would silently be a false full text. That is also why **the prose/code toggle is hidden while full text is on** (a filter that cannot apply is a button that does nothing when pressed). The filter is a tool for scanning the changes, so it now applies **to changes-only mode alone**.
- **It is laid out to be read**: in full text, unchanged lines are drawn in the **normal text colour** instead of dim grey (in a full-text view almost every line is unchanged, so dim means unreadable). On top of that, **full text on `.md` and friends drops the monospace font and opens up the line height** — there are no columns to align, and long-form prose in a tight monospace column is punishing to read. Full text on code stays monospace, where alignment does matter.
- **Unchanged blank lines no longer get a "(blank line)" placeholder.** The placeholder is now only attached to blank lines that were **added or removed**. It used to be decided by the line content alone, so in full text a placeholder appeared at every paragraph break and the article became unreadable — an unchanged blank line should simply stay blank and do its job as a paragraph break.
- **Changes only** is unchanged: unchanged runs still collapse to `… N unchanged lines …` with 3 lines of context on each side, for checking what was touched at a glance.
- **The default is full text in prose mode, changes only in code mode.** An article is something you read through; a source file is not. Open a `.md`, `.markdown`, or `.txt` and the full text is there without pressing anything.
- The choice applies **to that file only** (same rule as the prose/code toggle — made global, "full text" set on an article would follow you into source files). A code file you switched into prose mode by hand also defaults to full text, so the two toggles agree with each other.
- **There is a ceiling on line count.** Full text draws every line, so the line count becomes the element count on screen. **When the diff would print more than 20,000 lines** (unchanged + red + green) the view falls back to changes only even if full text is selected, **and says so on screen** — it will not freeze quietly, and it will not collapse quietly either (a view that says "full text" and is not would stop being trusted). A Japanese article is orders of magnitude below this; it is a ceiling you meet on a huge log or JSON file.
- Nothing about how the diff is computed changed — the LCS, how baselines are held, the `●`, and **Reviewed** are all as they were. Two things did change: **whether unchanged lines get collapsed**, and **what gets compared in prose files** (full text skips the filter, so there is more to compare). The view still refuses to open when nothing changed (full text included).
- ⚠ **Because full text compares more, it can hit "too large to diff"** — the cut-off is about how much is compared, not how it is displayed, so the answer can differ between full text and changes only. An article with a huge code block rewritten wholesale is the case that hits it. **Switching to "Changes only" narrows what is compared and may go through**, so the cut-off screen now says that. ⚠ Pressing **Reviewed** there advances the baseline to now and **you lose the change without ever reading it** — leaving Reviewed as the only visible way out would be showing the most costly action as the only road.

## v0.12.0

**Mermaid diagrams render. A ```mermaid block in a note is a picture in the preview, not twenty lines of arrows to read as text.**

### Mermaid diagrams in the preview

- A fenced ` ```mermaid ` block in a Markdown file is **drawn as a diagram** — flowcharts, sequence diagrams, state diagrams, Gantt charts, everything Mermaid itself supports. Agents write flows as Mermaid because it is text they can edit; until now the preview showed you that text.
- **Only the rendered view.** Press the source toggle and you get the fence back exactly as it is written, because that is the view you switch to in order to see what is actually in the file. Nothing else about code blocks moved: every other language still renders as the code block it was, with its copy button.
- **Colours follow the app.** The diagram is drawn from the same palette the rest of the window uses — background, panel, border, accent, text — and the light/dark choice is read from **the actual value of the window's background colour**, not from a setting that could drift out of step with it. Restyle the app and the diagrams follow rather than staying a dark rectangle in a light window.
- **The font follows the app too, without redrawing.** The font is handed to Mermaid as the CSS variable itself, so changing the UI font under ⚙ moves the text inside diagrams you have already drawn. Handing over the resolved font name instead would have frozen each diagram at whatever font was set when it was drawn.
- **A diagram that will not parse falls back to the code block** it came from — with its copy button, so you can take the source somewhere and fix it. One bad diagram never blanks the preview, and it is never silently dropped: a diagram you cannot see is a diagram you cannot fix. The same fallback covers the case where the Mermaid bundle itself failed to load.
- **Mermaid is shipped inside the app** (`renderer/vendor/mermaid.min.js`), never fetched from a CDN. Desk is a tool for reading a workspace that is often on the other side of a VPN or on a machine with no route out; a diagram that only appears when the internet does is not a feature. It is not a runtime dependency either, so the installer does not grow by the 80 MB of build-time packages Mermaid pulls in.
- The raw source is **hidden while the diagram is being drawn** rather than flashing as text for a moment on every file you open. The hiding is applied by the drawing code itself, so a diagram is never left invisible by a step that did not run.

### Links in the preview can no longer take the window with them

- **Symptom**: clicking a link inside the preview **navigated the Desk window itself** to the external page — a Markdown `[x](http://…)`, a `file://…`, or a link produced by Mermaid's `click` directive, all the same.
- **Why that matters**: `window.api` — the bridge preload hands the screen for reading and writing files, dropping into `_inbox`, and opening things in the OS — **travels to whatever page the window lands on**. One line of link text in a note was enough to hand a page you have never seen **a working handle on this machine's files**. Measured: on the page it navigated to, `window.api.readFile` was still a function.
- **Fix**: every navigation away from the app's own screen (`renderer/index.html`) is **blocked**. New windows are refused too (`window.open`, `target="_blank"`) — letting one open would put the same bridge in it.
- **Links still work.** `http` / `https` are handed to **the OS default browser**. A link that does nothing when you click it is a loss of function, so the link itself was not thrown away.
- Anything that is **not** `http` / `https` (`file:`, `javascript:`, any scheme registered with the OS) is **not** handed outward. Passing those on unconditionally would turn one line in a note into "launch an arbitrary local file or external handler", which is simply a different hole. Opening local files is still the tree's job.
- **`[[wikilink]]` is untouched.** It never was a real navigation — it swaps what is rendered — so the guard does not apply to it (verified in the running app). Reload and DevTools are unaffected as well.
- ⚠ This hole was **not introduced by the Mermaid work**; it had always been there. Mermaid's `click` only added one more door into it.

### License attribution for the bundled Mermaid (`THIRD-PARTY-NOTICES.md`)

- `renderer/vendor/mermaid.min.js` is **a redistribution of Mermaid itself** (MIT, © 2014–2022 Knut Sveidqvist), and it carries DOMPurify (Apache-2.0 / MPL-2.0, © Cure53) among others inside it. Unlike dependencies pulled from npm, this one **ships as a file in the repository and in the installers**, so the copyright notices and license texts have to travel with it.
- `THIRD-PARTY-NOTICES.md` is new, referenced from `LICENSE` and from both READMEs. It is shipped inside the installers alongside `LICENSE`.
- Mermaid's own copyright line **is not inside the bundle** — neither `Knut` nor `Sveidqvist` appears anywhere in the file. Shipping the file alone therefore does not satisfy MIT, so the notice and full license text are reproduced in `THIRD-PARTY-NOTICES.md`. Nothing there was written from memory: the notices the bundle carries about itself are transcribed as they are.

### `check.sh` now looks at Mermaid

- Until now the vendored bundle could **disappear and the check would still PASS**. The fallback to a code block is good enough that the app keeps working and only the diagrams stop appearing — which nobody notices. The better the fallback, the more this needs a machine watching it.
- Three things are checked: (1) the bundle **exists** and is a plausible size (catches truncation and failed downloads); (2) `index.html` actually **loads** it, and loads it **before** `i18n.js` / `app.js` (behind them, the file you open right after launch gets no diagram); (3) `package.json`, the installed `node_modules`, **the version string inside the bundle**, and `THIRD-PARTY-NOTICES.md` all point at **the same release** — so moving one of them without the others fails loudly.

## v0.11.0

**The diff baseline no longer disappears on you. Close the app, reload it, wander off into another file — what changed while you were away is still there.**

### Diff: fixed "Reviewed" silently killing every later diff

- **Symptom**: open a file, look at the diff, press **Reviewed**. From then on the file could be rewritten and neither the `●` nor the diff view ever appeared again — even though this changelog promises "the next diff starts from there".
- **Cause**: the diff baseline lived in **a single app-wide slot**. Opening any other file evicted the baseline of the file you were tracking. **Reviewed** is a statement of "keep watching from here", so right after pressing it you usually go look at something else — and while you were away the agent rewrote the file, you came back, the baseline was re-taken at "now", and every change made in the meantime was **gone beyond recovery** (no `●` either). Reviewed itself was advancing the baseline correctly; what destroyed it was the next detour. A single non-diffable file (image, PDF, over 4 MB) wiped the baseline the same way.
- **Fix**: the baseline is now kept **per file**. Looking at another file no longer discards it and coming back no longer re-takes it, so changes made while you were away are still there as a diff. To keep memory bounded, baselines past **20 files / 4,000,000 characters total** are dropped **least-recently-viewed first**. **Re-opening a file marks it as just-viewed**: the file you are tracking keeps its baseline and therefore never goes through the re-take path, so without that mark the eviction order would be "whichever baseline was taken first" and **the file you use most would be discarded before one you opened once** (with v0.10's folder tabs, simply switching tabs opens other files, so the count climbs faster than you would think). Only the ordering moves — the baseline text is never touched. The newest entry is always kept, so a single file that alone exceeds the budget never throws away its own baseline and ends up with "no diff, ever".
- **Reviewed** now advances the baseline of *the file the diff view is showing* rather than reading the global current file, which closed the remaining path where it could discard the baseline outright.
- **Why this stayed silent**: `test-diff.js` was **pinning "re-take the baseline when you come back" as correct behaviour** — the test was holding the bug in place. The regression tests were replaced: after Reviewed, a change made while you were away must light the `●`; a detour through another file must not erase the baseline; the LRU must never evict the entry it just stored.

### Diff: prose mode and code mode

- Reading an article and reading code want different things out of a diff, so they are now separate modes. **Picked automatically by extension** (`.md`, `.markdown`, `.txt` are prose; everything else is code), with a toggle at the top of the diff view to **switch on the spot**. The manual choice applies to that file only, so making an article prose does not follow you into your source files.
- **Prose mode** leaves four things out of the diff: **frontmatter** (the leading `---` block), **code blocks** (``` / `~~~` fences) and **raw HTML tags**, **image links** (`![alt](path)`), and **blank-line churn**. What is left is how the prose itself changed.
- **Code mode is exactly what it was** — every line compared, nothing left out.
- **What is left out is never dropped silently.** If only the excluded parts changed, the view does not fold away: it stays open with "{n} more changed lines outside the prose (switch to code mode to see them)" at the top. A `●` that opens onto nothing reads as "broken".
- **The `●` itself ignores prose filtering** and compares the raw file. If the filter reached the `●`, a change confined to frontmatter or a code block would not light it at all and you would never learn the file moved. The `●` says "something moved"; the filtering is about what is readable once you open it.
- Blank-line churn is not counted in the "{n} lines outside the prose" tally — a number that moves because a paragraph break moved is a number nobody reads. But a change that is *only* blank lines still does not fold the view away: it says "Only blank lines were added or removed (switch to code mode to see them)". The `●` lights on the raw file, so folding here would mean opening a lit `●` and being bounced to "nothing has changed".
- HTML tags are matched only when `<` is followed by a letter or `/` `!` `?`. A blunter `<[^>]*>` swallows ordinary prose such as "a &lt; b &gt; c" and makes real text disappear from the diff.

### Diff: baselines survive closing Desk

- **Symptom**: the baseline lived **only inside the running app**, so closing Desk, reloading with `Ctrl+R`, or switching the display language in settings (which reloads internally) threw away **every** baseline you were tracking. Nothing on screen said so — the next time you opened the file the baseline was re-taken at "now", which puts you back in a **completely silent** state with no `●` and no diff.
- **Why this one matters most**: the two fixes above are about what happens when you **take an action** (go look at another file). This one you hit **without touching anything**. Desk is a tool you leave open, so the common shape is "press **Reviewed** at night, close it, the agent rewrites the file overnight, open it again in the morning" — and that reset the baseline every single time.
- **Fix**: baselines are now stored locally on that machine (the browser's `localStorage`). Close and reopen, reload, switch languages — a rewrite made while you were away still lights the `●` and still reads as a diff. The write happens **when the baseline is taken** rather than on the way out, so an unclean exit (force-quit, WSL going down) keeps them too — with one caveat: the browser commits to disk a few seconds behind, and a save rewrites the whole set as a single blob rather than appending, so **every baseline taken after the last write to disk is rolled back together — not just the last one**. Measured: killed 0.5 s after taking a baseline, it is gone; 10 s after, it survives; two files opened in the seconds before the kill both lost their baselines while an earlier one survived.
- **What is stored is a copy of the file as it was when you opened it.** Since that is the content itself, it is kept only in that machine's local storage — never written to the repository and never to the shipped `config.json` (the same line the folder tabs draw, for a stronger reason: those are paths, this is the text).
- Storage gets a **smaller budget of its own** (500,000 characters total) separate from the in-memory one. Writing the in-memory budget of 4,000,000 characters straight out would blow past the `localStorage` quota (roughly 5–10 MB depending on the platform). Entries are packed **newest first, and one that does not fit is skipped rather than ending the pack** — so a single huge file cannot take the whole budget and leave the article you are actually tracking with nothing. If the write is rejected anyway the entry count is halved and retried, and past that it gives up. **A failed write never stops the screen** — the in-memory baseline is still live, so diffing works normally for the rest of the session.
- A corrupted store (hand-edited, or written by another version) **does not stop the app from starting**. Readable entries are kept and the rest are dropped. Nothing is ever written before the store has been read: saving from a not-yet-loaded state would overwrite last night's baselines with an empty set and there would be no way back (the guard lives inside the save routine, not at its call sites).
- **Left as designed**: saving a file yourself in write mode still folds your own edits into the baseline (that is the line that keeps your edits out of what the agent changed — an explicit decision), and **Reviewed** still advances it. Only the unintended ways of losing a baseline were closed; these two are the intended ways of moving it.

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
