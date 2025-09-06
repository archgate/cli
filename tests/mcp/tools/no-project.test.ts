import { describe, expect, test } from "bun:test";
import { noProjectResponse } from "../../../src/mcp/tools/no-project";

describe("noProjectResponse", () => {
  test("returns a content array with one text entry", () => {
    const response = noProjectResponse();
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe("text");
  });

  test("parsed JSON contains error, message, and action fields", () => {
    const response = noProjectResponse();
    const parsed = JSON.parse(response.content[0].text) as Record<
      string,
      string
    >;
    expect(parsed.error).toBe("no_project");
    expect(typeof parsed.message).toBe("string");
    expect(typeof parsed.action).toBe("string");
  });

  test("action mentions @archgate:onboard skill", () => {
    const response = noProjectResponse();
    const parsed = JSON.parse(response.content[0].text) as Record<
      string,
      string
    >;
    expect(parsed.action).toContain("@archgate:onboard");
  });
});
