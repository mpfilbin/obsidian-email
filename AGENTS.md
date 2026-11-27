# Agent Instructions

## Project at a glance

Email is an Obsidian plugin (desktop only) that provides a full Microsoft 365 mail client through Microsoft Graph. It runs inside Obsidian's privileged renderer, holds a long-lived OAuth refresh token with `Mail.ReadWrite`, `Mail.Send` and `Contacts.ReadWrite`, and renders HTML written by strangers. Treat every change with that in mind; see [Security-sensitive changes](#security-sensitive-changes).

- Stack: TypeScript, Svelte 5, esbuild, vitest (jsdom). Node 26+ and npm 11+ are required (`.tool-versions` pins the exact version; `.npmrc` sets `engine-strict`, and CI reads the same file).
- Layout: `src/auth` (OAuth and tokens), `src/providers` (Graph and a fake provider), `src/cache` (IndexedDB), `src/sync`, `src/render` (sanitizing and rendering message HTML), `src/host` (Obsidian-facing glue), `src/view` (Svelte UI and the view model), `src/settings`, `src/util`. Tests in `tests/` mirror `src/`.
- Tests use fake values and the `FakeProvider` or the stub in `tests/stubs/obsidian.ts`. Never call real Microsoft endpoints from tests.
- `dev-vault/` is a throwaway vault for manual testing (see the README's Development section). Its generated files are gitignored.

## Branches, commits and pull requests

- The default branch is `master` (not `main`). Open pull requests against `master`.
- Do all work on a feature branch, never directly on `master`.
- Write a short, imperative sentence as the commit message and PR title, matching the existing history (for example `Show pending state and progress during delete/archive/move`). Older history also uses `feat:` / `fix:` prefixes; either is fine, but do not mix styles within one PR. Dependency bumps are titled `Bump <package> to <version> (release X.Y.Z)`. PRs are squash-merged and the title ends in `(#NN)`.
- Every PR description includes one line on the threat model: `Threat model: no impact` or `Threat model: updated (IDs)`. See [Security](#security-sensitive-changes).
- Every PR includes the version bump described below, unless it only touches installation scripts, CI pipeline definitions, or `AGENTS.md`.

## Versioning

This plugin follows [Semantic Versioning](https://semver.org/). Every pull request that changes the plugin must bump the version, with these exceptions:

- Changes that only touch installation scripts (`scripts/install.*`, `scripts/uninstall.*`, `scripts/link.sh`).
- Changes that only touch CI pipeline definitions (`.github/workflows/`).
- Changes that only touch `AGENTS.md`. It does not ship in the release and does not affect users.

Documentation-only changes elsewhere, source changes, test changes, style changes, and dependency changes all require a bump.

### Choosing the bump level

| Level | When to use | Examples |
| --- | --- | --- |
| **major** | Major releases, especially backwards-incompatible changes. | Removing or renaming a setting without migration, changing the IndexedDB schema or `data.json` format without a migration, changing the secret-storage key so existing accounts must sign in again, raising `minAppVersion` in a way that drops support for older Obsidian versions. |
| **minor** | New features or functionality changes. | A new view, a new setting, a new keyboard shortcut or command, a change to how an existing feature behaves (for example, what "delete" does in a given folder). |
| **patch** | Dependency upgrades, and bug fixes that do not change behavior. | Bumping `svelte` or `vitest`, fixing a crash or rendering glitch, refactors with no user-visible change. |

If a PR mixes kinds of change, use the highest level that applies. When unsure between two levels, pick the higher one.

### Files that carry the version

The version lives in four files, and they must always agree:

- `package.json`
- `package-lock.json` (both the top-level `version` and `packages[""].version`)
- `manifest.json` (this is what Obsidian reads, and what the release workflow publishes)
- `versions.json` (maps plugin version to minimum Obsidian version; `version-bump.mjs` adds an entry for the new version, using the current `minAppVersion`)

Do not edit these by hand. Use the steps below so they stay in sync.

### Procedure

1. Decide the level (`major`, `minor` or `patch`) using the table above.
2. Run the three steps from the repository root:

   ```bash
   npm version <major|minor|patch> --no-git-tag-version
   node version-bump.mjs
   npm install
   ```

   `npm version` updates `package.json`, `version-bump.mjs` copies the new version into `manifest.json` and `versions.json`, and `npm install` syncs `package-lock.json`.

   `npm run release -- <major|minor|patch>` (`scripts/release.sh`) runs the same steps and then creates a commit itself (`chore: update version to X.Y.Z`). Prefer the manual steps above when the commit message must follow other conventions (for example, attribution lines), or when the version bump should be part of an existing commit.
3. Check `git diff`: only version lines should change in `package.json`, `package-lock.json` and `manifest.json`, plus one new line in `versions.json`. If `npm install` changed dependency versions, revert those changes.

   The lockfile is written by npm 11, which ships with Node 26 and is what `engine-strict` requires. If you are on an older Node, switch to the version in `.tool-versions` rather than working around it; an older npm rewrites the lockfile differently and can crash on some dependency changes. As a last resort, restore `package-lock.json` from `master` and edit only its two version lines.
4. Commit the bump on the PR branch, either in the feature commit or as a separate `chore: update version to X.Y.Z` commit.
5. Do not create git tags or GitHub releases by hand.

### Dependabot pull requests

Dependabot opens weekly npm and GitHub Actions upgrade PRs (`.github/dependabot.yml`). Do not merge them unbumped and follow up with a separate "update version" PR or commit afterwards. The version bump belongs with the upgrade, so the upgrade and its release go out together.

- **npm dependency upgrades** (`package.json` / `package-lock.json`, including dev dependencies) are a **patch** bump, per the rules above. Add the bump before the PR is merged.
- **GitHub Actions upgrades** only change `.github/workflows/`, which is exempt from versioning. Do not bump them.
- If an upgrade changes the plugin's behavior (for example, a library's new major version alters sanitizing, rendering or a Graph call), treat it as the level that behavior change deserves (usually **minor**) rather than patch, and say why in the PR.

To add the bump to a Dependabot PR:

1. Check out the Dependabot branch (`dependabot/npm_and_yarn/...`) and make sure it is up to date with `master` by **merging** `master` into it. Never rebase, amend or force-push it.
2. Run the [procedure](#procedure) above with `patch`. `npm install` must not change any dependency versions beyond what Dependabot already changed; if it does, revert that part of the diff.
3. Commit with `chore: update version to X.Y.Z` and push to the same branch. Pushing to a Dependabot branch makes Dependabot stop updating it itself; if it later needs a refresh, merge `master` in manually, or comment `@dependabot recreate` and redo the bump on the new branch.
4. If you cannot push to the Dependabot branch, open your own PR with the same upgrade plus the bump, titled `Bump <package> to <version> (release X.Y.Z)`, say `Supersedes #NN` in the description, and close the Dependabot PR once yours is merged. Recent history was done this way.
5. PRs are squash-merged (linear history, titles ending in `(#NN)`), so extra commits collapse into one commit on `master`. Make sure the squashed commit title still describes the dependency change, not the bump.

Several Dependabot PRs open at the same time will conflict on the version lines in `package.json`, `package-lock.json` and `manifest.json` as each one merges. When that happens, merge `master` into the branch, resolve the conflict by taking `master`'s version, and re-run the procedure so the bump is applied on top of the newest version. Never hand-pick a version number to resolve it.

### Releases

The `Release` workflow (`.github/workflows/release.yml`) runs when `manifest.json` changes on `master`. It builds the plugin and creates a GitHub release named after the `manifest.json` version, skipping the step if that release already exists. Merging a PR with a version bump therefore publishes a release, so make sure the bump is correct before merge, and bump once per PR rather than once per commit.

## Handling Dependabot pull requests

Agents asked to process Dependabot PRs have the autonomy to **merge them without asking for further approval** once every condition below is met. Human supervision is only needed when a change is backwards incompatible or needs a human-driven decision; see [When to stop and ask](#when-to-stop-and-ask).

### Conditions for merging on your own

Merge a Dependabot PR (squash, as for every PR here) only when **all** of these are true:

1. The upgrade is backwards compatible and needs no decision from a person (see below).
2. The version bump is in the PR (see [Dependabot pull requests](#dependabot-pull-requests) under Versioning). GitHub Actions upgrades that only touch `.github/workflows/` are exempt.
3. The checks in [Checks before pushing](#checks-before-pushing) pass locally from a clean install (`rm -rf node_modules && npm ci`).
4. **Every** CI check is green on the PR's current head commit: `Typecheck`, `Test` and `Build`, plus any code scanning (CodeQL) checks the repository has enabled. Never merge on pending or red checks, and never skip, disable or loosen a test or check to get green.
5. The PR is mergeable (no conflicts) and has no unresolved review comments.

### Working through several PRs

- Take them **one at a time**, lowest risk first (patch and minor dev dependencies, then runtime dependencies, then anything larger). Every merge changes `master` and its version, so the next PR needs `master` merged into it and a fresh bump (the next patch version) on top. Do not open several in parallel.
- For each PR: check out its Dependabot branch, merge `origin/master` into it (never rebase, amend or force-push), run `npm ci`, apply the patch bump, run the local checks, commit `chore: update version to X.Y.Z`, push to the same branch, wait for CI, then merge.
- Squash-merge with a title that describes the dependency change, ending in the PR number, for example `Bump tslib to 2.9.1 (release 0.15.3) (#56)`. Do not use the version bump as the title.
- Each merge changes `manifest.json` on `master`, so the Release workflow publishes a release per merged PR. That is expected.
- Afterwards, report what was merged (and anything that was not, with the reason).

### Things that go wrong, and what to do

- **Dependabot rewrote its branch.** When `master` moves, Dependabot rebases and force-pushes its branch, so your push is rejected as non-fast-forward. Do not force-push, and do not merge the old history. Fetch the branch, reset your local copy of it to the new remote branch (your unpushed commits are the only thing you discard), and re-apply the version bump and any extra changes on top.
- **Packages that must move together.** Some packages are pinned to each other (for example `svelte` with `@sveltejs/vite-plugin-svelte`, `vite` and `esbuild-svelte`; or `@types/node` with the Node version in `.tool-versions`). When `npm ci` fails with an `ERESOLVE` peer dependency conflict, bump the partner in the same PR rather than leaving CI red. A version-locked pair moving together is not a reason to stop.
- **npm crashes while resolving** (`Cannot read properties of null (reading 'edgesOut')`). That is a bug in older npm versions. Use the Node version from `.tool-versions` (npm 11), starting from `master`'s `package.json` and `package-lock.json` if Dependabot's lockfile is inconsistent, then confirm with a clean `npm ci`. Do not delete the lockfile and regenerate it from scratch, which drifts unrelated packages.
- **Lockfile noise.** Dependabot's lockfile can differ from `master`'s in ways that are not version changes (the root `obsidian` range, optional peer entries). That is fine. Do compare which packages changed versions: only the upgraded package, its version-locked partners and their own transitive dependencies should move.
- **Red CI that is not the upgrade's fault.** Show it is red on `master` too, or fix the root cause. Re-run a job at most once. Do not merge around it.

### When to stop and ask

Leave the PR open and ask the repository owner when any of these apply:

- **Backwards incompatible.** A major version upgrade that has breaking changes, an upgrade that needs source or configuration changes to keep the plugin working or behaving the same, an upgrade that changes what users see or what is stored, or one that would raise `minAppVersion` or drop support for an Obsidian version the plugin still supports.
- **A human decision is needed.** More than one reasonable way to resolve a conflict, a dependency that is deprecated, abandoned or has changed owner, a license change, or a choice between upgrading and pinning or replacing a package.
- **Security-sensitive.** Anything covered by [Security-sensitive changes](#security-sensitive-changes), including a new dependency with install scripts or native code, any change to `dompurify` or another dependency bundled into `main.js` that handles credentials, network requests, sanitizing or rendering of remote content (`dompurify`, `quill`, `turndown`, `idb`), and any change to `.github/workflows/`, `esbuild.config.mjs` or `scripts/` beyond the upgrade itself.
- **You cannot get it green** without changing behavior, tests or configuration in a way you are not sure is right.

Say what you found and what the options are. Do not merge in the meantime.

## Checks before pushing

CI (`.github/workflows/ci.yml`) runs the following on every PR, as three separate jobs, and all must pass. Run them locally first (`npm ci` or `npm install` if `node_modules/` is missing):

```bash
npm run typecheck
npm run test
npm run build
```

`npm run build` also runs the typecheck before bundling. There is no lint step and no coverage threshold. Do not commit build output (`main.js`, `*.js.map`); both are gitignored.

CI runs the tests in the runner's default timezone only. Follow-up due dates and the dates shown in the message list and print view depend on the local timezone, so when a change touches dates, times, or anything derived from `new Date()`, also run the tests in two non-UTC zones locally:

```bash
TZ=America/Los_Angeles npm test
TZ=Pacific/Auckland npm test
```

Add or update tests alongside the change. A change to the Graph provider needs coverage in `tests/providers/`, and a change to the sanitizer or renderer needs hostile-input cases in `tests/render/`.

## Documentation to keep in sync

Update the docs in the same PR as the code change:

- `docs/security/threat-model.md`: update it when the change matches the table in section 1.2 ("When you must update this document"): new or changed HTML/DOM sinks or sanitizer changes, new endpoints, providers, OAuth scopes or token types, new persisted data, new ways to open or write something outside the plugin, CI/release/build changes or new dependencies, new ways of fetching remote content, and relaxing a control in section 6. Add a row to the review log (section 11) when you change a threat, control or invariant.
- `README.md`: update the feature list, setup steps, keyboard shortcuts, the Security notes, and the Microsoft Graph permission list when user-facing behavior, settings, or required Azure permissions change.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` are a dated historical record of past designs. Do not edit them to match current code. A new feature may add a new dated spec and plan there.

## Security-sensitive changes

- Never open a public issue, PR, comment or commit message that describes a suspected vulnerability. The repository has no `SECURITY.md`; report it privately through GitHub's "Report a vulnerability" form (the repository's Security tab) or directly to the maintainer.
- Read `docs/security/threat-model.md` before changing anything that touches credentials, network calls, persisted data, rendering of remote content, or the release pipeline. Check the change against the invariants in section 7 and the controls in section 6.
- Treat these as needing explicit human review, and call them out in the PR description:
  - authentication and token storage (`src/auth/`, `TokenManager`, `src/host/secret-store.ts`, the `obsidian://obsidian-email-auth` protocol handler and `redirect-receiver.ts`);
  - new or changed OAuth scopes or Microsoft Graph permissions (currently `Mail.ReadWrite`, `Mail.Send`, `Contacts.ReadWrite`, `offline_access`, `User.Read`, which must also match the README);
  - any new outbound network request, host, or URL built from remote data (credentials may only go to `https://graph.microsoft.com` and the fixed Microsoft login hosts), and any change to `src/providers/`, `src/host/http-post.ts` or paging and delta-link handling;
  - new data written to disk or the vault (`saveData`, the IndexedDB caches in `src/cache/`, saved emails and attachments via `src/host/vault-io.ts` and `src/render/email-to-note.ts`);
  - rendering remote text as markup (`innerHTML`, `{@html}`, `dangerouslyPasteHTML`, an iframe, the print view) or any change to `src/render/html-sanitizer.ts`. Message HTML may reach the DOM only through `sanitizeEmailHtml`, and remote images must stay blocked unless the user opts in;
  - opening links or launching external programs (`openExternal`, `src/host/links.ts`, `src/render/open-email-link.ts`). Only `http`, `https` and `mailto` may be handed to the OS;
  - changes to `.github/workflows/`, `esbuild.config.mjs`, or `scripts/`.
- Never put tokens, message bodies, subjects or addresses in logs or `Notice`s.
- Never commit secrets, tokens, real client IDs tied to a private tenant, or real account or mailbox data. Tests must use fake values.
- Do not relax a control listed in section 6 of the threat model without recording it in sections 6 and 7 of that document.
