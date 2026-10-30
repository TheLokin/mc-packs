import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { parseArgs } from "node:util"
import { getProject, getProjectMembers } from "./lib/modrinth"
import { readPackMetadata } from "./lib/utils"
import { zipFolder } from "./packages/datapack"
import { packageDatapack } from "./packages/mod"

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: true,
  options: {
    mod: {
      type: "boolean",
      default: false,
    },
  },
})

const packName = positionals[0]

if (!packName || positionals.length !== 1) {
  throw new Error("Missing pack name. Usage: pnpm package <pack-name> [--mod]")
}

const packPath = path.resolve("packs", packName)

const stat = await fs.stat(packPath).catch(() => null)

if (!stat?.isDirectory()) {
  throw new Error(`Pack not found: ${packName}`)
}

const metadata = await readPackMetadata(packPath)

await fs.mkdir("dist", { recursive: true })

console.log(`📦 Packaging ${packName} as ${values.mod ? "mod" : "datapack"}...`)

const datapack = await zipFolder(metadata, packPath, "datapack")

if (values.mod) {
  const [project, members] = await Promise.all([
    getProject(metadata.project_id),
    getProjectMembers(metadata.project_id),
  ])

  const mod = await packageDatapack({
    zip: datapack,
    project,
    members,
    versionNumber: metadata.version_number,
    gameVersions: metadata.game_versions,
    loaders: ["fabric", "quilt", "forge", "neoforge"],
  })

  const outputPath = path.join("dist", `${packName}.jar`)
  const buffer = await mod.generateAsync({ type: "nodebuffer" })

  await fs.writeFile(outputPath, buffer)
  console.log(`✅ Created ${packName}.jar at ${path.relative(process.cwd(), outputPath)}`)
} else {
  const outputPath = path.join("dist", `${packName}.zip`)
  const buffer = await datapack.generateAsync({ type: "nodebuffer" })

  await fs.writeFile(outputPath, buffer)
  console.log(`✅ Created ${packName}.zip at ${path.relative(process.cwd(), outputPath)}`)
}
