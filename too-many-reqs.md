# Too many REQs investigation

## Snapshot

- `ndk2.log` shows **1,594** concurrent subscriptions, every one marked groupable.
- Fingerprints:
  - `#e-kinds` (kinds `1`, `6`, `7`, `9735` with `#e`) → **1,380** open subs.
  - `+authors-kinds` (`kinds: [3,10002]`, `closeOnEose: true`) → **170** concurrent subs.
  - Remaining fingerprints (`ids`, `authors-kinds`, `#l-authors-kinds`, etc.) account for ~44 subs.

## Spammy kinds & sources

| Kind(s) / Filter | Count | Source | Notes |
| --- | --- | --- | --- |
| `1`, `6`, `7`, `9735` + `#e` | 4 × 345 events = 1,380 | `useReactionsByAuthor` / `useReactions` (`src/shared/hooks/useReactions.ts`) via `ReactionsBar`, `Likes`, `FeedItemLike` | Each event spawns four long-lived subs. `closeOnEose` defaults to false so they stay open indefinitely. |
| `3`, `10002` (`closeOnEose: true`) | 170 | Relay list fetch (`ndk-relay-list-fetch`) | Should be short-lived, but re-triggered often (same author) so multiple REQs overlap. Needs caching/debouncing. |
| `30078` + `#l="double-ratchet/invites"` | 7 | `PrivateChats` invite watcher | Likely only needs one shared subscription; multiple components create duplicates. |
| `ids` | 17 | Event detail lookups | Typically can stop once the event arrives. |
| `authors-kinds` and variants | 9+ | Profile/follow/feed hooks | Some are long-lived feeds; others (metadata fetches) could set `closeOnEose`. |

## Mitigation plan

1. **Reaction hooks**
   - Add an option to `useReactionsByAuthor`/`useReactions` to opt-in to live updates; default to `closeOnEose: true` or call `sub.stop()` when the component unmounts.
   - Combine the four `#e` subscriptions per event into a single service that reference-counts consumers.

2. **Relay-list fetch throttling**
   - Cache the results of `kinds: [3,10002]` subs per author and debounce repeat calls so only one REQ is in flight.

3. **Centralize invite watchers**
   - Ensure `PrivateChats` exposes a single subscription for `#l="double-ratchet/invites"` and share it across components.

4. **Snapshot-only subscribers**
   - Audit `ndk.subscribe({ids: [...]})` and profile fetches; set `closeOnEose: true` or stop once the data arrives.

5. **Monitoring**
   - Use `window.irisDebugNdkSubscriptions()` to watch `total`/`persistentTotal` while navigating. Investigate any spike immediately.
