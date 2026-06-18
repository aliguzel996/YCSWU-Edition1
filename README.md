# YCSWU Tools Special Edition

Special Edition is a shared desktop shell for YCSWU apps. It is not a copy of the old launcher as an app. The old launcher stays excluded; this project uses a common app registry and asset bus so every app can hand off compatible work to every other app.

## Core Contract

Each app declares:

- `accepts`: asset kinds and extensions it can receive.
- `produces`: asset kinds and extensions it can output.
- `transforms`: native conversions the app can perform.

The shell calculates routes from that contract. A route can be:

- `direct`: source output already matches the target input.
- `app-route`: another YCSWU app can bridge the format.
- `bus-route`: the shared asset bus adapter handles a planned conversion layer.

## Current Apps

The registry includes:

- `pixelmaxxxing`
- `giffer`
- `rooms`
- `fibonacci-grid-maker`
- `kira-kira`
- `hot-vs-nice`
- `gift-converter`
- `moire-maker`
- `2d-to-3d`
- `ngon-junk`

`YCSWU-Tools-Launcher` is intentionally excluded.

## Validation

Run:

```bash
node scripts/validate-interop.cjs
node scripts/smoke-interop.cjs
```

`validate-interop` checks that every app has a format contract and every app pair has a route.
`smoke-interop` creates scratch assets and records handoffs across all app pairs.

## Preview

The Electron app uses `window.specialEdition`. For dependency-free testing, the renderer also works through the local preview server:

```bash
node scripts/preview-server.cjs
```

Then open `http://127.0.0.1:5173`.
