# Maintainers

This document lists the maintainers of the Archgate CLI project and describes the access continuity plan to ensure the project can continue with minimal interruption if any single contributor becomes unavailable.

## Current Maintainers

| Name          | GitHub                                           | Role            | Scope                                                     |
| ------------- | ------------------------------------------------ | --------------- | --------------------------------------------------------- |
| Rhuan Barreto | [@rhuanbarreto](https://github.com/rhuanbarreto) | Lead Maintainer | Full project access (code, releases, infrastructure, DNS) |

## Becoming a Maintainer

We welcome new maintainers. To be considered, a contributor should:

1. Have a history of meaningful contributions (code, docs, reviews, or community support)
2. Demonstrate understanding of the project's ADR governance model
3. Be nominated by an existing maintainer
4. Agree to follow the project's [Code of Conduct](CODE_OF_CONDUCT.md) and [Contributing Guidelines](CONTRIBUTING.md)

If you are interested in becoming a maintainer, open a discussion in [GitHub Discussions](https://github.com/archgate/cli/discussions) or reach out to an existing maintainer.

## Access Continuity Plan

The project maintains the following access continuity measures to ensure it can create and close issues, accept proposed changes, and release new versions within a week of any single contributor becoming unavailable:

### Critical Access Points

| Resource                                             | Access Level    | Backup Mechanism                                     |
| ---------------------------------------------------- | --------------- | ---------------------------------------------------- |
| GitHub repository (admin)                            | Lead Maintainer | GitHub organization ownership with recovery contacts |
| npm publishing (`archgate` package)                  | Lead Maintainer | npm organization with granular access tokens         |
| Domain (`archgate.dev`, `cli.archgate.dev`)          | Lead Maintainer | Domain registrar account with recovery email         |
| Cloudflare Pages (docs hosting)                      | Lead Maintainer | Cloudflare account with recovery mechanisms          |
| Plugin distribution service (`plugins.archgate.dev`) | Lead Maintainer | Infrastructure documented in internal runbooks       |
| GitHub Actions secrets                               | Lead Maintainer | Documented in internal access registry               |

### Continuity Measures

1. **GitHub Organization:** The `archgate` GitHub organization has recovery contacts configured. Organization ownership can be transferred through GitHub's account recovery process.

2. **npm Access:** The `archgate` npm package is published under an npm organization, enabling additional maintainers to be granted publish access without sharing individual credentials.

3. **Release Process:** The release workflow (`.github/workflows/release.yml` and `.github/workflows/release-binaries.yml`) is fully automated via GitHub Actions. Any maintainer with write access can trigger a release by pushing a version tag.

4. **Documentation:** The documentation site builds and deploys automatically from the `main` branch. No manual intervention is required for docs updates.

5. **Secrets and Credentials:** All project secrets (API keys, tokens, signing keys) are stored in GitHub Actions secrets and a secure credential vault. Access procedures are documented internally and can be transferred to a successor maintainer.

6. **Bus Factor Improvement:** The project is actively working to onboard additional maintainers to increase the bus factor above 1. This includes:
   - Comprehensive documentation of all processes in this file and [CONTRIBUTING.md](CONTRIBUTING.md)
   - Automated CI/CD pipelines that require minimal manual intervention
   - Self-governance via ADRs that document architectural decisions independently of any individual

### Emergency Contact

For urgent access or continuity concerns, contact: **hello@archgate.dev**
