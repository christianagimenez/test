module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testRegex: ["((\\.|/)(test|spec))\\.ts$"],
  testPathIgnorePatterns: ["/node_modules/", "/out/"],
};
