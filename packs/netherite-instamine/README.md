# Netherite Instamine

Expands instamine compatibility to harder blocks, like deepslate, nether bricks, end stone, and a wide range of wood types, whenever you wield an Efficiency V pickaxe or axe under Haste II.

## How it works

This solution takes advantage of the `minecraft:mining_efficiency` attribute introduced in snapshot [24w18a](https://www.minecraft.net/es-es/article/minecraft-snapshot-24w18a), which adds a mining speed factor when using an appropriate tool. The attribute is applied only while you are holding a pickaxe or axe with Efficiency V and you have Haste II. Once the conditions are no longer met, the attribute is automatically restored to its default value. Because of this, there are no side effects. You only get faster mining for blocks that usually cannot be instamined.
