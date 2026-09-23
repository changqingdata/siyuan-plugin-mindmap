# Outline Mind Map

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
2. Choose **Plugin → Outline Mind Map → Logic chart** (or Mind map / Tree chart)
3. The list turns into a mind map; pick **Outline view** to switch back at any time

You can also run **Toggle the list at the cursor between mind map and outline** from the command palette (`Ctrl + P`),
or **Open the current list's mind map in the side panel** to view the map next to the outline.

Three entry points are available:

| Entry | Where | What it does |
| --- | --- | --- |
| Block menu | list block icon → Plugin → Outline Mind Map | Converts that one list |
| Top bar icon | the tree icon on the right of the top toolbar | Convert the current list, open side-by-side, convert every list in the document, open settings |
| Command panel | `Alt + Shift + P`, then search "mind map" | Both commands live here, with proper labels |
| Shortcuts | `Alt + Cmd + D` toggles map / outline, `Alt + Cmd + V` opens the side panel | Rebindable in SiYuan's shortcut settings |

Keys the map deliberately **never** steals: `Ctrl + S` / `P` / `W` / `R`, `Ctrl + Z` / `Y` (undo is left
to SiYuan's own stack), `F5` / `F11` / `F12`, and **anything with `⌥` (Alt) held** — that namespace is
shared with SiYuan and other plugins, and this plugin's own `Alt + Cmd + D` / `Alt + Cmd + V` live in it.

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

The settings panel covers the default layout, connector style, theme, numbering, branch colours, wheel behaviour,
auto-fit, in-map keyboard control, lazy rendering, the minimap and per-document view preferences.

It also has a **Copy diagnostics** button: it copies the plugin version, kernel version, a config snapshot, the state of
every mounted map and the most recent plugin warnings to the clipboard, so you can paste it into a bug report.
It only writes to the clipboard — **no network calls, no telemetry**.

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

1. `npm run check` — 8 static gates + 312 unit assertions + 96 package smoke assertions
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

### 3. About `minAppVersion` (this was wrong once — here is why it is what it is)

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
> were done entirely on **SiYuan 3.8.4** (all six empirical notes in the source say 3.8.4).
> If you prefer to be more conservative, raise `minAppVersion` to `3.8.4`: that admits
> only the tested version, at the cost of excluding older users.

### 4. Already verified (no change needed)

`name` / `version` / `displayName` / `description` / `readme` / `icon` / `preview` /
`backends` / `frontends` have all been checked against the official spec:

- Icon 160×160, 4.4 KB (limit 64 KB); preview 1024×768, 28.8 KB (limit 512 KB)
- `package.zip` contains `index.js` / `index.css` / `plugin.json` / `i18n/*` /
  `README.md` / `README_zh_CN.md` / `icon.png` / `preview.png` — matches the required file list
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
