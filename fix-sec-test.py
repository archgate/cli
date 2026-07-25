import io

p = "tests/commands/check-security.test.ts"
s = io.open(p, encoding="utf-8", newline="").read()


def swap(old, new):
    global s
    assert old in s, "not found:\n" + old[:200]
    s = s.replace(old, new, 1)


# Shared capability probes + outside-dir cleanup harness.
swap(
    'describe("check command security", () => {\n'
    "  let tempDir: string;\n"
    "  let adrsDir: string;\n",
    "/**\n"
    " * Whether this platform/account can create a link of the given kind. Windows\n"
    " * allows directory junctions unprivileged but needs elevation for file\n"
    " * symlinks, so the two are probed separately.\n"
    " */\n"
    'function canLink(kind: "dir" | "file"): boolean {\n'
    '  const probe = mkdtempSync(join(tmpdir(), "archgate-linkprobe-"));\n'
    "  try {\n"
    '    if (kind === "dir") {\n'
    '      symlinkSync(probe, join(probe, "link"), "junction");\n'
    "    } else {\n"
    '      writeFileSync(join(probe, "f.txt"), "x");\n'
    '      symlinkSync(join(probe, "f.txt"), join(probe, "link.txt"));\n'
    "    }\n"
    "    return true;\n"
    "  } catch {\n"
    "    return false;\n"
    "  } finally {\n"
    "    rmSync(probe, { recursive: true, force: true });\n"
    "  }\n"
    "}\n"
    "\n"
    'const DIR_LINKS = canLink("dir");\n'
    'const FILE_LINKS = canLink("file");\n'
    "\n"
    'describe("check command security", () => {\n'
    "  let tempDir: string;\n"
    "  let adrsDir: string;\n"
    "  let outsideDirs: string[];\n",
)

swap(
    "    mkdirSync(join(tempDir, \"src\"), { recursive: true });\n  });",
    "    mkdirSync(join(tempDir, \"src\"), { recursive: true });\n"
    "    outsideDirs = [];\n  });",
)

swap(
    "  afterEach(() => {\n"
    "    rmSync(tempDir, { recursive: true, force: true });\n"
    "  });",
    "  // Cleanup runs here, not after each assertion: a failing expect() throws\n"
    "  // immediately, so a trailing rmSync would be skipped and leak the dir.\n"
    "  afterEach(() => {\n"
    "    rmSync(tempDir, { recursive: true, force: true });\n"
    "    for (const dir of outsideDirs) {\n"
    "      rmSync(dir, { recursive: true, force: true });\n"
    "    }\n"
    "  });\n"
    "\n"
    "  /** A temp directory outside the project root, removed in afterEach. */\n"
    "  function makeOutsideDir(): string {\n"
    '    const dir = mkdtempSync(join(tmpdir(), "archgate-outside-"));\n'
    "    outsideDirs.push(dir);\n"
    "    return dir;\n"
    "  }",
)

# Leaf file-symlink test (pre-existing): convert to skipIf.
swap(
    '  test("blocks symlink to file outside project", async () => {\n'
    "    // Create a real file outside the project\n"
    '    const outsideDir = mkdtempSync(join(tmpdir(), "archgate-outside-"));\n'
    '    writeFileSync(join(outsideDir, "secret.txt"), "sensitive data");\n'
    "\n"
    "    // Create a symlink inside the project pointing outside\n"
    "    try {\n"
    "      symlinkSync(\n"
    '        join(outsideDir, "secret.txt"),\n'
    '        join(tempDir, "src", "linked.txt")\n'
    "      );\n"
    "    } catch {\n"
    "      // Symlink creation may fail on Windows without admin privileges — skip\n"
    "      rmSync(outsideDir, { recursive: true, force: true });\n"
    "      return;\n"
    "    }\n",
    '  test.skipIf(!FILE_LINKS)(\n    "blocks symlink to file outside project",\n    async () => {\n'
    "    const outsideDir = makeOutsideDir();\n"
    '    writeFileSync(join(outsideDir, "secret.txt"), "sensitive data");\n'
    "    symlinkSync(\n"
    '      join(outsideDir, "secret.txt"),\n'
    '      join(tempDir, "src", "linked.txt")\n'
    "    );\n",
)

swap(
    "    const loaded = await loadRuleAdrs(tempDir);\n"
    "    const result = await runChecks(tempDir, loaded);\n"
    '    expect(result.results[0].error).toContain("symbolic link");\n'
    "\n"
    "    rmSync(outsideDir, { recursive: true, force: true });\n"
    "  });",
    "    const loaded = await loadRuleAdrs(tempDir);\n"
    "    const result = await runChecks(tempDir, loaded);\n"
    '    expect(result.results[0].error).toContain("symbolic link");\n'
    "  }\n  );",
)

# Ancestor directory-symlink test: convert to skipIf.
swap(
    '  test("blocks reads that tunnel out through a symlinked ancestor directory", async () => {\n',
    "  test.skipIf(!DIR_LINKS)(\n"
    '    "blocks reads that tunnel out through a symlinked ancestor directory",\n'
    "    async () => {\n",
)

swap(
    "    const outsideDir = mkdtempSync(join(tmpdir(), \"archgate-outside-\"));\n"
    '    writeFileSync(join(outsideDir, "secret.txt"), "sensitive data");\n'
    "\n"
    "    try {\n"
    '      // "junction" is ignored on POSIX (plain symlink) but on Windows creates\n'
    "      // a directory junction, which needs no admin privileges and which\n"
    "      // lstat() reports as a symbolic link — so unlike the file-symlink test\n"
    "      // above, this case runs for real on every platform instead of skipping.\n"
    '      symlinkSync(outsideDir, join(tempDir, "src", "linkdir"), "junction");\n'
    "    } catch {\n"
    "      rmSync(outsideDir, { recursive: true, force: true });\n"
    "      return;\n"
    "    }\n",
    "    const outsideDir = makeOutsideDir();\n"
    '    writeFileSync(join(outsideDir, "secret.txt"), "sensitive data");\n'
    '    // "junction" is ignored on POSIX; on Windows it needs no elevation and\n'
    "    // lstat reports it as a symlink, so this runs on every platform.\n"
    '    symlinkSync(outsideDir, join(tempDir, "src", "linkdir"), "junction");\n',
)

swap(
    "    const loaded = await loadRuleAdrs(tempDir);\n"
    "    const result = await runChecks(tempDir, loaded);\n"
    '    expect(result.results[0].error).toContain("access denied");\n'
    '    expect(result.results[0].error).toContain("symbolic link");\n'
    "\n"
    "    rmSync(outsideDir, { recursive: true, force: true });\n"
    "  });",
    "    const loaded = await loadRuleAdrs(tempDir);\n"
    "    const result = await runChecks(tempDir, loaded);\n"
    '    expect(result.results[0].error).toContain("access denied");\n'
    '    expect(result.results[0].error).toContain("symbolic link");\n'
    "  }\n  );",
)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("converted check-security.test.ts")
