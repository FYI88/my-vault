# My Vault — Roadmap & Plan

> Planning only — nothing here has been built yet. Companion to `HANDOFF.md`
> (which records what IS shipped). Created 2026-08-26 from a fresh audit of the
> codebase: 52/52 tests green, strict CSP, phantom v5 wall + drift + classic
> galleries, journal with doodles, mono/cream themes, drag-drop import, 94.8 MB
> portable EXE.

## Direction chosen

Four tracks, ordered by structural leverage. Track A first because every later
feature (slideshow, album walls, search filters) benefits from organization
existing. Design polish (Track D) is deliberately last-per-track: it rides on
top of real behavior instead of decorating placeholders that change.

| Track | Theme | Why this order |
|---|---|---|
| A | Albums & tags | Structural upgrade everything else composes with |
| B | Notes & captions | Cheapest big win; schema already supports it |
| C | Safety & convenience | Trash grace period, quick unlock, vault hygiene |
| D | Design & motion polish | Blur-up, staggered entry, mono personality, keyboard-first |

---

## Track A — Albums & collections

**Problem:** the vault is one flat scroll. Fine at 50 files, painful at 500.

**Shape:** records carry an `albums` string array (tags, not folders — an item
can live in several). UI: filter chip row above the grid (`all` + each album +
`+ new album`), album counts, rename/delete album without touching items.
Phantom v5 wall + drift wall read the active filter so galleries scope to the
current collection. Search stays global (searches across albums) with an
optional "in this album" toggle.

**Schema note:** container header/records are version-tolerant already; albums
is additive — old vault files open unchanged, saving writes the new field.
No migration needed, just a container test asserting old→new round-trip.

## Track B — Notes & captions

**Problem:** photos carry no words; search only matches filenames.

**Shape:** two layers.
1. **Captions** — one-line text under any photo/video (renders beside the
   existing `.cell-name`; searchable).
2. **Text notes** — standalone note records (kind `note`) rendered as elegant
   cards in the masonry grid, opening into a distraction-free editor pane
   (reuse the item-view shell). Markdown-lite later if wanted; start plain.

Both ride the same record plumbing the phone vault's `vaultAddNote` proved out.
EXIF-strip path untouched; notes are just encrypted UTF-8.

## Track C — Safety & convenience

1. **Recently deleted** — deleting moves the record's wrapped key into a
   `trash` section (still decryptable) instead of destroying it immediately;
   a "recently deleted" view offers restore or permanent delete (which then
   does the real cryptographic delete). Auto-purge after N days (default 30,
   configurable off). Tradeoff accepted knowingly: this softens pure
   crypto-delete-by-default, but the purge is still cryptographic and manual
   "delete forever" keeps the strong promise when wanted.
2. **Windows Hello quick unlock** — after first passphrase unlock, offer
   "unlock with Windows Hello": main process wraps a random unwrap secret with
   DPAPI (+ Hello presence check) and stores it alongside the vault file path;
   renderer requests it via IPC gated by Hello prompt. Passphrase + seed keep
   working unchanged; feature is opt-in and off by default.
3. **Vault hygiene** — move vault file (rewrite at new path, update bookmark),
   backup reminder (nag after N days since last copy), `--verify <file>` CLI
   flag running the tamper sample offline and printing a verdict.

## Track D — Design & motion polish

Audit found good bones (characterful fonts, single accent family, real empty
states, focus rings). These upgrades make it feel finished:

- **Blur-up thumbnails** — cells currently pop in post-decrypt; render a tiny
  blurred placeholder from the thumb pipeline first, swap sharp on ready.
- **Staggered entry** — grid/wall tiles cascade in (~30ms steps,
  translateY+opacity, transform-only animation).
- **Tinted shadows** — replace any pure-black shadows with warm mauve-tinted
  ones matching the cream base; consistent light source top-left.
- **Mono personality pass** — hairline dividers, wide-tracked uppercase
  micro-labels, `tabular-nums` on sizes/dates/counters so mono reads designed,
  not inverted cream.
- **Keyboard-first item view** — ←/→ between items, Esc closes, F favorites
  (see open questions), J/K journal navigation.
- **Spotlight borders** — card borders illuminate under the cursor on the
  phantom wall tiles; matches the wall aesthetic.
- **Memory-lane slideshow** — fullscreen auto-playing crossfade of the current
  filter with dates/captions; idle-timer screensaver option. Composes the
  three existing gallery engines rather than adding a fourth.

---

## Ticket breakdown (tracer bullets)

Each slice is demoable on its own. Blocking edges are explicit; unblocked
tickets can start in parallel.

### 01 — Album chips + record field
**Delivers:** items can be tagged into albums; chip row above the grid filters
it live; counts shown; survives lock/unlock and re-open. Old vault files load
unchanged.
**Blocked by:** none — can start immediately.
- [ ] Add/edit album tags from item view + via drag onto a chip (stretch)
- [ ] Filter row renders all/each album with counts, active chip highlighted
- [ ] Container round-trip test: pre-albums file opens, gains albums, reopens
- [ ] Lock wipes decrypted name/album caches

### 02 — Galleries respect the album filter
**Delivers:** opening phantom v5 / drift / classic while filtered scopes the
wall to that album; clearing the filter restores the full wall live.
**Blocked by:** 01.
- [ ] Wall rebuilds on filter change without leaving gallery mode
- [ ] Empty album shows a composed empty state, not a blank wall
- [ ] Grid prefs (cols/rows/scale) unaffected by filtering

### 03 — Photo/video captions
**Delivers:** one-line caption editable from item view, shown under the cell
name, searchable alongside names.
**Blocked by:** none (independent of albums).
- [ ] Caption edit inline in item view, persisted, wiped from memory on lock
- [ ] Search matches caption OR name; count line reflects both
- [ ] Test: caption round-trip + tamper still detected

### 04 — Text notes
**Delivers:** `+ add note` creates a text record rendered as a card in the
masonry grid, opening a clean in-app editor; notes export like docs.
**Blocked by:** 03 shares the caption/search plumbing (soft edge — could run
parallel with care).
- [ ] Note kind renders distinct card style in both themes
- [ ] Autosave debounce + unsaved-changes guard on close/lock
- [ ] Notes appear in search results; export-a-copy works

### 05 — Recently deleted
**Delivers:** delete moves items to a restore-able trash view; "delete forever"
performs the existing cryptographic delete; auto-purge configurable.
**Blocked by:** none.
- [ ] Trash view lists items with days-left; restore puts them back in place
- [ ] Purge path reuses crypto-delete; tamper checks ignore trashed keys safely
- [ ] Settings: auto-purge off/7/30/90 days

### 06 — Windows Hello quick unlock
**Delivers:** opt-in "unlock with Windows Hello" after first passphrase unlock;
passphrase and seed paths untouched; disabling revokes the stored secret.
**Blocked by:** none (main-process work).
- [ ] DPAPI-wrapped secret never touches renderer; IPC gated by Hello prompt
- [ ] Fallback to passphrase when Hello unavailable/fails
- [ ] Security review pass documented in HANDOFF before merge

### 07 — Vault hygiene set
**Delivers:** move vault file to a new folder without losing anything; backup
reminder; `--verify` CLI printing a tamper verdict.
**Blocked by:** none.
- [ ] Move = atomic write to new path + bookmark update + old file left alone
- [ ] Reminder nags after N days since last backup, dismissible
- [ ] `--verify <file>` runs headless, exit code reflects verdict

### 08 — Design & motion polish pack
**Delivers:** blur-up thumbs, staggered tile entry, tinted shadows, spotlight
borders on the phantom wall, mono personality pass.
**Blocked by:** 02 (so polish lands on final gallery behavior, once).
- [ ] No layout shift from placeholders; animations transform/opacity only
- [ ] Both themes verified; reduced-motion media query honored
- [ ] 52/52 tests still green; visual pass on EXE build

### 09 — Keyboard navigation + memory-lane slideshow
**Delivers:** arrow-key/Esc item navigation; fullscreen slideshow over the
active filter with optional idle screensaver mode.
**Blocked by:** 04 (item view stable), 08 (motion language exists).
- [ ] Focus management correct (no trapped focus, ring visible)
- [ ] Slideshow pauses on hover, exits cleanly, object URLs revoked on stop

Dependency sketch: **01 → 02**, **03 → 04**, others independent; **08** after
02; **09** after 04+08. Tracks A/B/C can interleave freely.

---

## Open questions (to settle before building each track)

1. **Albums:** flat tags vs nested albums? (Plan assumes flat tags.)
2. **Trash default:** 30-day auto-purge okay, or always ask before purge?
3. **Hello unlock:** acceptable to store the DPAPI blob next to the vault file,
   or keep it in `userData`?
4. **Notes:** plain text first, or markdown-lite rendering from day one?
5. **Favorites/starring:** worth adding as a special album ("favorites") in 01,
   or skip?

## Validation approach (every ticket)

- `npm test` suites extended with the ticket's node-testable logic.
- Live preview verification through the real import/open paths.
- EXE rebuilt + asar checked for new strings/modules before closing a ticket.
- HANDOFF.md gets a dated entry per shipped ticket (existing convention).
