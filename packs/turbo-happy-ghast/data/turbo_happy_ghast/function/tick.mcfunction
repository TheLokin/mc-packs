execute as @e[type=happy_ghast] if predicate turbo_happy_ghast:is_vehicle run attribute @s minecraft:flying_speed base set 0.1
execute as @e[type=happy_ghast] unless predicate turbo_happy_ghast:is_vehicle run attribute @s minecraft:flying_speed base set 0.05
