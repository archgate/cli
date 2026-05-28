---
name: shim-publishing-pipeline
description: Build/publish requirements for the multi-ecosystem shims in publish-shims.yml (pypi, rubygem, maven) — non-obvious gotchas that broke the first v0.40.0 release
metadata:
  type: project
---

The `publish-shims.yml` workflow publishes thin shim packages to PyPI, RubyGems, Maven Central, NuGet, and Go. Added in [#356](https://github.com/archgate/cli/pull/356); first ran at v0.40.0 ([run 26601268709](https://github.com/archgate/cli/actions/runs/26601268709)) where pypi/rubygem/maven all failed. Each ecosystem has build-time requirements NOT covered by the `shim-version-sync` ADR rule (ARCH-013), which only checks version strings.

**Why:** These are external-tool config requirements (hatchling, bundler, Sonatype central-publishing plugin) that no archgate lint rule enforces — so a green `archgate check` does NOT mean the shims will publish.

**How to apply** — when editing any shim under `shims/` or `publish-shims.yml`:

- **PyPI** (`shims/pypi/`): `pyproject.toml` declares `readme = "README.md"`, so `shims/pypi/README.md` MUST exist or `python -m build` fails with `OSError: Readme file does not exist`. If you change the `readme =` key, keep the referenced file present.
- **RubyGem** (`shims/rubygem/`): `rubygems/release-gem` runs `bundle exec rake release` from its `working-directory` input. Requires (1) `working-directory: shims/rubygem` on BOTH `ruby/setup-ruby` (with `bundler-cache: true` so `bundle install` runs) and `rubygems/release-gem`; and (2) a `shims/rubygem/Rakefile` containing `require "bundler/gem_tasks"` to provide the `release` task. Without the working-directory, bundler errors `Could not locate Gemfile`. Do NOT commit a `Gemfile.lock` — bundler-cache generates it untracked, which keeps `release:guard_clean` happy (an untracked lock isn't seen by `git diff --exit-code`).
- **Maven** (`shims/maven/pom.xml`): the `central-publishing-maven-plugin` with `<waitUntil>published</waitUntil>` blocks the build until Sonatype fully publishes, which routinely exceeds the 15-min job timeout (upload itself succeeds — you'll see `Uploaded bundle successfully` then a hang on `Waiting until Deployment ... is published`). Use `<waitUntil>validated</waitUntil>` with `<autoPublish>true</autoPublish>` so the build returns after validation and publishing finishes async.

**Re-running after a partial failure:** the jobs are not idempotent across a full workflow re-run. `publish-go-tag` (creates a git tag), `publish-nuget`, and a maven deploy that already uploaded will fail on "already exists" the second time. After fixing, prefer applying to the next version bump, or `workflow_dispatch` only the previously-failed ecosystems. Note v0.40.0's maven bundle DID upload (deploymentId d7671fb1) before the timeout, so it may already be published on Central.
