/** @type {import('prettier').Config} */

export default {
  semi: false,
  printWidth: 100,
  quoteProps: "consistent",
  overrides: [
    {
      files: "*.mcmeta",
      options: {
        parser: "json",
      },
    },
  ],
}
