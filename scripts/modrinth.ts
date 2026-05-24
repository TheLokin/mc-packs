import process from "node:process"
import dotenv from "dotenv"

dotenv.config({ quiet: true })

const BASE_URL = "https://api.modrinth.com"
const USER_AGENT = "mc-packs/1.0 (github.com/TheLokin/mc-packs)"

async function modrinthFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)

  headers.set("User-Agent", USER_AGENT)
  headers.set("Authorization", process.env.MODRINTH_TOKEN || "")

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (!response.ok) {
    throw new Error(`Modrinth API error ${response.status}: ${await response.text()}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

// https://docs.modrinth.com/api/operations/getproject
export interface Project {
  id: string
  slug: string
  project_type: string
  title: string
  description: string
  license: {
    id: string
  }
}

export const getProject = (id: string) => modrinthFetch<Project>(`/v2/project/${id}`)

// https://docs.modrinth.com/api/operations/getversion
export interface ProjectVersion {
  version_number: string
}

export const getProjectVersions = (id: string) =>
  modrinthFetch<ProjectVersion[]>(`/v2/project/${id}/version`)

// https://docs.modrinth.com/api/operations/createversion
export const createProjectVersion = async (versionData: {
  project_id: string
  name: string
  version_number: string
  changelog: string
  dependencies?: {
    version_id?: string
    project_id?: string
    file_name?: string
    dependency_type: "required" | "optional" | "incompatible" | "embedded"
  }[]
  game_versions: string[]
  version_type: "release" | "beta" | "alpha"
  loaders: ("minecraft" | "datapack" | "fabric" | "quilt" | "forge" | "neoforge")[]
  environment?: "client_only" | "server_only" | "dedicated_server_only" | "client_and_server"
  featured?: boolean
  file: {
    name: string
    data: Blob
  }
}) => {
  const formData = new FormData()

  const payload = JSON.stringify({
    project_id: versionData.project_id,
    name: versionData.name,
    version_number: versionData.version_number,
    changelog: versionData.changelog,
    dependencies: versionData.dependencies || [],
    game_versions: versionData.game_versions,
    loaders: versionData.loaders,
    version_type: versionData.version_type,
    featured: versionData?.featured || false,
    file_parts: [versionData.file.name],
    primary_file: versionData.file.name,
  })

  formData.append("data", payload)
  formData.append(versionData.file.name, versionData.file.data, versionData.file.name)

  const version = await modrinthFetch<{ id: string }>("/v2/version", {
    method: "POST",
    body: formData,
  })

  if (versionData.environment) {
    await modrinthFetch<void>(`/v3/version/${version.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: versionData.environment }),
    })
  }
}

// https://docs.modrinth.com/api/operations/getprojectteammembers
export interface ProjectMember {
  role: string
  user: {
    username: string
  }
}

export const getProjectMembers = (id: string) =>
  modrinthFetch<ProjectMember[]>(`/v2/project/${id}/members`)

// https://docs.modrinth.com/api/operations/versionlist
export interface GameVersion {
  version: string
  version_type: "release" | "snapshot" | "alpha" | "beta"
}

export const getGameVersions = () => modrinthFetch<GameVersion[]>("/v2/tag/game_version")
