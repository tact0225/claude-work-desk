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
file never lands in the wrong lane.*

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
- **New arrivals**: right-click a folder → **Show new arrivals**. Files that appear there afterwards stay highlighted until you click them — no fading after a few seconds — and the folder row is marked too, so you notice while it is collapsed. Watching is per folder and covers its **direct children only** (a subfolder is its own opt-in), the unread set survives a restart, and the workspace root cannot be watched (everything glowing means nothing glowing)
- **Path bar**: `▾` opens an Explorer-style history (last 20), `⌂` returns to the workspace, `↑` goes up one level. Paste a *file* path and it opens the parent folder and previews that one file
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

MIT
