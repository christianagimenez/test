import { MemoisedBranchChooser } from "./MemoisedBranchChooser";

export {};

describe("MemoisedBranchChooser", () => {
  test("memoise", async () => {
    const chooseDifferentBranchAction = jest.fn(async () => "stay-on-current" as const);
    const ui = {
      chooseDifferentBranchAction,
      chooseFetchWhenBranchMissing: jest.fn(),
      showError: jest.fn(),
    };
    const chooser = new MemoisedBranchChooser("main", ui);
    const choice1 = await chooser.choose("dev");
    expect(choice1).toBe("stay-on-current");
    const choice2 = await chooser.choose("dev");
    expect(choice2).toBe("stay-on-current");
    expect(chooseDifferentBranchAction).toBeCalledTimes(1); // i.e. memoised the second time
  });

  test("don't memoise no choice", async () => {
    const chooseDifferentBranchAction = jest.fn(async () => undefined);
    const ui = {
      chooseDifferentBranchAction,
      chooseFetchWhenBranchMissing: jest.fn(),
      showError: jest.fn(),
    };
    const chooser = new MemoisedBranchChooser("main", ui);
    const choice1 = await chooser.choose("dev");
    expect(choice1).toBe(undefined);
    const choice2 = await chooser.choose("dev");
    expect(choice2).toBe(undefined);
    expect(chooseDifferentBranchAction).toBeCalledTimes(2); // i.e. memoised the second time
  });
});
