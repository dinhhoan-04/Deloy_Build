# ResearchKit Extension

Chrome extension sidebar for academic research on Elicit, SciSpace, and Consensus.

## Features

- **Verify** — check AI-generated claims against cited papers
- **Inbox** — collect and manage sources from research pages
- **Projects** — organise verified claims into research projects
- **Drafts** — export literature review drafts as `.md` or `.docx`
- **Conflicts** — detect conflicting claims across sources

## Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Production build → dist/
npm test         # Run tests (Vitest)
```

Load `dist/` in `chrome://extensions/` (Developer mode → Load unpacked).

## Stack

- React 18 + TypeScript
- Zustand (state management)
- Tailwind CSS v4
- Vite + vite-plugin-crx
- Vitest + React Testing Library

## Structure

```
src/
├── background_minimal.ts   # Service worker — opens sidebar on research sites
├── content.ts              # Content script — page detection + extraction
├── shared/                 # API client, auth, SSE, types, utils
├── extract/                # Content extraction from research pages
├── adapters/               # Site-specific DOM parsers
└── sidebar/
    ├── state/              # Zustand stores (verify, inbox, projects, drafts, conflicts)
    ├── hooks/              # Data fetching hooks
    ├── selectors/          # Derived state
    └── components/         # UI components (atoms, shell, tabs, overlays)
```

## Backend

The extension connects to `research-kit/backend` (FastAPI). See the root [README.md](../../README.md) for backend setup.
