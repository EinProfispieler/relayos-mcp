# sample2 and samplecode: Structure and Usage

## What each folder is

- `sample2/`: a full runnable Bun project (includes `package.json`, `bunfig.toml`, lockfile, stubs, plugins, and `src/`).
- `samplecode/`: source-only snapshot (mostly `src/`), missing runtime/build metadata files.

## High-level structure

### `sample2/`

```
sample2/
├── README.md
├── package.json
├── bunfig.toml
├── bun.lock
├── tsconfig.json
├── plugins/
├── stubs/
└── src/
```

- Approx file count: ~2043 files.
- Purpose: complete project you can install and run directly.

### `samplecode/`

```
samplecode/
└── src/
    ├── entrypoints/
    ├── commands/
    ├── tools/
    ├── services/
    ├── components/
    ├── hooks/
    ├── bridge/
    ├── memdir/
    ├── tasks/
    └── ...
```

- Approx file count: ~1903 files.
- Purpose: source tree only; not directly runnable as-is because root build/runtime files are missing.

## Important differences

- `sample2` has project runtime files (`package.json`, `bunfig.toml`, `bun.lock`, `tsconfig.json`).
- `sample2` has local stub packages under `stubs/` that satisfy missing internal dependencies.
- `samplecode` currently has no `package.json` at its root, so `npm install` / `bun run` will not work directly there.
- Core app code layout is very similar between both (same major `src/` module groups).

## How to use `sample2`

From `/Users/randy/GID/sample2`:

```bash
npm install --legacy-peer-deps
bun run start
```

Useful commands:

```bash
bun run dev
bun run build
bun run typecheck
```

Optional env vars:

- `ANTHROPIC_API_KEY`
- `FEATURE_FLAGS` (example: `KAIROS,VOICE_MODE`)

## How to use `samplecode`

You have two practical paths.

### Path A (recommended): treat `samplecode` as reference source only

- Use `sample2` to run/debug.
- Compare or port changes from `samplecode/src` into `sample2/src` when needed.

### Path B: make `samplecode` runnable by adding missing project files

1. Copy runtime/build files from `sample2` into `samplecode`:
   - `package.json`
   - `bunfig.toml`
   - `tsconfig.json`
   - `bun.lock` (optional but recommended)
   - `stubs/`
   - `plugins/`
2. Install deps in `samplecode` root.
3. Run with `bun run start`.

Example:

```bash
cd /Users/randy/GID/samplecode
# after adding the files listed above
npm install --legacy-peer-deps
bun run start
```

## Suggested workflow

- Use `sample2` as the executable baseline.
- Use `samplecode` as an alternate source snapshot for comparison, auditing, or selective code extraction.
