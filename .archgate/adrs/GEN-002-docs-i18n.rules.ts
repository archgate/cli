import { defineRules } from "../../src/formats/rules";

/**
 * Configured documentation locales.
 * When adding a new language, add its directory name here AND in
 * docs/astro.config.mjs under the `locales` key.
 */
const LOCALES = ["pt-br"];

const CONTENT_ROOT = "docs/src/content/docs";

export default defineRules({
  "i18n-page-parity": {
    description:
      "Every root MDX file must have a corresponding translation in each locale, and vice versa",
    severity: "error",
    async check(ctx) {
      const allMdxFiles = await ctx.glob(`${CONTENT_ROOT}/**/*.mdx`);

      // Separate root files from locale files
      const rootFiles: string[] = [];
      const localeFiles = new Map<string, string[]>();

      for (const locale of LOCALES) {
        localeFiles.set(locale, []);
      }

      for (const file of allMdxFiles) {
        const matchedLocale = LOCALES.find((l) =>
          file.startsWith(`${CONTENT_ROOT}/${l}/`)
        );
        if (matchedLocale) {
          localeFiles.get(matchedLocale)!.push(file);
        } else {
          rootFiles.push(file);
        }
      }

      const rootRelativePaths = rootFiles.map((f) =>
        f.replace(`${CONTENT_ROOT}/`, "")
      );
      const rootRelativeSet = new Set(rootRelativePaths);

      for (const locale of LOCALES) {
        const localePrefix = `${CONTENT_ROOT}/${locale}/`;
        const existingLocaleRelatives = new Set(
          localeFiles.get(locale)!.map((f) => f.replace(localePrefix, ""))
        );

        // Root -> locale: missing translations
        for (const relativePath of rootRelativePaths) {
          if (!existingLocaleRelatives.has(relativePath)) {
            ctx.report.violation({
              message: `Missing ${locale} translation for "${relativePath}"`,
              file: `${CONTENT_ROOT}/${relativePath}`,
              fix: `Create translated file at ${localePrefix}${relativePath}`,
            });
          }
        }

        // Locale -> root: orphan translations
        for (const localeRelative of existingLocaleRelatives) {
          if (!rootRelativeSet.has(localeRelative)) {
            ctx.report.violation({
              message: `Orphan ${locale} translation "${localeRelative}" has no corresponding root file`,
              file: `${localePrefix}${localeRelative}`,
              fix: `Either create the root file at ${CONTENT_ROOT}/${localeRelative} or remove the orphan translation`,
            });
          }
        }
      }
    },
  },
});
