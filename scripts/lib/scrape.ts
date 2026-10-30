import type { PackFormat } from "./utils"
import fs from "node:fs/promises"
import * as cheerio from "cheerio"
import { ALL_GAME_VERSIONS } from "./utils"

const BASE_URL = "https://minecraft.wiki"
const USER_AGENT = "mc-packs/1.0 (https://github.com/TheLokin/mc-packs)"

async function minecraftWikiFetch(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  })

  if (!response.ok) {
    throw new Error(`Minecraft Wiki error: ${response.status}`)
  }

  return response.text()
}

function getGameVersion(label: string) {
  const version = label
    .replace(/^Java Edition\s+/i, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim()

  if (/^\d{2}w\d{2}[a-z]$/i.test(version)) {
    return version
  }

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

  return ALL_GAME_VERSIONS.includes(version) ? version : null
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
    throw new Error("Could not find the pack formats table in the Minecraft Wiki page")
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

    formats[version] = {
      resourcepack: Number(row[1]),
      datapack: Number(row[2]),
    }
  }

  return formats
}

export async function generatePackFormats() {
  const html = await minecraftWikiFetch("/w/Pack_format")
  const packFormats = parsePackFormats(html)

  await fs.writeFile(
    "packs/pack-formats.json",
    `${JSON.stringify(packFormats, null, 2)}\n`,
    "utf-8",
  )
}
