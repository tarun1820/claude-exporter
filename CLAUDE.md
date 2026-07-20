# Claude Exporter - Development Guide

## Communication Style

- Narrate what you're doing at each step — brief status updates help the user follow along and make the chat searchable
- Be patient with tangents and context-switching (ADHD-friendly pacing)
- Keep explanations concise but don't skip them
- **Scope guard:** Gently remind the user when a tangent is pulling away from the current task. User tends to spiral into feature ideas mid-implementation — help stay focused on finishing the current thing before starting the next. A quick "want to add that to TODO and finish X first?" goes a long way.

## Self-Maintenance

This file is the shared project memory. **Update it proactively** when:

- A new critical rule or recurring bug pattern is discovered
- Project structure changes (new files, renamed files, new architecture patterns)
- A decision is made about how something should always work (e.g., "exports > 1 file must ZIP")

Keep it concise. Don't duplicate what's already here — update existing sections instead.

## Project Structure

**Chrome-only.** This repo used to ship parallel Chrome and Firefox builds; Firefox support was dropped and the `firefox/` folder removed. All extension code lives directly under `chrome/` (Manifest V3).

- `chrome/` — the extension itself
- `docs/` — TODO, CHANGELOG, INSTALL
- `tests/` — Vitest harness
- `releases/vX.Y.Z/` — packaged release ZIPs

## Key Files (under `chrome/`)
- `content.js` — Content script injected on claude.ai pages (handles API calls, popup/bridge export actions)
- `utils.js` — Shared utilities (convertToMarkdown, convertToText, downloadFile, extractArtifactFiles, extractBridgeContext, generateBridgeMarkdown/JSON, etc.)
- `bridge.html` / `bridge.js` — AI Conversation Bridge review page (distill a conversation into a handoff package for another LLM)
- `browse.js` — Browse page logic (filtering, sorting, has its own export functions, always ZIPs)
- `background.js` — Re-injects content scripts on install/update
- `jszip.min.js` — ZIP library
- `popup.html` / `popup.js` — Extension popup UI and logic
- `browse.html` — Browse/search conversations page
- `options.html` / `options.js` — Settings page (Organization ID, Bridge API key, backup/restore, diagnostics)

## Git & Commits

**Auto-commit after every completed change.** Don't wait for the user to ask. After finishing a task (bug fix, feature, refactor), commit immediately with a clear message.

- Write concise, descriptive commit messages: `Fix bulk export to always ZIP instead of individual downloads`
- Not: `wip`, `fix stuff`, `update`, `final FINAL (1)`
- Don't push unless asked
- **Branching**: Do all development on `testing` branch. Merge to `main` only when creating a release

## Documentation Upkeep

**After each commit**, update these files:

- **`docs/TODO.md`** — Move completed items to the Completed section, update the current version number, clean up any stale entries
- **`docs/CHANGELOG.md`** — Append a short entry under the current version. Create the file if it doesn't exist. Format: `## [X.Y.Z]` header, then bullet points describing changes. Keep entries concise — one line per change is fine
- The CHANGELOG doubles as store update notes. All changes between the current version and the last `_Published_` marker are what goes into the store listing update

## Release Process

**Only create releases when explicitly asked.** Never auto-release.

When the user asks to create a release for version X.Y.Z:

1. **Verify version** — Confirm `chrome/manifest.json` shows the correct version
2. **Create release directory** — `mkdir -p releases/vX.Y.Z`
3. **ZIP the extension** — `cd chrome && zip -r ../releases/vX.Y.Z/claude-exporter-chrome.zip ./*`
4. **Git tag** — `git tag vX.Y.Z -m "Release vX.Y.Z"`
5. **Push tag** — `git push origin vX.Y.Z`
6. **Create GitHub release** — `gh release create vX.Y.Z releases/vX.Y.Z/* --title "vX.Y.Z" --notes "$(changelog excerpt from docs/CHANGELOG.md)"` — use all changes since last `_Published_` marker as the notes
7. **Mark as published** — Add `_Published_` line after the released version's entries in docs/CHANGELOG.md, commit

## Critical Rules

### Always bump version on every change
Update `"version"` in `chrome/manifest.json`.

### background.js must inject ALL content scripts
When re-injecting into already-open tabs (on install/update), background.js must inject all three files: `jszip.min.js`, `utils.js`, AND `content.js`. Injecting only `content.js` causes "JSZip is not defined" / "downloadFile is not defined" / "extractArtifactFiles is not defined" errors on already-open tabs.

### Multi-file exports must always be ZIPped
Any export producing more than one file should always create a ZIP — never trigger individual browser downloads.

### Manifest name differs by branch

`"name"` in `chrome/manifest.json` must be:

- `"Claude Exporter"` on the `main` branch (released version)
- `"Claude Exporter Beta"` on the `testing` branch (so the user can tell at a glance which build is loaded)

The popup header title is populated from `manifest.name` in `popup.js` (`#header-title`), so the popup automatically reads "Claude Exporter Beta" on the testing branch — no separate HTML edit needed.

When merging `testing` → `main` for a release, flip the manifest name to drop "Beta" as part of the merge.

### AI Conversation Bridge API key handling
The Bridge feature's optional Anthropic API key (`bridgeApiKey` in `chrome.storage.local`) is a secret, not app state. It must stay excluded from `backupExtensionData`/`generateDiagnostics` output in `utils.js` — never let a new backup/diagnostics field accidentally sweep it in via a `chrome.storage.local.get(null, ...)` call.

## Testing

- **Vitest** test harness (`package.json` + `node_modules/`) lives in `tests/`. Run tests with `npm test` (one-shot) or `npm run test:watch` (watch mode) from `tests/`.
- Test files live in `tests/` and import from `chrome/utils.js`.
- `utils.js` has a conditional `module.exports` block at the bottom that fires only when `module` is defined (Node/vitest). Browser extensions ignore it because the global is undefined.
- `node_modules/` and `package-lock.json` under `tests/` are gitignored (`package.json` is tracked). None are part of the release ZIPs.

## Architecture Notes

### Content Script Injection
- On fresh page loads: manifest `content_scripts` handles injection of all three JS files
- On extension install/update: `background.js` re-injects into already-open claude.ai tabs
- `content.js` has a double-injection guard (`window.claudeExporterContentScriptLoaded`) to prevent duplicate message listeners

### Export Flow
- **Popup "Export Current"** → sends message to content script on the active claude.ai tab
- **Popup "Export All"** → sends message to content script, which fetches all conversations and ZIPs them
- **Popup/Browse "Bridge to Another AI"** → opens `bridge.html`, which fetches the conversation via the content script relay, runs `extractBridgeContext` (and optionally `refineBridgeContextWithAI`), then exports a Markdown prompt or JSON package
- **Browse page** → loads conversation list via content script relay (`sendMessageToClaudeTab`), then exports directly via `fetch()` to claude.ai API
