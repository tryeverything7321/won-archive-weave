# C03 draft engine implementation notes

## Approved policy

- Storage: the current tab's `sessionStorage`, for at most 24 hours
- Boundary: one key per `ownerId`, form `kind`, and `documentId`
- Logout/account change: the global auth boundary calls `browserDraftStore().reconcileOwner(ownerId | null)` only after Firebase auth has settled
- Files: file bytes, `File`, `Blob`, typed arrays, handles, and tokens are not draft values. A consumer may persist only `fileReselectionRequired: true`
- Browser limitation: no `pagehide` clearing. Reload and OAuth return remain recoverable. A browser's tab-restore feature may restore session storage after closing, so the UI tells shared-device users to log out

## Store API

`draft-store.ts` exports:

- `DraftIdentity`, `DraftEnvelope<T>`, `DraftLoadResult<T>`, `DraftSaveResult`
- `createDraftStore(storage, now)` for tests and injected storage
- `browserDraftStore()` as the shared lazy browser singleton
- `load(identity)`: `ready | missing | expired | corrupt | unavailable`
- `save(identity, revision, value, options)`: `saved` or `error` with `quota | unavailable | invalid | owner_mismatch`
- `remove(identity)` and `clearSavedRevision(identity, revision)`
- `removeOwner(ownerId)`, `reconcileOwner(ownerId | null)`, and `sweepExpired()` with classified cleanup results

`reconcileOwner` advances the active-owner fence even when storage enumeration is unavailable. A stale form therefore cannot recreate the prior owner's draft after logout or account change.

## Hook and submission handshake

`useFormDraft` accepts a consumer-owned `DraftCodec<T>`. The codec must explicitly allowlist the fields for that form; generic JSON validation cannot determine whether an ordinary string contains a provider token or other secret.

Consumers with unresolved authentication or asynchronous edit baselines pass `active: false`. Inactive hooks create no session and do not load, prime, save, or capture. On `false -> true`, the hook loads the settled owner/kind/document identity before enabling persistence. This prevents a signed-out/default value or an unloaded edit value from becoming the new account's draft.

The hook hydrates before enabling persistence and primes a missing form's initial values without storing an empty draft. Real value changes persist synchronously after the React commit, so immediate navigation or reload does not wait for a debounce timer.

Before a server submission, call `capture(nextValue?)` (or `flush(nextValue?)`) and retain its exact successful `revision`. After confirmed server success, call `complete(revision, nextBaseline?)`. Only an exact `cleared` completion updates hook state; `stale`, `missing`, and `unavailable` do not affect a newer/current session. A supplied post-success baseline is primed without creating a recovery record, and persistence remains enabled for subsequent writing. Revisions combine a unique hydration nonce and a monotonic counter to prevent discard/recreate ABA collisions.

`startNew(nextBaseline?)` and `deleteDraft(nextBaseline?)` accept an explicit reset baseline. Consumers that also reset form fields should pass that next value so the reset itself is primed rather than stored as an empty recovery draft.

Both destructive actions return `false` when `sessionStorage.removeItem` fails. The hook then preserves the recovery envelope, reports an unavailable error, and does not reset the consumer form; the recovery panel keeps the destructive action available for an explicit retry. Owner reconciliation likewise returns `unavailable` when any individual removal fails while still advancing the active-owner fence so the stale account cannot write again. Physical browser-storage deletion cannot be guaranteed when the browser denies its storage API, and callers must not present that failure as successful deletion.

Consumers should remount or reset form values when `ownerId`, `kind`, or `documentId` changes. The engine primes the first value seen for a new identity rather than saving the previous identity's value under the new key.

`complete()` acts on the currently mounted session. A consumer with an in-flight remote submission must verify that its owner/document attempt is still current before completing the captured revision. The revision nonce prevents a stale revision from matching a replacement session, but the consumer guard also prevents misleading completion state after an identity switch.

## C04 contribution consumer

`ContributionForm` uses `contribution-draft.ts` as its field allowlist and identity contract:

- identity: authenticated owner, original contribution entry kind, and server submission id or `new`
- value: all text, activity, recipe, source-link, Instagram canonical-link, rights, attribution, redistribution, and visibility fields
- files: no `File`, bytes, hashes, target names, upload reservations, or provider credentials; only the shared `fileReselectionRequired` envelope metadata
- edit readiness: inactive until both the authenticated owner and the server edit baseline are ready
- submission: captures immediately after local validation; a new create also captures its request reservation before the callable starts; completion occurs only after the existing account/form attempt guard and confirmed callable success
- response-loss reservation: strict allowlist of `requestId`, input fingerprint, and the first contribution field snapshot; reload rebuilds the same first server payload and request id, without upload bytes, hashes, targets, or provider credentials
- reset: passes an explicit empty contribution baseline so deletion, discard, and successful new-writing transitions do not create an untouched recovery record

## QC02 withdrawn restoration

The contribution management action `restore_private` uses the existing owner-management callable. It accepts a withdrawn record only and restores the private source record to `draft` with visibility `보류`. It retains withdrawal timestamps, source fields, scan/attachment state, and the prior audit stream; adds one `submission.restored_private_draft` audit event; and records an idempotency marker so a response-loss retry does not add another audit event.

The restore transaction never creates a material/activity projection. If an inconsistent projection exists, it is forced to `unpublished`/`hold`. Text and source-link records retain `not_applicable` attachment state, upload scan evidence remains attachment-only state, and a restored upload cannot satisfy automatic publication because its lifecycle is `draft` and visibility is private. No permanent-delete action or audit deletion is introduced.

## D04 contribution audience selection

New contribution baselines store `visibility: null` and `visibilityExplicit: false`. The prominent, always-expanded audience control must be changed by the user before either the form submit handler or the pure server-payload builder accepts the contribution. The existing meanings remain unchanged: public, authenticated members, or private storage.

Current server documents are loaded with `visibilityExplicit: true`, preserving their stored audience. Current-version browser drafts persist the explicit marker. Older ordinary browser drafts without the marker do not treat their former default value as consent and require selection again. A legacy in-flight create reservation is different: the reservation proves its first payload was already sent, so its stored first audience is retained solely to recover the same request and document; subsequent current edits still use the newly selected audience.

## Recovery UI

`DraftRecoveryPanel` provides:

- continue writing
- confirmed new writing and confirmed deletion
- saving/saved/error/retry status
- unique accessible heading IDs for multiple panels
- truthful 24-hour, logout, browser tab-restore, and file-reselection copy

## Verification boundary

Focused tests cover identity isolation, expiry/sweep, corrupt and oversized records, denied/quota storage, owner fencing, JSON-only values, ABA-safe completion, synchronous navigation persistence, initial baseline, malformed codec recovery, retry state, and recovery copy. C04/C05/C06 must still supply field-allowlisting codecs and consumer-level browser journeys.
