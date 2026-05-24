import fs from "node:fs/promises"
import { getGameVersions } from "./modrinth"

export const ALL_GAME_VERSIONS = await getGameVersions().then((gameVersions) =>
  gameVersions
    .filter((gameVersion) => gameVersion.version_type === "release")
    .map((gameVersion) => gameVersion.version),
)
export const PACK_FORMATS = await fs
  .readFile("packs/pack-formats.json", "utf-8")
  .then((content) => JSON.parse(content))
  .catch(() => ({}))
