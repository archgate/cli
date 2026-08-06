/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "docs-version-sync": {
      description:
        "softwareVersion in docs/astro.config.mjs must match package.json version",
      severity: "error",
      async check(ctx) {
        const pkgJson = await ctx.readJSON("package.json");
        if (pkgJson.version === undefined || pkgJson.version === "") return;

        let astroConfig: string;
        try {
          astroConfig = await ctx.readFile("docs/astro.config.mjs");
        } catch {
          // docs/astro.config.mjs may not exist in all contexts
          return;
        }

        const match = /softwareVersion:\s*"([^"]+)"/u.exec(astroConfig);
        if (!match) return;

        const docsVersion = match[1];
        if (docsVersion !== pkgJson.version) {
          ctx.report.violation({
            message: `docs/astro.config.mjs softwareVersion "${docsVersion}" does not match package.json version "${pkgJson.version}"`,
            file: "docs/astro.config.mjs",
            fix: `Update softwareVersion to "${pkgJson.version}" in docs/astro.config.mjs`,
          });
        }
      },
    },
    "shim-version-sync": {
      description: "All shim package versions must match package.json version",
      severity: "error",
      async check(ctx) {
        const pkgJson = await ctx.readJSON("package.json");
        if (pkgJson.version === undefined || pkgJson.version === "") return;
        const expected = pkgJson.version;

        // `required` fields must match their pattern. Without it a field whose
        // format stops matching is skipped in silence by both this rule and
        // the `.simple-release.js` bump hook, so a manifest can ship pointing
        // at an asset that was never published.
        const shimFiles: Array<{
          file: string;
          pattern: RegExp;
          label: string;
          required?: boolean;
        }> = [
          {
            file: "shims/pypi/pyproject.toml",
            pattern: /^version\s*=\s*"([^"]+)"/mu,
            label: "PyPI pyproject.toml",
          },
          {
            file: "shims/pypi/archgate/_version.py",
            pattern: /__version__\s*=\s*"([^"]+)"/u,
            label: "PyPI _version.py",
          },
          {
            file: "shims/nuget/Archgate.Tool/Archgate.Tool.csproj",
            pattern: /<Version>([^<]+)<\/Version>/u,
            label: "NuGet .csproj",
          },
          {
            file: "shims/nuget/Archgate.Tool/Program.cs",
            pattern: /private const string Version = "([^"]+)"/u,
            label: "NuGet Program.cs",
          },
          {
            file: "shims/go/internal/shim/shim.go",
            pattern: /const Version = "([^"]+)"/u,
            label: "Go shim.go",
          },
          {
            file: "shims/maven/pom.xml",
            pattern:
              /<artifactId>archgate-cli<\/artifactId>\s*<version>([^<]+)<\/version>/u,
            label: "Maven pom.xml",
          },
          {
            file: "shims/maven/src/main/java/dev/archgate/cli/Shim.java",
            pattern: /private static final String VERSION = "([^"]+)"/u,
            label: "Maven Shim.java",
          },
          {
            file: "shims/rubygem/lib/archgate/version.rb",
            pattern: /VERSION\s*=\s*"([^"]+)"/u,
            label: "RubyGem version.rb",
          },
          {
            file: "shims/winget/manifests/Archgate.Archgate.yaml",
            pattern: /^PackageVersion:\s*"([^"]+)"/mu,
            label: "winget version manifest",
            required: true,
          },
          {
            file: "shims/winget/manifests/Archgate.Archgate.installer.yaml",
            pattern: /^PackageVersion:\s*"([^"]+)"/mu,
            label: "winget installer manifest",
            required: true,
          },
          {
            file: "shims/winget/manifests/Archgate.Archgate.locale.en-US.yaml",
            pattern: /^PackageVersion:\s*"([^"]+)"/mu,
            label: "winget locale manifest",
            required: true,
          },
          // The two URLs embed the version too. A manifest whose
          // PackageVersion is current but whose URL is stale points winget at
          // the wrong release asset, so each is matched on its own.
          {
            file: "shims/winget/manifests/Archgate.Archgate.installer.yaml",
            pattern: /InstallerUrl:\s*"[^"]*\/releases\/download\/v([^/]+)/u,
            label: "winget InstallerUrl",
            required: true,
          },
          {
            file: "shims/winget/manifests/Archgate.Archgate.locale.en-US.yaml",
            pattern: /ReleaseNotesUrl:\s*\S*\/releases\/tag\/v(\S+)/u,
            label: "winget ReleaseNotesUrl",
            required: true,
          },
        ];

        for (const { file, pattern, label, required } of shimFiles) {
          let content: string;
          try {
            // oxlint-disable-next-line no-await-in-loop -- sequential read is intentional; files are few and order-independent but must check each
            content = await ctx.readFile(file);
          } catch {
            // Shim file may not exist yet
            continue;
          }

          const match = pattern.exec(content);
          if (!match) {
            if (required === true) {
              ctx.report.violation({
                message: `${label} is missing or malformed in ${file}`,
                file,
                fix: `Restore the expected format so the version is readable — the bump hook rewrites this field only when it matches ${String(pattern)}`,
              });
            }
            continue;
          }

          const shimVersion = match[1];
          if (shimVersion !== expected) {
            ctx.report.violation({
              message: `${label} version "${shimVersion}" does not match package.json version "${expected}"`,
              file,
              fix: `Update version to "${expected}" in ${file} (automated by .simple-release.js)`,
            });
          }
        }
      },
    },
    "shim-readme-sync": {
      description:
        "All shim package READMEs must be byte-identical to the canonical root README.md",
      severity: "error",
      async check(ctx) {
        let canonical: string;
        try {
          canonical = await ctx.readFile("README.md");
        } catch {
          // Root README.md should always exist; skip if running in a context without it
          return;
        }

        // .gitattributes enforces eol=lf, but normalize trailing newlines and
        // CRLF defensively so the rule is stable across platforms.
        const normalize = (s: string): string =>
          s.replaceAll("\r\n", "\n").trimEnd();
        const expected = normalize(canonical);

        // The npm package publishes the root README.md directly (package.json
        // "readme" + npm always-include), so it is excluded here. Every other
        // shim ecosystem ships its own copy that must mirror the root.
        const shimReadmes: string[] = [
          "shims/go/README.md",
          "shims/maven/README.md",
          "shims/nuget/Archgate.Tool/README.md",
          "shims/pypi/README.md",
          "shims/rubygem/README.md",
        ];

        for (const file of shimReadmes) {
          let content: string;
          try {
            // oxlint-disable-next-line no-await-in-loop -- sequential read is intentional; files are few and order-independent but must check each
            content = await ctx.readFile(file);
          } catch {
            // Shim README may not exist yet
            continue;
          }

          if (normalize(content) !== expected) {
            ctx.report.violation({
              message: `${file} is out of sync with the canonical root README.md`,
              file,
              fix: `Copy README.md to ${file} (e.g. \`cp README.md ${file}\`) so all package READMEs stay identical`,
            });
          }
        }
      },
    },
    "shim-license-sync": {
      description:
        "All shim package LICENSE.md files must be byte-identical to the canonical root LICENSE.md",
      severity: "error",
      async check(ctx) {
        let canonical: string;
        try {
          canonical = await ctx.readFile("LICENSE.md");
        } catch {
          // Root LICENSE.md should always exist; skip if running in a context without it
          return;
        }

        // .gitattributes enforces eol=lf, but normalize trailing newlines and
        // CRLF defensively so the rule is stable across platforms.
        const normalize = (s: string): string =>
          s.replaceAll("\r\n", "\n").trimEnd();
        const expected = normalize(canonical);

        // The npm package publishes the root LICENSE.md directly (npm
        // always-include), so it is excluded here. Every other shim ecosystem
        // ships its own copy that must mirror the root — registries and
        // pkg.go.dev detect the license from files inside the package, not
        // from the repository root.
        const shimLicenses: string[] = [
          "shims/go/LICENSE.md",
          "shims/maven/LICENSE.md",
          "shims/nuget/Archgate.Tool/LICENSE.md",
          "shims/pypi/LICENSE.md",
          "shims/rubygem/LICENSE.md",
        ];

        for (const file of shimLicenses) {
          let content: string;
          try {
            // oxlint-disable-next-line no-await-in-loop -- sequential read is intentional; files are few and order-independent but must check each
            content = await ctx.readFile(file);
          } catch {
            // Shim LICENSE may not exist yet
            continue;
          }

          if (normalize(content) !== expected) {
            ctx.report.violation({
              message: `${file} is out of sync with the canonical root LICENSE.md`,
              file,
              fix: `Copy LICENSE.md to ${file} (e.g. \`cp LICENSE.md ${file}\`) so all package licenses stay identical`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
