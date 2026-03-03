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
