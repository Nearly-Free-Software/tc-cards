# TC Cards

A small, offline phone web app for playing the **Table Conversations** question cards when the box isn't with you. You choose a pile (Start Small or Go Deeper), read its intro, and draw one card at a time. Cards don't repeat across evenings, and the screen stays out of the way.

TC Cards is an unofficial companion. Table Conversations and its questions are © [Practicing the Way](https://www.practicingtheway.org/tableconversations), and TC Cards is not affiliated with or endorsed by them.

**This repository contains no Practicing the Way content.** There are no questions, PDFs or encrypted deck here. Each person builds the deck on their own machine from PtW's [free PDF](https://www.practicingtheway.org/tableconversations#download), and it is only ever served encrypted behind a spoken *table word*. Please respect [PtW's terms](https://www.practicingtheway.org/terms): personal and non-commercial use only, and ask them (hello@practicingtheway.org) before sharing a deployment beyond your own phone.

## How it works

- **Plain static files** in `public/`. There's no framework, no bundler and no runtime dependencies.
- **`public/cards.enc.json`** holds the deck, encrypted with AES-GCM-256 using a key derived by PBKDF2-SHA256 (600k iterations) from the table word. The phone stores the derived key after the first unlock.
- **`public/sw.js`** pre-caches every file, so after one online visit the app works with no signal.
- **Pile state** (shuffled order and position) is kept in `localStorage`. Nothing leaves the phone, and there are no analytics or cookies.
- **Screen wake lock** keeps the screen on while a card is showing, where the browser supports it.
- **Cards feel physical**: each question is printed on a card lying on a candlelit table, drawn from a pile that visibly thins. Drawing sets the old card aside and turns the next one over; *Not this one* tucks it under the pile; *Turn* spins it flat for the person opposite. `public/motion.js` holds the motions (Web Animations, transform/opacity only); they move at an unhurried, hand-turned pace and all finish inside the 900 ms tap guard, never gate state, and fall back to a short fade with Reduce Motion or for cards too tall to animate. On Android a 10 ms tick confirms each draw (toggle in About); iPhones have no web vibration API.

## Setup

You need Node 22+ and poppler (`brew install poppler`, for `pdftotext`).

1. Download the three PDFs from the [Table Conversations page](https://www.practicingtheway.org/tableconversations#download) into `local/source/`:
   - `digital.pdf` — *Community-Table-Conversations-Digital-Version.pdf*
   - `print-start-small.pdf` — the printable Start Small booklet
   - `print-go-deeper.pdf` — the printable Go Deeper booklet
2. Put your table word on the first line of `local/table-word.txt`.
3. Build the deck and update the offline cache version:

   ```sh
   npm run cards
   npm run stamp
   ```

`local/` is git-ignored and never uploaded. `npm run cards` does the following:

- extracts every card word for word;
- checks the page structure, and that there are 50 + 50 questions;
- cross-checks the numbering against both printable booklets;
- writes `local/cards.json` (plaintext, kept local) and `public/cards.enc.json` (encrypted).

Read each tier against the PDF once by eye. Use `local/overrides.json` (keyed by card ID, e.g. `{"ss-18": {"hint": "…"}}`) to mark a line as a hint or to correct a card.

## Develop

```sh
npm run dev     # http://localhost:5173, served with the same headers as vercel.json
npm test        # pile rules, the lock, and checks that nothing readable is in public/
```

- **Run `npm run stamp` after any change in `public/`.** The service worker serves from its cache first, so you won't see a change until the stamp moves.
- **Use `localhost`, not a LAN IP.** WebCrypto and service workers need a secure context.

### Changing the table word

Edit `local/table-word.txt`, then run `npm run cards -- --rotate && npm run stamp` and deploy. Phones that already unlocked will ask for the new word, and their card progress is kept.

## Deploy

Deploys run from your own machine with the Vercel CLI, because the encrypted deck only exists locally:

```sh
npm run predeploy   # stamp is current + tests pass
vercel deploy --prod
```

- **Git deployments are turned off** in `vercel.json`, since a build from this repository would have no deck.
- **Use the production URL only.** Preview URLs sit behind Vercel Authentication, and an app installed on an iPhone home screen can't sign in.

### Installing on a phone

- **iPhone:** in Safari, tap Share, then *Add to Home Screen*. Open it once from the icon while online and unlock it there.
- **Android:** in Chrome, tap ⋮, then *Install app*.

## Taking it down

If you ever need to withdraw a deployment, follow [`takedown/README.md`](takedown/README.md). It covers clearing copies already installed on phones before removing the site.

## Layout

```
public/          everything that is served (index.html, app.js, pile.js, lock.js, sw.js, …)
scripts/         build-cards, stamp-sw, make-icons, make-paper, serve (all dependency-free Node)
tests/           node:test suites
takedown/        tombstone files for withdrawing a deployment
local/           your PDFs, plaintext deck, overrides and table word (git-ignored)
```
