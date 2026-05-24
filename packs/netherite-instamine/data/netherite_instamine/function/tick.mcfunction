execute as @a unless predicate netherite_instamine:pickaxe run attribute @s minecraft:mining_efficiency base set 0
execute as @a unless predicate netherite_instamine:axe run attribute @s minecraft:mining_efficiency base set 0

execute as @a if predicate netherite_instamine:pickaxe run attribute @s minecraft:mining_efficiency base set 30
execute as @a if predicate netherite_instamine:axe run attribute @s minecraft:mining_efficiency base set 10
