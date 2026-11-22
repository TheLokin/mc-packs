import type { PackBuilder } from "../../scripts/lib/builder"

export default async function build(builder: PackBuilder) {
  await builder.pack("uncraftable-ice")
  await builder.pack("uncraftable-honeycomb")
  await builder.pack("craftable-coral-blocks")
  await builder.pack("sulfur-oxidizes-copper")
  await builder.pack("stonecutter-tweaks")
  await builder.pack("dye-rebalance")
  await builder.pack("cheaper-shulker-boxes")
  await builder.pack("cheaper-armor-trims")
  await builder.pack("duplicate-pottery-sherds")
}
