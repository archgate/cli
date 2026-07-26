/// <reference path="../rules.d.ts" />

/**
 * Configured documentation locales.
 * When adding a new language, add its directory name here AND in
 * docs/astro.config.mjs under the `locales` key.
 */
const LOCALES = ["pt-br", "nb"];

const CONTENT_ROOT = "docs/src/content/docs";

const LOCALE_LINK_PATTERNS = LOCALES.map(
  (locale) => new RegExp(`(?:href="|\\]\\()/${locale}/`, "gu")
);

/**
 * Accented characters below are expressed as numeric code points rather than
 * literals. A check for mangled encoding must not depend on its own bytes
 * surviving an editor round-trip, and code points stay readable in a diff.
 */

// Named HTML entities for accented letters. Structural entities (&lt; &gt;
// &amp;) are legitimate in MDX and deliberately absent.
const ENTITY_PATTERN =
  /&(?:a|A)(?:ring|elig|circ|cute|grave|tilde);|&(?:o|O)(?:slash|circ|cute|tilde);|&(?:c|C)cedil;|&(?:e|E)(?:circ|cute);|&(?:i|I)acute;|&(?:u|U)(?:acute|uml);/gu;

// Numeric entities in the accented Latin-1 range (192-255 / 0xC0-0xFF).
const NUMERIC_ENTITY_PATTERN =
  /&#(?:19[2-9]|2[0-4]\d|25[0-5]|x[cdefCDEF][\da-fA-F]);/gu;

const LETTER_PATTERN = /\p{L}/gu;

// UTF-8 lead bytes for the Latin-1 supplement, as they render when the bytes
// are mistakenly decoded as Latin-1.
const MOJIBAKE_LEADS = new Set([0xc2, 0xc3]);
// UTF-8 continuation bytes are always 0x80-0xBF, so a lead followed by one of
// these is double-encoded text. Requiring the pair avoids flagging legitimate
// uppercase prose, where 0xC3 is followed by an ASCII letter.
const CONTINUATION_MIN = 0x80;
const CONTINUATION_MAX = 0xbf;

/** Norwegian a-ring, ae, o-slash (lower and upper case). */
const NB_LETTERS = new Set([0xe5, 0xe6, 0xf8, 0xc5, 0xc6, 0xd8]);

/** Portuguese acute, grave, circumflex, tilde, cedilla and diaeresis. */
const PT_BR_LETTERS = new Set([
  0xe0, 0xe1, 0xe2, 0xe3, 0xe7, 0xe9, 0xea, 0xed, 0xf3, 0xf4, 0xf5, 0xfa, 0xfc,
  0xc0, 0xc1, 0xc2, 0xc3, 0xc7, 0xc9, 0xca, 0xcd, 0xd3, 0xd4, 0xd5, 0xda, 0xdc,
]);

/**
 * Diacritics each locale must actually exhibit, with the minimum density
 * (occurrences per 1000 prose letters) a genuine translation shows. Measured
 * corpus minimums are nb 5.9 and pt-br 15.2; fully stripped pages score
 * 0.0-1.1. The thresholds sit between those bands with room to spare.
 */
const LOCALE_DIACRITICS: Record<
  string,
  { letters: Set<number>; minPerThousand: number; label: string }
> = {
  nb: { letters: NB_LETTERS, minPerThousand: 2, label: "Norwegian" },
  "pt-br": { letters: PT_BR_LETTERS, minPerThousand: 5, label: "Portuguese" },
};

// Pages shorter than this carry too little prose for a density signal.
const MIN_PROSE_LETTERS = 200;

// Fenced and inline code hold identifiers, not prose. They must not dilute the
// density measurement, nor contribute a stray accent that masks a stripped page.
function proseOnly(text: string): string {
  return text.replaceAll(/```[\s\S]*?```/gu, " ").replaceAll(/`[^`]*`/gu, " ");
}

function countLetters(text: string): number {
  return (text.match(LETTER_PATTERN) ?? []).length;
}

function countCodePoints(text: string, wanted: Set<number>): number {
  let found = 0;
  for (const char of text) {
    if (wanted.has(char.codePointAt(0) ?? 0)) found++;
  }
  return found;
}

function hasMojibake(line: string): boolean {
  for (let i = 0; i < line.length - 1; i++) {
    if (!MOJIBAKE_LEADS.has(line.codePointAt(i) ?? 0)) continue;
    const next = line.codePointAt(i + 1) ?? 0;
    if (next >= CONTINUATION_MIN && next <= CONTINUATION_MAX) return true;
  }
  return false;
}

export default {
  rules: {
    "no-locale-prefix-in-links": {
      description:
        "Locale pages must not use locale-prefixed internal links — Starlight resolves them automatically",
      severity: "error",
      async check(ctx) {
        await Promise.all(
          LOCALES.map(async (locale, i) => {
            const localePrefix = `${CONTENT_ROOT}/${locale}/`;
            const localeFiles = (
              await ctx.glob(`${localePrefix}**/*.mdx`)
            ).filter((f) => f.startsWith(localePrefix));
            const pattern = LOCALE_LINK_PATTERNS[i];

            const matches = await Promise.all(
              localeFiles.map((file) => ctx.grep(file, pattern))
            );
            for (const fileMatches of matches) {
              for (const m of fileMatches) {
                ctx.report.violation({
                  message: `Internal link contains locale prefix "/${locale}/". Remove the prefix — Starlight resolves locale routes automatically.`,
                  file: m.file,
                  line: m.line,
                  fix: `Replace "/${locale}/..." with "/..." in the link`,
                });
              }
            }
          })
        );
      },
    },
    "i18n-page-parity": {
      description:
        "Every root MDX file must have a corresponding translation in each locale, and vice versa",
      severity: "error",
      async check(ctx) {
        const allMdxFiles = await ctx.glob(`${CONTENT_ROOT}/**/*.mdx`);

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
    "i18n-translation-drift": {
      description:
        "When an English docs file is modified, the corresponding locale file must also be modified in the same changeset",
      severity: "error",
      async check(ctx) {
        // Only meaningful when running against a changeset (PR, staged, etc.)
        if (ctx.changedFiles.length === 0) return;

        const changedSet = new Set(ctx.changedFiles);
        const rootPrefix = `${CONTENT_ROOT}/`;

        // Find changed root (English) MDX files that aren't inside a locale dir
        const changedRootFiles = ctx.changedFiles.filter(
          (f) =>
            f.startsWith(rootPrefix) &&
            f.endsWith(".mdx") &&
            !LOCALES.some((l) => f.startsWith(`${rootPrefix}${l}/`))
        );

        if (changedRootFiles.length === 0) return;

        const localeFileArrays = await Promise.all(
          LOCALES.map((locale) =>
            ctx.glob(`${CONTENT_ROOT}/${locale}/**/*.mdx`)
          )
        );
        const allLocaleFiles = new Set<string>(localeFileArrays.flat());

        for (const rootFile of changedRootFiles) {
          const relativePath = rootFile.replace(rootPrefix, "");

          for (const locale of LOCALES) {
            const localePath = `${CONTENT_ROOT}/${locale}/${relativePath}`;

            // Only flag if the locale file exists but wasn't changed.
            // Missing locale files are already caught by i18n-page-parity.
            if (allLocaleFiles.has(localePath) && !changedSet.has(localePath)) {
              ctx.report.violation({
                message: `English file "${relativePath}" was modified but the ${locale} translation was not updated`,
                file: localePath,
                fix: `Update ${localePath} to reflect the changes in ${rootFile}`,
              });
            }
          }
        }
      },
    },
    "i18n-encoding-corruption": {
      description:
        "Docs pages must not contain entity-escaped or double-encoded accented characters",
      severity: "error",
      async check(ctx) {
        const files = await ctx.glob(`${CONTENT_ROOT}/**/*.mdx`);

        await Promise.all(
          files.map(async (file) => {
            let content: string;
            try {
              content = await ctx.readFile(file);
            } catch {
              return;
            }

            for (const [index, line] of content.split("\n").entries()) {
              const entity =
                line.match(ENTITY_PATTERN) ??
                line.match(NUMERIC_ENTITY_PATTERN);
              if (entity) {
                ctx.report.violation({
                  message: `Accented character written as HTML entity "${entity[0]}" instead of the character itself`,
                  file,
                  line: index + 1,
                  fix: `Replace "${entity[0]}" with the literal accented character`,
                });
              }

              if (hasMojibake(line)) {
                ctx.report.violation({
                  message:
                    "Double-encoded UTF-8 sequence: this text was decoded as Latin-1 and re-saved",
                  file,
                  line: index + 1,
                  fix: "Restore the intended accented character and save the file as UTF-8",
                });
              }
            }
          })
        );
      },
    },
    "i18n-diacritic-density": {
      description:
        "Locale prose must carry its language's diacritics at a plausible density, catching wholesale stripping",
      severity: "error",
      async check(ctx) {
        await Promise.all(
          LOCALES.map(async (locale) => {
            const spec = LOCALE_DIACRITICS[locale];
            if (!spec) return;

            const localePrefix = `${CONTENT_ROOT}/${locale}/`;
            const files = (await ctx.glob(`${localePrefix}**/*.mdx`)).filter(
              (f) => f.startsWith(localePrefix)
            );

            await Promise.all(
              files.map(async (file) => {
                let content: string;
                try {
                  content = await ctx.readFile(file);
                } catch {
                  return;
                }

                const body = proseOnly(content);
                const letters = countLetters(body);
                if (letters < MIN_PROSE_LETTERS) return;

                const density =
                  (countCodePoints(body, spec.letters) / letters) * 1000;
                if (density >= spec.minPerThousand) return;

                ctx.report.violation({
                  message: `${locale} prose carries ${density.toFixed(1)} ${spec.label} accented characters per 1000 letters, below the minimum ${spec.minPerThousand} — diacritics appear to have been stripped`,
                  file,
                  fix: `Restore the ${locale} diacritics in the prose of ${file}`,
                });
              })
            );
          })
        );
      },
    },
  },
} satisfies RuleSet;
