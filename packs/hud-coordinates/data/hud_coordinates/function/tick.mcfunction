schedule function hud_coordinates:tick 1t

function hud_coordinates:get_24_time

execute as @a at @s run function hud_coordinates:get_player_coords
execute as @a at @s run function hud_coordinates:display_hud
