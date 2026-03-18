import { describe, expect, test } from "bun:test";

import { isTlsError, tlsHintMessage } from "../../src/helpers/tls";

describe("isTlsError", () => {
  test("detects 'self signed certificate in certificate chain'", () => {
    const err = new Error("self signed certificate in certificate chain");
    expect(isTlsError(err)).toBe(true);
  });

  test("detects 'self signed certificate' (without chain suffix)", () => {
    expect(isTlsError(new Error("self signed certificate"))).toBe(true);
  });

  test("detects SELF_SIGNED_CERT_IN_CHAIN code", () => {
    expect(isTlsError(new Error("SELF_SIGNED_CERT_IN_CHAIN"))).toBe(true);
  });

  test("detects 'unable to verify the first certificate'", () => {
    expect(
      isTlsError(new Error("unable to verify the first certificate"))
    ).toBe(true);
  });

  test("detects UNABLE_TO_GET_ISSUER_CERT_LOCALLY code", () => {
    expect(isTlsError(new Error("UNABLE_TO_GET_ISSUER_CERT_LOCALLY"))).toBe(
      true
    );
  });

  test("returns false for unrelated errors", () => {
    expect(isTlsError(new Error("fetch failed"))).toBe(false);
    expect(isTlsError(new Error("ECONNREFUSED"))).toBe(false);
  });

  test("handles non-Error values", () => {
    expect(isTlsError("self signed certificate")).toBe(true);
    expect(isTlsError(42)).toBe(false);
  });
});

describe("tlsHintMessage", () => {
  test("mentions NODE_EXTRA_CA_CERTS", () => {
    expect(tlsHintMessage()).toContain("NODE_EXTRA_CA_CERTS");
  });

  test("mentions corporate proxy", () => {
    expect(tlsHintMessage()).toContain("corporate proxy");
  });

  test("shows shell-appropriate syntax per platform", () => {
    const msg = tlsHintMessage();
    if (process.platform === "win32") {
      expect(msg).toContain("PowerShell:");
      expect(msg).toContain("cmd:");
      expect(msg).toContain("Git Bash:");
    } else {
      expect(msg).toContain("export NODE_EXTRA_CA_CERTS=");
    }
  });
});
