import antfu from "@antfu/eslint-config"

export default antfu({
  type: "lib",
  stylistic: false,
  node: true,
  typescript: true,
  vue: false,
})
