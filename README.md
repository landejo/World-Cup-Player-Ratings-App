# Match Ratings — FIFA Post-Match player ratings

Upload a FIFA **Post-Match Summary Report (PMSR)** PDF and get every player rated out of 10, using a replicable weighted-action model (v4.4). Everything runs in your browser — **the PDF never leaves your device.**

**Live:** https://jasonlande.com/World-Cup-Player-Ratings-App/

## Use it
1. Open the live link.
2. Drop in a PMSR PDF (download them from FIFA's match-report hub) — or click a sample.
3. It rates the match. Tap a player to tweak position/minutes; use **Export** for a share image or JSON; switch to **Tournament** to accumulate matches into a team-of-the-tournament + leaderboards.

## How it works
Per-position weighted actions (passing, line breaks, progression, take-ons, duels, pressures, goalkeeping) pulled straight from the PMSR tables, calibrated on three reference-rated matches to ~0.32 cross-validated mean error. Parser + model in `core.js`, UI in `ui.js`, pdf.js bundled in `vendor/`.

Saved matches persist per-browser (localStorage). Built with Claude Code.
