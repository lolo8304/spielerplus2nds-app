# AGENTS.md

## Project Role

This repository is the React/Vite frontend for the SpielerPlus to NDS workflow.
It is used by FC RWW administrators to speed up and reduce errors in generating
NDS attendance/import files from SpielerPlus exports.

The full system has three repositories:

- `spielerplus2nds-app`: React frontend in this repository.
- `spielerplus2nds-api`: NestJS BFF and file/process administrator.
- `spielerplus2nds`: Java NDS generator, shell scripts, and season/team data
  folders.

The frontend must treat the API as the only component allowed to read, move,
archive, delete, or generate files. Browser code must not assume direct local
filesystem access except for optional display-only folder labels.

## Working Agreement

- Expect the user to make changes at the same time. Always inspect and work with
  the current git state, including uncommitted changes, before editing.
- Treat all existing git changes as intentional context unless the user asks for
  a revert.
- The user is also working on the code. Always take all current changes into
  account.
- Do not start dev servers or background services for testing. The user keeps
  them running in watch mode.
- Use the running frontend at `http://localhost:3001`.
- Use the running API at `http://localhost:3000`.
- Keep final responses short and focused on what changed and what was checked.

## Git Workflow

- The repository's integration branch is `main`.
- Normal development should account for all current git changes, including
  uncommitted user edits.
- If the user says `commit + push`, create a branch from `main` with a name based
  on the overall changes, commit the relevant changes there, push the branch, and
  merge it back to `main` automatically.

## Ports And Locations

- Frontend app: `http://localhost:3001`
- API: `http://localhost:3000`
- Java generator repository: `/Users/Lolo/git/spielerplus2nds`
- Java generator command wrapper:
  `/Users/Lolo/git/spielerplus2nds/nds.sh`
- Java generator run location: `/Users/Lolo/git/spielerplus2nds`
- Java installed app binary:
  `/Users/Lolo/git/spielerplus2nds/app/build/install/app/bin/app`
- Data folder root: `/Users/Lolo/git/spielerplus2nds/data`
- Downloads folder: `/Users/Lolo/Downloads`
- Example season folder: `/Users/Lolo/git/spielerplus2nds/data/2026-1`
- Example team folder: `/Users/Lolo/git/spielerplus2nds/data/2026-1/B`

## Local Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Preview build: `npm run preview`

The app historically used `http://localhost:3002`, but the active local API for
this workspace is `http://localhost:3000`. Override with:

```sh
VITE_API_URL=http://localhost:3000
```

## Runtime Assumptions

- Vite is already running on `http://localhost:3001`.
- The API must be running from `../spielerplus2nds-api`.
- Data is served through the API from `/Users/Lolo/git/spielerplus2nds/data`.
- Pending SpielerPlus exports are served through the API from
  `/Users/Lolo/Downloads`.
- The NDS generator is invoked only by the API via
  `/Users/Lolo/git/spielerplus2nds/nds.sh`.

## Domain Model

The application optimizes generation/conversion of NDS activity attendance data
from these inputs:

- SpielerPlus participant/player files: `*_Teilnehmende_*.csv`
- SpielerPlus trainer files: `*_Leiterinnen_Leiter_*.xlsx`
- SpielerPlus activity files: `*_Aktivitäten_*.xlsx`
- SpielerPlus attendance/statistics exports: `statistics-*.csv`
- Manual wildcard attendance rows: `nds+anwesenheiten-always.csv`
- Java generator outputs: `*-to-import-1-all.csv`, `*-to-import-2-auto.csv`,
  `*-to-import-3-manual.csv`, summaries, missing-data console output.

Teams are maintained per season. Top-level teams currently include `B`, `C`,
`Da`, `Db`, `Dc`, `Dd`, `E`, `F`, and `G`. Some teams have subteams configured
by `config.json` in the Java data folder, for example `E/Ea` and `E/Eb`.

The app must preserve the distinction between:

- `All`: aggregate view and whole-season generation target.
- Top-level team: valid import and generate target.
- Subteam: valid import target for most files, but generation is run on the
  parent team.

`statistics-*.csv` files can only be imported into top-level teams.

## API Contract

The frontend currently consumes these endpoints:

- `GET /config`
- `GET /teams?season=...`
- `GET /downloads?season=...`
- `GET /downloads/events`
- `GET /wildcards?season=...&targetId=...`
- `POST /downloads/move`
- `POST /downloads/clear`
- `POST /generate`

When editing TypeScript types in `src/App.tsx`, keep them aligned with the API
interfaces in `../spielerplus2nds-api/src/app.service.ts`.

Important constants mirrored from the API:

- All target id: `__all`
- Default season: currently `2026-1`
- Default API URL: `http://localhost:3002`

## UI Behavior To Preserve

- Keep the three-column operations layout: teams/subteams, metrics/generation,
  download queue.
- Season changes must refresh team metrics and downloads.
- Counts should be visible without pressing Generate.
- Parent teams with configured subteams show aggregate counts.
- `All` counts sum only top-level teams to avoid double-counting subteams.
- Generate output and missing-data state should remain available while switching
  teams.
- During All Generate, lock imports, target changes, and other Generate actions.
- After importing a file, run Generate for the imported team; when the current
  view is `All`, also run All Generate after the team Generate.
- Keep download target guessing transparent to the user; do not auto-import
  unless the explicit auto-import control is enabled.

## Frontend Guidelines

- Use React functional components and hooks.
- Keep API calls centralized through the existing Axios client.
- Prefer adding small typed helpers over duplicating shape logic inline.
- Preserve existing Tailwind CSS usage and Heroicons style.
- This is an operations tool, not a marketing site. Prioritize dense,
  scannable, predictable UI over decorative presentation.
- Do not add unrelated routing, state libraries, component frameworks, or visual
  redesigns unless the task explicitly requires them.

## Verification

For frontend-only changes, run:

```sh
npm run build
npm run lint
```

For behavior that depends on the backend, also run the API with
the already-running API on `http://localhost:3000` and test against the
already-running app on `http://localhost:3001`.
