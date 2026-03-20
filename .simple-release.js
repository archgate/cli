import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { NpmProject } from "@simple-release/npm";

class ArchgateProject extends NpmProject {
  async bump(options) {
    const result = await super.bump(options);

    if (result) {
      const pkgPath = "package.json";
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const version = pkg.version;
      let changed = false;

      // Sync optionalDependencies (platform-specific npm packages)
      for (const dep of Object.keys(pkg.optionalDependencies || {})) {
        if (pkg.optionalDependencies[dep] !== version) {
          pkg.optionalDependencies[dep] = version;
          changed = true;
        }
      }

      if (changed) {
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        execSync("bun install", { stdio: "inherit" });
        this.changedFiles.push("bun.lock");
      }

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
    }

    return result;
  }
}

export const project = new ArchgateProject();
