# Repository Guidelines

## Project Structure & Module Organization
FisherAI ships as a Chrome extension; the repo root holds `manifest.json`, `background.js`, and HTML entrypoints such as `popup/`, `settings.html`, and `side_panel.html`. Core logic belongs in `scripts/`: keep provider adapters in `scripts/providers/`, shared helpers in `scripts/utils.js`, and vendored code in `scripts/third/`. UI assets live in `popup/`, `css/`, `styles/`, `images/`, and `public/`. Localised copy sits in `translations/`; add at least matching `en` and `zh` strings whenever you introduce new text.

## Build, Test, and Development Commands
Develop by loading the repository folder as an unpacked extension from `chrome://extensions` (enable Developer Mode, then “Load unpacked…”). Package a store-ready zip with `zip -r dist/fisherai.zip manifest.json background.js css images popup public scripts settings.html side_panel.html styles translations` so the uploaded bundle mirrors the directory layout.

## Coding Style & Naming Conventions
Follow the existing ES2020 pattern: four-space indentation, `const`/`let` declarations, camelCase for functions and variables, and uppercase snake case for shared constants like `OPENAI_BASE_URL`. End statements with semicolons, favour template literals, and keep comments short—default to English unless Chinese context is required. Avoid introducing new build tooling or global CSS selectors without discussion; scope DOM hooks to the relevant container.

## Testing Guidelines
Automated tests are not yet wired up, so rely on targeted manual checks. After each change, reload the unpacked extension and verify popup conversations, settings persistence, and content-script behaviour in YouTube pages (`scripts/content.js`). When touching translations or providers, confirm language fallbacks and a live request against a safe model; note the scenarios exercised in your pull request.

## Commit & Pull Request Guidelines
Use the Conventional Commit prefixes seen in history (`fix:`, `chore:`, `feature:`) and keep the subject focused on one outcome. Reference related issues, describe user-facing impact, and attach screenshots or GIFs for UI edits (temporary assets can stay in `public/`). PRs should call out risk areas, list the manual tests run, and wait for maintainer review before merge or store submission.

## Security & Configuration Tips
Do not commit real API keys—store them through the extension settings so they remain in Chrome local storage. Strip sensitive data from logs and explain any new permission added to `manifest.json` within the pull request description.
