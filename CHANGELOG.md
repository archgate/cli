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
