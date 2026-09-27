# TODOS

Deferred items from the v1 plan review (2026-09-22). Not blocking v1
implementation; pick up after the core ingest/vault/score/triage lanes land.

## 1. ~~Read Jigsaw Harassment Manager — retroactive check against the design~~ DONE 2026-09-23

Read the real component structure at `conversationai/harassment-manager`
(not just its README) and diffed it against `DESIGN.md`. Findings written
into `DESIGN.md`'s "Diff against Jigsaw's Harassment Manager" section. The
one real gap it surfaced — a dedicated crisis-resources / find-support
section, which their interviews with 27 journalists and activists apparently
found important enough to build as a first-class part of the app — is
TODO item 5 below.

## 2. ~~Harden vault key management~~ DONE 2026-09-23

Addressed the threat model directly (a live unlocked session under a
laptop-password-holding adversary, the more realistic attack window
than an offline file): real inactivity auto-lock, `Settings.autoLockMinutes`
(default 15, 0 disables), checked every 30s in `main/index.ts` and reset
on every IPC request via `VaultSession.touch()`. A manual "Lock now" in
Settings once the mechanism existed to back it. A new test confirms
message text and raw payloads never leak into the vault's `-wal` file
either, not just the checkpointed main db.

Two of the five original sub-items are a deliberate decision and an
accepted platform limitation, not silently dropped — see `vault/crypto.ts`'s
doc comment:
- **argon2id over scrypt**: declined. Would need a native/WASM dependency
  for a marginal hardening gain over scrypt already run at OWASP's
  recommended memory-hard cost — not worth the native-build fragility
  this project already got burned by once.
- **Locking key material out of swap**: not possible from Node/V8
  without a native addon. The inactivity timeout is the real mitigation
  for this specific threat — it shortens the window, since actually
  closing it isn't available on this stack.
- **Clipboard clearing**: moot — nothing in the app copies vault content
  to the clipboard today.

Verified: `VaultSession`'s idle logic is unit-tested with fake timers
(touch/isIdle/unlock-resets-clock/lock-clears-idle). The manual "Lock
now" flow has a real e2e test (`test/e2e/lock-now.spec.ts`). The actual
auto-lock timer firing was verified by hand against the real running
app (set `autoLockMinutes` to 1, waited ~70s, watched it lock) rather
than automated — a real e2e test for it would need a 60-100s run just
for this one mechanism, which isn't worth the CI cost given the
underlying logic is already covered by the fake-timer unit tests; this
is a deliberate coverage tradeoff, not an oversight.

## 3. Design the shared-device / coerced-unlock safety flow

Not addressed by any decision in the plan review: what happens when the
abuser is physically present and demands the vault be unlocked, or the device
is genuinely shared. Options span a duress passphrase (opens a decoy-empty
vault — a known technique with real complexity and a way to fail under
pressure) to no special handling (refusal to unlock is itself a tell). This is
a documented pattern in DV tech-abuse literature and deserves its own design
pass, not a bolt-on.

Depends on: `vault/crypto.ts` (lane 2) and TODO 2 above, since a duress
mechanism is part of the same key-management design.

## 4. ~~Keyboard power-navigation for the triage message list~~ DONE 2026-09-23

Built as a standard roving-tabindex list: ArrowDown/j and ArrowUp/k move
focus between row buttons, Enter opens the focused row (free — native
`<button>` behavior, no handler needed), r marks it reviewed, h hides it.
Focus survives a redraw — marking a row reviewed or hiding it removes it
from the list, and focus lands on the next available row rather than
getting stranded. No "space to select" — there's no multi-select/batch
action in the real triage screen (that was an aspirational detail from
the original TODO wording, not something DESIGN.md's built screens
actually have), so r/h act directly on the focused row instead.

Along the way, found and fixed a real bug: the row's open-control used
`display: contents` to avoid an extra layout box, which made it silently
unfocusable in this Chromium build — `.focus()` calls succeeded on the
element reference but `document.activeElement` never actually changed,
so keyboard nav would have done nothing at all. Fixed by giving it a
real (but still fully unstyled/transparent) flex box instead.

Verified end to end (`test/e2e/triage-keyboard-nav.spec.ts`): arrow/j/k
movement, Enter opening a thread, r and h against real seeded messages,
and bucket counts updating in response — closing the gap TODOS item 8
called out below.

## 5. ~~Crisis-resources / find-support section~~ DONE 2026-09-23

Designed and built: a fifth app-level nav icon ("Support and resources"),
listing three national US services verified against their own official
pages (National DV Hotline, Crisis Text Line, RAINN), plus a "Help" link
on the lock screen reachable before the passphrase — crisis help isn't
gated behind vault security. Full writeup in `DESIGN.md`'s "Support and
resources" section; screen is on the comparison board.

Left open, for later: whether the resource list should be configurable
(international users, regional resources) rather than hardcoded — a real
product question, not answered here.

## 6. ~~Onboarding: point an ingest adapter at a real source~~ DONE 2026-09-23

Built: Settings has a real Connect action per source, opening a wizard
(`renderer/screens/onboarding.ts`) — connect, scan (metadata only, no
vault write), DESIGN.md's D7 "before you continue" screen, a checkbox
picker, then connect + first sync in one step. Connection config lives
in the vault (`vault/source-config.ts`), not a plain settings file,
since it reveals exactly who's being monitored; the IMAP app password
goes through the existing `CredentialStore`. Verified end to end against
the real app (`test/e2e/onboarding.spec.ts`): connecting an Android SMS
export through the actual wizard UI, and the imported message showing
up in triage afterward.

Left open: no checkpoint persistence, so "Sync now" always re-scans the
whole source (correct — append() dedupes by hash — just not efficient
for a large mailbox or export). iMessage and IMAP onboarding are wired
identically but only unit-tested (real chat.db / IMAP server access
isn't available in this environment); Android SMS is the one path
verified through a real e2e run.

## 7. ~~Settings UI for boundaries and tagged phrases~~ DONE 2026-09-23

Built in two parts. First, `triage/view.ts` was wired to actually run
`score/signals.ts`'s `StructuralSignalDetector` (all six detectors, not
just the two that need user input) across every vault message once per
list render, grouping fired signals by thread — a thread reaches
"medium" from a fired signal now, not just a toxicity score, and
`TriageRow.signalDetails` carries the human-readable reason. Second, a
real screen (`renderer/screens/boundaries.ts`, reached from Settings)
to author the boundaries and tagged phrases those detectors need,
stored in the vault via a new `UserContextStore`. Triage rows show the
fired reason as visible text, not a hover-only tooltip.

Verified end to end: tagging a phrase moves a real seeded message from
no badge to Medium with the reason shown, and removing the tag reverts
it (`test/e2e/boundaries-and-tagged-phrases.spec.ts`).

Surfaced a real bug along the way, since fixed: `.list-block` (used by
five other screens too — Settings sources, onboarding's candidate
picker, OSINT eligibility, export history, support resources) could
collapse to 0 height and silently swallow clicks on its rows, per a
non-obvious flexbox spec interaction with `overflow: hidden`. See the
fix's commit message and the comment on `.list-block` in `app.css` for
the mechanism — nothing about it was visible in a screenshot's text
content, only in an actual click landing somewhere else.

## 8. ~~Deeper e2e coverage with seeded vault data~~ DONE 2026-09-23

`test/e2e/lock-and-triage.spec.ts` covers first-run/unlock/lock-screen
flows against an empty vault. `test/e2e/onboarding.spec.ts` (added
2026-09-23) sidesteps the seeding problem entirely by seeding through
the app's own onboarding UI (an Android SMS export file) rather than
reaching into the vault directly from the test process — the ABI
mismatch this item originally worried about (the Playwright runner is
plain Node; the launched app is Electron's Node) never comes up,
because the test never touches better-sqlite3 itself.

`test/e2e/triage-keyboard-nav.spec.ts` (added 2026-09-23, alongside
item 4) closes the remaining gap: mark reviewed / hide against real
seeded messages, and bucket counts updating in response, are now
covered. ELECTRON_RUN_AS_NODE seeding turned out to be unnecessary
for this class of coverage entirely.

## 9. ~~Renderer isn't covered by the shared lint/typecheck-in-eslint setup~~ DONE 2026-09-23

`eslint.config.js` now has a second config block scoped to `renderer/**/*.ts`,
pointed at `renderer/tsconfig.json` (its own project, since it targets the
browser — DOM lib, ES module output — and can't share `tsconfig.eslint.json`
with src/test's Node/CommonJS project). `npm run lint` now runs `eslint src
test renderer`. Lint is clean except one expected warning (`no-console` on
the deliberate main-process-only log line in `vault-session.ts`).

## 10. ~~No client-side validation on onboarding connect forms~~ DONE 2026-09-23

Scan is now disabled until each source's required fields are filled in:
`dbPath` for iMessage (starts enabled — a real default path is pre-filled),
`exportFilePath` for Android SMS, and host/user/app-password for IMAP
(port, mailbox, and the secure toggle all have working defaults already).
Checked reactively on every keystroke via a `revalidate()` closure that
updates the Scan button directly, without a full re-render — the existing
fields already mutate state without redrawing to avoid losing focus
mid-type, so this follows the same pattern rather than introducing a new one.

This retired the e2e test that used to cover connectImap()'s own
defensive error for an all-blank submission, since that path isn't
reachable through the UI anymore — replaced with tests asserting the
disabled/enabled transitions themselves
(`test/e2e/onboarding-error-handling.spec.ts`).

Found during a /qa pass (2026-09-23) testing what happens when a form is
submitted empty; the sweep-then-scan flow always had this gap, it just
hadn't been exercised end to end before.

## 11. ~~Onboarding/settings showed raw Electron IPC error text~~ DONE 2026-09-23

Found during the same /qa pass: a bad chat.db path, or an IMAP scan with
blank fields, showed Electron's own wrapper verbatim ("Error invoking
remote method 'onboarding:sweepImessage': TypeError: ...") or a bare
"Error: " prefix. `renderer/dom.ts`'s `ipcErrorMessage()` strips both;
used in onboarding's scan/connect error handling and settings' sync-now
failure toast. Verified via `test/e2e/onboarding-error-handling.spec.ts`
— couldn't unit-test the helper directly since importing anything from
`renderer/` into `test/unit/` pulls it into `tsconfig.eslint.json`'s
program, which has no DOM lib.

## 12. ~~Some full-width buttons look heavier than intended~~ DONE 2026-09-24

"Lock now" (Settings), "Add boundary" / "Add tagged phrase" (Boundaries
screen) stretch to the full width of their container because they're
direct children of a `flex-direction: column` form wrapper with the
default `align-items: stretch` — same mechanism as the primary "Export
to file…" CTA, which is intentionally full-width, but these read as
heavier than a secondary action probably should. Purely cosmetic, found
during the same /qa pass; not fixed here since it's a judgment call
about which buttons should read as primary vs. secondary, not a bug.

Fixed with a `.btn--inline` modifier (`align-self: flex-start`) on "Lock
now", "Add boundary", and "Add tagged phrase", also used by the new OSINT
buttons. A screenshot then showed "Lock now" with its bottom edge
clipped: the Settings pane scrolls, and flex shrinks items once the
content is taller than the window — the same mechanism as the
`.list-block` note in `app.css`. `.btn--inline` also sets
`flex-shrink: 0`.

## 13. ~~Packaged releases~~ DONE 2026-09-23

Built with electron-builder: `npm run dist:mac/win/linux` locally, or
`.github/workflows/release.yml` on any `vX.Y.Z` tag push, which builds all
three on their native runners and attaches the artifacts to a matching
GitHub Release. Verified locally end to end on macOS — built a real `.dmg`,
installed the unpacked `.app`, and confirmed it launches without the
Electron ABI mismatch README already warns about (electron-builder's
`npmRebuild` step handles the better-sqlite3 rebuild automatically, same
as `npm start`'s own `prestart` hook).

Two real decisions, not defaults:
- **Unsigned.** Neither an Apple Developer ID nor a Windows code-signing
  certificate exists for this project, and both cost money someone would
  have to commit to. Shipping unsigned means a real, one-time Gatekeeper/
  SmartScreen warning on first launch instead of a silent block — annoying
  but honest, and documented in the README rather than hidden. Signing can
  be added later without changing anything else in the build config.
- **Product name "Notes."** D5's neutral-name-and-icon requirement finally
  has somewhere to attach: `package.json`'s `build.productName` is what
  Electron actually names the installed app (Applications folder, Dock,
  Start menu, `~/Library/Application Support/<name>` for the vault path)
  — not the internal `antistalker` package name, which only ever showed up
  in dev. The icon (`build/icon.svg`, rendered to `.icns`/`.ico`/`.png` via
  `qlmanage`'s QuickLook thumbnailer — no image-generation tool was needed)
  reuses the same page-with-lines glyph already on the marketing site.

Found and fixed along the way: electron-builder's default `files` handling
bundles `onnxruntime-node`'s prebuilt native binary for every platform
(darwin/linux/win32) into every build, not just the target one — an
easy-to-miss size bloat specific to packages that ship prebuilt binaries
per-platform. Fixed with a `files` exclude scoped to each of `mac`/`win`/
`linux` in the electron-builder config, verified locally by confirming only
the darwin `.node` file survived in a macOS `--dir` build's
`app.asar.unpacked`.

Left open: mac builds are single-arch (whatever `macos-latest`'s runner is
— currently Apple Silicon), not a universal binary; cross-arch/universal
support would need both `better-sqlite3` and `onnxruntime-node` rebuilt for
both architectures, which needs actual CI verification, not just local
guesswork on one machine's arch.

## 14. ~~Cross-platform test coverage~~ DONE 2026-09-24

Prompted by a request to make the app "work across multiple devices and
platforms." A `/plan-eng-review` pass split that into two questions:
whether "multiple devices" meant syncing one vault across machines a
person owns (it doesn't — that's a real, unscoped architecture project
that conflicts with the no-cloud/no-account design and wasn't what was
being asked for) versus just making sure the app genuinely works on
whichever OS someone has (it does, mostly, but nothing had ever verified
that beyond assumption). Landed on the second, narrower reading.

Added `.github/workflows/test.yml`: typecheck, lint, unit, and e2e (via
`xvfb-run` on Linux, since Electron needs a display server even for CI)
across macos-latest/windows-latest/ubuntu-latest, on every push to main
and every PR — separate from `release.yml`, which only builds and
publishes installers and never ran the test suite at all.

Auditing the codebase for platform-specific risk before trusting that CI
surfaced two real, pre-existing bugs, both fixed here rather than just
flagged:

- **The iMessage onboarding form's pre-filled default path never
  worked.** `~/Library/Messages/chat.db` was never expanded — Node/
  Electron don't do shell-style `~` expansion, and there's no shell
  between a text field and `better-sqlite3`'s `new Database()`. Verified
  directly: `path.resolve("~/Library/Messages/chat.db")` from this repo
  returns `<cwd>/~/Library/Messages/chat.db`. Clicking Scan with the
  untouched default always failed with "no such file or directory," on
  every install — the existing e2e test only checked the Scan button's
  enabled/disabled state, never actually clicked Scan on the unedited
  default. Fixed with a new `expandHome()` in `src/main/paths.ts`, called
  at the two points a raw `dbPath` enters the main process
  (`onboarding.ts`'s `sweepImessage`/`connectImessage`); unit-tested
  directly since it's a plain function with no Electron/DOM dependency.
- **The panic-hide hotkey's registration failure was silently
  swallowed.** `globalShortcut.register()`'s boolean return (whether the
  OS actually granted the shortcut) was discarded. This is a documented
  weak spot on Linux under Wayland, and can fail on any OS if another app
  already owns the key combo — and DESIGN.md calls this hotkey "the
  actual first line of defense." Fixed by threading the boolean through
  `registerHandlers` to a new `support:hotkeyStatus` IPC channel (not
  vault-gated, since Support is reachable pre-passphrase), surfaced as a
  plain status line on the Support screen — the same screen that already
  explains this hotkey and the no-coerced-unlock decision, rather than a
  toast that could be seen over someone's shoulder. Verified end to end
  in `test/e2e/lock-and-triage.spec.ts`.

Left open: mac/Windows/Linux binaries in CI build for whatever
architecture each GitHub-hosted runner uses (currently arm64 for
macos-latest) — same single-arch caveat item 13 already logged.

**Addendum, same day:** ran an outside-voice review (`codex`) against
this change before calling it done. Real findings, all fixed:

- The Support screen awaited the hotkey-status IPC call before building
  any DOM at all — a rejected or slow call would have meant the crisis
  hotline numbers, the most safety-critical content on that screen,
  never rendered. Fixed: static content mounts immediately, the status
  line is patched in once the call resolves (or silently dropped if it
  doesn't).
- The first real run of the new CI matrix (not a hypothetical — this
  actually happened) failed on windows-latest with `EBUSY` unlinking
  `vault.db` during test teardown. Root cause: `sqlite-store.test.ts`
  opened two ad-hoc inline `new Database(dbPath, { readonly: true })`
  handles to inspect table contents directly and never closed them —
  invisible on macOS/Linux, where deleting a file with an open handle is
  allowed, fatal on Windows, where it isn't. Fixed both, plus added a
  shared `removeTestDir()` helper (`test/helpers/tmp-dir.ts`, used by
  all 19 test files with this teardown shape) with a modest retry budget
  as defense-in-depth for the separate, genuinely transient case
  (antivirus scanning a just-written file, the most commonly reported
  cause of this exact flake on GitHub-hosted Windows runners).
- `release.yml` published installers on any tag without checking whether
  that commit's tests actually passed anywhere. Fixed: `test.yml` is now
  also `workflow_call`-triggered, and `release.yml`'s build job `needs`
  it — a tag only produces a release once the full cross-platform suite
  is green on that exact commit.
- Two documentation-accuracy issues caught in the same pass: the test
  plan claimed `~\...` (Windows-style) path expansion was unit-tested
  when it wasn't yet (fixed by adding the test), and a CI comment
  implied iMessage's tests were OS-conditional when they're actually
  pure, OS-agnostic byte-parsing tests that run identically everywhere
  (comment corrected, not the tests — they were never wrong).

**Confirmed and fixed, same day:** once the `EBUSY` fix let the Windows
CI leg actually reach e2e, real data came back: `CommandOrControl+Shift+
Escape` does NOT register on windows-latest — exactly the collision
Codex flagged (it's Windows' own reserved Task Manager shortcut), not a
hypothetical. `main/index.ts`'s `PANIC_HOTKEY` is now
platform-conditional: `Cmd+Shift+Escape` stays on macOS (free there),
everywhere else gets `Control+Shift+Alt+H` — deliberately not a bare
Ctrl+Alt combo, which Electron's own docs warn maps to AltGr on several
European keyboard layouts. The Support screen shows whichever combo
actually registered (via a new `HotkeyStatus { registered, label }`
returned by `support:hotkeyStatus`, computed in main so the label can
never drift from what was actually registered) instead of a hardcoded
string, and says so plainly either way.
`test/e2e/lock-and-triage.spec.ts`'s assertion accepts either outcome —
it tests that the wiring renders a status at all, not which way a given
OS resolves the registration attempt, since that's genuinely
OS-dependent and the point of the fix is handling both gracefully.
Not independently verified that `Control+Shift+Alt+H` itself is
collision-free on every real Windows machine — only that it isn't one
of the well-known OS-reserved combos, which is what actually broke.

## 15. ~~Instagram DM export adapter~~ DONE 2026-09-24

A new `src/ingest/instagram/` adapter (mirroring android-sms's shape:
adapter.ts + metadata-sweep.ts + reader.ts) parsing the JSON export from
Instagram's "Download Your Information" tool
(`your_instagram_activity/messages/inbox/<person>/message_1.json`).
Closes a real, named harassment vector nothing in the app covers today,
using an export path that needs no live API/OAuth — consistent with D3/
D8's no-live-platform-API stance. Instagram gives personal accounts no
DM-reading API at all; the export is the only legitimate path in.

Two real caveats to design around, not just implement around: deleted/
unsent messages are NOT in the export (unlike the app's iMessage
WAL-recovery flagship feature — onboarding copy needs to say so, not
imply parity), and Meta's own export can take up to 30 days to prepare
with a 4-day download window, which rules out a "click Scan and go" flow
like Android SMS's.

Deferred 2026-09-24 (`/plan-eng-review`): scoped and researched, not
built — "social media, payment apps, email, and others" as one plan was
3-4 new adapters at once, which is exactly the complexity this kind of
review is supposed to catch before it starts. No dependency on any other
open item.

**Built later the same day**, as one adapter on its own rather than
bundled with 16/17: `reader.ts` + `metadata-sweep.ts` + `adapter.ts`,
plus `blocked.ts` for the export's own block list (feeds item 19).
Reads `inbox/` and `message_requests/` (harassers who aren't followed
land in requests), both the current `your_instagram_activity/messages/`
layout and the older `messages/` one. Details that needed real handling:

- Meta writes every string as UTF-8 bytes escaped one byte per
  character; `decodeMetaString` undoes it, and leaves a string alone if
  it can't be that.
- Senders are display names, not usernames. The one-to-one thread
  folder name is kept as an alias, so an Instagram block list username
  can still match the sender in onboarding.
- The owner comes from `personal_information.json`; without it, from the
  one name common to every thread (two threads minimum). With neither,
  the scan fails with a message that says what to include in the
  export, rather than guessing and attributing the user's own messages
  to someone else.
- A media-only message and a thread file that isn't valid JSON are
  quarantined with a reason, not skipped. An HTML-format export gets its
  own error message that says to request JSON.
- Message ids come from the raw record's hash, so re-importing the same
  (or a newer) export adds nothing twice.
- Only selected senders' messages plus the owner's replies in those
  threads are imported — never other people in a group thread.

The onboarding copy says plainly that unsent and deleted messages are
not in the export. Verified by 16 unit tests (`test/unit/instagram/`),
an orchestration test against a real vault (`onboarding.test.ts`), and
`test/e2e/instagram-onboarding.spec.ts`.

## 16. Payment-app (Venmo/PayPal/Cash App) transaction-note adapter

A new ingest adapter parsing the CSV/statement export these apps already
offer, extracting the public transaction-note field as message-like
content — financial harassment via payment notes (threats sent disguised
as small payment memos) is a real, documented DV-tech-abuse pattern nothing
in the app covers, and distinct from every existing vector, which are all
conversational. None of the three expose a harassment-relevant API; all
three support CSV/statement export instead, matching the existing
"parse a file the user exported" pattern (Venmo's own CSV export caps at
90 days, PayPal's at 3 months, though Venmo's separate "Request Your
Data" full export has no such cap).

Real open question, not just an ingest question: a transaction note is a
few words, not a conversation, so it needs its own presentation in
triage rather than being shoehorned into the existing thread view as-is.
Whoever picks this up should treat that as a small design pass, not an
implementation detail.

Deferred 2026-09-24 (`/plan-eng-review`), same reasoning as item 15.

## 17. Manual encrypted vault-to-vault transfer (multi-device use)

D1 (this same review) framed "multiple devices" as a binary — cross-
platform (built) vs. full live vault sync (rejected, conflicts with
no-cloud/no-account) — and an outside-voice review (Codex) correctly
called that framing too narrow: a manual, user-initiated, encrypted
export/import between someone's own devices needs no network and no
third party ever touches it, so it doesn't compromise local-first at
all. Scoped here, not built.

**What already exists and isn't reusable as-is:** `src/vault/export.ts`
sounds like the same thing but isn't — it's an unencrypted, human-
readable JSON export for handing to a lawyer or police, missing raw
records/edit history/retraction data, never meant to be read back into
a vault. This needs a genuinely separate mechanism.

**Scope of what transfers** (a vault is five stores, see `vault.ts`):
`store` (messages, raw records, quarantine), `userContext` (boundaries/
tagged phrases), `integrityLog`, and `triageState` (hide/reviewed
flags) all transfer — together they're what makes device B's copy
actually usable and consistent with device A's. `sourceConfig` and
`credentials` do NOT transfer: `sourceConfig` holds device-A-specific
paths (`~/Library/Messages/chat.db` means nothing on a different OS or
even a different macOS user account) and `credentials` holds a live
IMAP app password that a portable file doesn't need to carry — device B
reconnects its own sources through the normal onboarding flow.

**Transfer file encryption:** a separate, one-time transfer passphrase
set at export and entered at import — not the vault's own passphrase.
A portable file (USB stick, briefly in a Downloads folder) is more
exposed than the vault's own on-disk file, which never leaves the
device; reusing the real passphrase would make the transfer file a
second copy of the master key. Reuses the existing `ScryptGcmVaultCrypto`
(crypto.ts) keyed by the transfer passphrase instead of a new algorithm,
and the existing create/unlock passphrase UI pattern instead of new UX.

**Architecture: model import as an ingest adapter, not a bespoke merge.**
`store.append()` already dedupes by raw-record hash (tested:
"re-appending the same raw record hash is a no-op, not an overwrite or
an error") — the exact idempotency a device-to-device transfer needs
(importing the same file twice, or two devices that both grew
independently and get cross-imported, should both be safe). A new
`src/ingest/vault-transfer/` adapter (adapter.ts + metadata-sweep.ts +
reader.ts, same three-file shape as android-sms/imap) that decrypts the
transfer file and runs through the existing `runIngest`/`append()`
pipeline gets this for free, rather than writing new merge logic from
scratch.

**Export UX: no sender/thread picker**, unlike onboarding's external-
source picker. That picker exists to let someone vet a stranger's data
(an export from IMAP or Android SMS) before any of it enters the vault;
here the source is the user's own already-vetted vault, so gating it
behind a picker would just be friction with no corresponding safety
benefit. Export is all-or-nothing.

**Left open, real design questions for whoever builds this:**
- Where this lives in the UI — Settings, next to source management and
  "Lock now," is the natural fit, but not decided.
- Whether merging two independently-grown `integrityLog`s needs special
  handling for hash-chain continuity, or whether each device's log can
  just stay logically separate per-origin. Not analyzed here.
- File extension / format naming (something like `.atsxfer`) — cosmetic,
  not decided.

Deferred 2026-09-24 (`/plan-eng-review`, extended after outside-voice
review reopened D1's scope narrowing).

## 18. ~~OSINT collector: verify-mode~~ DONE 2026-09-24

The first real OSINT collector work since D6/D7/D22 were decided —
`osint:rank` had always returned `rankCandidates([])`, an honest empty
state, since no collector existed. Before writing any collector code, the
core architecture decision got its own explicit pass: **search-mode**
(given a raw identifier from a vault message, go find where else it
appears — the same shape as a people-search site or a tool like Sherlock)
versus **verify-mode** (the user names a candidate they already suspect;
the app only checks whether vault-held signals support that one
hypothesis). Went with verify-mode — search-mode is real deanonymization-
tool architecture with a vault-gate bolted in front of it, and the gate
restricts who can trigger it, not what it's capable of finding once
triggered (D22's own comment already says as much: the gate "cannot
distinguish a genuine abuser from someone who" isn't).

**What shipped**, all four of graph.ts's non-photo signal kinds, all
zero-network-call, pure local correlation against vault data:

- `src/osint/candidate-input.ts` — what a human supplies (a label plus
  optional username/email/phone/writing sample), never fetched or
  searched on their behalf.
- `src/osint/signals/identifier-reuse.ts` — checks a candidate's
  username/email/phone against the sender's own identifier (0.9
  confidence) or against text the sender actually wrote (0.7) — never
  against any external source.
- `src/osint/signals/writing-style.ts` — coarse, explainable stylometry
  (sentence length, word length, function-word frequency, cosine
  similarity), capped at 0.6 confidence so it can never look as certain
  as a direct identifier match, and returns nothing rather than a
  false-confident score under a 40-word minimum on either side.
- `src/osint/verify.ts` — orchestrates one `CandidateInput` into a scored
  `Candidate`, checking only the fields the user actually filled in.
- `osint:checkCandidate` replaces `osint:rank`: still the only
  `registerGated` channel, still refuses a sender who hasn't crossed the
  abuse threshold, now actually does something when it doesn't refuse.

**Bug found and fixed along the way**: `rankCandidates()` divided by
`candidate.signals.length` with no guard — `0/0 = NaN` for any candidate
with zero matching signals. This was always latently present but
unreachable while every candidate list was `[]`; verify-mode makes "the
user's hypothesis wasn't supported by anything" a real, ordinary, expected
outcome, not an edge case. Fixed to score 0, with its own test.

**UI**: `renderer/screens/osint.ts` rewritten from the unlock-then-see-an-
empty-list flow to a form (name a candidate, optionally give an
identifier or paste a writing sample, Check) with results accumulating
and re-sorting client-side, each one showing its actual supporting
signals inline — never a bare percentage. The mockup's "generates
internet traffic" indicator was removed from this flow rather than kept
for consistency: showing it here would mean claiming network activity
that verify-mode never has, which is the opposite of the earlier
panic-hotkey and vault-export fixes' whole point (say plainly what a
mechanism actually does).

**Verified**: 20 new unit tests (`osint-identifier-reuse.test.ts`,
`osint-writing-style.test.ts`, `osint-verify.test.ts`, plus 2 added to
`osint-rank.test.ts` for the NaN fix) plus a new integration test
(`osint-verify-integration.test.ts`) against a real `SqliteVaultStore`,
same pattern as `osint-gate-integration.test.ts` — seeds a message with
an explicit classification override, since there's no real ONNX model in
this environment to naturally cross the abuse threshold, the same
disclosed gap the OSINT unlocked-state UI already had. A locked-state e2e
test (`osint-verify.spec.ts`) covers what's reachable through the real
app without a classifier; the unlocked verify-mode flow was hand-verified
live against a running dev instance instead (its own database's
`crosses_abuse_threshold` flag flipped directly — an unencrypted metadata
column — to reach eligibility, since nothing in the app itself can set
that flag without a real classifier).

**Deliberately not built, still a separate future decision**:
`profile-photo-match` — the one signal kind in graph.ts's model this pass
didn't touch. Doing it for real means either fetching/hosting images (a
real network surface verify-mode's other four signals don't have) or
actual facial recognition, which is legally restricted outright in
several jurisdictions (Illinois BIPA, the EU AI Act's biometric rules,
multiple city-level bans) — the single most doxxing-coded capability on
the list, and not something that should ride along on the back of the
four safe, local-only ones that just shipped.

## 19. ~~Known accounts: blocked contacts as the OSINT baseline~~ DONE 2026-09-24

The person harassing someone is usually already known and already
blocked; what the user doesn't know is whether a new number or account
is the same person again. Verify-mode (item 18) needed the user to type
a candidate in by hand every time. This gives OSINT a standing list to
compare against instead.

- `src/vault/known-accounts.ts` — a vault table of accounts (phone,
  email, or username) with a person label and an origin (manual, macOS
  block list, Instagram block list). Unique per normalized value, so the
  same number typed three ways is one row; a re-import never overwrites
  a label the user set.
- `src/ingest/blocklist/macos-blocklist.ts` — reads
  `~/Library/Preferences/com.apple.cmfsyncagent.plist`, the Messages/
  FaceTime block list (iCloud-synced, so usually the iPhone's too).
  Read-only. Entries that are neither a phone number nor an email are
  counted and reported, not dropped. Checked against the real file on
  the development Mac (entry counts only, no values printed).
  `DOCKET_MACOS_BLOCKLIST_PATH` points e2e tests at a fixture.
- Onboarding marks every scanned sender that is on the Mac block list,
  the Instagram export's block list, or already a known account; lists
  them first; pre-selects them; and offers to save the selected blocked
  senders as known accounts (on by default, one checkbox). A block list
  that can't be read never stops an import — the reason is shown.
- `src/osint/known-accounts.ts` + gated `osint:compareKnownAccounts` —
  one lead per person: identifier reuse for each of their accounts, and
  writing style against that person's own vault messages (their history
  from before the block), never the sender's own messages.
- Phone numbers now match across formats in every identifier check
  ("(555) 123-4567" vs "+15551234567"), with a 7-digit minimum so a
  street number can't match.

Import is one person per block-list entry, on purpose: a block list is
mostly spam, and merging entries into people is a judgment only the user
can make (by giving accounts the same person name).

Left open: the compare tool is still behind the abuse-threshold gate,
same as item 18. A blocked person writing from a new number often opens
with something that isn't toxic ("hey, it's me"), so the gate can keep
the one sender the user most wants compared locked until a later
message crosses the threshold. Loosening the gate for senders who match
a known account's writing or identifiers is a real option, but it's a
change to D22 and should be its own decision.

Verified: 12 known-accounts store tests, 7 block-list reader tests, 9 onboarding
annotation tests, 5 comparison tests, 4 new phone-matching tests, plus
`test/e2e/known-accounts.spec.ts` (onboarding path macOS-only; the
add/relabel/remove path on every OS). The compare flow was checked by
hand against a built app with the abuse flag set directly in a scratch
vault (no classifier model in this environment): the new number scored
65% for the blocked person, from a phone mention (70%) and writing style
(60%).

## 20. ~~Local calendar dates with strictdatetime~~ DONE 2026-09-24

Added `strictdatetime` (1.3.0) behind a small main-process wrapper,
`src/time/local-time.ts`. It's used only where docket needs a person's
local calendar; plain instants still use `Date`. The renderer has no
bundler, so it sends "YYYY-MM-DD" strings and the main process does the
time-zone work.

- **Boundary dates were wrong west of UTC (evidence bug).** The form did
  `new Date("2026-09-24")`, which is UTC midnight: 8 PM on Sep 23 in New
  York. The boundary showed as "9/23", and a message sent at 9 PM on Sep
  23 was flagged "sent after boundary". Reproduced with `TZ=America/
  New_York`. Boundaries now start at local midnight (`startOfLocalDay`),
  and the store keeps the picked date and zone (`set_on`, `time_zone`).
  Rows the old form wrote (exactly UTC midnight, no `set_on`) are
  repaired once when the vault opens. The form's default date was also
  the UTC date (already tomorrow on a US evening) and now is the local
  date.
- **Evidence export** writes `sentAtLocal`
  ("2026-09-23T21:00:00.000-04:00[America/New_York]") next to the UTC
  `sentAt`, plus the export's `timeZone`.
- **OSINT** dates a match by the local day, not the UTC day.
- **IMAP** (not strictdatetime, found while auditing dates): a message
  with no `Date` header was dated at import time, and so was one whose
  header mailparser couldn't read — mailparser returns the current time
  in that case. Both are now quarantined with the reason.
- CI moved from Node 20 (end of life April 2026) to Node 22.

Checked in a packaged macOS build: the module loads from `app.asar` and
gives the right answer on Electron's Node 20.18.

Issues filed on strictdatetime while integrating:
[#2](https://github.com/erikleon/strictdatetime/issues/2) (bug: unit
boundaries follow `disambiguation`, so "earlier"/"later" can put an
instant in the wrong day; docket uses "compatible", the one policy that's
right in both directions),
[#3](https://github.com/erikleon/strictdatetime/issues/3) (start of a
PlainDate in a zone),
[#4](https://github.com/erikleon/strictdatetime/issues/4) (date part of
a PlainDateTime),
[#5](https://github.com/erikleon/strictdatetime/issues/5) (strict RFC
5322 date parser, which would replace the IMAP `Date.parse` fallback).

## 21. ~~Upgrade Electron off Node 20~~ DONE 2026-09-24

Electron 33 ships Node 20.18, which reached end of life in April 2026.
strictdatetime declares `node >=22`; it works on 20.18 (tested), but
that's outside its supported range. A current Electron (Node 22 or
later) fixes both. Needs `better-sqlite3` and `onnxruntime-node`
rebuilt and the full e2e suite on all three CI runners, so it's its own
change.

Also seen during this work: `crypto.test.ts`'s timing test ("wrong
passphrase and a corrupted canary take roughly the same time") failed
once under full parallel load and passed 3/3 alone. It compares two
wall-clock durations, so it's load-sensitive.

**Done the same day.** Electron 33 → 44.4.5 (Node 24.21, Chromium 152),
better-sqlite3 11 → 13.0.3. better-sqlite3 13 is the first N-API release,
so one prebuilt binary now loads in both plain Node and Electron: the
`rebuild:node` / `rebuild:electron` scripts, their `pre*` hooks, and
`@electron/rebuild` are gone, and so is the old failure where every
unlock said "That passphrase didn't work" after running the wrong one.
CI runs on Node 24 to match Electron. All three CI runners green.

Found while checking the upgrade:

- **The installers shipped the whole repository**, including `.git`,
  `src/`, `test/`, `qa-reports/`, TODOS.md and DESIGN.md. A platform's
  `files` list in electron-builder replaces the top-level list rather
  than merging with it, so the per-platform onnxruntime excludes added in
  item 13 silently dropped every shared exclude. For an app that installs
  as "Notes" to stay unnoticed, the design docs inside it said exactly
  what it is. The config moved to `electron-builder.cjs`, where each
  platform list is built from one shared base, and `npmRebuild` is off
  (both native modules are N-API). The macOS app went from 721 MB to
  388 MB; `app.asar` from 334 MB to 11 MB. No release had been published,
  so no public installer contained any of it.
- **No Content-Security-Policy in the renderer** (Electron's own warning).
  Added, plus a navigation and new-window block in the main window. See
  DESIGN.md.
- **The window title and lock screen said "Ledger"** while the installed
  app is named "Notes". Now "Notes" everywhere.
- The scrypt timing test failed about one run in two under full parallel
  load. It now takes the fastest of three interleaved runs per path; a
  path that skipped scrypt would still fail it by a factor of about 100.

## 22. ~~Incident log~~ DONE 2026-09-24

See DESIGN.md "Incident log". `src/vault/incident-log.ts` (append-only,
encrypted text and "involving", revisions never overwritten),
`src/time/local-time.ts`'s `resolveLocalDateTime` (ok / ambiguous /
nonexistent / invalid, never shifting a time on its own),
`renderer/screens/incident-log.ts`, and the export's `incidentLog`
section with its own disclosure. minisiwyg-editor 0.6.0 is copied into
`dist/ui/vendor/` at build time (the renderer has no bundler; the file has
no imports of its own) and typed through `renderer/vendor/`.

Verified: 9 store tests, 5 new time-resolution tests, an export test, and
`test/e2e/incident-log.spec.ts` (ambiguous time → choice → save →
update → history; skipped time refused; pasted `<img onerror>`,
`javascript:` link, and `<script>` all removed with the text kept, and
the payload never ran). The two clock-change e2e tests run with
`TZ=America/New_York` and skip on Windows, which ignores `TZ`.

Found in minisiwyg-editor while integrating (not filed; see below):
- Bold, italic, and underline do nothing with no text selected
  (`src/editor.ts`, `if (range.collapsed) return;`), so "click Bold, then
  type" leaves the typed text plain. Most editors turn the style on for
  the next typed text.
- `createEditor` throws unless its element is already in the page. The
  error is clear, but the README doesn't mention it; docket's screen
  builds each view detached, so it has to start the editor after
  mounting.

Filed on strictdatetime:
[#6](https://github.com/erikleon/strictdatetime/issues/6) — plain time
parsers reject "HH:MM", the format a datetime-local input produces.


## 23. ~~Ship a toxicity model~~ DONE 2026-09-25

Before this, no model shipped: no message was ever scored, no sender ever
crossed the abuse threshold, and OSINT could never unlock for a real
user.

- **Model:** `minuva/MiniLMv2-toxic-jigsaw-onnx` (Apache-2.0, 23 MB
  quantized, distilled from `unitary/toxic-bert`, ROC-AUC 0.9860 vs the
  teacher's 0.9864 on Jigsaw). Six independent labels including
  "threat". Pinned by revision and SHA-256 in `models/toxicity.json`;
  `scripts/fetch-model.mjs` downloads it for development and CI (cached
  by the manifest's hash); installers bundle it as an extra resource, and
  the app checks every file's hash before loading.
- **Tokenizer:** Hugging Face's own `@huggingface/tokenizers` (Apache-2.0,
  no dependencies) reading the model's `tokenizer.json`; checked against
  reference token ids. It ignores the 512-token limit, so the classifier
  scores long text in windows, plus each sentence alone — a threat at the
  end of a long, calm email scored under the threshold inside a window of
  ordinary text.
- **Calibration found on real examples:** raw "toxic" fires on swearing
  alone ("lol fuck yes, see you there" 0.98), which would have flagged
  friends and opened OSINT on them. "toxic" now counts only as
  toxic × (1 − obscene); threat and insult are unchanged. Friendly
  swearing drops to 0.06–0.24; "you better watch your back tonight"
  stays Medium. Polite coercion ("I know where you're staying now")
  scores near zero — a documented limit, covered by the structural
  signals.
- **Scores are stored apart from evidence** (`message_scores`, written
  only by `vault/message-scores.ts`), so `sqlite-store.ts` keeps its
  enforced no-UPDATE rule. A background pass scores anything the current
  model hasn't, after unlock and after each import; a model change
  rescores everything. The user's own messages are never scored, and
  `isAbusiveSender` now ignores them: on Android SMS a sent message's
  `sender` is the other person's number, so an angry reply would have
  marked them abusive.
- Verified: 19 real-model unit tests, scoring-pass and service tests,
  `test/e2e/toxicity-model.spec.ts` (an imported threat → High with the
  model's reason → OSINT opens; a friend's swearing doesn't), and a
  packaged macOS build scoring with the bundled model.

Now reachable in practice, worth watching: `detectNewCorrelatedIdentifiers`
marks any sender whose first message arrives within 72 hours after a
known-abusive sender's last one as Medium ("unverified correlation"). With
no model it never fired; with one, it will flag some innocent new
contacts. The window was never tuned.

## 24. ~~OSINT online checks: link safety and username presence~~ DONE 2026-09-25

See DESIGN.md "Online checks". `src/osint/network/` (`http.ts`,
`link-safety.ts`, `username-presence.ts`), five gated IPC channels, and
the "Online checks" section at the end of the unlocked OSINT screen.
Verified with 15 unit tests on a fake network (including that no
message link is ever requested and a failed list download is reported,
not hidden), `test/e2e/osint-online.spec.ts` (offline part only), and a
live run: a Grabify link flagged by the built-in list and both downloaded
lists, a bit.ly link flagged only as a short link, all five lists
downloaded, all 19 sites answered.

Open: docket has no license file. The downloaded IP-logger lists are GPL,
which is one reason they're downloaded rather than copied in; choosing a
license for docket itself is the owner's call.

## 25. ~~WhatsMyName username check~~ DONE 2026-09-26

Reviewed with /plan-eng-review plus an outside review (Codex). Plan:
`~/.claude/plans/2026-09-26-whatsmyname.md`. Replaces the 19 hand rules
in `username-presence.ts` with the pinned, bundled, verified WhatsMyName
dataset; major platforms by default, a separate "check all" sweep with
adaptive concurrency; sensitive categories opt-in; a weekly verification
job and a remove-only skip list. Test plan:
`qa-reports/test-plan-whatsmyname-2026-09-25.md`.

**Built the same day.** `scripts/fetch-assets.mjs` (every manifest in
`models/`, strictly validated: two allowed sources, full commit hashes,
plain file names, size limits); `src/osint/network/whatsmyname.ts` (load,
validate, build requests, classify like the upstream checker);
`verify-rules.ts` + `scripts/verify-whatsmyname.mjs`;
`username-check.ts` (tier selection, remote skip list, adaptive
scheduler); `src/main/username-check-service.ts` (one check at a time,
progress events, Stop, stops when the vault locks); the OSINT screen;
`.github/workflows/whatsmyname-weekly.yml`.

Verification on 2026-09-26: 290 of about 650 rules passed. It dropped
rules that would have lied, e.g. Instagram's rule said `cristiano`
doesn't exist, and X's rule now answers 200 for random handles. 16 of 30
major platforms passed; Instagram, Facebook, X, Snapchat, Reddit, Venmo,
and others are named as "not checked". A live run: the 16 major sites in
0.9 s; the 265-site sweep in 35 s at adaptive speed, 11 "couldn't tell"
(4%). A `--check` run an hour after verification found 2 more rules
failing (a connection error, a bot block): some failures are temporary,
which is why the weekly job opens a pull request for a person to review.

**Found on the first weekly run (from GitHub's servers):** 20 shipped rules
failed there against 2 from a home connection, because many sites block
data-center addresses. Skipping all of them would have turned off sites
that work for users. The weekly check now skips only rules that give
**wrong** answers (every known account reported missing, or a random
name reported found); rules that merely couldn't answer stay, since in
the app they show an honest "couldn't tell". The report lists both
groups separately.

The repository now allows GitHub Actions to create pull requests
(enabled 2026-09-26 at the owner's request). The default workflow token
stays read-only; only the weekly workflow asks for contents and
pull-requests write in its own file. Not yet seen end to end: the last
run found no wrong-answer rules, so it had no pull request to open.

Changes from the plan, found while building:
- **Redirects are never followed.** WhatsMyName's checker doesn't follow
  them and 75 rules read a 3xx status as the answer. Safer, too: a site
  can't move the request anywhere else.
- **The handle may be in the host** as a subdomain of a fixed domain
  (`{account}.tumblr.com`, 22 rules), since the request still can't leave
  that site's domain.
- **"user-agent" protection is allowed**: it only means the site blocks
  non-browser clients, and docket sends a browser identity (GitHub's rule
  has it and passes).
- **A POST rule with no profile page shows no link** instead of its API
  address.

Verified: unit tests for fetch-assets (12), the engine (42), verification
(7), the scheduler (13), and the service (7); `osint-online.spec.ts`
(no network); a packaged macOS build loading the bundled rules.

## 26. Choose a license for docket

docket has no LICENSE file and no `license` in package.json. It already
downloads GPL lists (item 24) and item 25 bundles CC BY-SA data with
attribution. Without its own license, nobody can say what they may do
with docket's code. Options: MIT or Apache-2.0 (permissive), GPL-3.0 or
AGPL-3.0 (copyleft). The owner's decision; nothing blocks it.

## 27. Proxy or Tor mode for OSINT online checks

An optional Settings choice to send every OSINT online request (link
lists, username sites, skip list) through a SOCKS proxy or Tor. Someone
watching the victim's network (shared home Wi-Fi, a family router) can
see which sites a check contacts, and each site sees the victim's IP.
Raised by Codex during item 25's review. The main process can use a
SOCKS agent; Tor needs the tor daemon or Tor Browser running, or a large
bundled tor. Many sites block Tor exits, so more results would read
"couldn't tell". Depends on item 25 (all requests go through
`src/osint/network/http.ts`).

## 28. Impersonation check: fake profiles in the victim's name

A separate check where the victim enters their own name or handle and
looks for accounts pretending to be them, including dating and adult
sites. Fake profiles of the victim are a common harassment pattern, and
it's the real use for the sensitive categories item 25 keeps opt-in; as
a search about the victim, it doesn't expose an innocent stranger. Reuses
item 25's engine; needs its own framing and what to do with a hit
(per-platform report links, saving it to the incident log). Depends on
item 25 and the incident log (item 22).

## 29. Tools left out of the WhatsMyName change, and why

Asked for on 2026-09-25 with WhatsMyName; left out in item 25's review:
- **Sherlock** (MIT, 481 sites): a Python program; its site list
  overlaps WhatsMyName heavily. Adding it means a second rule format to
  parse and deduplicate for a small gain.
- **Epieos**: email/phone lookup (Google account name, reviews, linked
  profiles). API only on paid plans (about €19-49/month); it is the
  email-exposure lookup declined on 2026-09-25. Would need the owner to
  reverse that and a bring-your-own-key design.
- **Social Searcher**: keyword search over public posts. No API on the
  free plan; using the free website from the app would be scraping
  against its terms.
- **Other tools in tools.osintnewsletter.com** (17 categories): each needs
  its own review against the rules this app now follows: never contact
  the person looked up, no login or cookies, no scraping against a site's
  terms, name every recipient before the click.
