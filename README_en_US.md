# Outline Mind Map

> 中文版（默认）：[README.md](README.md)

Turn **unordered lists, ordered lists and task lists** in SiYuan into professional-looking mind maps with a single click.

## Why

An outline is already a tree — it just doesn't look like one once it gets deep. This plugin renders outline blocks as a real diagram:

- **Card-style nodes** — a filled pill for the root, tinted cards for first-level branches, and cards with a coloured spine below that
- **Per-branch colour schemes** inherited down the hierarchy
- **Bézier connectors** whose width and opacity taper with depth
- **A real layout engine** — tidy-tree packing with parents centred over their children, so long text can't skew the whole map
- **Three structures** — logic chart, mind map (split left/right) and tree chart (top-down)
- **Follows the SiYuan theme** by default, plus five built-in palettes: Deep Space, Paper, Morandi, Neon and High Contrast
- **Zoom, pan and fold** — Ctrl + wheel to zoom, drag to pan, one click to fit, collapse any subtree
- **Full keyboard control** — arrow keys navigate, `Tab` / `Enter` / `F2` / `Delete` restructure without going back to the editor
- **Edit in place** — double-click a node to rename it; Enter commits and writes straight back to SiYuan
- **Drag to restructure** — drag a node to change its order or level; right-click for insert / move / indent / outdent / delete
- **Tick tasks off in the map** — click a `- [ ]` checkbox (or press `X`) and the marker is written back to the outline
- **Search and multi-select** — `Ctrl + F` to find a node (scope can be switched to the **whole document**), `Shift`-drag to box-select, then act on the whole selection at once
- **Filter by status** — in a task list, show only unfinished or only finished items; non-task nodes stay or go with their nearest task ancestor
- **Node marks** — attach an icon, a short label or a custom colour to a node; stored in a block attribute so it syncs with your notes
- **Minimap and zoom capsule** — always know where you are in a big map
- **Built for long documents** — blocks render only as they approach the viewport, and oversized maps are guarded
- **Export to SVG / PNG**, or just the selected subtree

## Usage

1. Open the block menu on any list block
2. Choose **Plugin → Outline Mind Map**, then pick one of three modes:

   | Mode | What it does |
   | --- | --- |
   | **Outline mode** (map off) | The list stays exactly as it is |
   | **Map mode** | The list becomes a mind map; defaults to the **logic chart** |
   | **Side-by-side mode** (outline + map) | The outline stays on the left, a linked map opens on the right — editing either side updates the other |

3. To switch structure (logic chart / mind map / tree chart), use **the map's own toolbar** rather than
   the block menu — that's where "what the map looks like" belongs, and you see the result immediately.

> The menu only answers "do I want a map, and do I want it side by side". **Layouts are not in the menu.**
> The old menu flattened five items ("Outline view / Logic chart / Mind map / Tree chart / Side by side"),
> mixing two different levels of decision.
>
> One related gotcha: **picking "Map mode" while already in map mode does not reset the layout** —
> otherwise your manual switch to "Tree chart" would be silently undone by a single menu click.

You can also run **Toggle the list at the cursor between mind map and outline** from the command palette (`Ctrl + P`),
or **Open the current list's mind map in the side panel** to view the map next to the outline.

Four entry points are available:

| Entry | Where | What it does |
| --- | --- | --- |
| Block menu | list block icon → Plugin → Outline Mind Map | Converts that one list |
| Top bar icon | the tree icon on the right of the top toolbar | Convert the current list, open side-by-side, convert every list in the document, open settings |
| Command panel | `Alt + Shift + P`, then search "mind map" | Both commands live here, with proper labels |
| Shortcuts | `Ctrl + Shift + D` toggles map / outline, `Ctrl + Shift + X` opens the side panel | Rebindable in SiYuan's shortcut settings |

> On macOS these read `⇧⌘D` / `⇧⌘X` — SiYuan stores key bindings in macOS glyph form
> internally and converts them to `Ctrl + Shift + …` on Windows itself.
>
> **Why not Space.** These defaults started as `Ctrl + Alt + D` / `Ctrl + Alt + V`, and were
> briefly `Ctrl + Space` / `Alt + Space` — which **did not fire at all on a real machine**.
> `Ctrl + Space` is the default toggle for Chinese/English mode in Windows IMEs (the IME eats it
> before the app ever sees it — and only while the IME is *active*, so it looks like a flaky
> "sometimes it works" bug), and `Alt + Space` is the Windows window system menu.
> Both are **silent** interceptions: no error, no warning, nothing happens.
>
> **Why the side panel is `X`, not `S` or `B`.** `S` looks like the obvious choice (Side), and we did
> ship `Ctrl + Shift + S` for a while — but it **does not fire inside the editor**. The `Ctrl + S`
> family belongs to SiYuan's editor (Protyle), which swallows the key on its way up the DOM tree;
> SiYuan's global shortcut matcher sits further out and **never sees the event at all**.
> Worse, it only fails *while the caret is inside the editor* (it works when focus is elsewhere),
> so it looks like yet another "sometimes it works" bug.
>
> Then we shipped `Ctrl + Shift + B` (Beside), which failed one layer deeper: the event *did* reach
> the outermost layer, but SiYuan's built-in "insert block above" (`editor.general.insertBefore`)
> is bound to that exact key by default and marks the event as handled **earlier in the chain**.
> The plugin command never got a turn — the map did nothing, while a **stray empty paragraph**
> quietly appeared in the document. "Did the key arrive?" and "is it still unclaimed?" are two
> different gates; checking only the first makes a taken key look free.
>
> The current pair contains no Space and no bare `Ctrl + Shift` (that switches input language),
> and `Ctrl + Shift + X` is verified free of collisions with every SiYuan command and installed
> plugin — as well as verified to actually reach SiYuan's shortcut matcher.
>
> ⚠️ SiYuan stores "space" as a **literal space character** in its key strings (not the word `Space`),
> so the shortcut reference renders it as the visible word "Space": pasting it raw
> produces `Ctrl + ` with an **invisible trailing space**, which tells the user nothing.
> The reference still has such rows (fold / expand, presentation advance).
>
> SiYuan filters plugin-declared hotkeys: anything with a `⌃` / `⌥` / `⌘` prefix is allowed through;
> only bare single characters without a modifier get cleared. Both bindings work.

Keys the map deliberately **never** steals: `Ctrl + S` / `P` / `W` / `R`, `Ctrl + Z` / `Y` (undo is left
to SiYuan's own stack), `F5` / `F11` / `F12`, and **every `⌥⌘` and `⇧⌘` combination** — those
namespaces are shared with SiYuan and other plugins, so the map yields the whole family.

That's not just politeness, it's **data safety**: the map itself binds `Ctrl + A / C / V / X / D / F`,
so a predicate that forgets one modifier turns that whole family into an accidental action —
`⌥⌘X` / `⇧⌘X` in particular would "cut the selected node's subtree", i.e. **silently delete your notes**.

> The plugin's own two global hotkeys, `⇧⌘D` / `⇧⌘X`, live in that family too.
> They only take the global path while the map has *not* grabbed the keyboard, so the two never
> fight — and with the map focused, `⇧⌘D` is not intercepted by the map's own `Ctrl + D` (duplicate).

The toolbar on the map offers layout switching, status filters, zoom controls, fit-to-canvas, fold/expand all, export, fullscreen and exit.

### Interactions

- **Ctrl + wheel** (⌘ on macOS) to zoom
- **Drag empty space** to pan
- **Click a node** to select and focus that branch
- **Double-click a node** to edit its text — Enter commits, Esc cancels
- **Ctrl / ⌘ + double-click a node** to drill down into that branch; the breadcrumb walks back out
- **Drag a node** onto another to restructure: drop on the upper / lower edge to become a sibling, drop in the middle to become a child
- **Right-click a node** for the action menu
- **Hover a node** for the `+` (add child) and `▾` (fold) shortcuts
- **Click the dot beside a node** to fold or unfold its subtree
- **Click a task checkbox** to toggle it; `X` toggles the selected node
- **Select two or more nodes** and a **batch bar** appears: outdent / indent / fold / unfold / mark done / mark undone / export these / delete.
  Batch operations are **all-or-nothing** — a mid-way failure rolls back to the snapshot taken before the operation
- **Hover a folded node** for 600 ms and a preview card lists its first few children
- **`Ctrl + F`** searches the current map by default; flip the scope switch on the search box to **whole document**
  to list hits from every map in the file (each row says which map it came from) and jump straight to one
- **Click a status chip** on the toolbar to show only unfinished or only finished tasks. A hit keeps **all of its
  ancestors** — an unfinished sub-task has to stay under its (possibly finished) parent, or you can't tell why it's there
- **Right-click → Add mark** to attach an icon, label or custom colour — handy for flagging or visually grouping nodes

> Renaming and inserting only touch the blocks involved, so **block IDs are preserved** and block references keep working.
> Only when a drop position cannot be expressed by the kernel API (e.g. inserting at the very top of a list, or a target
> that has no child list yet) does the plugin fall back to "insert a copy + delete the original", which rebuilds the IDs
> of the moved subtree.

## Data model

The map is **a view, not data** — blocks remain the single source of truth. The marker is stored in the block attribute `custom-mindmap`.

**Node marks are stored as a block attribute too** (`custom-mindmap-mark`, e.g. `{"icon":"⭐","label":"Important","color":"#e5534b"}`),
so icons, labels and custom colours travel with your notes. They are **never mixed into the node text** — renaming,
copying and exporting won't pick them up.

**Fold state is not stored separately**: the plugin uses SiYuan's native list folding (the `fold` attribute on `.li`), so folding
in the outline shows up in the map immediately and folding in the map is written back to the outline. It saves with the document.

It coexists with the *Custom Block* plugin — the two use separate attribute namespaces. To migrate from it, use the "Migrate" button in settings or the command palette entry; only `custom-block-list-view = map` lists are converted.

## Settings

The settings panel is organised as **side tabs**, grouped by purpose so you don't hunt through one long list:

| Tab | What lives there | Items |
| --- | --- | --- |
| **Appearance** | What the map looks like | Theme, default layout, connector style, branch colours, custom branch colours, level numbering, compact mode, layout animation |
| **Canvas** | How big the canvas is and how it auto-frames | Canvas height, canvas height (px), auto-fit, auto-columns for logic charts, minimap, always show minimap |
| **Interaction** | Mouse and keyboard behaviour | Double-click to edit, drag to restructure, hover preview for folded nodes, in-map keyboard control, `Ctrl + wheel` zoom, wheel to pan, per-document view preferences, fold state syncs with the outline |
| **Performance** | Trade-offs on large documents | Lazy rendering, compact-mode threshold, render cap |
| **Help** | Troubleshooting and migration | View shortcuts, copy diagnostics, migrate Custom Block marks |

Worth calling out:

- **View shortcuts** opens a **grouped table dialog** — two columns ("Key | Action"), 12 groups, 37 rows —
  instead of a toast that disappears after a dozen seconds. Key names are converted per platform
  (Windows shows `Ctrl + Shift + D` / `Ctrl + Shift + X`, macOS shows `⇧⌘D` / `⇧⌘X`), spaces render as the visible word "Space"
  (otherwise you get an invisible trailing blank), and rows with no key at all
  (clicking a checkbox, using the right-click menu) say "menu action" explicitly rather than being left blank.
- **Copy diagnostics** copies the plugin version, kernel version, a config snapshot, the state of
  every mounted map and the most recent plugin warnings to the clipboard, so you can paste it into
  a bug report. It only writes to the clipboard — **no network calls, no telemetry**.

## Development

```bash
npm install
npm run dev        # watch mode
npm run build      # one-off build
npm run package    # build + package.zip
npm run test       # parser / layout / tree-op unit tests
npm run smoke      # packaged-bundle smoke test (build first)
npm run visual     # headless-browser acceptance run (real rendering, real key events)
npm run live       # live run against a real SiYuan kernel + web frontend
npm run typecheck
npm run check      # the whole pipeline in one go
npm run check:all  # build + tests + browser acceptance
npm run deploy     # build + sync into the SiYuan workspace
```

Place this folder under `{workspace}/data/plugins/`; SiYuan loads `index.js` and `index.css` directly.

## Maintainer notes

### 1. Releasing is automated

`.github/workflows/release.yml` runs on every push to `main`:

1. `npm run check` — 8 static gates + 317 unit assertions + 96 package smoke assertions
2. builds `package.zip` and verifies it contains the required files
3. creates a GitHub Release tagged `v<version>` — **only if that release does not exist yet** (idempotent)

**To ship a new version: bump `version` in `plugin.json` and push to `main`.** That is the whole process.

> ⚠️ Why a Release at all, and not just a push: **the bazaar pulls `package.zip` from the
> Release, not the source in the repo.** This matters more here than in a typical plugin,
> because `.gitignore` excludes the build artifacts (`index.js` / `index.css` / `i18n/`) —
> so the repo source on its own is **not** a usable package.

### 2. Repository requirements (already satisfied — do not break them)

- **The repo name must match `plugin.json`'s `name` exactly** (`siyuan-plugin-mindmap`) —
  the bazaar enforces uniqueness by `name`
- **The default branch must be `main`** — the release workflow triggers on it
- Release tags use the `v<version>` form (same style as the official `plugin-sample`)
- `.gitignore` anchors root-level build artifacts with a leading `/`. Do **not** write a
  bare `i18n/` or `index.css` there: it matches at **any** depth and would silently
  exclude the real sources `src/i18n/*.json` and `src/styles/index.css`.

### 3. Language and READMEs (Chinese by default)

This plugin targets a Chinese-speaking audience, so the **fallback is Chinese**: in
`plugin.json`, the `default` value of `displayName` / `description` / `readme` is Chinese,
and English lives in the separate `en` / `en_US` keys.

The kernel resolves locale strings like this (`GetPreferredLocaleString` in
`kernel/bazaar/package.go`):

```
current locale → legacy underscore locale → default → en → en_US
```

`LangToLegacy` maps `zh-CN` → `zh_CN` and `en` → `en_US`, so both spellings are accepted.
**Note that `default` is checked before `en`** — once `default` is Chinese, English users
must be caught by `en` or `en_US`, otherwise they would see Chinese. That is why both
English keys are kept:

| User's SiYuan language | Key hit | They see |
| --- | --- | --- |
| `zh-CN` / `zh_CN` | `default` | Chinese |
| `en` | `en` | English |
| `en_US` (older builds) | `en_US` | English |
| `ja` / `de` / anything else | `default` | Chinese |

**The two READMEs:**

- `README.md` — Chinese; this is what GitHub and the bazaar detail page show by default
- `README_en_US.md` — English

> ⚠️ If you rename either file you **must** update the `readme` map in `plugin.json`.
> A mismatch is invisible locally — the bazaar simply shows no README and reports no error.
> `scripts/build.mjs` has a gate for this: if a file named in the manifest is not packed
> into `package.zip`, the build fails.

### 4. About `minAppVersion` (this was wrong once — here is why it is what it is)

It is now **`3.6.4`**, and that is derived, not guessed: the plugin uses
`/api/block/batchUpdateTaskListItemMarker` — the kernel API for **batch** task
check/uncheck (select several nodes, toggle them all in one round trip). That
kernel API was added by
[PR #17461](https://github.com/siyuan-note/siyuan/pull/17461), milestone **3.6.4**.
Below that version, batch check/uncheck fails.

> ⚠️ Do not confuse it with `/api/block/updateTaskListItemMarker` — that is the
> older **single-item** API used when you check off one task, and it imposes no
> version floor. When setting `minAppVersion`, take the **highest** floor among
> *all* kernel APIs the plugin uses, not the first one you happen to look at.

> It used to say `3.1.0` — a value with **no basis at all**. Development and acceptance
> were done entirely on **SiYuan 3.8.x** (starting from 3.8.4, later re-run in full on **3.8.5**;
> the empirical notes in the source are labelled with those versions).
> If you prefer to be more conservative, raise `minAppVersion` to `3.8.4`: that admits
> only the tested version, at the cost of excluding older users.

### 5. Already verified (no change needed)

`name` / `version` / `displayName` / `description` / `readme` / `icon` / `preview` /
`backends` / `frontends` have all been checked against the official spec:

- Icon 160×160, 4.4 KB (limit 64 KB); preview 1024×768, 28.8 KB (limit 512 KB)
- `package.zip` contains `index.js` / `index.css` / `plugin.json` / `i18n/*` /
  `README.md` / `README_en_US.md` / `icon.png` / `preview.png` — matches the required file list
- `frontends: ["all"]` (including mobile) is **actually tested**, not a bare claim —
  see `tests/kernel/probe-mobile-touch.mjs`, which runs against the real mobile frontend
  (`/stage/build/mobile/`) and verifies loading, rendering, tap-to-select, long-press menu,
  drag-to-pan, and checkbox writes to the kernel
- `disabledInPublish: true`: the plugin stays disabled in the **publish service**.
  That is deliberate — a published page has no runtime for this plugin, and claiming
  otherwise would only produce a half-rendered page. In other words:
  **in a published document, a mind map degrades to a plain outline list.**

## License

MIT
