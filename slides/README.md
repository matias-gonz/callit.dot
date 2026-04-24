# Callit Slides

A 5-minute [reveal.js](https://revealjs.com) deck for Callit — decentralized prediction markets on Polkadot. Content mirrors [`SLIDES_SCRIPT.md`](../SLIDES_SCRIPT.md) at the repo root.

## Install

```bash
bun install
```

## Run

```bash
bun run dev     # http://localhost:1948 (with HMR)
# or
bun start
```

Override the port:

```bash
PORT=3000 bun run dev
```

## Build a static bundle

```bash
bun run build   # outputs to ./dist
```

Then host `./dist` on any static web server.

## Presenter mode

Press `S` in the browser to open the reveal.js speaker notes view. The presenter notes are the `<aside class="notes">` blocks in `index.html` and correspond to the scripts in [`SLIDES_SCRIPT.md`](../SLIDES_SCRIPT.md).

## Keyboard shortcuts

| Key         | Action                 |
| ----------- | ---------------------- |
| `→ / Space` | Next slide             |
| `←`         | Previous slide         |
| `S`         | Speaker view           |
| `F`         | Fullscreen             |
| `O` / `Esc` | Slide overview         |
| `?`         | All keyboard shortcuts |

## Files

- `index.html` — the deck (5 content slides + title + closing)
- `frontend.ts` — reveal.js initialization with `highlight` and `notes` plugins
- `styles.css` — Polkadot-pink dark theme overrides
- `index.ts` — Bun dev server (HMR + static fallback for `node_modules/reveal.js/dist/*`)

## Editing

Slide content lives directly in `index.html` as `<section>` blocks. Each section has an `<aside class="notes">` for presenter notes. Keep slides in sync with [`SLIDES_SCRIPT.md`](../SLIDES_SCRIPT.md) when changing content.
