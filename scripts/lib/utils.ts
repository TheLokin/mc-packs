import fs from "node:fs/promises"
import path from "node:path"
import { error } from "./console"
import { getGameVersions } from "./modrinth"
import { generatePackFormats } from "./scrape"

export const ALL_GAME_VERSIONS = await getGameVersions().then((gameVersions) =>
  gameVersions
    .filter(
      ({ version }) =>
        /^\d+(?:\.\d+){0,2}$/.test(version) ||
        /^\d{2}w\d{2}[a-z]$/i.test(version) ||
        /^\d{2}\.\d+(?:\.\d+)?-(?:snapshot|rc|pre)-\d+$/i.test(version) ||
        /^\d+(?:\.\d+){0,2}-(?:rc|pre)\d+$/i.test(version),
    )
    .map(({ version }) => version),
)

export async function readPackMetadata(packPath: string) {
  const data = await fs
    .readFile(path.join(packPath, "metadata.json"), "utf-8")
    .then((content) => JSON.parse(content))

  const isAlpha = data.version_number.includes("-alpha")
  const isBeta = data.version_number.includes("-beta")

  return {
    project_id: data.project_id as string,
    type: data.type as "datapack" | "resourcepack",
    version_number: data.game_version
      ? `${data.version_number}-mc${data.game_version}`
      : (data.version_number as string),
    version_type: isAlpha ? ("alpha" as const) : isBeta ? ("beta" as const) : ("release" as const),
    changelog: await fs.readFile(path.join(packPath, "CHANGELOG.md"), "utf-8"),
    game_versions: (data.game_versions || [data.game_version]) as string[],
    include: new Set<string>(data.include || []),
  }
}

export interface PackFormat {
  datapack: number | null
  resourcepack: number | null
}

export async function getPackFormat(version: string): Promise<PackFormat> {
  const readFormats = () =>
    fs
      .readFile(path.join("packs", "pack-formats.json"), "utf-8")
      .then((content) => JSON.parse(content) as Record<string, PackFormat>)

  let formats = await readFormats().catch(() => generatePackFormats().then(() => readFormats()))

  if (!formats[version]) {
    formats = await generatePackFormats().then(() => readFormats())
  }

  const format = formats[version]

  if (!format) {
    error(`Unknown Minecraft version: ${version}`)
  }

  return format
}
