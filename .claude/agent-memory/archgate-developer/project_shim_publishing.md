---
name: shim-publishing-pipeline
description: Non-obvious build/publish requirements for the multi-ecosystem shims in publish-shims.yml (pypi, rubygem, maven) that `archgate check` does NOT catch
metadata:
  type: project
---

`publish-shims.yml` publishes thin shim packages to PyPI, RubyGems, Maven Central, NuGet, and Go. Each ecosystem has build-time requirements that no archgate rule enforces (ARCH-013's `shim-version-sync` only checks version strings) — so a green `archgate check` does NOT mean the shims will publish. These are external-tool config (hatchling, bundler, Sonatype central-publishing plugin) and breakage only surfaces at release time.

**When editing any shim under `shims/` or `publish-shims.yml`:**

- **PyPI** (`shims/pypi/`): `pyproject.toml` needs `shims/pypi/README.md` to exist (`readme = "README.md"`) or the build fails with `OSError: Readme file does not exist`. Builds via `uv build --python 3.12` (isolated, version-pinned env — no `pip install build` line to flag). Never reintroduce `pip install build==X --hash=...`: `--hash` isn't a valid `pip install` CLI flag (requirements-file only); broke v0.41.0.
- **RubyGem** (`shims/rubygem/`): needs `working-directory: shims/rubygem` on both `ruby/setup-ruby` and `rubygems/release-gem`, a `Rakefile` requiring `bundler/gem_tasks`, and `gem "rake"` in the `Gemfile` (Ruby 4.0 dropped rake as a default gem; broke v0.41.0 on the Ruby 4.0.5 runner bump). Don't commit `Gemfile.lock` — bundler-cache generates it untracked.
- **Maven** (`shims/maven/pom.xml`): use `<waitUntil>validated</waitUntil>` with `<autoPublish>true</autoPublish>`, NOT `<waitUntil>published</waitUntil>` — the latter blocks until Sonatype finishes publishing, which routinely exceeds the job timeout (upload succeeds, then the build hangs on "Waiting until Deployment ... is published").

**Re-runs are not idempotent:** `publish-go-tag` (creates a git tag), `publish-nuget`, and an already-uploaded Maven deploy fail on "already exists" on a second run. After a partial failure, apply the fix to the next version bump or `workflow_dispatch` only the failed ecosystems.

**Advertised version can lag the installable version.** `docs/public/version.json` deploys on merge to main BEFORE `release.yml`/`release-binaries.yml` finish creating the release and uploading assets (~15-25 min gap, longer if the release job fails, as in the v0.44 incident). `install.sh`/`install.ps1` verify the platform asset exists (HEAD request) before trusting the advertised version, falling back to walking `releases?per_page=10`. The shims pin version constants at release time and share this exposure — see ARCH-017 if hardening them.

**Registering a subdir Go module on pkg.go.dev:** a subdir module's zip only contains files under its subtree, so the repo-root `LICENSE.md` is excluded and pkg.go.dev shows "no license" until `shims/go/LICENSE.md` exists (enforced by ARCH-013). Trigger registration via `curl https://proxy.golang.org/<module>/@v/<version>.info`.
