// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import {
  PackMetadataSchema,
  CommunityLinkSchema,
  CommunityLinksFileSchema,
  ImportEntrySchema,
  ImportsManifestSchema,
  parsePackMetadata,
} from "../../src/formats/pack";

describe("PackMetadataSchema", () => {
  test("parses valid pack metadata", () => {
    const result = PackMetadataSchema.parse({
      name: "typescript-strict",
      version: "0.1.0",
      description: "Strict TypeScript conventions",
      maintainers: [{ github: "testuser" }],
      tags: ["language:typescript"],
      requires: [],
    });
    expect(result.name).toBe("typescript-strict");
    expect(result.version).toBe("0.1.0");
    expect(result.maintainers).toHaveLength(1);
  });

  test("applies defaults for optional arrays", () => {
    const result = PackMetadataSchema.parse({
      name: "minimal",
      version: "1.0.0",
      description: "Minimal pack",
      maintainers: [{ github: "user" }],
    });
    expect(result.tags).toEqual([]);
    expect(result.requires).toEqual([]);
  });

  test("rejects missing required fields", () => {
    expect(() =>
      PackMetadataSchema.parse({
        name: "test",
        version: "0.1.0",
        // missing description, maintainers
      })
    ).toThrow();
  });

  test("rejects empty maintainers array", () => {
    expect(() =>
      PackMetadataSchema.parse({
        name: "test",
        version: "0.1.0",
        description: "Test",
        maintainers: [],
      })
    ).toThrow();
  });

  test("rejects invalid name format (uppercase)", () => {
    expect(() =>
      PackMetadataSchema.parse({
        name: "TypeScript-Strict",
        version: "0.1.0",
        description: "Test",
        maintainers: [{ github: "user" }],
      })
    ).toThrow(/kebab-case/u);
  });

  test("rejects invalid name format (starts with number)", () => {
    expect(() =>
      PackMetadataSchema.parse({
        name: "123-pack",
        version: "0.1.0",
        description: "Test",
        maintainers: [{ github: "user" }],
      })
    ).toThrow(/kebab-case/u);
  });

  test("rejects invalid version format", () => {
    expect(() =>
      PackMetadataSchema.parse({
        name: "test",
        version: "v1.0",
        description: "Test",
        maintainers: [{ github: "user" }],
      })
    ).toThrow(/semver/u);
  });

  test("rejects invalid tag format (no namespace)", () => {
    expect(() =>
      PackMetadataSchema.parse({
        name: "test",
        version: "0.1.0",
        description: "Test",
        maintainers: [{ github: "user" }],
        tags: ["typescript"],
      })
    ).toThrow(/namespaced/u);
  });

  test("rejects invalid tag format (uppercase)", () => {
    expect(() =>
      PackMetadataSchema.parse({
        name: "test",
        version: "0.1.0",
        description: "Test",
        maintainers: [{ github: "user" }],
        tags: ["Language:TypeScript"],
      })
    ).toThrow(/namespaced/u);
  });

  test("accepts valid tag with dots", () => {
    const result = PackMetadataSchema.parse({
      name: "test",
      version: "0.1.0",
      description: "Test",
      maintainers: [{ github: "user" }],
      tags: ["runtime:node.js"],
    });
    expect(result.tags).toEqual(["runtime:node.js"]);
  });
});

describe("parsePackMetadata", () => {
  test("parses YAML string into PackMetadata", () => {
    const yaml = `
name: test-pack
version: 0.2.0
description: A test pack
maintainers:
  - github: someone
tags:
  - language:go
`;
    const result = parsePackMetadata(yaml);
    expect(result.name).toBe("test-pack");
    expect(result.version).toBe("0.2.0");
    expect(result.tags).toEqual(["language:go"]);
  });
});

describe("CommunityLinkSchema", () => {
  test("parses valid community link", () => {
    const result = CommunityLinkSchema.parse({
      title: "Example Link",
      url: "https://example.com",
      tags: ["tag1"],
      description: "An example link",
      submittedBy: "user123",
      submittedAt: "2026-01-15",
    });
    expect(result.title).toBe("Example Link");
    expect(result.url).toBe("https://example.com");
  });

  test("rejects invalid URL", () => {
    expect(() =>
      CommunityLinkSchema.parse({
        title: "Bad",
        url: "not-a-url",
        tags: [],
        description: "Bad link",
        submittedBy: "user",
        submittedAt: "2026-01-15",
      })
    ).toThrow();
  });

  test("rejects invalid date format", () => {
    expect(() =>
      CommunityLinkSchema.parse({
        title: "Bad",
        url: "https://example.com",
        tags: [],
        description: "Bad link",
        submittedBy: "user",
        submittedAt: "not-a-date",
      })
    ).toThrow();
  });
});

describe("CommunityLinksFileSchema", () => {
  test("applies default empty links array", () => {
    const result = CommunityLinksFileSchema.parse({});
    expect(result.links).toEqual([]);
  });
});

describe("ImportEntrySchema", () => {
  test("parses valid import entry", () => {
    const result = ImportEntrySchema.parse({
      source: "packs/typescript-strict",
      version: "0.1.0",
      importedAt: "2026-01-15T12:00:00.000Z",
      adrIds: ["ARCH-001", "ARCH-002"],
    });
    expect(result.source).toBe("packs/typescript-strict");
    expect(result.adrIds).toHaveLength(2);
  });

  test("allows optional version", () => {
    const result = ImportEntrySchema.parse({
      source: "acme/repo/path",
      importedAt: "2026-05-10T10:00:00.000Z",
      adrIds: ["GEN-001"],
    });
    expect(result.version).toBeUndefined();
  });
});

describe("ImportsManifestSchema", () => {
  test("applies default empty imports array", () => {
    const result = ImportsManifestSchema.parse({});
    expect(result.imports).toEqual([]);
  });

  test("parses full manifest", () => {
    const result = ImportsManifestSchema.parse({
      imports: [
        {
          source: "packs/test",
          importedAt: "2026-01-01T00:00:00.000Z",
          adrIds: ["ARCH-001"],
        },
      ],
    });
    expect(result.imports).toHaveLength(1);
  });
});
