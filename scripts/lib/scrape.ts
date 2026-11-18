import fs from "node:fs/promises"
import path from "node:path"
import * as cheerio from "cheerio"
import { error } from "./console"

const BASE_URL = "https://minecraft.wiki"
const USER_AGENT = "mc-packs/1.0 (https://github.com/TheLokin/mc-packs)"

interface PackFormat {
  type: "release" | "snapshot"
  datapack: number | null
  resourcepack: number | null
}

async function minecraftWikiFetch(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "User-Agent": USER_AGENT },
  })

  if (!response.ok) {
    error(`Minecraft Wiki error: ${response.status}`)
  }

  return response.text()
}

function getGameVersionType(version: string) {
  if (/^\d+(?:\.\d+){0,2}$/.test(version)) {
    return "release"
  }

  if (
    /^\d{2}w\d{2}[a-z]$/i.test(version) ||
    /^\d{2}\.\d+(?:\.\d+)?-(?:snapshot|pre|rc)-\d+$/i.test(version) ||
    /^\d+(?:\.\d+){0,2}-(?:pre|rc)\d+$/i.test(version)
  ) {
    return "snapshot"
  }

  return null
}

function getGameVersion(label: string) {
  const version = label
    .replace(/^Java Edition\s+/i, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim()

  const oldSnapshot = version.match(/^Snapshot\s+(\d{2}w\d{2}[a-z])$/i)

  if (oldSnapshot) {
    return oldSnapshot[1]!
  }

  const snapshot = version.match(/^([\d.]+)\s+Snapshot\s+(\d+)$/i)

  if (snapshot) {
    return `${snapshot[1]}-snapshot-${snapshot[2]}`
  }

  const pre = version.match(/^([\d.]+)\s+Pre-?Release\s+(\d+)$/i)

  if (pre) {
    return `${pre[1]}-pre-${pre[2]}`
  }

  const rc = version.match(/^([\d.]+)\s+Release Candidate\s+(\d+)$/i)

  if (rc) {
    return `${rc[1]}-rc-${rc[2]}`
  }

  return getGameVersionType(version) ? version : null
}

function parsePackFormats(html: string) {
  const $ = cheerio.load(html)

  const table = $("table")
    .filter((_, element) => {
      const text = $(element).text().toLowerCase()

      return (
        text.includes("client version") &&
        text.includes("resource pack format") &&
        text.includes("data pack format")
      )
    })
    .first()

  if (!table.length) {
    error("Could not find the pack formats table in the Minecraft Wiki page")
  }

  const grid: string[][] = []

  table.find("tr").each((rowIndex, row) => {
    grid[rowIndex] ??= []

    let columnIndex = 0

    $(row)
      .children("th, td")
      .each((_, cell) => {
        while (grid[rowIndex]![columnIndex] !== undefined) {
          columnIndex++
        }

        const value = $(cell).text().trim()
        const rowspan = Number($(cell).attr("rowspan")) || 1

        for (let row = 0; row < rowspan; row++) {
          grid[rowIndex + row] ??= []
          grid[rowIndex + row]![columnIndex] = value
        }

        columnIndex++
      })
  })

  const formats: Record<string, PackFormat> = {}

  for (const row of grid.slice(1)) {
    const version = getGameVersion(row[0]!)

    if (!version) continue

    const type = getGameVersionType(version)

    if (!type) continue

    formats[version] = {
      type,
      datapack: Number(row[2]) || null,
      resourcepack: Number(row[1]) || null,
    }
  }

  return formats
}

async function generatePackFormats() {
  const html = await minecraftWikiFetch("/w/Pack_format")
  const packFormats = parsePackFormats(html)

  await fs.writeFile(
    path.join("packs", "pack-formats.json"),
    `${JSON.stringify(packFormats, null, 2)}\n`,
    "utf-8",
  )

  return packFormats
}

async function readPackFormats() {
  const content = await fs.readFile(path.join("packs", "pack-formats.json"), "utf-8")

  return JSON.parse(content) as Record<string, PackFormat>
}

export async function loadPackFormats() {
  try {
    return await readPackFormats()
  } catch {
    return await generatePackFormats()
  }
}

let packFormats = await loadPackFormats()
let releaseOnly = false

export const GAME_VERSIONS: string[] = []

function updateGameVersions() {
  GAME_VERSIONS.splice(
    0,
    GAME_VERSIONS.length,
    ...Object.entries(packFormats)
      .filter(([, format]) => !releaseOnly || format.type === "release")
      .map(([version]) => version),
  )
}

updateGameVersions()

export function setGameVersionMode(release: boolean) {
  releaseOnly = release
  updateGameVersions()
}

export function getGameVersions(type?: PackFormat["type"]) {
  return Object.entries(packFormats)
    .filter(([, format]) => !type || format.type === type)
    .map(([version]) => version)
}

export async function refreshPackFormats() {
  packFormats = await generatePackFormats()

  updateGameVersions()

  return packFormats
}
