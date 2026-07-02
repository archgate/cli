import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { NpmProject } from "@simple-release/npm";

class ArchgateProject extends NpmProject {
  /**
   * Pre-1.0 semver policy: breaking changes bump the MINOR version, not
   * the major. The project ships no support guarantees yet, so v1.0.0
   * must be an explicit decision — force it via the `version` (or `as`)
   * bump option when the time comes — never an automatic consequence of
   * a `feat!`/BREAKING CHANGE commit landing on main.
   *
   * `bump()` derives its version from this method, so capping here keeps
   * the manifest writes, changelog, release PR title, and tag consistent.
   */
  async getNextVersion(options) {
    const next = await super.getNextVersion(options);

    // Respect explicit overrides and no-op results.
    if (!next || options?.version || options?.as) {
      return next;
    }

    const current = await this.manifest.getVersion();
    const isPreMajor = current?.startsWith("0.");
    const bumpsToMajor = !next.startsWith("0.");

    if (isPreMajor && bumpsToMajor) {
      const minor = Number(current.split(".")[1] ?? 0);
      return `0.${minor + 1}.0`;
    }

    return next;
  }

  async bump(options) {
    const result = await super.bump(options);

    if (result) {
      const pkgPath = "package.json";
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const version = pkg.version;

      // Sync docs/astro.config.mjs softwareVersion
      const astroConfigPath = "docs/astro.config.mjs";
      if (existsSync(astroConfigPath)) {
        const astroConfig = readFileSync(astroConfigPath, "utf8");
        const updated = astroConfig.replace(
          /softwareVersion:\s*"[^"]+"/u,
          `softwareVersion: "${version}"`
        );
        if (updated !== astroConfig) {
          writeFileSync(astroConfigPath, updated);
          this.changedFiles.push(astroConfigPath);
        }
      }

      // Sync docs/public/version.json (used by install scripts)
      const versionJsonPath = "docs/public/version.json";
      const versionPayload = `{ "version": "v${version}" }\n`;
      writeFileSync(versionJsonPath, versionPayload);
      this.changedFiles.push(versionJsonPath);

      // ---------------------------------------------------------------
      // Sync shim package versions
      // ---------------------------------------------------------------

      // PyPI: pyproject.toml
      const pyprojectPath = "shims/pypi/pyproject.toml";
      if (existsSync(pyprojectPath)) {
        const content = readFileSync(pyprojectPath, "utf8");
        const updated = content.replace(
          /^version\s*=\s*"[^"]+"/mu,
          `version = "${version}"`
        );
        if (updated !== content) {
          writeFileSync(pyprojectPath, updated);
          this.changedFiles.push(pyprojectPath);
        }
      }

      // PyPI: _version.py
      const pyVersionPath = "shims/pypi/archgate/_version.py";
      if (existsSync(pyVersionPath)) {
        writeFileSync(pyVersionPath, `__version__ = "${version}"\n`);
        this.changedFiles.push(pyVersionPath);
      }

      // NuGet: .csproj
      const csprojPath = "shims/nuget/Archgate.Tool/Archgate.Tool.csproj";
      if (existsSync(csprojPath)) {
        const content = readFileSync(csprojPath, "utf8");
        const updated = content.replace(
          /<Version>[^<]+<\/Version>/u,
          `<Version>${version}</Version>`
        );
        if (updated !== content) {
          writeFileSync(csprojPath, updated);
          this.changedFiles.push(csprojPath);
        }
      }

      // NuGet: Program.cs version constant (download URL)
      const csProgramPath = "shims/nuget/Archgate.Tool/Program.cs";
      if (existsSync(csProgramPath)) {
        const content = readFileSync(csProgramPath, "utf8");
        const updated = content.replace(
          /private const string Version = "[^"]+"/u,
          `private const string Version = "${version}"`
        );
        if (updated !== content) {
          writeFileSync(csProgramPath, updated);
          this.changedFiles.push(csProgramPath);
        }
      }

      // Go: shim.go version constant
      const goShimPath = "shims/go/internal/shim/shim.go";
      if (existsSync(goShimPath)) {
        const content = readFileSync(goShimPath, "utf8");
        const updated = content.replace(
          /const Version = "[^"]+"/u,
          `const Version = "${version}"`
        );
        if (updated !== content) {
          writeFileSync(goShimPath, updated);
          this.changedFiles.push(goShimPath);
        }
      }

      // Maven: pom.xml (project version, not dependency versions)
      const pomPath = "shims/maven/pom.xml";
      if (existsSync(pomPath)) {
        const content = readFileSync(pomPath, "utf8");
        const updated = content.replace(
          /(<artifactId>archgate-cli<\/artifactId>\s*<version>)[^<]+(<\/version>)/u,
          `$1${version}$2`
        );
        if (updated !== content) {
          writeFileSync(pomPath, updated);
          this.changedFiles.push(pomPath);
        }
      }

      // Maven: Shim.java version constant (download URL)
      const javaShimPath =
        "shims/maven/src/main/java/dev/archgate/cli/Shim.java";
      if (existsSync(javaShimPath)) {
        const content = readFileSync(javaShimPath, "utf8");
        const updated = content.replace(
          /private static final String VERSION = "[^"]+"/u,
          `private static final String VERSION = "${version}"`
        );
        if (updated !== content) {
          writeFileSync(javaShimPath, updated);
          this.changedFiles.push(javaShimPath);
        }
      }

      // RubyGem: version.rb
      const rubyVersionPath = "shims/rubygem/lib/archgate/version.rb";
      if (existsSync(rubyVersionPath)) {
        const content = readFileSync(rubyVersionPath, "utf8");
        const updated = content.replace(
          /VERSION = "[^"]+"/u,
          `VERSION = "${version}"`
        );
        if (updated !== content) {
          writeFileSync(rubyVersionPath, updated);
          this.changedFiles.push(rubyVersionPath);
        }
      }

      // ---------------------------------------------------------------
      // Sync shim package READMEs to the canonical root README.md
      //
      // The npm package publishes the root README directly, so it needs
      // no copy. Every other ecosystem ships its own copy that must stay
      // byte-identical to root (enforced by ARCH-013/shim-readme-sync).
      // ---------------------------------------------------------------
      const rootReadmePath = "README.md";
      if (existsSync(rootReadmePath)) {
        const rootReadme = readFileSync(rootReadmePath, "utf8");
        const shimReadmePaths = [
          "shims/go/README.md",
          "shims/pypi/README.md",
          "shims/nuget/Archgate.Tool/README.md",
          "shims/rubygem/README.md",
          "shims/maven/README.md",
        ];
        for (const readmePath of shimReadmePaths) {
          const existing = existsSync(readmePath)
            ? readFileSync(readmePath, "utf8")
            : null;
          if (existing !== rootReadme) {
            writeFileSync(readmePath, rootReadme);
            this.changedFiles.push(readmePath);
          }
        }
      }

      // ---------------------------------------------------------------
      // Sync shim package LICENSE.md to the canonical root LICENSE.md
      //
      // The npm package publishes the root LICENSE directly, so it needs
      // no copy. Every other ecosystem ships its own copy that must stay
      // byte-identical to root (enforced by ARCH-013/shim-license-sync).
      // Registries and pkg.go.dev detect the license from files inside
      // the package, not from the repository root.
      // ---------------------------------------------------------------
      const rootLicensePath = "LICENSE.md";
      if (existsSync(rootLicensePath)) {
        const rootLicense = readFileSync(rootLicensePath, "utf8");
        const shimLicensePaths = [
          "shims/go/LICENSE.md",
          "shims/pypi/LICENSE.md",
          "shims/nuget/Archgate.Tool/LICENSE.md",
          "shims/rubygem/LICENSE.md",
          "shims/maven/LICENSE.md",
        ];
        for (const licensePath of shimLicensePaths) {
          const existing = existsSync(licensePath)
            ? readFileSync(licensePath, "utf8")
            : null;
          if (existing !== rootLicense) {
            writeFileSync(licensePath, rootLicense);
            this.changedFiles.push(licensePath);
          }
        }
      }
    }

    return result;
  }
}

export const project = new ArchgateProject();
