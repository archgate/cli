/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-npm-main-field": {
      description:
        "Root package.json must not declare a `main` field — npm always publishes it, bundling the CLI into the thin shim",
      severity: "error",
      async check(ctx) {
        let pkgJson: Record<string, unknown>;
        try {
          pkgJson = await ctx.readJSON("package.json");
        } catch {
          return;
        }

        if ("main" in pkgJson) {
          ctx.report.violation({
            message: `package.json declares a "main" field ("${String(pkgJson.main)}") — npm always includes it in the published tarball, bundling the CLI entry point into the thin shim`,
            file: "package.json",
            fix: 'Remove the "main" field; the npm package exposes only bin/archgate.cjs and sub-path exports (e.g. "./rules")',
          });
        }
      },
    },
    "store-identity": {
      description:
        "The Microsoft Store product ID and package identity must be the values Partner Center assigned, and install.ps1 must name the same product",
      severity: "error",
      async check(ctx) {
        let store: unknown;
        let manifest: string;
        let installer: string;
        try {
          store = await ctx.readJSON("distribution/msix/store.json");
          manifest = await ctx.readFile("distribution/msix/AppxManifest.xml");
          installer = await ctx.readFile("install.ps1");
        } catch {
          return;
        }

        const productId =
          typeof store === "object" && store !== null && "productId" in store
            ? String(store.productId)
            : "";
        if (!/^9[A-Z0-9]{11}$/u.test(productId)) {
          ctx.report.violation({
            message: `distribution/msix/store.json productId "${productId}" is not a Microsoft Store product ID`,
            file: "distribution/msix/store.json",
            fix: "Set productId to the 12-character Store ID shown under Product identity in Partner Center (it starts with 9)",
          });
        }

        const installerId = /^\$StoreId = "([^"]*)"/mu.exec(installer)?.[1];
        if (installerId !== productId) {
          ctx.report.violation({
            message: `install.ps1 $StoreId "${String(installerId)}" does not match distribution/msix/store.json productId "${productId}"`,
            file: "install.ps1",
            fix: `Set $StoreId = "${productId}" in install.ps1`,
          });
        }

        // The install pages print the product ID inside the winget command.
        const installPages: string[] = [
          "docs/src/content/docs/getting-started/installation.mdx",
          "docs/src/content/docs/nb/getting-started/installation.mdx",
          "docs/src/content/docs/pt-br/getting-started/installation.mdx",
          "docs/public/llms.txt",
        ];
        const command = `winget install --id ${productId}`;
        for (const file of installPages) {
          let page: string;
          try {
            // oxlint-disable-next-line no-await-in-loop -- sequential read is intentional; files are few and order-independent but must check each
            page = await ctx.readFile(file);
          } catch {
            continue;
          }
          if (!page.includes(command)) {
            ctx.report.violation({
              message: `${file} does not show the Store install command "${command}"`,
              file,
              fix: `Use "${command}" as the Windows install command`,
            });
          }
        }

        // Partner Center issues the publisher as `CN=<GUID>`; the Store
        // rejects a package signed for any other subject.
        const publisher =
          /<Identity\b[^>]*\bPublisher="([^"]*)"/u.exec(manifest)?.[1] ?? "";
        if (
          !/^CN=[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/iu.test(publisher)
        ) {
          ctx.report.violation({
            message: `distribution/msix/AppxManifest.xml Identity Publisher "${publisher}" is not a Partner Center publisher ID`,
            file: "distribution/msix/AppxManifest.xml",
            fix: "Copy Package/Identity/Name, Package/Identity/Publisher (CN=<GUID>) and Package/Properties/PublisherDisplayName from Product identity in Partner Center",
          });
        }
      },
    },
  },
} satisfies RuleSet;
