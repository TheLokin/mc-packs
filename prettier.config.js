/** @type {import('prettier').Config} */
export default {
  semi: false,
  printWidth: 100,
  quoteProps: "consistent",
  plugins: ["prettier-plugin-multiline-arrays"],
  overrides: [
    {
      files: "*.mcmeta",
      options: {
        parser: "json",
      },
    },
  ],
}
