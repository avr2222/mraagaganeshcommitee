# Ganesh Pooja Expense Portal

A simple, self-contained web portal for a Ganesh Pooja / Ganesh Chaturthi committee to track
contributions (donations) and expenses, and see a live balance at a glance.

## Features

- **Dashboard** — total collections, total expenses, balance in hand, contributor count,
  expense breakdown by category, and a recent activity feed.
- **Contributions** — record donor name, phone, amount, date, payment mode and notes.
  Search, edit, and delete entries.
- **Expenses** — record description, category (Idol & Decoration, Pandal Setup, Pooja
  Samagri, Priest, Prasad & Food, Sound & Lighting, Cultural Events, Visarjan, Printing &
  Invitations, Permissions & Security, Miscellaneous), amount, date, vendor and notes.
- **Reports** — export contributions or expenses as CSV, print a summary report, and
  download/restore a full JSON backup.
- **Settings** — customize the event/committee name and subtitle shown in the header.

## Tech

Plain HTML, CSS, and vanilla JavaScript — no build step, no framework, no server required.
Data is stored in the browser's `localStorage`, so it persists across visits on the same
device/browser.

## Running it

Just open `index.html` in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

It can also be hosted for free as a static site (e.g. GitHub Pages) so committee members can
access it from a shared link.

## Data & backups

All data lives in `localStorage` in the browser it was entered in — it is **not** synced
across devices by default. Use **Reports → Download Full Backup (JSON)** regularly, and
**Restore from Backup** to load it back in (on this or another device/browser).

## Project structure

```
index.html      Markup for all tabs (Dashboard, Contributions, Expenses, Reports)
css/style.css   Styling (saffron/festive theme, responsive layout, print styles)
js/app.js       App logic: CRUD, dashboard calculations, CSV export, backup/restore
```
