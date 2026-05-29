---
name: shim-publishing-pipeline
description: Non-obvious build/publish requirements for the multi-ecosystem shims in publish-shims.yml (pypi, rubygem, maven) that `archgate check` does NOT catch
metadata:
  type: project
---

`publish-shims.yml` publishes thin shim packages to PyPI, RubyGems, Maven Central, NuGet, and Go. Each ecosystem has build-time requirements that no archgate rule enforces (ARCH-013's `shim-version-sync` only checks version strings) — so a green `archgate check` does NOT mean the shims will publish. These are external-tool config (hatchling, bundler, Sonatype central-publishing plugin) and breakage only surfaces at release time.

**When editing any shim under `shims/` or `publish-shims.yml`:**

- **PyPI** (`shims/pypi/`): `pyproject.toml` declares `readme = "README.md"`, so `shims/pypi/README.md` MUST exist or the build fails with `OSError: Readme file does not exist`. The job builds with **`uv build --python 3.12`** (via `astral-sh/setup-uv`, SHA-pinned) — uv provisions its own version-pinned, isolated build env, so there is no `pip install build` line for Scorecard Pinned-Dependencies to flag. Do NOT reintroduce the `pip install build==X --hash=...` form: **`--hash` is NOT a valid `pip install` command-line option** (only valid inside a requirements file), so it fails with `no such option: --hash` — that broke the v0.41.0 release (introduced unverified in #361 since the workflow only runs at release time).
- **RubyGem** (`shims/rubygem/`): `rubygems/release-gem` runs `bundle exec rake release` from its `working-directory`. Requires (1) `working-directory: shims/rubygem` on BOTH `ruby/setup-ruby` (with `bundler-cache: true`) and `rubygems/release-gem`; (2) a `shims/rubygem/Rakefile` with `require "bundler/gem_tasks"` for the `release` task; (3) **`gem "rake"` declared in `shims/rubygem/Gemfile`** — Ruby 4.0 no longer ships rake as a bundled default gem, so `bundle exec rake` fails with `rake is not currently included in the bundle` (broke the v0.41.0 release when the runner moved to Ruby 4.0.5). Do NOT commit `Gemfile.lock` — bundler-cache generates it untracked, keeping `release:guard_clean` happy.
- **Maven** (`shims/maven/pom.xml`): use `<waitUntil>validated</waitUntil>` with `<autoPublish>true</autoPublish>`, NOT `<waitUntil>published</waitUntil>` — the latter blocks until Sonatype finishes publishing, which routinely exceeds the job timeout (upload succeeds, then the build hangs on "Waiting until Deployment ... is published").

**Re-runs are not idempotent:** `publish-go-tag` (creates a git tag), `publish-nuget`, and an already-uploaded Maven deploy fail on "already exists" on a second run. After a partial failure, apply the fix to the next version bump or `workflow_dispatch` only the failed ecosystems.
