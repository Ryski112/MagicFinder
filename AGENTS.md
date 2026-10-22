# MagicFinder

What it is and how to run it: `README.md`. Build decisions: `docs/spec.md`; where the spec and the code disagree, the code and `CONTEXT.md` win.

## Language

Use the terms in `CONTEXT.md` exactly, in code, UI copy, commit messages and PRs. Write commit subjects in the imperative, naming what the buyer gets: "Let the buyer cancel a search and go back to the Want List".

## Checks

CI runs `npm run typecheck`, `npm test` and `npm run build`; all three pass before a PR is opened.

Tests sit beside the code as `*.test.ts` and run against recorded fixtures, so they work offline. Record new fixtures with the scripts in `scripts/` (`record-mtgsingles-fixture.ts`, `scrub-fetch-fixture.ts`, `make-scryfall-fixture.ts`).

The preview server in `.claude/launch.json` keeps its data in the git-ignored `.magicfinder-data`, apart from the owner's real profile. The CardKingdom comparison is off there; switch on Settings → "Compare with CardKingdom" to see the bargain chips.

## Live Sources

Every request to a Source or Store is polite and paced, and the scripts that make them (`check-stores`, `probe-*`) are run deliberately, not as a check. Before touching a Source module, a probe, or anything that reads CardKingdom or a Shopify checkout, read `docs/agents/sources.md`: it holds the rate limits and data quirks that each cost a bug.

## Workflow

- One branch and one PR per change. PRs merge with merge commits; the owner merges. The repo has no auto-merge, so "merge when green" means `gh pr checks --watch`, then `gh pr merge --merge`.
- Stacked PRs: retarget the child to `main` (`gh pr edit <n> --base main`) before its parent merges, or the child merges into a dead branch.
- Collaborator PRs are tested in an isolated copy (a worktree) before they merge.
- Releases: a version PR bumps `package.json`, then the tag `vX.Y.Z` is pushed and the Release and Docker workflows publish. The owner decides when; push a tag only when asked.
- Keep the owner's domain, LAN IPs and tunnel names out of commits, issues and PRs. `docs/hosting.md` uses placeholders; the filled-in copy is the git-ignored `docs/hosting.local.md`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for Ryski112/MagicFinder, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
