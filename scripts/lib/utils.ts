import fs from "node:fs/promises"
import path from "node:path"
import { getGameVersions } from "./modrinth"

export interface PackMetadata {
  project_id: string
  version_number: string
  changelog: string
  game_versions: string[]
}

export const readPackMetadata = (packPath: string) =>
  fs
    .readFile(path.join(packPath, "metadata.json"), "utf-8")
    .then((content) => JSON.parse(content))
    .then(
      (data) =>
        ({
          project_id: data.project_id,
          version_number: data.game_version
            ? `${data.version_number}-mc${data.game_version}`
            : data.version_number,
          changelog: data.changelog,
          game_versions: data.game_versions || [data.game_version],
        }) as PackMetadata,
    )

export const ALL_GAME_VERSIONS = await getGameVersions().then((gameVersions) =>
  gameVersions
    .filter((gameVersion) => gameVersion.version_type === "release")
    .map((gameVersion) => gameVersion.version),
)

export interface PackFormat {
  datapack: number | null
  resourcepack: number | null
}

export const PACK_FORMATS: Record<string, PackFormat> = await fs
  .readFile("packs/pack-formats.json", "utf-8")
  .then((content) => JSON.parse(content))
  .catch(() => ({}))
