# Outline Mind Map

Turn **unordered lists, ordered lists and task lists** in SiYuan into professional-looking mind maps with a single click.

## Why

An outline is already a tree — it just doesn't look like one once it gets deep. This plugin renders outline blocks as a real diagram:

- **Card-style nodes** — a filled pill for the root, tinted cards for first-level branches, and cards with a coloured spine below that
- **Per-branch colour schemes** inherited down the hierarchy
- **Bézier connectors** whose width and opacity taper with depth
- **A real layout engine** — tidy-tree packing with parents centred over their children, so long text can't skew the whole map
- **Four structures** — logic chart, mind map (split left/right) and tree chart (top-down)
- **Follows the SiYuan theme** by default, plus four built-in palettes: Deep Space, Paper, Morandi and Neon
- **Zoom, pan and fold** — Ctrl + wheel to zoom, drag to pan, one click to fit, collapse any subtree
- **Edit in place** — double-click a node to rename it; Enter commits and writes straight back to SiYuan
- **Drag to restructure** — drag a node to change its order or level; right-click for insert / move / indent / outdent / delete
- **Built for long documents** — blocks render only as they approach the viewport, and oversized maps are guarded
- **Export to SVG / PNG**

## Usage

1. Open the block menu on any list block
2. Choose **Plugin → Outline Mind Map → Logic chart** (or Mind map / Tree chart)
3. The list turns into a mind map; pick **Outline view** to switch back at any time

The toolbar on the map offers layout switching, zoom controls, fit-to-canvas, fold/expand all, export, fullscreen and exit.

### Interactions

- **Ctrl + wheel** (⌘ on macOS) to zoom
- **Drag empty space** to pan
- **Click a node** to select and focus that branch
- **Double-click a node** to edit its text — Enter commits, Esc cancels
- **Drag a node** onto another to restructure: drop on the upper / lower edge to become a sibling, drop in the middle to become a child
- **Right-click a node** for the action menu
- **Click the dot beside a node** to fold or unfold its subtree

> Renaming and inserting only touch the blocks involved, so **block IDs are preserved** and block references keep working.
> Only when a drop position cannot be expressed by the kernel API (e.g. inserting at the very top of a list, or a target
> that has no child list yet) does the plugin fall back to "insert a copy + delete the original", which rebuilds the IDs
> of the moved subtree.

## Data model

The map is **a view, not data** — blocks remain the single source of truth. The marker is stored in the block attribute `custom-mindmap`; fold state lives in `custom-mindmap-fold`, so both sync across devices.

It coexists with the *Custom Block* plugin — the two use separate attribute namespaces. To migrate from it, use the "Migrate" button in settings or the command palette entry; only `custom-block-list-view = map` lists are converted.

## Development

```bash
npm install
npm run dev        # watch mode
npm run build      # one-off build
npm run package    # build + package.zip
npm run test       # parser / layout / tree-op unit tests
npm run smoke      # packaged-bundle smoke test (build first)
npm run typecheck
npm run check      # the whole pipeline in one go
```

Place this folder under `{workspace}/data/plugins/`; SiYuan loads `index.js` and `index.css` directly.

## License

MIT
