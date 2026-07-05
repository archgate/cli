---
name: project-i18n-translation-quality
description: Norwegian/pt-br docs translation quality checks not covered by GEN-002's automated structural rules
metadata:
  type: project
---

- **Docs have TWO locales: `nb/` AND `pt-br/`.** Editing any English docs page requires updating BOTH locale trees in the same changeset (GEN-002 `i18n-translation-drift` is error-severity). Locale pages can also silently lack whole sections present in English — the drift rule only checks that the file was touched, not content parity, so compare section structure manually.
- **Norwegian (nb/) diacritical corruption patterns to scan for:** (1) stripped diacriticals (`monster` for `mønster`, `a` for `å`), (2) ASCII approximations (`aa`/`oe`/`ae` for `å`/`ø`/`æ`), (3) HTML entities (`&aring;`/`&oslash;`/`&aelig;`). GEN-002 only checks structural i18n, not diacritical correctness — that needs manual/AI review. Watch words: må, når, på, også, både, får, bør, før, første, følger, kjører, mønster, nøkkel, verktøy, nødvendig, støtter, foreslår, påvirkning, forårsaker, primær, erklæring, miljø, overføring.
