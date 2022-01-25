import { Environment } from "../../common/src/env/env";
import { VSCodeUI } from "./ui";

describe("makeURL", () => {
  const env = new Environment("beta");
  const ui: VSCodeUI = new VSCodeUI(env, null!, null!, null!, null!);

  test("clientid argument only", () => {
    const url = ui.makeURL("/hello/world", "xyz123");
    expect(url).toBe("https://notebooks.codelingo.io/hello/world?clientid=xyz123");
  });

  test("sharing: should not include clientid", () => {
    const url = ui.makeURL("/hello/world", "xyz123", { forSharing: true });
    expect(url).toBe("https://notebooks.codelingo.io/hello/world?action=open");
  });
});
