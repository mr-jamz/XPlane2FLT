import { describe, expect, it } from "vitest";
import { parseOptionDefaults } from "./files";

describe("parseOptionDefaults", () => {
  it("maps saved aircraft options to the plugin configuration namespace", () => {
    expect(parseOptionDefaults(`
exterior=1
esss=0
variant=2
tailnum=24611
`, ["uh60m"])).toEqual({
      "uh60m/conf/exterior": 1,
      "uh60m/conf/esss": 0,
      "uh60m/conf/variant": 2,
      "uh60m/conf/tailnum": 24611,
    });
  });
});
