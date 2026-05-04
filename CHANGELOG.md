## [0.32.0](https://github.com/archgate/cli/compare/v0.31.3...v0.32.0) (2026-05-04)

### Features

* add Sentry tunnel and route error tracking through s.archgate.dev ([#266](https://github.com/archgate/cli/issues/266)) ([38c6a82](https://github.com/archgate/cli/commit/38c6a82e2c3115856e67fc856d14f9035b3bb889))

### Bug Fixes

* suppress PostHog telemetry errors behind corporate proxies ([#264](https://github.com/archgate/cli/issues/264)) ([f130487](https://github.com/archgate/cli/commit/f130487841f00af6a9ff67d001c5591db86871c5))

## [0.31.3](https://github.com/archgate/cli/compare/v0.31.2...v0.31.3) (2026-05-04)

### Bug Fixes

* clean up stale .old binary at startup instead of via detached process ([#261](https://github.com/archgate/cli/issues/261)) ([621bb6b](https://github.com/archgate/cli/commit/621bb6b1b83f7dc32fb64cb85726e472eb399c67))

## [0.31.2](https://github.com/archgate/cli/compare/v0.31.1...v0.31.2) (2026-05-02)

### Bug Fixes

* **ci:** remove backfill-attestations workflow ([#258](https://github.com/archgate/cli/issues/258)) ([6a32d09](https://github.com/archgate/cli/commit/6a32d09e01187aa794d99ecb5b7da1e9ab172c00))

## [0.31.1](https://github.com/archgate/cli/compare/v0.31.0...v0.31.1) (2026-04-29)

### Bug Fixes

* **ci:** revert SLSA reusable workflow to tag pin ([#250](https://github.com/archgate/cli/issues/250)) ([f350bce](https://github.com/archgate/cli/commit/f350bce0a12ad82c89aa297cc411f7cecefd2c91)), closes [#245](https://github.com/archgate/cli/issues/245)
* **ci:** use GH App token for release PR job to trigger CI naturally ([#252](https://github.com/archgate/cli/issues/252)) ([6c9acd0](https://github.com/archgate/cli/commit/6c9acd032b5434b1f6c9636df4336882e7f426e6)), closes [#131](https://github.com/archgate/cli/issues/131)

## [0.31.0](https://github.com/archgate/cli/compare/v0.30.2...v0.31.0) (2026-04-29)

### Features

* **installer:** detect and update PowerShell profiles on Windows ([#248](https://github.com/archgate/cli/issues/248)) ([3f142ce](https://github.com/archgate/cli/commit/3f142ce1d4bf62cd7b4f9c80d6155b8e9fdc7902))

### Bug Fixes

* **ci:** add SLSA provenance to release artifacts ([#243](https://github.com/archgate/cli/issues/243)) ([f80b942](https://github.com/archgate/cli/commit/f80b942155a8ff19616713e62024005a20f58959))
* **ci:** pin SLSA reusable workflow by SHA ([#245](https://github.com/archgate/cli/issues/245)) ([92d4829](https://github.com/archgate/cli/commit/92d48299db4f5d6e36446a97130f2d95a77e077e)), closes [#13](https://github.com/archgate/cli/issues/13)
* **init:** hide opencode user-scope path from init output ([#249](https://github.com/archgate/cli/issues/249)) ([7b04f04](https://github.com/archgate/cli/commit/7b04f04270d13167397c15ab191219dda4cf07b0))

## [0.30.2](https://github.com/archgate/cli/compare/v0.30.1...v0.30.2) (2026-04-27)

### Bug Fixes

* **ci:** add DCO sign-off to release PR commits ([#239](https://github.com/archgate/cli/issues/239)) ([946e169](https://github.com/archgate/cli/commit/946e16979a3225e6d2e9353f869a9d89fa03bf8c))
* **ci:** enable dco sign-off for renovate commits ([#234](https://github.com/archgate/cli/issues/234)) ([0397bc9](https://github.com/archgate/cli/commit/0397bc9fa439e7b8d6cb57ae75b5ed2fa3d82be2))
* remove invalid dco option from renovate.json ([#238](https://github.com/archgate/cli/issues/238)) ([4603a84](https://github.com/archgate/cli/commit/4603a846cd2ec8eeca3a3c24f106d51f88e264c9))

## [0.30.1](https://github.com/archgate/cli/compare/v0.30.0...v0.30.1) (2026-04-26)

### Bug Fixes

* **engine:** match dot-prefixed dirs in ctx.glob() and ADR file scopes ([#223](https://github.com/archgate/cli/issues/223)) ([2b3eba4](https://github.com/archgate/cli/commit/2b3eba4dae00f6b035c3a7a84a93809fc6012eec)), closes [#222](https://github.com/archgate/cli/issues/222) [#222](https://github.com/archgate/cli/issues/222)

## [0.30.0](https://github.com/archgate/cli/compare/v0.29.0...v0.30.0) (2026-04-23)

### Features

* **init:** add opencode as a fifth editor target ([#217](https://github.com/archgate/cli/issues/217)) ([58f8aaa](https://github.com/archgate/cli/commit/58f8aaab48da7f1d27a7b5678560e28dd05f3468))

## [0.29.0](https://github.com/archgate/cli/compare/v0.28.0...v0.29.0) (2026-04-16)

### Features

* **adr:** support custom domains via `archgate domain` commands ([#212](https://github.com/archgate/cli/issues/212)) ([2717763](https://github.com/archgate/cli/commit/271776347a8f35e5ef812e1612f6d2638c8e8dfa))
* **docs:** add PostHog web analytics ([#208](https://github.com/archgate/cli/issues/208)) ([0502ecd](https://github.com/archgate/cli/commit/0502ecd6d9f2da11c56d43daa25318d5d845beda))

### Bug Fixes

* **telemetry:** await initTelemetry so command_executed carries repo_id ([#211](https://github.com/archgate/cli/issues/211)) ([4ffbb70](https://github.com/archgate/cli/commit/4ffbb706029f370e7f277c764a5aba602a6d7e76))

### Performance Improvements

* **cli:** remove 3s exit tail and trim startup overhead ([#213](https://github.com/archgate/cli/issues/213)) ([9e442d6](https://github.com/archgate/cli/commit/9e442d60bb4d87c0b86d072301481a943bca4954)), closes [#6](https://github.com/archgate/cli/issues/6) [#211](https://github.com/archgate/cli/issues/211)

## [0.28.0](https://github.com/archgate/cli/compare/v0.27.0...v0.28.0) (2026-04-14)

### Features

* **telemetry:** fix command/exit-code tracking and enrich events ([#206](https://github.com/archgate/cli/issues/206)) ([d798061](https://github.com/archgate/cli/commit/d798061f76f890fa4b75e0559d874fb6e406c7c9))

### Bug Fixes

* address valid AI quality findings ([#202](https://github.com/archgate/cli/issues/202)) ([8c63cd6](https://github.com/archgate/cli/commit/8c63cd6154fe2049d911802d1ac155b55fc6acc4))

## [0.27.0](https://github.com/archgate/cli/compare/v0.26.2...v0.27.0) (2026-03-31)

### Features

* native Cursor plugin support via marketplace and VSIX install ([#182](https://github.com/archgate/cli/issues/182)) ([bc7a120](https://github.com/archgate/cli/commit/bc7a120829b52fa3fbf7e30575fd1ec10154385d))

### Bug Fixes

* use correct path encoding for Cursor session-context on Windows ([#181](https://github.com/archgate/cli/issues/181)) ([9e531ee](https://github.com/archgate/cli/commit/9e531eef4278b2e1ad1ecab515dc06f5673c70ca))
* use VS Code marketplace URL in copilot init fallback ([#186](https://github.com/archgate/cli/issues/186)) ([e0187f9](https://github.com/archgate/cli/commit/e0187f99a778c9f8eec5a1a42ac7e9892fe59b8a))

## [0.26.2](https://github.com/archgate/cli/compare/v0.26.1...v0.26.2) (2026-03-25)

### Bug Fixes

* suppress all GCM interactive prompts in credential store ([#176](https://github.com/archgate/cli/issues/176)) ([5d9bd33](https://github.com/archgate/cli/commit/5d9bd333180d1769dd887fbdeda5b8c46ad27efa))

## [0.26.1](https://github.com/archgate/cli/compare/v0.26.0...v0.26.1) (2026-03-25)

### Bug Fixes

* show manual install commands on failure, split CLI docs ([#171](https://github.com/archgate/cli/issues/171)) ([91544c4](https://github.com/archgate/cli/commit/91544c43412d85dcb8609c435df3cb0cecddc526))

## [0.26.0](https://github.com/archgate/cli/compare/v0.25.1...v0.26.0) (2026-03-24)

### Features

* add doctor command and auto-detect editors ([#166](https://github.com/archgate/cli/issues/166)) ([ec5be2a](https://github.com/archgate/cli/commit/ec5be2a27346737a17b1574d845a3cd942e0e3c3))
* add global --log-level option ([#170](https://github.com/archgate/cli/issues/170)) ([972028e](https://github.com/archgate/cli/commit/972028e3b3928358925c334635b67a2661b9d99e))

### Bug Fixes

* filter Sentry noise from tests and user cancellations ([#169](https://github.com/archgate/cli/issues/169)) ([2c988b6](https://github.com/archgate/cli/commit/2c988b6616bf509870e91abb11edcba7abce1c5b))

## [0.25.1](https://github.com/archgate/cli/compare/v0.25.0...v0.25.1) (2026-03-24)

### Bug Fixes

* avoid Windows CI timeout in init idempotency test ([#164](https://github.com/archgate/cli/issues/164)) ([8fdbe29](https://github.com/archgate/cli/commit/8fdbe29b3dc07a8ccc733820c5d2ab888dcdd786))

## [0.25.0](https://github.com/archgate/cli/compare/v0.24.0...v0.25.0) (2026-03-23)

### Features

* add typed readJSON overload for package.json ([#162](https://github.com/archgate/cli/issues/162)) ([1240080](https://github.com/archgate/cli/commit/12400809c82523780f9af0ff63a4367a4a5cb0af))
* add VS Code extension install via plugin install ([#161](https://github.com/archgate/cli/issues/161)) ([f71bd4d](https://github.com/archgate/cli/commit/f71bd4d6640e294c278b88de688088ed95d3b2c7))

### Bug Fixes

* remove plaintext token storage and fix upgrade losing login ([#160](https://github.com/archgate/cli/issues/160)) ([390ef9b](https://github.com/archgate/cli/commit/390ef9b4f7fc80bb205d3a8fa196a7c9cef19c31))

## [0.24.0](https://github.com/archgate/cli/compare/v0.23.2...v0.24.0) (2026-03-23)

### Features

* validate rule file syntax conventions ([#159](https://github.com/archgate/cli/issues/159)) ([f600f88](https://github.com/archgate/cli/commit/f600f887db5b6c6c14eca5b454b41685cb25f056))

### Bug Fixes

* **ci:** remove self-referencing archgate proto plugin ([#157](https://github.com/archgate/cli/issues/157)) ([66d71ac](https://github.com/archgate/cli/commit/66d71ac04c69405df29c6702bf987e0ba9a353cf))

## [0.23.2](https://github.com/archgate/cli/compare/v0.23.1...v0.23.2) (2026-03-23)

### Bug Fixes

* correct scanner positions, suppress stderr noise, and fix stdin hang ([#155](https://github.com/archgate/cli/issues/155)) ([387b318](https://github.com/archgate/cli/commit/387b318edd8945faa86f89c9450599678da6d199))

## [0.23.1](https://github.com/archgate/cli/compare/v0.23.0...v0.23.1) (2026-03-23)

### Bug Fixes

* report blocked rules and range info in JSON output ([#152](https://github.com/archgate/cli/issues/152)) ([0acb40d](https://github.com/archgate/cli/commit/0acb40d24e701f652d920e48257b97980bca58fb))

## [0.23.0](https://github.com/archgate/cli/compare/v0.21.0...v0.23.0) (2026-03-23)

### Features

* add file arguments to check command ([#147](https://github.com/archgate/cli/issues/147)) ([63299a1](https://github.com/archgate/cli/commit/63299a1526230537611598853d2911481d1bab6a))
* add GEN-003 ADR for tool invocation via package scripts ([#149](https://github.com/archgate/cli/issues/149)) ([58eb611](https://github.com/archgate/cli/commit/58eb611572f26497f03d1e6106c58b697c3450f4))

### Bug Fixes

* prevent release push race condition ([#151](https://github.com/archgate/cli/issues/151)) ([0405f75](https://github.com/archgate/cli/commit/0405f75ecf0ec3c0d51d962882e713657c6b839a))

## [0.22.0](https://github.com/archgate/cli/compare/v0.21.0...v0.22.0) (2026-03-23)

### Features

* add file arguments to check command ([#147](https://github.com/archgate/cli/issues/147)) ([63299a1](https://github.com/archgate/cli/commit/63299a1526230537611598853d2911481d1bab6a))

## [0.21.0](https://github.com/archgate/cli/compare/v0.20.0...v0.21.0) (2026-03-23)

### Features

* add security scanner for .rules.ts files ([#145](https://github.com/archgate/cli/issues/145)) ([1148af6](https://github.com/archgate/cli/commit/1148af622dd540611ecfe59f90b886869d931657))

### Bug Fixes

* copilot CLI plugin install uses wrong URL and command ([#143](https://github.com/archgate/cli/issues/143)) ([a5562c7](https://github.com/archgate/cli/commit/a5562c71216dea376c35141b1f5b62fc658b0e46))
* use two-segment URL path for VS Code marketplace ([#146](https://github.com/archgate/cli/issues/146)) ([e995bd5](https://github.com/archgate/cli/commit/e995bd53ec6310e38b58b5bbd4f9eca63040f0e8))

## [0.20.0](https://github.com/archgate/cli/compare/v0.19.0...v0.20.0) (2026-03-22)

### Features

* wire PostHog telemetry into CLI lifecycle ([#141](https://github.com/archgate/cli/issues/141)) ([292ff58](https://github.com/archgate/cli/commit/292ff5809ab925b135c4e074a48eb211bd77ff75))

## [0.19.0](https://github.com/archgate/cli/compare/v0.18.0...v0.19.0) (2026-03-22)

### Features

* store tokens in git credential manager instead of plaintext ([#138](https://github.com/archgate/cli/issues/138)) ([e495e01](https://github.com/archgate/cli/commit/e495e018f84d0bed68186f71a9d888659f22d40d))

## [0.18.0](https://github.com/archgate/cli/compare/v0.17.2...v0.18.0) (2026-03-22)

### Features

* add anonymous telemetry and error tracking ([#135](https://github.com/archgate/cli/issues/135)) ([fadfcb1](https://github.com/archgate/cli/commit/fadfcb19a87aef931702bb81abd4b4385ebae5d5))

### Bug Fixes

* **ci:** skip release PR validation when branch missing ([#133](https://github.com/archgate/cli/issues/133)) ([d424244](https://github.com/archgate/cli/commit/d4242442d762e63bcf0e997e605b4a283632601f))

## [0.17.2](https://github.com/archgate/cli/compare/v0.17.1...v0.17.2) (2026-03-21)

### Bug Fixes

* **ci:** post status checks on release PR ([#131](https://github.com/archgate/cli/issues/131)) ([dd2156e](https://github.com/archgate/cli/commit/dd2156eef2e4639f42d48c4bc5d60760acde8036))
* **config:** unify docs dependencies into a single Renovate PR ([#129](https://github.com/archgate/cli/issues/129)) ([999a237](https://github.com/archgate/cli/commit/999a2375dd1d6891f37d2e202d510c068172303e))
* **deps:** group docs dependencies into a single Renovate PR ([#125](https://github.com/archgate/cli/issues/125)) ([4c1ad20](https://github.com/archgate/cli/commit/4c1ad201c06ad236b4823bfac3d971e24933bc53))
* **deps:** update docs dependencies ([#126](https://github.com/archgate/cli/issues/126)) ([4c7008a](https://github.com/archgate/cli/commit/4c7008a568c67b08c05dae07653d4c6c6f7f0f04))
* encode colons and dots in session-context project path ([#130](https://github.com/archgate/cli/issues/130)) ([262a172](https://github.com/archgate/cli/commit/262a17234cfec5dbe06c152735c3d4a4e8f8707c))

## [0.17.1](https://github.com/archgate/cli/compare/v0.17.0...v0.17.1) (2026-03-21)

### Bug Fixes

* serve version from static endpoint to avoid GitHub API rate limits ([#112](https://github.com/archgate/cli/issues/112)) ([877c6f5](https://github.com/archgate/cli/commit/877c6f51b0a992b1cd436f3f1da387f5885e62f9))

## [0.17.0](https://github.com/archgate/cli/compare/v0.16.0...v0.17.0) (2026-03-21)

### Features

* auto-compact JSON output in agent contexts ([#108](https://github.com/archgate/cli/issues/108)) ([314e909](https://github.com/archgate/cli/commit/314e909c72c38c17797f9231b7d739ca8be6519e))

### Bug Fixes

* correct login refresh hint from option to subcommand ([03ffeff](https://github.com/archgate/cli/commit/03ffeff5c82abd3803b69746055360bfd736cb5c))
* resolve consistency issues across CLI codebase ([#101](https://github.com/archgate/cli/issues/101)) ([4e182da](https://github.com/archgate/cli/commit/4e182da79f7943fa6d97af8251707d052077c939))
* security hardening across CLI ([#104](https://github.com/archgate/cli/issues/104)) ([ba2ba49](https://github.com/archgate/cli/commit/ba2ba49bf90b5b7abddd71d298190a621762034c))

## [0.16.0](https://github.com/archgate/cli/compare/v0.15.0...v0.16.0) (2026-03-20)

### Features

* on-demand binary download fallback for npm distribution ([#92](https://github.com/archgate/cli/issues/92)) ([c5512db](https://github.com/archgate/cli/commit/c5512db65d6a7505ed8d7dc1c6cbaa564a92fc31))
* support all installation methods in upgrade command ([#97](https://github.com/archgate/cli/issues/97)) ([8312986](https://github.com/archgate/cli/commit/831298637da042bee53b90769d994cc6018a508a))

### Bug Fixes

* treat rule import failures as errors ([#95](https://github.com/archgate/cli/issues/95)) ([abac53e](https://github.com/archgate/cli/commit/abac53e5739b833fa22247576d9963a3b85a9cfc))

## [0.15.0](https://github.com/archgate/cli/compare/v0.14.0...v0.15.0) (2026-03-19)

### Features

* local rules shim, ARCH-010, and parallel file discovery ([#86](https://github.com/archgate/cli/issues/86)) ([3975be4](https://github.com/archgate/cli/commit/3975be4278db0bc3ac8e57154fda939d2c14fa2e))
* support Git Bash PATH setup in install scripts ([#89](https://github.com/archgate/cli/issues/89)) ([57a5cef](https://github.com/archgate/cli/commit/57a5cef71725b00de2d3a1f2588eaa1a2684a495))

### Bug Fixes

* correct Windows drive letter casing and platform error message ([#91](https://github.com/archgate/cli/issues/91)) ([521d8bf](https://github.com/archgate/cli/commit/521d8bf2dd3a6b2950982f4525fa3a1c4de0004e))

## [0.14.0](https://github.com/archgate/cli/compare/v0.13.2...v0.14.0) (2026-03-19)

### Features

* support binary self-replacement in upgrade command ([#81](https://github.com/archgate/cli/issues/81)) ([561c627](https://github.com/archgate/cli/commit/561c627cecabc99432f6ac66cb1932145c59dabd))

### Bug Fixes

* address AI code quality findings across install scripts and utilities ([#84](https://github.com/archgate/cli/issues/84)) ([4730beb](https://github.com/archgate/cli/commit/4730bebf18a264ee76536ea75b1d648cad0ef0a9))
* address valid AI code quality findings ([#85](https://github.com/archgate/cli/issues/85)) ([b4630d0](https://github.com/archgate/cli/commit/b4630d0d8b1433291d3ea1db41d903f172957d8f))
* resolve documentation inconsistencies and minor code issues ([#82](https://github.com/archgate/cli/issues/82)) ([ec50cca](https://github.com/archgate/cli/commit/ec50ccaff2ff413a4f1a6a446eeea5cbbc6a6da0))

## [0.13.2](https://github.com/archgate/cli/compare/v0.13.1...v0.13.2) (2026-03-18)

### Bug Fixes

* use PROCESSOR_ARCHITECTURE for Windows arch detection in installer ([#79](https://github.com/archgate/cli/issues/79)) ([63afc7e](https://github.com/archgate/cli/commit/63afc7e23d628035417f1b51b135e7d0bf717067))

## [0.13.1](https://github.com/archgate/cli/compare/v0.13.0...v0.13.1) (2026-03-18)

### Bug Fixes

* split upload release asset step for Windows compatibility ([#77](https://github.com/archgate/cli/issues/77)) ([54ba520](https://github.com/archgate/cli/commit/54ba520b668d3ea9dbb3a24f733ad6dc0c53f3a8))

## [0.13.0](https://github.com/archgate/cli/compare/v0.11.2...v0.13.0) (2026-03-18)

### Features

* add ARCH-009 adr, tls platform hints, release lockfile fix, flaky test fixes ([#76](https://github.com/archgate/cli/issues/76)) ([15fdef5](https://github.com/archgate/cli/commit/15fdef5560480a78d22520725af7a49176463aaa))
* standalone installer and GitHub Releases distribution ([#72](https://github.com/archgate/cli/issues/72)) ([09fc5dd](https://github.com/archgate/cli/commit/09fc5dd554e2c444c0c18877392999c041264be9))

### Bug Fixes

* update lockfile and detect TLS errors in login ([#74](https://github.com/archgate/cli/issues/74)) ([2c15d83](https://github.com/archgate/cli/commit/2c15d83404ece9d7678e6cb95e4d1c0f1a80e6fd))

## [0.12.0](https://github.com/archgate/cli/compare/v0.11.2...v0.12.0) (2026-03-18)

### Features

* standalone installer and GitHub Releases distribution ([#72](https://github.com/archgate/cli/issues/72)) ([09fc5dd](https://github.com/archgate/cli/commit/09fc5dd554e2c444c0c18877392999c041264be9))

## [0.11.2](https://github.com/archgate/cli/compare/v0.11.0...v0.11.2) (2026-03-17)

### Bug Fixes

* handle Windows backslash paths in encodeProjectPath ([#69](https://github.com/archgate/cli/issues/69)) ([ad63659](https://github.com/archgate/cli/commit/ad63659e2d717d13236d7983afce2fd5697687a0))
* pin platform package versions to exact release version ([#67](https://github.com/archgate/cli/issues/67)) ([939964a](https://github.com/archgate/cli/commit/939964aa2cd63cba06bd659ec79a0414a63fb324))

## [0.11.1](https://github.com/archgate/cli/compare/v0.11.0...v0.11.1) (2026-03-17)

### Bug Fixes

* pin platform package versions to exact release version ([#67](https://github.com/archgate/cli/issues/67)) ([939964a](https://github.com/archgate/cli/commit/939964aa2cd63cba06bd659ec79a0414a63fb324))

## [0.11.0](https://github.com/archgate/cli/compare/v0.10.0...v0.11.0) (2026-03-16)

### Features

* add `archgate plugin` command group ([#61](https://github.com/archgate/cli/issues/61)) ([24950b4](https://github.com/archgate/cli/commit/24950b4f7874754ddd8d7f923add23c52090ae86))

### Bug Fixes

* **docs:** sync pt-br translations with English source ([#64](https://github.com/archgate/cli/issues/64)) ([e1dd6b7](https://github.com/archgate/cli/commit/e1dd6b792d0ece21a9f7ee3d76c0385717b2f5cb))

## [0.10.0](https://github.com/archgate/cli/compare/v0.9.3...v0.10.0) (2026-03-15)

### Features

* **docs:** maximize SEO discoverability ([#58](https://github.com/archgate/cli/issues/58)) ([4d8b04e](https://github.com/archgate/cli/commit/4d8b04e27202a9ccee7474458a672bfd1c623f79))

### Bug Fixes

* **ci:** prevent release workflow self-cancellation ([#60](https://github.com/archgate/cli/issues/60)) ([63dd9c2](https://github.com/archgate/cli/commit/63dd9c22789eef0cce230f597a1aaad235cf65cd))

## [0.9.3](https://github.com/archgate/cli/compare/v0.9.2...v0.9.3) (2026-03-14)

### Bug Fixes

* **ci:** prevent expression injection in PR title handling ([#55](https://github.com/archgate/cli/issues/55)) ([036615f](https://github.com/archgate/cli/commit/036615fd19cb32a0db46a87b06509cf77a7223a1))

## [0.9.2](https://github.com/archgate/cli/compare/v0.9.1...v0.9.2) (2026-03-13)

### Bug Fixes

* remove stale MCP server configs from editor settings ([#53](https://github.com/archgate/cli/issues/53)) ([5c9fdfd](https://github.com/archgate/cli/commit/5c9fdfd49b5c6cd4962de9c3d08a09bd9363288c)), closes [#50](https://github.com/archgate/cli/issues/50)

## [0.9.1](https://github.com/archgate/cli/compare/v0.9.0...v0.9.1) (2026-03-13)

### Bug Fixes

* pipeline credentials for release ([#49](https://github.com/archgate/cli/issues/49)) ([788961c](https://github.com/archgate/cli/commit/788961c6bc9c278e4528bd6f302c499e40f44abc))

## 0.9.0 (2026-03-12)

### Features

* add VS Code & Copilot CLI as editor targets ([#46](https://github.com/archgate/cli/issues/46)) ([86ce264](https://github.com/archgate/cli/commit/86ce2644f819ee51d2f55b32f5784d0168a99efb))
* add Windows (x64) build and CI smoke test ([#20](https://github.com/archgate/cli/issues/20)) ([e579520](https://github.com/archgate/cli/commit/e579520f94ec785f52390f268833be293f1866d3))
* distribute binaries via npm platform packages ([#7](https://github.com/archgate/cli/issues/7)) ([9fc775c](https://github.com/archgate/cli/commit/9fc775c30278c0e9959326c284a9a793f55a5254))
* **docs:** add Brazilian Portuguese i18n and GEN-002 ADR ([#30](https://github.com/archgate/cli/issues/30)) ([291f1d7](https://github.com/archgate/cli/commit/291f1d7e2d1d9e59795efe14d751d4d6aa12997b))
* **docs:** add Cloudflare Web Analytics ([#33](https://github.com/archgate/cli/issues/33)) ([fe615a0](https://github.com/archgate/cli/commit/fe615a09a6affe09bebd5cef56087fa2fd50c07a))
* **docs:** add Starlight documentation site ([#23](https://github.com/archgate/cli/issues/23)) ([0bf9653](https://github.com/archgate/cli/commit/0bf965397339c29dc83bf3c59f17b17e1ccbc4c1))
* **docs:** port terminal/editor chrome from marketing site ([#34](https://github.com/archgate/cli/issues/34)) ([2457f87](https://github.com/archgate/cli/commit/2457f87579c220779fb45dd08ef0ecc89e4cf387)), closes [#1a1a1](https://github.com/archgate/cli/issues/1a1a1) [#0f0f0](https://github.com/archgate/cli/issues/0f0f0) [#f8f9](https://github.com/archgate/cli/issues/f8f9) [#eef0f2](https://github.com/archgate/cli/issues/eef0f2)
* **init:** add Cursor editor integration with MCP and governance rules ([#15](https://github.com/archgate/cli/issues/15)) ([912405b](https://github.com/archgate/cli/commit/912405b4b6e8738a14d6893f22020b78ac56af25))
* **login:** add github auth and plugin install for init ([#21](https://github.com/archgate/cli/issues/21)) ([e2ec02c](https://github.com/archgate/cli/commit/e2ec02c61dcb115a7b99ff2320ab1dd9b6d43893))
* **mcp:** add cursor_session_context tool ([#17](https://github.com/archgate/cli/issues/17)) ([a82c5b6](https://github.com/archgate/cli/commit/a82c5b644ce107966ba03a4d64deee815481811b))

### Bug Fixes

* add .gitkeep to archgate-win32-x64 bin directory ([#36](https://github.com/archgate/cli/issues/36)) ([204a2e1](https://github.com/archgate/cli/commit/204a2e17fa4e85f0c05b394a263c581d37ffbc7b))
* **ci:** add auto-install to deploy-docs toolchain setup ([#26](https://github.com/archgate/cli/issues/26)) ([cc5805b](https://github.com/archgate/cli/commit/cc5805b26d9300f7e94e1e521a783ae9b133ed19))
* **ci:** add explicit permissions to workflows ([#38](https://github.com/archgate/cli/issues/38)) ([0289273](https://github.com/archgate/cli/commit/02892733fe6c54211c3cb1224cacd79cf187a4bb)), closes [#1](https://github.com/archgate/cli/issues/1) [#2](https://github.com/archgate/cli/issues/2) [#3](https://github.com/archgate/cli/issues/3)
* **ci:** upgrade npm to v11 for OIDC trusted publishing ([#41](https://github.com/archgate/cli/issues/41)) ([13341f3](https://github.com/archgate/cli/commit/13341f3d8168f999ce073510122f12364eeaf294))
* **ci:** use npm trusted publishing (OIDC) instead of secret tokens ([#40](https://github.com/archgate/cli/issues/40)) ([49d94ad](https://github.com/archgate/cli/commit/49d94ad38e1e069a55dbb9aaa797be74ade74b2b))
* **ci:** use workflow-scoped concurrency groups for PR pipelines ([#37](https://github.com/archgate/cli/issues/37)) ([552da08](https://github.com/archgate/cli/commit/552da08ff8f08a376b3cf71ff17f4f418b6d17b8))
* drop --provenance (private repo), use npm-token input for release ([fa7f042](https://github.com/archgate/cli/commit/fa7f04229a98f3b2bc9b674359a03efae8c0c93d))
* improve packaging ([#4](https://github.com/archgate/cli/issues/4)) ([1d8245a](https://github.com/archgate/cli/commit/1d8245accfde307f4189dfc57b9865bbb3c753dd))
* **mcp:** start server without a project and guide onboarding ([3df4ee6](https://github.com/archgate/cli/commit/3df4ee6bd50b65be867bff1acd51126b4a7de638))
* move bundled deps to devDependencies to avoid unnecessary installs ([#19](https://github.com/archgate/cli/issues/19)) ([2a6d62f](https://github.com/archgate/cli/commit/2a6d62f9e05aed797177f6419b3ab11ba98cb220))
* replace Bun.$ shell calls with Bun.spawn for Windows compatibility ([#43](https://github.com/archgate/cli/issues/43)) ([ca33377](https://github.com/archgate/cli/commit/ca33377a11f935dad08aa774253cd89fb2e24134))
* **upgrade:** switch from GitHub API to npm registry for version checks and install ([96ac92a](https://github.com/archgate/cli/commit/96ac92a90edd138bb5af62d1c0deaece5c768eec))
* use ./ prefix for npm publish to avoid GitHub shorthand resolution ([79dce8d](https://github.com/archgate/cli/commit/79dce8d3784e89bed993ea4ea9244c18fd5c2552))
* use NPM_TOKEN for registry auth alongside --provenance ([394d2c5](https://github.com/archgate/cli/commit/394d2c5da66c78f3c3c7329ab659abb412baa304))
* use NPM_TOKEN secret instead of OIDC for npm publish ([4704f33](https://github.com/archgate/cli/commit/4704f3305b2ab726096ba6eb1945b7ef272ea6c1))
* use OIDC provenance for platform packages, NPM_TOKEN for main package ([b8ce61d](https://github.com/archgate/cli/commit/b8ce61d1f3c159486a00534c50fb7aa967b182d8))

## 0.8.2 (2026-03-04)

### Features

* add Windows (x64) build and CI smoke test ([#20](https://github.com/archgate/cli/issues/20)) ([e579520](https://github.com/archgate/cli/commit/e579520f94ec785f52390f268833be293f1866d3))
* distribute binaries via npm platform packages ([#7](https://github.com/archgate/cli/issues/7)) ([9fc775c](https://github.com/archgate/cli/commit/9fc775c30278c0e9959326c284a9a793f55a5254))
* **docs:** add Brazilian Portuguese i18n and GEN-002 ADR ([#30](https://github.com/archgate/cli/issues/30)) ([291f1d7](https://github.com/archgate/cli/commit/291f1d7e2d1d9e59795efe14d751d4d6aa12997b))
* **docs:** add Cloudflare Web Analytics ([#33](https://github.com/archgate/cli/issues/33)) ([fe615a0](https://github.com/archgate/cli/commit/fe615a09a6affe09bebd5cef56087fa2fd50c07a))
* **docs:** add Starlight documentation site ([#23](https://github.com/archgate/cli/issues/23)) ([0bf9653](https://github.com/archgate/cli/commit/0bf965397339c29dc83bf3c59f17b17e1ccbc4c1))
* **docs:** port terminal/editor chrome from marketing site ([#34](https://github.com/archgate/cli/issues/34)) ([2457f87](https://github.com/archgate/cli/commit/2457f87579c220779fb45dd08ef0ecc89e4cf387)), closes [#1a1a1](https://github.com/archgate/cli/issues/1a1a1) [#0f0f0](https://github.com/archgate/cli/issues/0f0f0) [#f8f9](https://github.com/archgate/cli/issues/f8f9) [#eef0f2](https://github.com/archgate/cli/issues/eef0f2)
* **init:** add Cursor editor integration with MCP and governance rules ([#15](https://github.com/archgate/cli/issues/15)) ([912405b](https://github.com/archgate/cli/commit/912405b4b6e8738a14d6893f22020b78ac56af25))
* **login:** add github auth and plugin install for init ([#21](https://github.com/archgate/cli/issues/21)) ([e2ec02c](https://github.com/archgate/cli/commit/e2ec02c61dcb115a7b99ff2320ab1dd9b6d43893))
* **mcp:** add cursor_session_context tool ([#17](https://github.com/archgate/cli/issues/17)) ([a82c5b6](https://github.com/archgate/cli/commit/a82c5b644ce107966ba03a4d64deee815481811b))

### Bug Fixes

* add .gitkeep to archgate-win32-x64 bin directory ([#36](https://github.com/archgate/cli/issues/36)) ([204a2e1](https://github.com/archgate/cli/commit/204a2e17fa4e85f0c05b394a263c581d37ffbc7b))
* **ci:** add auto-install to deploy-docs toolchain setup ([#26](https://github.com/archgate/cli/issues/26)) ([cc5805b](https://github.com/archgate/cli/commit/cc5805b26d9300f7e94e1e521a783ae9b133ed19))
* **ci:** add explicit permissions to workflows ([#38](https://github.com/archgate/cli/issues/38)) ([0289273](https://github.com/archgate/cli/commit/02892733fe6c54211c3cb1224cacd79cf187a4bb)), closes [#1](https://github.com/archgate/cli/issues/1) [#2](https://github.com/archgate/cli/issues/2) [#3](https://github.com/archgate/cli/issues/3)
* **ci:** upgrade npm to v11 for OIDC trusted publishing ([#41](https://github.com/archgate/cli/issues/41)) ([13341f3](https://github.com/archgate/cli/commit/13341f3d8168f999ce073510122f12364eeaf294))
* **ci:** use npm trusted publishing (OIDC) instead of secret tokens ([#40](https://github.com/archgate/cli/issues/40)) ([49d94ad](https://github.com/archgate/cli/commit/49d94ad38e1e069a55dbb9aaa797be74ade74b2b))
* **ci:** use workflow-scoped concurrency groups for PR pipelines ([#37](https://github.com/archgate/cli/issues/37)) ([552da08](https://github.com/archgate/cli/commit/552da08ff8f08a376b3cf71ff17f4f418b6d17b8))
* drop --provenance (private repo), use npm-token input for release ([fa7f042](https://github.com/archgate/cli/commit/fa7f04229a98f3b2bc9b674359a03efae8c0c93d))
* improve packaging ([#4](https://github.com/archgate/cli/issues/4)) ([1d8245a](https://github.com/archgate/cli/commit/1d8245accfde307f4189dfc57b9865bbb3c753dd))
* **mcp:** start server without a project and guide onboarding ([3df4ee6](https://github.com/archgate/cli/commit/3df4ee6bd50b65be867bff1acd51126b4a7de638))
* move bundled deps to devDependencies to avoid unnecessary installs ([#19](https://github.com/archgate/cli/issues/19)) ([2a6d62f](https://github.com/archgate/cli/commit/2a6d62f9e05aed797177f6419b3ab11ba98cb220))
* replace Bun.$ shell calls with Bun.spawn for Windows compatibility ([#43](https://github.com/archgate/cli/issues/43)) ([ca33377](https://github.com/archgate/cli/commit/ca33377a11f935dad08aa774253cd89fb2e24134))
* **upgrade:** switch from GitHub API to npm registry for version checks and install ([96ac92a](https://github.com/archgate/cli/commit/96ac92a90edd138bb5af62d1c0deaece5c768eec))
* use ./ prefix for npm publish to avoid GitHub shorthand resolution ([79dce8d](https://github.com/archgate/cli/commit/79dce8d3784e89bed993ea4ea9244c18fd5c2552))
* use NPM_TOKEN for registry auth alongside --provenance ([394d2c5](https://github.com/archgate/cli/commit/394d2c5da66c78f3c3c7329ab659abb412baa304))
* use NPM_TOKEN secret instead of OIDC for npm publish ([4704f33](https://github.com/archgate/cli/commit/4704f3305b2ab726096ba6eb1945b7ef272ea6c1))
* use OIDC provenance for platform packages, NPM_TOKEN for main package ([b8ce61d](https://github.com/archgate/cli/commit/b8ce61d1f3c159486a00534c50fb7aa967b182d8))

## [0.8.2](https://github.com/archgate/cli/compare/v0.8.1...v0.8.2) (2026-03-03)

### Bug Fixes

* **ci:** upgrade npm to v11 for OIDC trusted publishing ([#41](https://github.com/archgate/cli/issues/41)) ([3a3e490](https://github.com/archgate/cli/commit/3a3e49049af949e260de32aaf56cf3699473b88a))

## [0.8.1](https://github.com/archgate/cli/compare/v0.8.0...v0.8.1) (2026-03-03)

### Bug Fixes

* **ci:** add explicit permissions to workflows ([#38](https://github.com/archgate/cli/issues/38)) ([eddf428](https://github.com/archgate/cli/commit/eddf428ecd02516518482b2cb332d9b5a6c52675)), closes [#1](https://github.com/archgate/cli/issues/1) [#2](https://github.com/archgate/cli/issues/2) [#3](https://github.com/archgate/cli/issues/3)
* **ci:** use npm trusted publishing (OIDC) instead of secret tokens ([#40](https://github.com/archgate/cli/issues/40)) ([786711f](https://github.com/archgate/cli/commit/786711fa8d0339a06d1077005991c3c213bbe657))

## [0.8.0](https://github.com/archgate/cli/compare/v0.7.0...v0.8.0) (2026-03-03)

### Features

* **docs:** port terminal/editor chrome from marketing site ([#34](https://github.com/archgate/cli/issues/34)) ([9d11476](https://github.com/archgate/cli/commit/9d11476db1a773b2169b0fcf89210c16deddded0)), closes [#1a1a1](https://github.com/archgate/cli/issues/1a1a1) [#0f0f0](https://github.com/archgate/cli/issues/0f0f0) [#f8f9](https://github.com/archgate/cli/issues/f8f9) [#eef0f2](https://github.com/archgate/cli/issues/eef0f2)

### Bug Fixes

* add .gitkeep to archgate-win32-x64 bin directory ([#36](https://github.com/archgate/cli/issues/36)) ([3b0c3c3](https://github.com/archgate/cli/commit/3b0c3c332efa87a975387e1e803dff0f0834c6e8))
* **ci:** use workflow-scoped concurrency groups for PR pipelines ([#37](https://github.com/archgate/cli/issues/37)) ([0b1030c](https://github.com/archgate/cli/commit/0b1030cfae6c1f9010aedeb62cc36ba60f4e7d51))

## [0.7.0](https://github.com/archgate/cli/compare/v0.6.0...v0.7.0) (2026-03-01)

### Features

* **docs:** add Brazilian Portuguese i18n and GEN-002 ADR ([#30](https://github.com/archgate/cli/issues/30)) ([e053488](https://github.com/archgate/cli/commit/e053488e00ba21299ef0e23b19962bcfa6ddc928))
* **docs:** add Cloudflare Web Analytics ([#33](https://github.com/archgate/cli/issues/33)) ([529e928](https://github.com/archgate/cli/commit/529e92831004f4d8e5ee4a015964ef405553e91c))

## [0.6.0](https://github.com/archgate/cli/compare/v0.5.0...v0.6.0) (2026-02-28)

### Features

* **docs:** add Starlight documentation site ([#23](https://github.com/archgate/cli/issues/23)) ([ea949f3](https://github.com/archgate/cli/commit/ea949f3cc86bf00bca030f3967c091af7fa3de66))

### Bug Fixes

* **ci:** add auto-install to deploy-docs toolchain setup ([#26](https://github.com/archgate/cli/issues/26)) ([931d89d](https://github.com/archgate/cli/commit/931d89d9dad4215cd9c7b2d393efb1a370879744))

## [0.5.0](https://github.com/archgate/cli/compare/v0.4.0...v0.5.0) (2026-02-28)

### Features

* add Windows (x64) build and CI smoke test ([#20](https://github.com/archgate/cli/issues/20)) ([c59eec4](https://github.com/archgate/cli/commit/c59eec49d10a3f10fa5bd76a122e09ac6e31da38))
* **login:** add github auth and plugin install for init ([#21](https://github.com/archgate/cli/issues/21)) ([ed03063](https://github.com/archgate/cli/commit/ed030636093d142504005c152907c6c22fa8ba9a))

## [0.4.0](https://github.com/archgate/cli/compare/v0.3.0...v0.4.0) (2026-02-26)

### Features

* **mcp:** add cursor_session_context tool ([#17](https://github.com/archgate/cli/issues/17)) ([8cf9f38](https://github.com/archgate/cli/commit/8cf9f383a0a7129d8e4383f1b51b03aeed1c745e))

### Bug Fixes

* move bundled deps to devDependencies to avoid unnecessary installs ([#19](https://github.com/archgate/cli/issues/19)) ([d61d7e0](https://github.com/archgate/cli/commit/d61d7e062ae8ba6ef3fd441784fd6a2a6e4c4243))

## [0.3.0](https://github.com/archgate/cli/compare/v0.2.5...v0.3.0) (2026-02-24)

### Features

* **init:** add Cursor editor integration with MCP and governance rules ([#15](https://github.com/archgate/cli/issues/15)) ([5932530](https://github.com/archgate/cli/commit/593253035da9d764fbc0e7c373fa16b0883284e5))

## [0.2.5](https://github.com/archgate/cli/compare/v0.2.4...v0.2.5) (2026-02-23)

### Bug Fixes

* **upgrade:** switch from GitHub API to npm registry for version checks and install ([254a28b](https://github.com/archgate/cli/commit/254a28b25dd07f44dc72fc93eb5a5bb1009b13e2))

## [0.2.4](https://github.com/archgate/cli/compare/v0.2.3...v0.2.4) (2026-02-23)

### Bug Fixes

* **mcp:** start server without a project and guide onboarding ([5f02fa3](https://github.com/archgate/cli/commit/5f02fa39795fcd72102a6bd68fdee47d0d948560))

## [0.2.3](https://github.com/archgate/cli/compare/v0.2.2...v0.2.3) (2026-02-23)

### Bug Fixes

* drop --provenance (private repo), use npm-token input for release ([503571b](https://github.com/archgate/cli/commit/503571bb73a8e02e85c865df5016e8d38c7e2157))

## [0.2.2](https://github.com/archgate/cli/compare/v0.2.1...v0.2.2) (2026-02-23)

### Bug Fixes

* use NPM_TOKEN for registry auth alongside --provenance ([8fcd418](https://github.com/archgate/cli/commit/8fcd418a049869995b48265cd307833d1b1c519f))

## [0.2.1](https://github.com/archgate/cli/compare/v0.2.0...v0.2.1) (2026-02-23)

### Bug Fixes

* use NPM_TOKEN secret instead of OIDC for npm publish ([347910a](https://github.com/archgate/cli/commit/347910af7f0f43ad9f8283335704ddd6cce58f98))
* use OIDC provenance for platform packages, NPM_TOKEN for main package ([34303cb](https://github.com/archgate/cli/commit/34303cb01c38b26c20920d5b9db81a3dceec34ef))

## [0.2.0](https://github.com/archgate/cli/compare/v0.1.1...v0.2.0) (2026-02-23)

### Features

* distribute binaries via npm platform packages ([#7](https://github.com/archgate/cli/issues/7)) ([e3102f6](https://github.com/archgate/cli/commit/e3102f627bf4da329d6233ef14921dac0b265735))

### Bug Fixes

* use ./ prefix for npm publish to avoid GitHub shorthand resolution ([5f87fa9](https://github.com/archgate/cli/commit/5f87fa9a9624629d6101a30e80790198022bcba5))

## [0.1.1](https://github.com/archgate/cli/compare/v0.1.0...v0.1.1) (2026-02-23)

### Bug Fixes

* improve packaging ([#4](https://github.com/archgate/cli/issues/4)) ([ea910f1](https://github.com/archgate/cli/commit/ea910f178f5f94d9a62b82a0bb82122b7feee991))

## 0.1.0 (2026-02-23)
