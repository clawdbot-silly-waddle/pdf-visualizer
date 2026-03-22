# PDF Render Visualizer

A browser-based tool that visualizes how a PDF page is constructed by stepping through its content stream operators one by one.

Drop any PDF file in, select a page, and scrub through the drawing instructions to see the page build up — from blank canvas to finished render.

## Features

- **Drag & drop** PDF loading (desktop) or file picker (mobile)
- **Page navigation** via thumbnail sidebar (desktop) or prev/next buttons (mobile)
- **Instruction seeker** — slider to scrub through content stream operators
- **Operator list** with color-coded category badges (Path, Paint, Color, Text, etc.)
- **Playback controls** — play/pause, step forward/back, adjustable speed (0.5× – 10×)
- **Keyboard shortcuts** — ←/→ step, Shift+←/→ jump 10, Space play/pause, Home/End
- **HiDPI-aware** — renders at native device resolution
- **Responsive** — works on desktop and mobile

## How It Works

1. Parses the PDF's raw content stream using **pdf-lib** (handles FlateDecode decompression)
2. Tokenizes the stream into individual operators (moveTo, setColor, fill, stroke, showText, etc.)
3. For each seeker position, creates a modified PDF with a truncated content stream
4. Renders the partial PDF using **pdfjs-dist**
5. Displays the result with an overlay showing the current operator and its description

## Tech Stack

- **TypeScript** + **Vite**
- **pdfjs-dist** — PDF rendering
- **pdf-lib** — content stream manipulation
- Vanilla CSS (dark theme, no frameworks)

## Development

```bash
npm install
npm run dev        # start dev server
npm run build      # production build
npm run typecheck  # type checking
```

## License

MIT
