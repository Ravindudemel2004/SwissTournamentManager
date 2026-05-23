# Swiss Tournament Manager

A professional **Swiss-system chess tournament manager** that runs entirely in the browser. No server, no install — host on GitHub Pages or open `index.html` locally.

**Live demo:** [https://ravindudemel2004.github.io/SwissTournamentManager/](https://ravindudemel2004.github.io/SwissTournamentManager/)

## Features

- **Swiss pairings** — score groups, top/bottom half pairing, rematch avoidance, byes, color balance
- **8–64 players** — manual entry or **Excel import** (.xlsx, .xls, .csv)
- **Round management** — generate rounds, enter results, lock completed rounds
- **Results page** — view by round or full results grid across all rounds
- **Live standings** — points, Buchholz, Sonneborn-Berger, rating tie-breaks
- **Saved tournaments** — multiple events stored in browser (auto-save)
- **Import / export** — JSON backup, CSV for standings, pairings, and results
- **Dark / light theme** — responsive, mobile-friendly UI

## Pages

| Page | Purpose |
|------|---------|
| [index.html](index.html) | Dashboard & tournament overview |
| [players.html](players.html) | Add/edit players, Excel import |
| [pairings.html](pairings.html) | Generate pairings, enter results |
| [results.html](results.html) | Round results & cross-table grid |
| [standings.html](standings.html) | Live rankings |
| [settings.html](settings.html) | Rules, saved tournaments, export |

## Excel player import

1. On **Players**, click **Excel Template** to download the sample file.
2. Fill columns: **Name** (required), Rating, Club, Active (Yes/No).
3. Click **Import Excel** and choose append or replace.

## Saved tournaments

On **Settings → Saved Tournaments** you can save, load, rename, duplicate, or delete events. Data is stored in `localStorage` and persists until you clear browser data.

## Tech stack

- HTML, CSS, vanilla JavaScript only
- [SheetJS](https://sheetjs.com/) (CDN) for Excel import
- GitHub Pages compatible

## Local use

Open `index.html` in any modern browser, or serve the folder with a static server.

## License

MIT — use freely for chess clubs and tournaments.
