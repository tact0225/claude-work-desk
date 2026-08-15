# claude-work Desk

[日本語README](README.ja.md) ・ [Changelog](CHANGELOG.md)

**A file-handoff desk between your Claude Code workspace and your desktop. If you run Claude Code in a terminal — on plain Windows, macOS, or WSL — this is for you.**

Coming to terminal Claude Code from claude.ai or the desktop app, the first thing you miss is this: **you can't drag-and-drop anything into the chat anymore.** PDFs, spreadsheets, screenshots — on the web you just dropped them onto the window. A terminal has no drop target (pasting images works; attaching files does not).

This app gives that back, as a single window: **drop anything onto it → it lands in `_inbox/` inside your workspace → tell Claude "check _inbox"**. Working with Claude Code feels like tossing files into a chat again.

The other half is every frustration I had browsing my workspace in Obsidian: it opens nothing but Markdown (no code files, no docx), shows no line numbers so you can't tell Claude "line 120 looks wrong", and **you can't drag a file out to another app** (stock Obsidian hands over an `obsidian://` link instead of the file; getting the real file out takes a plugin). Here, Markdown renders, code gets highlighted with line numbers, PDFs/docx/images preview, and the tree drags real files out to any app with **plain OS drag-and-drop**.

## Install

**No terminal needed.** Grab the installer for your OS from
[**Releases**](https://github.com/tact0225/claude-work-desk/releases/latest):

- **Windows** — download `claude-work-desk-setup-x.y.z.exe` and double-click it.
  Windows SmartScreen will warn about an unknown publisher the first time
  (the app is not code-signed — certificates cost money, the code is open instead):
  click **More info → Run anyway**. That's it — the app starts by itself.
- **macOS** — download `claude-work-desk-x.y.z-mac.dmg`, open it, and drag the app
  into **Applications**. On first launch macOS says "**Apple could not verify
  'claude-work Desk' is free of malware**" — and **that dialog has no Open button**
  (the app is not code-signed; certificates cost money, the code is open instead).
  Allow it once, like this:
  1. Close the dialog with **Done** (do *not* click **Move to Trash**)
  2. Open **System Settings → Privacy & Security** and scroll down
  3. Next to the line saying "claude-work Desk" was blocked, click **Open Anyway**
     (this entry only appears *after* a blocked launch attempt)
  4. Confirm with your password (or Touch ID), then **Open**

  It starts normally from then on. On older macOS versions,
  **right-click the app → Open → Open** also works.

On first launch, pick your workspace folder (e.g. the folder Claude Code works in) — done.
To update, download the newer installer from Releases and run it; your settings survive.

**Prefer the terminal?** Installing from source works exactly as before:

**Windows (WSL)** — from a WSL terminal:

```bash
git clone https://github.com/tact0225/claude-work-desk.git
cd claude-work-desk
bash sync_to_windows.sh
```

That one script copies the app to `%LOCALAPPDATA%\claude-work-desk`, installs its
dependencies, and puts a shortcut on your desktop. To update later: `git pull` and run
it again — your settings survive.

**macOS** — from a terminal:

```bash
git clone https://github.com/tact0225/claude-work-desk.git
cd claude-work-desk
bash setup_mac.sh
```

That runs the self-check, installs dependencies, and puts a "claude-work Desk.command"
launcher on your desktop — double-click it from then on. To update later: just `git pull`.

Prerequisites and the longer version: [Setup](#setup).

![The workspace tree on the left, a rendered Markdown note on the right, and the _inbox panel below the tree](docs/images/hero.png)

*One window: your whole workspace as a tree, a real Markdown preview beside it, and
an `_inbox/` that anything can be dropped into. Tables render, code blocks get a
Copy button on hover, and `[[wikilinks]]` are clickable.*

## Why this exists

I used to **run Obsidian inside WSL** and do all of this there. That is where I hit the wall.

Japanese input did not work. That is not Obsidian's fault — **WSLg does not pass the
Windows IME through to Linux apps**, and [the request for it](https://github.com/microsoft/wslg/issues/9)
has been open since 2021. Sometimes input stopped registering at all. Going fullscreen
left the pointer and the caret slightly out of sync
([another open one](https://github.com/microsoft/wslg/issues/502)); snapping the window
with Win+Arrow fixed it, but having to is its own kind of annoying.

What finally decided it, though, was that **Claude Code kept telling me things like
"L49"**. Line 49 of that note. Obsidian does not show line numbers. I am not counting
to 49 by hand.

And it only opens Markdown. I wanted something that shows me the inside of any file.

So I rebuilt it outside WSLg — **as a native Windows app**. Then I got greedy: I wanted
a file to land in `_inbox/` just by being dragged onto the window. What Claude Code
generates comes out in `_outbox/`, so dragging straight from there into Google Drive
would save a step. And I added the path bar at the top so I could look into a worktree
lane without any ceremony.

That is the whole story.

## What it does

### Rendered to read, raw to fix

![The same note shown as raw Markdown with line numbers running down the side](docs/images/markdown-source.png)

*The same note as above, one click away. Rendered Markdown has no line 49 to point
at — so when your coding agent tells you the problem is on line 49 of a note, flip
to the source and go look at line 49.*

### Code files, not just notes

![A JavaScript file with syntax highlighting and line numbers](docs/images/code-view.png)

*Source files get highlighting and line numbers too, so you can read what the agent
just wrote without opening an editor.*

### Drop anything, it lands in `_inbox/`

![A file being dragged over the window, with a dashed drop zone reading Drop into _inbox](docs/images/drop-overlay.png)

*Drag a file anywhere onto the window — there is no target to aim for, the whole
window is the target. `Ctrl/Cmd+V` works too: files, screenshots (saved as `.png`), or
plain text (saved as `.md`).*

### A receipt, not a guess

![The inbox panel listing received files with timestamps and check marks](docs/images/inbox-feed.png)

*Every arrival is logged with a time and a name, so you can see what landed without
going to look. The list clears itself after a minute. Same-name files are kept, not
overwritten — a timestamp is appended instead.*

### Peek into another worktree lane without losing your inbox

![The tree showing a different folder, its name in blue with an arrow marker](docs/images/worktree-lane.png)

*Paste a path and the tree jumps there. WSL paths like `/home/you/project-lane` work
as-is. The folder name turns blue with `↗` to remind you that you are outside your
workspace — and `_inbox/` deliberately stays pointed at the real one, so a dropped
file never lands in the wrong lane. Somewhere you keep coming back to? Put it on a
tab at the bottom with `＋` and it is one click away from then on.*

### Right-click, paste into your prompt

![A context menu with Copy WSL path as the last item](docs/images/copy-wsl-path.png)

*`Copy WSL path` gives you `/home/you/project/notes/release-checklist.md` — the form
your terminal actually wants, instead of translating `\\wsl.localhost\...` by hand
every time you point Claude Code at a file. Or skip the path entirely: drag the file
straight out of the window into Explorer, a chat, or Google Drive.*

### Read-only until you say otherwise

![The preview switched to an editor, with the Edit button inverted to solid blue](docs/images/write-mode.png)

*The preview does not write to your files. Press **Edit** and the button inverts to
solid blue, Undo/Redo and Save appear, and a `●` marks unsaved changes — the
writable state is never something you have to guess at. Walking away with unsaved
edits asks first.*

### Eight languages, picked from your OS locale

![The settings panel with the language dropdown open, listing eight languages](docs/images/languages.png)

*English, 日本語, 简体中文, 한국어, Español, Português (BR), Deutsch, Français.
The first launch follows your system locale and falls back to English. Adding or
fixing one means editing a single file — see [Languages](#languages).*

## One habit worth setting up: give Claude an `_outbox/`

The drop window covers *your* half of the handoff. For Claude's half, make one
folder in your workspace where Claude puts things meant for you — and Desk watches
`_outbox/` for that **out of the box**: any new file there gets a light in the tree
that stays until you click it. You stop asking "did it finish? where did it write that?"

All it takes is one line in your project's `CLAUDE.md`:

```
Save deliverables meant for me (reports, exports, drafts) to _outbox/.
```

The names mirror each other from the workspace's point of view: `_inbox/` is what
comes *in* (you → Claude), `_outbox/` is what goes *out* (Claude → you). Any other
folder can be watched the same way — right-click it in the tree → **Show new arrivals**.

## Everything else

- **Tree view** of your whole workspace, lazy-loaded so a large repo still opens instantly
- **Auto-refresh**: the tree and the open preview are re-checked every 2 seconds, so what your agent writes shows up on its own. Rows are inserted and removed in place — the scroll position, the selected row, and the expanded folders never jump. A preview that changed on disk is re-read *and keeps its scroll position*; if you are in write mode your buffer is left untouched and the title says the file changed. Polling pauses while the window is minimized, and the sidebar footer shows the time of the last check (it reads "Waiting" until the workspace is reachable, and turns red and explains itself if polling ever stops — click it to refresh now or restart)
- **Diff (since you opened it)**: press **Diff** in the preview header and you get, in one column, only the lines that changed **between the moment you opened the file and now** — deletions in red, additions in green. Auto-refresh never moves that baseline, so if the agent rewrote the file five times you still see all of it **in one screen**, not just the last pass. How much to show is a choice between **full text** and **changes only** (below). The button itself carries a `●` when something changed, so you notice without pressing it. **Reviewed** advances the baseline to the current content — from then on the diff runs from that moment. If too much of the file was rewritten the view says so instead of diffing, and **Reviewed** is the way out of that too (move the baseline to now and the next rewrite diffs again). Your own saves in write mode are folded into the baseline too, so your edits never mix into what the agent changed (if unreviewed changes are still pending, entering write mode asks first). Markdown and code only, and never while you are in write mode
  - **Full text / changes only**: a toggle for how much of the file the diff shows. **Full text** shows every line, changed or not — read it top to bottom taking **only the red lines and you have the old version**, **only the green ones and you have the new one**, start to finish. That is what lets you judge whether the rewrite was actually better; with only the changed spots you never see enough around them to tell. **Full text shows the file as it is** — frontmatter, code blocks, image links and blank lines all included; the prose filter below is *not* applied to it (filtered, "full text" would be a lie: taking the green lines would not give you the new version). That is also why the prose/code toggle is hidden while full text is on. Unchanged lines are drawn in the normal text colour, and for `.md` and friends the view drops the monospace font and opens up the line height, so it reads like a document. **Changes only** is the previous behaviour: unchanged runs collapse to `… N unchanged lines …` with 3 lines of context on each side, so you can check what was touched at a glance. **The default is full text in prose mode and changes only in code mode** — an article is something you read through, a source file is not. The choice applies to that file only. **When the diff would print more than 20,000 lines** (unchanged + red + green), full text falls back to changes only and says so on screen, rather than freezing quietly or collapsing quietly. ⚠ Full text skips the filter, so there is more to compare and it **can hit "too large to diff"** where changes only would not (the cut-off is about how much is compared, not how it is shown). The cut-off screen says so: **switching to "Changes only" may go through** — whereas pressing **Reviewed** there advances the baseline and loses the change unread
  - **Prose mode / code mode**: an article and a source file want different things out of a diff, so they are separate. **Picked by extension** (`.md`, `.markdown`, `.txt` are prose; everything else is code), with a toggle at the top of the diff view to switch on the spot (the choice applies to that file only). **Prose mode** leaves frontmatter, code blocks, raw HTML tags, image links, and blank-line churn out of the diff so that what remains is how the prose changed. **Code mode** compares every line and leaves nothing out. If only the excluded parts changed the view still opens, with "{n} more changed lines outside the prose" at the top — and the `●` always compares the raw file, so filtering can never hide the fact that something moved
  - **The baseline is kept per file**, so wandering into another file does not discard it and coming back does not re-take it. Clicking the same row again — or double-clicking to open it elsewhere — does not move it either. A rewrite made while you were away is still there as a diff when you return (baselines past 20 files / 4,000,000 characters total are dropped least-recently-viewed first)
  - **Baselines survive closing Desk.** Quitting, reloading, or switching the display language no longer wipes them, so "press **Reviewed** at night, the agent rewrites it overnight, open it again in the morning" reads as a diff. A force-quit is survived too — with a caveat: the disk write lags a few seconds behind, and a save rewrites the whole set as one blob rather than appending, so **every baseline taken after the last write to disk is rolled back together, however many that is** (measured: one taken well before the kill survived; two opened in the seconds just before it were both gone). They live only in that machine's local storage, and **what is stored is a copy of the file as it was when you opened it** — never written to the repository or to `config.json`. The budget is 500,000 characters total, packed newest first: baselines past that, and any single file too large to fit it, are gone by the next launch (they still work for the rest of the session)
- **Double-click** a folder to open it in a tab (same path as the right-click **Open in a tab**), or a file to open it in your default app. Right-click has **Open** and **Show in Explorer** when you want the Explorer route
- **New arrivals**: right-click a folder → **Show new arrivals**. Files that appear there afterwards stay highlighted until you click them — no fading after a few seconds — and the folder row is marked too, so you notice while it is collapsed. Watching is per folder and covers its **direct children only** (a subfolder is its own opt-in), the unread set survives a restart, and the workspace root cannot be watched (everything glowing means nothing glowing)
- **Folder tabs** along the bottom, like sheet tabs in Excel. One tab per folder; clicking one moves the tree there. `＋` offers the worktree lanes it finds next to your workspace (measured every time you open it, so a lane you removed is simply gone), the folder you are looking at right now, or any folder from a picker — which is how you reach the ones the tree will never show you, like `~/.claude` or a notes folder outside the workspace. Each tab remembers **which folders were expanded, which file was selected, and where the tree was scrolled**, so coming back puts you where you left off. Right-click to rename (the label only — the path stays), copy the path, or close it. `Ctrl+Tab` / `Ctrl+Shift+Tab` step through them, `Ctrl+1`–`Ctrl+9` jump. The first tab is the workspace and cannot be closed, and `⌂` always returns to it. **Switching tabs never moves where dropped files land** — tabs change what you are looking at, nothing else. A tab pointing at a folder that has gone away gets a `⚠` and stays put; it is never removed for you (WSL blinking out should not cost you your tabs)
- **Path bar**: `▾` opens a history of where you just were (last 20; `↓` opens it too), `⌂` returns to the workspace, `↑` goes up one level. Enter, `↑`, and history entries rewrite the **current tab** rather than opening a new one, the way a browser does — switching tabs never touches the history. Paste a *file* path and it opens the parent folder and previews that one file
- **Mermaid diagrams**: a ` ```mermaid ` block renders as a diagram in the rendered view (the source toggle still shows the fence as written). Colours and font come from the app's own palette and font setting, so diagrams match the window rather than sitting in it as a foreign rectangle. Mermaid ships inside the app — no CDN, so diagrams draw with no network. A diagram that will not parse falls back to the code block it came from, copy button and all, instead of taking the preview down with it
- **Wikilinks**: `[[page-name]]` resolves to a clickable link (`←` / Alt+← to go back). Targets are matched by *name*, not path, so moving files doesn't break links; search directories come from `wikilinkDirs` in `config.json`. Unresolved links render greyed out rather than disappearing — they double as a list of pages you haven't written yet
- **Undo/Redo** (`↶` `↷`) appear only in write mode. They drive Chromium's own edit history rather than a parallel stack, so the buttons and `Ctrl/Cmd+Z`/`Ctrl/Cmd+Shift+Z` share one history and an IME composition undoes as a single step. **The history survives saving** — the editor element is never rebuilt on save
- **Drag out**: drag any file from the tree straight into Explorer or a chat app (always a copy, never a move)
- **More preview types**: `.docx`, images, PDF — plus draggable table column widths
- **Pick your own drop folder**: `_inbox` is only the default. Set any folder under ⚙ — it is created if missing. It must stay *inside* the workspace, and that is not a formality: it is what stops a dropped file from landing in a worktree lane you were only peeking at. Symlinks and junctions pointing out of the workspace are rejected, and the check runs again at drop time, not only when you set it
- **Display settings**: font size (Ctrl/Cmd+wheel or Ctrl/Cmd +/-), UI/monospace font pickers, draggable sidebar width — all persisted

## Requirements

**Installing from [Releases](https://github.com/tact0225/claude-work-desk/releases/latest)** (the normal way)

- Windows 10/11, or macOS 11 (Big Sur) or later — Apple Silicon or Intel
- That's it. No Node.js, no WSL. **WSL is not required to *use* the app** — it browses
  any folder you pick, `C:\...` included. WSL paths (`\\wsl.localhost\...`) just happen
  to work too, because that's how the author runs it.

**Installing from source**

- Windows: Windows 10/11 + WSL2 (the install script runs in WSL), Node.js LTS on the
  Windows side — https://nodejs.org, rsync inside WSL (usually preinstalled)
- macOS: Node.js LTS — https://nodejs.org (or `brew install node`)

## Setup

### Windows (WSL)

From a WSL terminal:

```bash
git clone https://github.com/tact0225/claude-work-desk.git
cd claude-work-desk
bash sync_to_windows.sh
```

This deploys to `%LOCALAPPDATA%\claude-work-desk`, installs dependencies, and creates a desktop shortcut. On first launch, pick your workspace folder (WSL folders are under "Linux" in the dialog sidebar).

To update: `git pull` then re-run `bash sync_to_windows.sh`. Your settings survive redeployment.

### macOS

From a terminal:

```bash
git clone https://github.com/tact0225/claude-work-desk.git
cd claude-work-desk
bash setup_mac.sh
```

One script: `check.sh` (self-check) → `npm install` → a "claude-work Desk.command"
launcher on your desktop. Double-click it to start the app, and pick your workspace
folder on first launch. Re-running the script is idempotent.

**Unlike the Windows path, nothing is deployed anywhere.** `sync_to_windows.sh` copies
into `%LOCALAPPDATA%` because WSL and Windows are separate filesystems; on macOS the
clone *is* the runtime, so there is nowhere to copy to — **`git pull` alone updates the
app** (re-run `bash setup_mac.sh` only when dependencies change).

## Languages

The UI ships in 8 languages: **English, 日本語, 简体中文, 한국어, Español, Português (BR), Deutsch, Français**.

On first launch the language is taken from your OS locale, falling back to English for anything unsupported. Change it under **⚙ → Language**; the choice is saved and the window reloads to apply it. Traditional Chinese locales (`zh-TW` / `zh-HK`) currently map to Simplified Chinese.

Adding or fixing a language means editing one file, [`renderer/i18n.js`](renderer/i18n.js), which is laid out key-first so every language for a given string sits in one block:

```js
'btn.save': {
  ja: '保存', en: 'Save', zh: '保存', ko: '저장',
  es: 'Guardar', pt: 'Salvar', de: 'Speichern', fr: 'Enregistrer',
},
```

Missing translations fall back to English at runtime instead of rendering blank, and both processes log every missing `key [lang]` pair on startup — so a half-translated string is loud, not silent. Translation PRs are welcome (see Stance below on response times).

## Coming from Obsidian

This app resolves `[[wikilinks]]` so your notes stay navigable after you stop opening
Obsidian. It is not a drop-in replacement, though, and some links **will go grey on the
first run**. Grey means "not resolved" — nothing is deleted, so this is safe to discover
gradually.

What changes:

| | Obsidian | Here |
| --- | --- | --- |
| Where a link is looked up | the whole vault | the note's own folder, plus the folders listed in `wikilinkDirs` |
| `[[note\|alias]]` | works | works |
| `[[note#heading]]` | jumps to the heading | opens the note, but does not scroll to the heading |
| `[[note^block]]` | works | **not supported** — renders grey |
| `![[note]]` (embed) | embeds the note | **not embedded** — you get a link and a stray `!` |
| `aliases:` in frontmatter | resolves | **not read** |
| Exact spelling | forgiving | **exact match only** |

`wikilinkDirs` ships as a generic starting point — the note's own folder plus `notes`,
`docs`, and `wiki/…`. To point it at your own layout, edit the user config file:

- Windows: **`%APPDATA%\claude-work-desk\user-config.json`**
- macOS: **`~/Library/Application Support/claude-work-desk/user-config.json`**

*Not* the `config.json` bundled with the app: that one is overwritten on every update
(by `sync_to_windows.sh` on Windows, by `git pull` on macOS), so your change would
vanish the next time you update.

That last row is the one that actually bites. A link written `[[my-note]]` when the file
is `my_note.md` silently renders grey and nobody notices. When I moved my own workspace
over, **201 of 4,267 links were broken this way** — purely hyphen-versus-underscore.

The fix is mechanical, so hand it to Claude Code: *"find every `[[link]]` in this
workspace that doesn't resolve, and rewrite the ones where swapping hyphens for
underscores finds a real file."* Point it at `wikilink.js` — the same `makeResolver()`
this app uses will tell it exactly which links are dead. Worth re-running now and then;
name-based links break quietly by design.

⚠️ **If you use the Obsidian Web Clipper, keep Obsidian installed.** The clipper saves
into an Obsidian vault and [needs the app](https://obsidian.md/help/web-clipper) — this
app only reads folders, it cannot receive clips. Stopping Obsidian and keeping the
clipper is not a combination that works.

## Known limitations

- On Windows it must run as a native Windows app (drag & drop from Explorer doesn't reach WSLg windows). On macOS it runs natively, so this does not apply
- Freshness comes from **polling every 2 seconds**, never from the OS. WSL carries no change notification at all (`fs.watch` over `\\wsl.localhost\` fails outright), so polling is the single code path and macOS uses it too: changes appear within a couple of seconds rather than instantly, and the interval stretches itself if a scan ever gets slow. `F5` still forces a full refresh
- Dragging out of the tree always **copies** (never moves)
- Source comments are written in Japanese (the UI itself is fully translated)
- Write mode is a plain textarea (no highlighting, completion, or diff while editing). Undo/Redo ride the browser's edit history, so **leaving write mode or switching files resets it**. It's meant for **quick one-line fixes**, not long-form writing or code editing. Saving overwrites in place with no backup, so use it on folders under version control
- No preview for `.xlsx` / `.pptx` / legacy `.doc` (double-click opens the default app)

## Stance

This is the author's daily-driver tool, published as-is. **No support promised.** Issues and PRs are welcome but replies and merges are not guaranteed.

Almost all code was written in collaboration with Claude Code (Anthropic). This project is not affiliated with Anthropic.

## License

MIT — see [LICENSE](LICENSE).

One third-party component is redistributed as a file in this repository (and inside the
installers): `renderer/vendor/mermaid.min.js` — Mermaid, MIT, © 2014–2022 Knut Sveidqvist — which
in turn bundles DOMPurify (Apache-2.0 / MPL-2.0, © Cure53) among others. Their copyright notices
and license texts are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
