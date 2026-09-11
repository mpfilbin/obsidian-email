import { describe, it, expect } from "vitest";
import { parseRecipients } from "../../src/view/parse-recipients";

describe("parseRecipients", () => {
  it("parses a single address", () => {
    expect(parseRecipients("a@x.com")).toEqual([{ email: "a@x.com" }]);
  });

  it("parses comma-separated addresses, trimming whitespace", () => {
    expect(parseRecipients(" a@x.com , b@y.com ")).toEqual([{ email: "a@x.com" }, { email: "b@y.com" }]);
  });

  it("returns an empty array for a blank string", () => {
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("   ")).toEqual([]);
  });

  it("drops empty segments from trailing/double commas", () => {
    expect(parseRecipients("a@x.com,, b@y.com,")).toEqual([{ email: "a@x.com" }, { email: "b@y.com" }]);
  });

  it("returns null when any non-empty segment has no @", () => {
    expect(parseRecipients("a@x.com, not-an-email")).toBeNull();
  });
});
