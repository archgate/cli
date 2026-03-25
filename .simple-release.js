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
          /softwareVersion:\s*"[^"]+"/,
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
    }

    return result;
  }
}

export const project = new ArchgateProject();
