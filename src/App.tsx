import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import {
  AcademicCapIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  PlayIcon,
  TrophyIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

type Team = 'B' | 'C' | 'Da' | 'Db' | 'Dc' | 'Dd' | 'E' | 'F' | 'G'

type AppConfig = {
  title: string
  dataFolder: string
  downloadFolder: string
  teams: Team[]
  downloadPatterns: string[]
  seasons: string[]
  defaultSeason: string
}

type DownloadFile = {
  name: string
  path: string
  size: number
  modifiedAt: string
  pattern: string
  guess?: DownloadGuess
}

type DownloadGuess = DownloadGuessCandidate & {
  candidates: DownloadGuessCandidate[]
}

type DownloadGuessCandidate = {
  targetId: string
  team: Team
  subteam?: string
  name: string
  folder: string
  file: string
  pattern: string
  score: number
  sameRowsPercent: number
  existingRowsMatchedPercent: number
  downloadedRows: number
  existingRows: number
  matchingRows: number
  addedRows: number
  removedRows: number
  teamIds: string[]
  teamNames: string[]
}

type TeamStatus = {
  id: string
  team: Team
  subteam?: string
  name: string
  folder: string
  exists: boolean
  level: number
  counts: {
    players: number
    trainers: number
    assistants: number
    trainings: number
    tournaments: number
    summary: number
    files: number
  }
}

type WildcardEntry = {
  personNumber: string
  function: string
  date: string
  activityType: string
  name: string
}

type GenerateResult = {
  season: string
  team: Team | 'All'
  targetId: string
  command: string
  run: {
    output: string
    importFile: {
      file: string
      records: number
    } | null
  }
  persons: {
    output: string
    missing: Array<{
      sourceTeam: string
      name: string
      dateOfBirth: string
    }>
  }
  events: {
    output: string
    missing: Array<{
      sourceTeam: string
      type: string
      date: string
    }>
  }
  certifications: {
    missing: Array<{
      sourceTeam: string
      personNumber: string
      trainerName: string
    }>
  }
  trainers: {
    missing: Array<{
      sourceTeam: string
      date: string
      eventTypes: string
      availableTrainers: string[]
    }>
  }
  conflicts: Array<{
    sourceTeam: string
    trainer: string
    personNumber: string
    date: string
    time: string
    teams: Array<{
      team: string
      activityType: string
    }>
  }>
}

type GenerateRun = {
  result: GenerateResult | null
  error: string
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<{ name: string }>
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3002',
})

const fallbackTeams: Team[] = ['B', 'C', 'Da', 'Db', 'Dc', 'Dd', 'E', 'F', 'G']
const logoUrl = 'https://www.fcrww.ch/wp-content/uploads/2025/03/fcrww-lolo-400x400-1.jpg'
const allTargetId = '__all'

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [downloads, setDownloads] = useState<DownloadFile[]>([])
  const [teamStatuses, setTeamStatuses] = useState<TeamStatus[]>([])
  const [wildcards, setWildcards] = useState<WildcardEntry[]>([])
  const [season, setSeason] = useState('2026-1')
  const [selectedTarget, setSelectedTarget] = useState('')
  const [rowTargets, setRowTargets] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('Loading workspace status')
  const [isDataLoading, setIsDataLoading] = useState(true)
  const [movingFile, setMovingFile] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [allGenerateRunning, setAllGenerateRunning] = useState(false)
  const [generateRuns, setGenerateRuns] = useState<Record<string, GenerateRun>>({})
  const [folderLabels, setFolderLabels] = useState<Record<string, string>>({})
  const [autoImportBestGuess, setAutoImportBestGuess] = useState(false)
  const autoImportEnabled = useRef(false)
  const autoImportInFlight = useRef(false)

  const teams = config?.teams ?? fallbackTeams
  const targetOptions =
    teamStatuses.length > 0
      ? teamStatuses
      : teams.map((team) => createFallbackStatus(team, season, config?.dataFolder))
  const selectedStatus = targetOptions.find((item) => item.id === selectedTarget)
  const selectedAll = selectedTarget === allTargetId
  const selectedTeamFolder =
    selectedTarget && selectedStatus?.folder ? selectedStatus.folder : ''
  const selectedGenerateTargetId = selectedAll
    ? allTargetId
    : selectedStatus
    ? selectedStatus.level > 0
      ? selectedStatus.team
      : selectedStatus.id
    : ''
  const selectedGenerateKey = selectedGenerateTargetId
    ? getGenerateKey(season, selectedGenerateTargetId)
    : ''
  const selectedGenerateRun = selectedGenerateKey ? generateRuns[selectedGenerateKey] : undefined
  const generateResult = selectedGenerateRun?.result ?? null
  const generateError = selectedGenerateRun?.error ?? ''
  const hasMissingEntries = Boolean(
    generateResult &&
      (generateResult.persons.missing.length > 0 ||
        generateResult.events.missing.length > 0 ||
        (generateResult.trainers?.missing.length ?? 0) > 0 ||
        (generateResult.certifications?.missing.length ?? 0) > 0),
  )
  const controlsLocked = allGenerateRunning

  const allCounts = sumTeamCounts(targetOptions.filter((target) => target.level === 0))
  const counts = selectedAll ? allCounts : selectedStatus?.counts
  const summary = [
    {
      label: 'Players',
      value: counts?.players ?? 0,
      description: 'Players in total',
      detail: `Trainers: ${counts?.trainers ?? 0} · Assistants: ${counts?.assistants ?? 0}`,
    },
    {
      label: 'Trainings',
      value: counts?.trainings ?? 0,
      description: 'Total trainings from activities',
    },
    {
      label: 'Tournaments',
      value: counts?.tournaments ?? 0,
      description: 'Total tournaments from activities',
    },
    {
      label: 'Summary',
      value: counts?.summary ?? 0,
      description: 'Rows in *-to-import-1-all.csv',
    },
  ]

  const loadTeamStatuses = useCallback(async (activeSeason: string) => {
    setIsDataLoading(true)
    setStatus(`Loading ${activeSeason}`)
    try {
      const response = await api.get<TeamStatus[]>('/teams', {
        params: { season: activeSeason },
      })
      setTeamStatuses(response.data)
      setStatus('Ready')
    } finally {
      setIsDataLoading(false)
    }
  }, [])

  const loadDownloads = useCallback(async (activeSeason: string) => {
    const response = await api.get<DownloadFile[]>('/downloads', {
      params: { season: activeSeason },
    })
    setDownloads(response.data)
  }, [])

  const loadAll = useCallback(async () => {
    setIsDataLoading(true)
    setStatus('Loading workspace status')
    try {
      const configResponse = await api.get<AppConfig>('/config')
      const activeSeason = season || configResponse.data.defaultSeason
      const [downloadsResponse, teamsResponse] = await Promise.all([
        api.get<DownloadFile[]>('/downloads', {
          params: { season: activeSeason },
        }),
        api.get<TeamStatus[]>('/teams', {
          params: { season: activeSeason },
        }),
      ])

      setConfig(configResponse.data)
      setSeason(activeSeason)
      setDownloads(downloadsResponse.data)
      setTeamStatuses(teamsResponse.data)
      setStatus('Ready')
    } finally {
      setIsDataLoading(false)
    }
  }, [season])

  const loadWildcards = useCallback(async (activeSeason: string, targetId: string) => {
    if (!targetId || targetId === allTargetId) {
      setWildcards([])
      return
    }

    const response = await api.get<WildcardEntry[]>('/wildcards', {
      params: { season: activeSeason, targetId },
    })
    setWildcards(response.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    autoImportEnabled.current = autoImportBestGuess
  }, [autoImportBestGuess])

  useEffect(() => {
    if (config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadTeamStatuses(season)
      void loadDownloads(season)
    }
  }, [config, loadDownloads, loadTeamStatuses, season])

  useEffect(() => {
    setRowTargets((current) => {
      let changed = false
      const next = { ...current }

      for (const file of downloads) {
        if (!next[file.name] && file.guess) {
          next[file.name] = getGuessTargetId(file)
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [downloads])

  useEffect(() => {
    if (config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadWildcards(season, selectedTarget)
    }
  }, [config, loadWildcards, season, selectedTarget])

  useEffect(() => {
    const source = new EventSource(`${api.defaults.baseURL}/downloads/events`)

    source.onmessage = () => {
      setStatus('Download folder updated')
      void loadDownloads(season)
    }

    source.onerror = () => {
      setStatus('Live watch disconnected; use refresh to poll')
    }

    return () => source.close()
  }, [loadDownloads, season])

  function getMoveTargetId(file: DownloadFile) {
    const rowTargetId = rowTargets[file.name]

    if (file.guess) {
      return rowTargetId || getGuessTargetId(file)
    }

    return selectedAll ? rowTargetId : selectedTarget || rowTargetId
  }

  function getGuessTargetId(file: DownloadFile) {
    if (!file.guess) {
      return ''
    }

    return isStatisticsFile(file.name) ? file.guess.team : file.guess.targetId
  }

  function shouldShowRowTarget(file: DownloadFile) {
    if (!selectedTarget || selectedAll) {
      return true
    }

    if (!file.guess) {
      return false
    }

    return selectedTarget !== getGuessTargetId(file)
  }

  function isExactDuplicate(file: DownloadFile) {
    return (
      file.guess?.sameRowsPercent === 100 &&
      file.guess.existingRowsMatchedPercent === 100
    )
  }

  async function moveFile(file: DownloadFile) {
    if (controlsLocked || isGenerating) {
      return
    }

    if (isExactDuplicate(file)) {
      setStatus(`${file.name} is already fully imported`)
      return
    }

    await moveFileToTarget(file, getMoveTargetId(file))
  }

  async function clearDownload(file: DownloadFile) {
    setMovingFile(file.name)
    setStatus(`Clearing ${file.name}`)

    try {
      const response = await api.post<{ downloads: DownloadFile[] }>('/downloads/clear', {
        filename: file.name,
        season,
      })
      setDownloads(response.data.downloads)
      setStatus(`Cleared ${file.name}`)
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message ?? error.message
        : 'Clear failed'
      setStatus(Array.isArray(message) ? message.join(', ') : message)
    } finally {
      setMovingFile(null)
    }
  }

  async function moveFileToTarget(file: DownloadFile, targetId: string) {
    const target = targetOptions.find((item) => item.id === targetId)
    if (!targetId || targetId === allTargetId || !target) {
      setStatus('Choose a team folder for this file')
      return
    }

    if (isStatisticsFile(file.name) && target.level > 0) {
      setStatus('statistics-*.csv files can only be moved to the top-level team folder')
      return
    }

    setMovingFile(file.name)
    setStatus(`Moving ${file.name}`)

    try {
      const response = await api.post<{ downloads: DownloadFile[] }>('/downloads/move', {
        filename: file.name,
        targetId,
        season,
      })
      setDownloads(response.data.downloads)
      await loadTeamStatuses(season)
      const generateTargetId = target.level > 0 ? target.team : target.id
      setStatus(`Moved ${file.name} to ${season}/${targetId}; generating ${generateTargetId}`)
      await generate(generateTargetId)
      if (selectedAll) {
        setStatus(`Generated ${season}/${generateTargetId}; generating All`)
        await generate(allTargetId)
      }
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message ?? error.message
        : 'Move failed'
      setStatus(Array.isArray(message) ? message.join(', ') : message)
    } finally {
      setMovingFile(null)
    }
  }

  useEffect(() => {
    if (
      !autoImportBestGuess ||
      autoImportInFlight.current ||
      controlsLocked ||
      isGenerating ||
      isDataLoading ||
      movingFile
    ) {
      return
    }

    const eligibleFiles = downloads
      .filter((download) => {
        const targetId = getGuessTargetId(download)
        const target = targetOptions.find((item) => item.id === targetId)

        return (
          download.guess &&
          download.guess.existingRowsMatchedPercent === 100 &&
          targetId &&
          target &&
          (!isStatisticsFile(download.name) || target.level === 0)
        )
      })
      .sort(
        (left, right) =>
          new Date(left.modifiedAt).getTime() - new Date(right.modifiedAt).getTime(),
      )
    const file =
      eligibleFiles.find((download) => getGuessTargetId(download) === selectedTarget) ??
      eligibleFiles[0]

    if (!file) {
      return
    }

    const targetId = getGuessTargetId(file)
    if (isExactDuplicate(file)) {
      return
    }

    if (selectedTarget !== targetId) {
      setStatus(`Selecting ${targetId} for ${file.name}`)
      setSelectedTarget(targetId)
      return
    }

    if (!autoImportEnabled.current) {
      return
    }

    autoImportInFlight.current = true
    void moveFileToTarget(file, targetId).finally(() => {
      autoImportInFlight.current = false
    })
  }, [
    autoImportBestGuess,
    controlsLocked,
    downloads,
    isDataLoading,
    isGenerating,
    movingFile,
    selectedTarget,
    targetOptions,
  ])

  async function generate(targetId = selectedGenerateTargetId) {
    if (isGenerating || controlsLocked) {
      return
    }

    const target = targetId === allTargetId ? null : targetOptions.find((item) => item.id === targetId)
    const runningAll = targetId === allTargetId

    if (!runningAll && (!target || target.level > 0)) {
      return
    }

    let targetLabel = 'All'
    if (!runningAll) {
      targetLabel = target?.team ?? targetId
    }
    const generateKey = getGenerateKey(season, targetId)
    setIsGenerating(true)
    if (runningAll) {
      setAllGenerateRunning(true)
    }
    setGenerateRuns((current) => ({
      ...current,
      [generateKey]: { result: null, error: '' },
    }))
    setStatus(`Generating ${season}/${targetLabel}`)

    try {
      const response = await api.post<GenerateResult>('/generate', {
        season,
        targetId,
      })
      setGenerateRuns((current) => ({
        ...current,
        [generateKey]: { result: response.data, error: '' },
      }))
      setStatus(`Generated ${season}/${targetLabel}`)
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message ?? error.message
        : 'Generate failed'
      setGenerateRuns((current) => ({
        ...current,
        [generateKey]: {
          result: null,
          error: Array.isArray(message) ? message.join('\n') : message,
        },
      }))
      setStatus('Generate failed')
    } finally {
      setIsGenerating(false)
      if (runningAll) {
        setAllGenerateRunning(false)
      }
    }
  }

  function dismissMissingPerson(sourceTeam: string, name: string, dateOfBirth: string) {
    if (!selectedGenerateKey) {
      return
    }

    setGenerateRuns((current) => {
      const run = current[selectedGenerateKey]
      if (!run?.result) {
        return current
      }

      return {
        ...current,
        [selectedGenerateKey]: {
          ...run,
          result: {
            ...run.result,
            persons: {
              ...run.result.persons,
              missing: run.result.persons.missing.filter(
                (person) =>
                  person.sourceTeam !== sourceTeam ||
                  person.name !== name ||
                  person.dateOfBirth !== dateOfBirth,
              ),
            },
          },
        },
      }
    })
  }

  function dismissMissingEvent(sourceTeam: string, type: string, date: string) {
    if (!selectedGenerateKey) {
      return
    }

    setGenerateRuns((current) => {
      const run = current[selectedGenerateKey]
      if (!run?.result) {
        return current
      }

      return {
        ...current,
        [selectedGenerateKey]: {
          ...run,
          result: {
            ...run.result,
            events: {
              ...run.result.events,
              missing: run.result.events.missing.filter(
                (event) =>
                  event.sourceTeam !== sourceTeam || event.type !== type || event.date !== date,
              ),
            },
          },
        },
      }
    })
  }

  function dismissMissingCertification(sourceTeam: string, personNumber: string) {
    if (!selectedGenerateKey) {
      return
    }

    setGenerateRuns((current) => {
      const run = current[selectedGenerateKey]
      if (!run?.result) {
        return current
      }

      return {
        ...current,
        [selectedGenerateKey]: {
          ...run,
          result: {
            ...run.result,
            certifications: {
              ...run.result.certifications,
              missing: run.result.certifications.missing.filter(
                (certification) =>
                  certification.sourceTeam !== sourceTeam ||
                  certification.personNumber !== personNumber,
              ),
            },
          },
        },
      }
    })
  }

  async function pickFolder(key: 'data' | 'download' | 'team') {
    if (controlsLocked) {
      return
    }

    const picker = (window as DirectoryPickerWindow).showDirectoryPicker

    if (!picker) {
      setStatus('Native folder picker is not supported in this browser')
      return
    }

    const handle = await picker()
    setFolderLabels((current) => ({ ...current, [key]: handle.name }))
    setStatus(`Selected ${handle.name}`)
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-300 bg-white">
        <div className="flex min-w-[1180px] items-center gap-5 px-6 py-4">
          <img src={logoUrl} alt="FCRWW" className="h-14 w-14 rounded object-cover" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-normal">{config?.title ?? 'FCRWW - SpielerPlus to NDS.'}</h1>
            <p className="mt-1 text-sm text-slate-600">{status}</p>
          </div>
          <button
            type="button"
            disabled={controlsLocked}
            onClick={() => {
              setStatus('Refreshing folders')
              void loadAll()
            }}
            className="inline-flex h-10 items-center gap-2 rounded border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowPathIcon className="h-5 w-5" />
            Refresh
          </button>
        </div>
      </header>

      <main className="min-w-[1180px] px-6 py-5">
        <section className="grid grid-cols-[180px_minmax(280px,1fr)_minmax(300px,1fr)_minmax(300px,1fr)] gap-3 rounded border border-slate-300 bg-white p-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">Season</span>
            <select
              value={season}
              onChange={(event) => setSeason(event.target.value)}
              disabled={controlsLocked}
              className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
            >
              {(config?.seasons ?? ['2026-1']).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>

          <FolderField
            label="data-folder"
            value={folderLabels.data ?? config?.dataFolder ?? '/Users/Lolo/git/spielerplus2nds/data'}
            onPick={() => void pickFolder('data')}
            disabled={controlsLocked}
          />
          <FolderField
            label="download-folder"
            value={folderLabels.download ?? config?.downloadFolder ?? '/Users/Lolo/Downloads'}
            onPick={() => void pickFolder('download')}
            disabled={controlsLocked}
          />
          <div>
            <span className="text-xs font-semibold uppercase text-slate-500">team-folder</span>
            <div className="mt-1 grid grid-cols-[92px_minmax(0,1fr)_40px] gap-2">
              <select
                value={selectedTarget}
                onChange={(event) => setSelectedTarget(event.target.value)}
                disabled={controlsLocked}
                className="h-10 rounded border border-slate-300 bg-white px-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="">No folder</option>
                {targetOptions.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.level > 0 ? `  ${target.name}` : target.name}
                  </option>
                ))}
              </select>
              <input
                readOnly
                value={folderLabels.team ?? selectedTeamFolder}
                className="h-10 min-w-0 rounded border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700"
              />
              <IconButton
                label="Pick team folder"
                onClick={() => void pickFolder('team')}
                disabled={controlsLocked}
              />
            </div>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-[220px_minmax(520px,1fr)_470px] gap-5">
          <aside className="rounded border border-slate-300 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase text-slate-500">Teams</h2>
            </div>
            <div className="divide-y divide-slate-200">
              <button
                type="button"
                disabled={controlsLocked}
                onClick={() =>
                  setSelectedTarget((current) => (current === allTargetId ? '' : allTargetId))
                }
                className={`flex h-12 w-full items-center justify-between px-4 text-left text-base font-semibold ${
                  selectedAll ? 'bg-red-50 text-red-800' : 'hover:bg-slate-50'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span>All</span>
              </button>
              {targetOptions.map((target) => (
                <button
                  type="button"
                  key={target.id}
                  disabled={controlsLocked}
                  onClick={() =>
                    setSelectedTarget((current) => (current === target.id ? '' : target.id))
                  }
                  className={`flex h-12 w-full items-center justify-between px-4 text-left text-base font-medium ${
                    selectedTarget === target.id ? 'bg-red-50 text-red-800' : 'hover:bg-slate-50'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span className={target.level > 0 ? 'pl-5 text-sm text-slate-700' : ''}>
                    {target.name}
                  </span>
                  <span className="text-xs text-slate-500">
                    {target.counts.files}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="relative min-w-0">
            {isDataLoading && (
              <div className="absolute inset-0 z-20 flex items-start justify-center bg-slate-100/70 pt-24 backdrop-blur-[1px]">
                <div className="inline-flex items-center gap-3 rounded border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
                  <ArrowPathIcon className="h-5 w-5 animate-spin text-red-700" />
                  Loading data
                </div>
              </div>
            )}
            <div className="mb-4 flex items-center justify-between rounded border border-slate-300 bg-white px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold">Folder {selectedTarget || 'none'}</h2>
                <p className="text-sm text-slate-600">
                  {selectedAll
                    ? `Overall output for ${season}`
                    : selectedTarget
                    ? selectedStatus?.exists
                      ? selectedStatus.folder
                      : 'Team folder not found yet'
                    : 'Choose a folder globally or per downloaded file'}
                </p>
              </div>
              {(selectedAll || (selectedStatus && selectedStatus.level === 0)) && (
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={isGenerating || controlsLocked}
                  className="inline-flex h-10 items-center gap-2 rounded bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-wait disabled:bg-red-400"
                >
                  {isGenerating ? (
                    <ArrowPathIcon className="h-5 w-5 animate-spin" />
                  ) : (
                    <PlayIcon className="h-5 w-5" />
                  )}
                  {isGenerating ? 'Generating' : 'Generate'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {summary.map((item) => (
                <MetricPanel
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  description={item.description}
                  detail={item.detail}
                />
              ))}
            </div>

            <div className="mt-4 rounded border border-slate-300 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Wildcards</h2>
                <span className="text-xs font-medium text-slate-500">
                  nds+anwesenheiten-always.csv
                </span>
              </div>
              {selectedTarget && !selectedAll ? (
                wildcards.length > 0 ? (
                  <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <div className="grid grid-cols-[110px_minmax(120px,1fr)_150px_150px_140px] bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                      <span>nr</span>
                      <span>trainer</span>
                      <span>function</span>
                      <span>activity type</span>
                      <span>date</span>
                    </div>
                    <div className="divide-y divide-slate-200 text-sm">
                      {wildcards.map((entry, index) => (
                        <div
                          key={`${entry.personNumber}-${entry.activityType}-${entry.name}-${index}`}
                          className="grid grid-cols-[110px_minmax(120px,1fr)_150px_150px_140px] px-3 py-2"
                        >
                          <span className="font-medium text-slate-900">{entry.personNumber}</span>
                          <span>{entry.name}</span>
                          <span>{entry.function}</span>
                          <ActivityIcons activityType={entry.activityType} />
                          <span>{entry.date}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-600">
                    No wildcard entries found for this folder.
                  </p>
                )
              ) : (
                <p className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-600">
                  {selectedAll
                    ? 'Wildcards are shown for individual team folders.'
                    : 'Choose a folder to show wildcard attendance rows.'}
                </p>
              )}
            </div>

            <div className="mt-4 rounded border border-slate-300 bg-white p-4">
              <h2 className="text-lg font-semibold">Summary</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <StatusLine
                  ok={Boolean(selectedStatus?.exists)}
                  text={selectedStatus?.exists ? 'Team folder exists' : 'Team folder is missing'}
                />
                <StatusLine
                  ok={downloads.length === 0}
                  text={downloads.length === 0 ? 'No pending downloads' : `${downloads.length} download files waiting`}
                />
              </div>
            </div>

            {generateResult && hasMissingEntries && (
              <div className="mt-4 rounded border border-amber-300 bg-white p-4">
                <h2 className="text-lg font-semibold">Missing</h2>
                <div className="mt-3 space-y-4">
                  {generateResult.persons.missing.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-slate-500">
                        Missing persons: search in Bexio, and add AHV-Nr and date into team persons
                      </h3>
                      <div className="mt-2 divide-y divide-slate-200 rounded border border-slate-200 text-sm">
                        <div className="grid grid-cols-[70px_minmax(160px,1fr)_130px] items-center bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                          <span>Team</span>
                          <span>Person</span>
                          <span>Date of birth</span>
                        </div>
                        {generateResult.persons.missing.map((person) => (
                          <div
                            key={`${person.sourceTeam}-${person.name}-${person.dateOfBirth}`}
                            className="grid grid-cols-[70px_minmax(160px,1fr)_130px] items-center px-3 py-2"
                          >
                            <span className="font-medium text-slate-900">
                              {person.sourceTeam || '-'}
                            </span>
                            <span className="flex items-center gap-2 font-medium text-slate-900">
                              <button
                                type="button"
                                title="Remove from list"
                                aria-label={`Remove ${person.name}`}
                                onClick={() =>
                                  dismissMissingPerson(
                                    person.sourceTeam,
                                    person.name,
                                    person.dateOfBirth,
                                  )
                                }
                                className="inline-flex h-7 w-7 flex-none items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                              {person.name}
                            </span>
                            <span>{person.dateOfBirth}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {generateResult.events.missing.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-slate-500">
                        Missing or wrong events: register the activity data in NDS
                      </h3>
                      <div className="mt-2 divide-y divide-slate-200 rounded border border-slate-200 text-sm">
                        <div className="grid grid-cols-[70px_minmax(120px,1fr)_130px] bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                          <span>Team</span>
                          <span>Activity</span>
                          <span>Date</span>
                        </div>
                        {generateResult.events.missing.map((event) => (
                          <div
                            key={`${event.sourceTeam}-${event.type}-${event.date}`}
                            className="grid grid-cols-[70px_minmax(120px,1fr)_130px] px-3 py-2"
                          >
                            <span className="font-medium text-slate-900">
                              {event.sourceTeam || '-'}
                            </span>
                            <span className="flex items-center gap-2 font-medium text-slate-900">
                              <button
                                type="button"
                                title="Remove from list"
                                aria-label={`Remove ${event.type} ${event.date}`}
                                onClick={() =>
                                  dismissMissingEvent(event.sourceTeam, event.type, event.date)
                                }
                                className="inline-flex h-7 w-7 flex-none items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                              {event.type}
                            </span>
                            <span>{event.date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(generateResult.trainers?.missing.length ?? 0) > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-slate-500">
                        Missing trainer for an event
                      </h3>
                      <div className="mt-2 divide-y divide-slate-200 rounded border border-slate-200 text-sm">
                        <div className="grid grid-cols-[70px_120px_130px_minmax(220px,1fr)] bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                          <span>Team</span>
                          <span>Date</span>
                          <span>Activity</span>
                          <span>Available J+S trainers</span>
                        </div>
                        {generateResult.trainers.missing.map((trainer) => (
                          <div
                            key={`${trainer.sourceTeam}-${trainer.date}-${trainer.eventTypes}`}
                            className="grid grid-cols-[70px_120px_130px_minmax(220px,1fr)] px-3 py-2"
                          >
                            <span className="font-medium text-slate-900">
                              {trainer.sourceTeam || '-'}
                            </span>
                            <span>{trainer.date}</span>
                            <span className="font-medium text-slate-900">
                              {trainer.eventTypes}
                            </span>
                            <span>
                              {trainer.availableTrainers.length > 0
                                ? trainer.availableTrainers.join(', ')
                                : '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(generateResult.certifications?.missing.length ?? 0) > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-slate-500">
                        Missing certifications: open nds+certifications.xlsx and adapt
                      </h3>
                      <div className="mt-2 divide-y divide-slate-200 rounded border border-slate-200 text-sm">
                        <div className="grid grid-cols-[70px_150px_minmax(160px,1fr)] bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                          <span>Team</span>
                          <span>Nr</span>
                          <span>Trainer</span>
                        </div>
                        {generateResult.certifications.missing.map((certification) => (
                          <div
                            key={`${certification.sourceTeam}-${certification.personNumber}`}
                            className="grid grid-cols-[70px_150px_minmax(160px,1fr)] px-3 py-2"
                          >
                            <span className="font-medium text-slate-900">
                              {certification.sourceTeam || '-'}
                            </span>
                            <span className="flex items-center gap-2 font-medium text-slate-900">
                              <button
                                type="button"
                                title="Remove from list"
                                aria-label={`Remove certification ${certification.personNumber}`}
                                onClick={() =>
                                  dismissMissingCertification(
                                    certification.sourceTeam,
                                    certification.personNumber,
                                  )
                                }
                                className="inline-flex h-7 w-7 flex-none items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                              {certification.personNumber}
                            </span>
                            <span>{certification.trainerName || '-'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(generateResult || generateError) && (
              <div className="mt-4 rounded border border-slate-300 bg-white p-4">
                <h2 className="text-lg font-semibold">
                  {generateResult?.targetId === allTargetId
                    ? 'Overall Generate Output'
                    : 'Generate Output'}
                </h2>
                {generateError ? (
                  <pre className="mt-3 whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    {generateError}
                  </pre>
                ) : (
                  generateResult && (
                    <div className="mt-3 space-y-4">
                      <p className="text-sm text-slate-600">{generateResult.command}</p>
                      {generateResult.run.importFile && (
                        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                          <span className="font-semibold">
                            {generateResult.run.importFile.records}
                          </span>{' '}
                          records written to {generateResult.run.importFile.file}
                        </div>
                      )}
                      {(generateResult.conflicts?.length ?? 0) > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold uppercase text-slate-500">
                            Trainer conflicts
                          </h3>
                          <div className="mt-2 overflow-hidden rounded border border-amber-200 text-sm">
                            <div className="grid grid-cols-[80px_minmax(160px,1fr)_130px_130px_110px] bg-amber-50 px-3 py-2 text-xs font-semibold uppercase text-amber-900">
                              <span>Team</span>
                              <span>Trainer</span>
                              <span>Date, time</span>
                              <span>Conflicting team</span>
                              <span>Activity</span>
                            </div>
                            <div className="divide-y divide-amber-100">
                              {generateResult.conflicts.map((conflict, index) => {
                                const conflictingTeams = conflict.teams
                                  .map((team) => team.team)
                                  .filter((team) => team !== conflict.sourceTeam)
                                const fallbackTeams = conflict.teams.map((team) => team.team)
                                const activityTypes = Array.from(
                                  new Set(conflict.teams.map((team) => team.activityType)),
                                )

                                return (
                                  <div
                                    key={`${conflict.trainer}-${conflict.date}-${conflict.time}-${index}`}
                                    className="grid grid-cols-[80px_minmax(160px,1fr)_130px_130px_110px] px-3 py-2"
                                  >
                                    <span className="font-medium text-slate-900">
                                      {conflict.sourceTeam || '-'}
                                    </span>
                                    <span>
                                      {conflict.trainer}
                                      <span className="ml-1 text-xs text-slate-500">
                                        ({conflict.personNumber})
                                      </span>
                                    </span>
                                    <span>
                                      {conflict.date} {conflict.time}
                                    </span>
                                    <span className="font-medium text-slate-900">
                                      {(conflictingTeams.length > 0 ? conflictingTeams : fallbackTeams).join(', ')}
                                    </span>
                                    <span>{activityTypes.join(', ')}</span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                      <div>
                        <h3 className="text-sm font-semibold uppercase text-slate-500">
                          Script output
                        </h3>
                        {getGenerateOutputs(generateResult).length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {getGenerateOutputs(generateResult).map((output) => (
                              <div key={output.label}>
                                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
                                  {output.label}
                                </p>
                                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100">
                                  {output.text}
                                </pre>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 rounded bg-slate-50 p-3 text-sm text-slate-600">
                            No script output.
                          </p>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </section>

          <aside className="rounded border border-slate-300 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase text-slate-500">Download Folder</h2>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={autoImportBestGuess}
                    onChange={(event) => {
                      autoImportEnabled.current = event.target.checked
                      setAutoImportBestGuess(event.target.checked)
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-red-700"
                  />
                  automatic import best guess
                </label>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {config?.downloadPatterns.join(' | ') ?? 'Waiting for patterns'}
              </p>
            </div>
            <div className="max-h-[calc(100vh-245px)] overflow-auto">
              {downloads.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No matching files found.</div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {downloads.map((file) => (
                    <div key={file.name} className="p-4">
                      <div className="flex items-start gap-3">
                        <DocumentArrowDownIcon
                          className={`mt-0.5 h-5 w-5 flex-none ${
                            isExactDuplicate(file) ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`break-words text-sm font-semibold ${
                              isExactDuplicate(file)
                                ? 'text-slate-500 line-through'
                                : 'text-slate-950'
                            }`}
                          >
                            {file.name}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleString()}
                          </p>
                          {file.guess && (
                            <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900">
                              Guess {file.guess.name}: {file.guess.sameRowsPercent}% same rows (
                              {file.guess.matchingRows}/{file.guess.downloadedRows}), existing{' '}
                              {file.guess.existingRowsMatchedPercent}% matched
                            </p>
                          )}
                        </div>
                      </div>
                      {isExactDuplicate(file) ? (
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            disabled={controlsLocked || isGenerating || movingFile === file.name}
                            onClick={() => void clearDownload(file)}
                            className="inline-flex h-9 items-center rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {movingFile === file.name ? 'Clearing' : 'Clear'}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
                          {shouldShowRowTarget(file) && (
                            <select
                              value={rowTargets[file.name] ?? ''}
                              disabled={controlsLocked}
                              onChange={(event) =>
                                setRowTargets((current) => ({
                                  ...current,
                                  [file.name]: event.target.value,
                                }))
                              }
                              className="h-9 rounded border border-slate-300 bg-white px-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                            >
                              <option value="">Choose folder</option>
                              {targetOptions
                                .filter((target) => !isStatisticsFile(file.name) || target.level === 0)
                                .map((target) => (
                                  <option key={target.id} value={target.id}>
                                    {target.level > 0 ? `  ${target.name}` : target.name}
                                  </option>
                                ))}
                            </select>
                          )}
                          <button
                            type="button"
                            disabled={controlsLocked || isGenerating || movingFile === file.name}
                            onClick={() => void moveFile(file)}
                            className="col-start-2 inline-flex h-9 items-center rounded bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-wait disabled:bg-slate-400"
                          >
                            {movingFile === file.name
                              ? 'Importing'
                              : `Import${getMoveTargetId(file) ? ` to ${getMoveTargetId(file)}` : ''}`}
                          </button>
                          <button
                            type="button"
                            disabled={controlsLocked || isGenerating || movingFile === file.name}
                            onClick={() => void clearDownload(file)}
                            className="col-start-3 inline-flex h-9 items-center rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {movingFile === file.name ? 'Clearing' : 'Clear'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>
      </main>
    </div>
  )
}

function FolderField({
  label,
  value,
  onPick,
  disabled = false,
}: {
  label: string
  value: string
  onPick: () => void
  disabled?: boolean
}) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_40px] gap-2">
        <input
          readOnly
          value={value}
          className="h-10 min-w-0 rounded border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700"
        />
        <IconButton label={`Pick ${label}`} onClick={onPick} disabled={disabled} />
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
    >
      <FolderIcon className="h-5 w-5" />
    </button>
  )
}

function MetricPanel({
  label,
  value,
  description,
  detail,
}: {
  label: string
  value: number
  description: string
  detail?: string
}) {
  return (
    <div className="rounded border border-slate-300 bg-white p-4">
      <p className="text-sm font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-4 text-4xl font-semibold">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      {detail && <p className="mt-1 text-sm font-medium text-slate-800">{detail}</p>}
    </div>
  )
}

function StatusLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
      {ok ? (
        <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
      ) : (
        <ExclamationTriangleIcon className="h-5 w-5 text-amber-600" />
      )}
      <span>{text}</span>
    </div>
  )
}

function ActivityIcons({ activityType }: { activityType: string }) {
  const hasTraining = /Training/i.test(activityType)
  const hasMatch = /Wettkampf/i.test(activityType)

  return (
    <span className="flex items-center gap-1.5" aria-label={activityType}>
      {hasTraining && (
        <span
          title="Training"
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-emerald-200 bg-emerald-50 text-emerald-700"
        >
          <AcademicCapIcon className="h-4 w-4" />
        </span>
      )}
      {hasMatch && (
        <span
          title="Wettkampf"
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-sky-200 bg-sky-50 text-sky-700"
        >
          <TrophyIcon className="h-4 w-4" />
        </span>
      )}
      {!hasTraining && !hasMatch && <span>{activityType}</span>}
    </span>
  )
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function createFallbackStatus(team: Team, season: string, dataFolder = '/Users/Lolo/git/spielerplus2nds/data'): TeamStatus {
  return {
    id: team,
    team,
    name: team,
    folder: `${dataFolder}/${season}/${team}`,
    exists: false,
    level: 0,
    counts: {
      players: 0,
      trainers: 0,
      assistants: 0,
      trainings: 0,
      tournaments: 0,
      summary: 0,
      files: 0,
    },
  }
}

function sumTeamCounts(targets: TeamStatus[]) {
  return targets.reduce(
    (total, target) => ({
      players: total.players + target.counts.players,
      trainers: total.trainers + target.counts.trainers,
      assistants: total.assistants + target.counts.assistants,
      trainings: total.trainings + target.counts.trainings,
      tournaments: total.tournaments + target.counts.tournaments,
      summary: total.summary + target.counts.summary,
      files: total.files + target.counts.files,
    }),
    {
      players: 0,
      trainers: 0,
      assistants: 0,
      trainings: 0,
      tournaments: 0,
      summary: 0,
      files: 0,
    },
  )
}

function isStatisticsFile(filename: string) {
  return /^statistics-.*\.csv$/i.test(filename)
}

function getGenerateKey(season: string, targetId: string) {
  return `${season}/${targetId}`
}

function getGenerateOutputs(result: GenerateResult) {
  return [
    { label: 'Run', text: result.run.output },
    { label: 'Persons', text: result.persons.output },
    { label: 'Events', text: result.events.output },
  ].filter((output) => output.text.trim().length > 0)
}

export default App
