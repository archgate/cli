import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { NpmProject } from "@simple-release/npm";

class ArchgateProject extends NpmProject {
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
    }

    return result;
  }
}

export const project = new ArchgateProject();
