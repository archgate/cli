/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "docs-version-sync": {
      description:
        "softwareVersion in docs/astro.config.mjs must match package.json version",
      severity: "error",
      async check(ctx) {
        const pkgJson = await ctx.readJSON("package.json");
        if (!pkgJson.version) return;

        let astroConfig: string;
        try {
          astroConfig = await ctx.readFile("docs/astro.config.mjs");
        } catch {
          // docs/astro.config.mjs may not exist in all contexts
          return;
        }

        const match = astroConfig.match(/softwareVersion:\s*"([^"]+)"/u);
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
        if (!pkgJson.version) return;
        const expected = pkgJson.version as string;

        const shimFiles: Array<{
          file: string;
          pattern: RegExp;
          label: string;
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
            file: "shims/rubygem/lib/archgate/version.rb",
            pattern: /VERSION\s*=\s*"([^"]+)"/u,
            label: "RubyGem version.rb",
          },
        ];

        for (const { file, pattern, label } of shimFiles) {
          let content: string;
          try {
            // oxlint-disable-next-line no-await-in-loop -- sequential read is intentional; files are few and order-independent but must check each
            content = await ctx.readFile(file);
          } catch {
            // Shim file may not exist yet
            continue;
          }

          const match = content.match(pattern);
          if (!match) continue;

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
  },
} satisfies RuleSet;
