# Copilot UX fixtures

Reusable synthetic projects for reviewing the actual copilot UI. No copied production conversations and no model calls. Content lives in `copilot-ux.mjs`; artifact shapes are checked by `src/lib/chat/ux-fixtures.test.ts` against the real parser.

| Scenario | Inspect |
| --- | --- |
| `empty` | Onboarding guidance and empty workspace |
| `pending` | Four proposed fields; pending disclosure and chat Apply/Skip |
| `revision` | Earlier saved target plus pending correction; saved value must stay visible |
| `approved` | Resolved card after reload; no active approval controls |
| `rejected` | Compact skipped card; no pending canvas values |
| `discussion` | Unsaved comparison; source inspector and export; known misleading “Saving proposal…” state |
| `long-it` | 122 messages, four tables, long project title, Italian interface, final scope correction |

## Run

From the repo root, start the local app with the QA bypass:

```sh
E2E_AUTH_ENABLED=1 node_modules/.bin/next dev --webpack -H 127.0.0.1 -p 3027
```

A current production build can use `next start` instead. Then:

```sh
node scripts/copilot-ux-fixtures.mjs list
node --env-file=.env.local scripts/copilot-ux-fixtures.mjs setup
node --env-file=.env.local scripts/copilot-ux-fixtures.mjs check
node scripts/copilot-ux-fixtures.mjs serve
```

Open the URLs printed by `serve`. It binds only to `127.0.0.1:3028` and supplies the synthetic user header. `UX_FIXTURE_APP_PORT` and `UX_FIXTURE_PROXY_PORT` override the two ports; use the same values for each command.

The preview proxy rejects mutating requests with a readable error. It is for inspecting saved states, disclosures, source inspectors, scrolling, navigation and layout. Sending chat or applying a proposal is intentionally not supported here. Those operations need the existing live e2e scripts or a dedicated interaction harness. The proxy does not simulate streaming, disconnection, cancellation, cross-tab mutations, real compaction quality or model costs.

## Review matrix

Check desktop 1280×720 and phone 390×844. Also review long Italian labels, keyboard activation, reduced motion and browser zoom when testing corresponding changes. Do not consider these checks passed just because the fixture exists.

- Pending status stays visible with the diff collapsed. Opening it reveals the comparison without applying anything.
- Revised fields distinguish saved values from proposed replacements.
- Approved/rejected cards stay resolved across reloads.
- An unsaved artifact must not promise a save that will never finish. This currently reproduces a known issue.
- The long transcript exposes older-message loading; reading history should not unexpectedly jump to the latest message.
- The phone composer, Send control and workspace should all be reachable. The existing layout currently clips them.
- Cross-section links stay in the same fixture project.

## Cleanup and recovery

The local app uses the production database. These commands create a unique `uxfixture-<uuid>` user and disposable projects, and record ownership in `.context/copilot-ux-fixtures.json`. Setup refuses to overwrite an active manifest. A failed setup attempts cleanup automatically. If the process is interrupted, preserve the manifest and run:

```sh
node --env-file=.env.local scripts/copilot-ux-fixtures.mjs cleanup
```

Cleanup is transactional and repeatable. It finds projects by the unique fixture owner, including a project created just before an interrupted manifest write. It refuses to delete an owned organization if another user or another owner's project has appeared. Stop the preview proxy and local app after cleanup.

## Automated checks

```sh
node_modules/.bin/vitest run src/lib/chat/ux-fixtures.test.ts
```

The parser contract is offline. The `check` command verifies the seeded history, saved versus pending fields, resolved action status and absence of persisted artifact rows through the local API/database. It does not approve actions or call an LLM.
