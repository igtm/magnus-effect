import { For, createMemo, createSignal } from 'solid-js'

import PitchScene from './components/PitchScene'
import './App.css'
import {
  DEFAULT_PRESET_ID,
  PRESET_DEFINITIONS,
  clampValue,
  describeAxisEffect,
  formatBreakLabel,
  getPresetDefinition,
  getPresetInputs,
  roundTo,
  simulatePitch,
  type Handedness,
  type PitchPresetId,
  type SimulationInputs,
} from './lib/simulation'

type BuiltInPresetId = Exclude<PitchPresetId, 'custom'>

function App() {
  const [inputs, setInputs] = createSignal<SimulationInputs>(
    getPresetInputs(DEFAULT_PRESET_ID as BuiltInPresetId, 'RHP'),
  )

  const snapshot = createMemo(() => simulatePitch(inputs()))
  const metrics = createMemo(() => snapshot().metrics)
  const activePreset = createMemo(() => {
    const current = inputs()

    return current.presetId === 'custom'
      ? undefined
      : getPresetDefinition(current.presetId as BuiltInPresetId)
  })
  const insights = createMemo(() => describeAxisEffect(inputs(), metrics()))
  const currentPresetLabel = createMemo(() => activePreset()?.label ?? 'Custom Mix')
  const currentPresetSummary = createMemo(
    () => activePreset()?.summary ?? 'Manual axis and spin edits are driving this shape.',
  )
  const movementDescriptor = createMemo(() =>
    formatBreakLabel(inputs().handedness, metrics().horizontalBreakIn),
  )
  const verticalDescriptor = createMemo(() => {
    if (metrics().verticalBreakIn > 1.5) {
      return 'Ride above spinless baseline'
    }

    if (metrics().verticalBreakIn < -1.5) {
      return 'Drop below spinless baseline'
    }

    return 'Neutral vertical plane'
  })

  const selectPreset = (presetId: BuiltInPresetId) => {
    setInputs(getPresetInputs(presetId, inputs().handedness))
  }

  const setHandedness = (handedness: Handedness) => {
    const current = inputs()

    if (current.presetId === 'custom') {
      setInputs({
        ...current,
        handedness,
      })
      return
    }

    setInputs(getPresetInputs(current.presetId as BuiltInPresetId, handedness))
  }

  const updateNumericInput = <
    Key extends keyof Pick<
      SimulationInputs,
      'velocityMph' | 'spinRateRpm' | 'axisAzimuthDeg' | 'axisElevationDeg'
    >,
  >(
    key: Key,
    value: number,
  ) => {
    const current = inputs()

    setInputs({
      ...current,
      presetId: 'custom',
      [key]: value,
    })
  }

  return (
    <main class="min-h-screen overflow-hidden bg-[#030917] text-slate-100">
      <div class="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(61,158,255,0.18),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(255,155,66,0.12),transparent_24%),linear-gradient(180deg,#030917_0%,#08111d_45%,#030917_100%)]" />
      <div class="pointer-events-none fixed inset-0 aurora-grid opacity-70" />

      <div class="relative mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 xl:flex-row xl:gap-7 xl:px-7">
        <section class="relative flex min-h-[42rem] flex-1 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03] shadow-[0_36px_140px_rgba(3,9,23,0.75)] backdrop-blur-sm">
          <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(24,40,67,0.92)_0%,rgba(6,14,26,0.45)_34%,rgba(6,14,26,0.2)_100%)]" />
          <div class="relative z-10 flex min-h-full w-full flex-col">
            <div class="flex flex-col justify-between gap-5 px-5 pb-2 pt-5 sm:px-7 sm:pt-7 lg:flex-row lg:items-start">
              <div class="max-w-xl">
                <p class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.4em] text-cyan-200/80">
                  Magnus Effect
                </p>
                <h1 class="mt-3 max-w-[12ch] font-[var(--font-display)] text-4xl font-semibold leading-[0.92] text-white sm:text-5xl xl:text-[4.3rem]">
                  Shape a pitch. Watch the force.
                </h1>
                <p class="mt-4 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                  Drive velocity, spin, and axis in real time. The seam rotation, path tilt,
                  and force vectors all update together so the pitch shape reads instantly.
                </p>
              </div>

              <div class="flex max-w-[18rem] flex-col items-start gap-3 self-start rounded-[1.35rem] border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
                <span class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-slate-400">
                  Live profile
                </span>
                <div>
                  <div class="font-[var(--font-display)] text-2xl font-medium text-white">
                    {currentPresetLabel()}
                  </div>
                  <p class="mt-1 text-sm leading-6 text-slate-300">{currentPresetSummary()}</p>
                </div>
              </div>
            </div>

            <div class="relative flex-1 px-2 pb-2 sm:px-4 sm:pb-4">
              <PitchScene snapshot={snapshot()} inputs={inputs()} />
              <div class="pointer-events-none absolute inset-x-6 bottom-5 hidden justify-between gap-4 rounded-[1.4rem] border border-white/10 bg-[#061320]/55 px-5 py-3 backdrop-blur md:flex">
                <LiveStrip
                  label="Velocity"
                  value={`${roundTo(inputs().velocityMph, 0)} mph`}
                  hint="Release speed"
                />
                <LiveStrip
                  label="Spin"
                  value={`${roundTo(inputs().spinRateRpm, 0)} rpm`}
                  hint="Seam rotation"
                />
                <LiveStrip
                  label="Flight"
                  value={`${roundTo(metrics().flightTimeMs, 0)} ms`}
                  hint="Release to plate"
                />
                <LiveStrip
                  label="Peak Magnus"
                  value={`${roundTo(metrics().magnusForceN, 2).toFixed(2)} N`}
                  hint="Max force cue"
                />
              </div>
            </div>
          </div>
        </section>

        <aside class="relative w-full shrink-0 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.05] shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-sm xl:w-[26rem]">
          <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.01)_100%)]" />
          <div class="relative flex h-full flex-col">
            <section class="border-b border-white/8 px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-slate-400">
                    Preset bank
                  </p>
                  <h2 class="mt-2 font-[var(--font-display)] text-2xl font-medium text-white">
                    Pitch shapes
                  </h2>
                </div>
                <div class="flex rounded-full border border-white/10 bg-black/20 p-1">
                  <HandednessButton
                    label="RHP"
                    active={inputs().handedness === 'RHP'}
                    onClick={() => setHandedness('RHP')}
                  />
                  <HandednessButton
                    label="LHP"
                    active={inputs().handedness === 'LHP'}
                    onClick={() => setHandedness('LHP')}
                  />
                </div>
              </div>

              <div class="mt-5 grid grid-cols-2 gap-3">
                <For each={PRESET_DEFINITIONS}>
                  {(preset) => (
                    <button
                      type="button"
                      class="preset-chip text-left"
                      classList={{
                        'preset-chip-active': inputs().presetId === preset.id,
                      }}
                      onClick={() => selectPreset(preset.id)}
                    >
                      <div class="flex items-center justify-between gap-3">
                        <span class="font-[var(--font-display)] text-lg text-white">
                          {preset.label}
                        </span>
                        <span class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.3em] text-cyan-200/80">
                          {preset.shortLabel}
                        </span>
                      </div>
                      <p class="mt-2 text-sm leading-5 text-slate-300">{preset.summary}</p>
                    </button>
                  )}
                </For>
              </div>
            </section>

            <section class="border-b border-white/8 px-5 py-5 sm:px-6 sm:py-6">
              <div class="flex items-end justify-between gap-4">
                <div>
                  <p class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-slate-400">
                    Movement readout
                  </p>
                  <h2 class="mt-2 font-[var(--font-display)] text-2xl font-medium text-white">
                    Pitch outcome
                  </h2>
                </div>
                <span class="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.28em] text-cyan-100">
                  {inputs().presetId === 'custom' ? 'Custom' : inputs().handedness}
                </span>
              </div>

              <div class="mt-5 space-y-4">
                <MetricRail
                  label="Vertical break"
                  value={formatSigned(metrics().verticalBreakIn, 'in')}
                  sublabel={verticalDescriptor()}
                  ratio={clampValue((metrics().verticalBreakIn + 22) / 44, 0, 1)}
                />
                <MetricRail
                  label="Horizontal break"
                  value={formatSigned(metrics().horizontalBreakIn, 'in')}
                  sublabel={movementDescriptor()}
                  ratio={clampValue((Math.abs(metrics().horizontalBreakIn) + 1) / 20, 0, 1)}
                />
                <MetricRail
                  label="Peak Magnus"
                  value={`${roundTo(metrics().magnusForceN, 2).toFixed(2)} N`}
                  sublabel="Maximum lift-force magnitude along the flight."
                  ratio={clampValue(metrics().magnusForceN / 1.5, 0, 1)}
                />
                <MetricRail
                  label="Spin efficiency"
                  value={`${roundTo(metrics().spinEfficiencyPct, 0)}%`}
                  sublabel="Share of spin acting perpendicular to travel."
                  ratio={clampValue(metrics().spinEfficiencyPct / 100, 0, 1)}
                />
              </div>
            </section>

            <section class="border-b border-white/8 px-5 py-5 sm:px-6 sm:py-6">
              <p class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-slate-400">
                Control surface
              </p>
              <h2 class="mt-2 font-[var(--font-display)] text-2xl font-medium text-white">
                Tune the release
              </h2>

              <div class="mt-5 space-y-5">
                <RangeField
                  label="Velocity"
                  value={inputs().velocityMph}
                  valueLabel={`${roundTo(inputs().velocityMph, 0)} mph`}
                  min={70}
                  max={102}
                  step={1}
                  onInput={(value) => updateNumericInput('velocityMph', value)}
                />
                <RangeField
                  label="Spin rate"
                  value={inputs().spinRateRpm}
                  valueLabel={`${roundTo(inputs().spinRateRpm, 0)} rpm`}
                  min={1200}
                  max={3200}
                  step={25}
                  onInput={(value) => updateNumericInput('spinRateRpm', value)}
                />
                <RangeField
                  label="Axis azimuth"
                  value={inputs().axisAzimuthDeg}
                  valueLabel={`${roundTo(inputs().axisAzimuthDeg, 0)} deg`}
                  min={-180}
                  max={180}
                  step={1}
                  onInput={(value) => updateNumericInput('axisAzimuthDeg', value)}
                />
                <RangeField
                  label="Axis elevation"
                  value={inputs().axisElevationDeg}
                  valueLabel={`${roundTo(inputs().axisElevationDeg, 0)} deg`}
                  min={-65}
                  max={65}
                  step={1}
                  onInput={(value) => updateNumericInput('axisElevationDeg', value)}
                />
              </div>

              <p class="mt-5 text-sm leading-6 text-slate-300">
                Azimuth rotates the spin axis around the ball. Elevation tilts that axis into
                ride, drop, run, or sweep.
              </p>
            </section>

            <section class="px-5 py-5 sm:px-6 sm:py-6">
              <p class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-slate-400">
                Axis notes
              </p>
              <h2 class="mt-2 font-[var(--font-display)] text-2xl font-medium text-white">
                What this axis does
              </h2>

              <div class="mt-5 rounded-[1.5rem] border border-amber-300/10 bg-[linear-gradient(180deg,rgba(255,179,71,0.12)_0%,rgba(255,179,71,0.03)_100%)] p-4">
                <ul class="space-y-3 text-sm leading-6 text-slate-200">
                  <For each={insights()}>
                    {(line) => (
                      <li class="flex gap-3">
                        <span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                        <span>{line}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </main>
  )
}

interface LiveStripProps {
  label: string
  value: string
  hint: string
}

function LiveStrip(props: LiveStripProps) {
  return (
    <div class="flex min-w-0 flex-1 flex-col">
      <span class="font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.28em] text-slate-400">
        {props.label}
      </span>
      <span class="mt-2 truncate font-[var(--font-display)] text-xl font-medium text-white">
        {props.value}
      </span>
      <span class="mt-1 text-xs text-slate-400">{props.hint}</span>
    </div>
  )
}

interface MetricRailProps {
  label: string
  value: string
  sublabel: string
  ratio: number
}

function MetricRail(props: MetricRailProps) {
  return (
    <div class="space-y-2">
      <div class="flex items-end justify-between gap-4">
        <div>
          <div class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.28em] text-slate-400">
            {props.label}
          </div>
          <div class="mt-1 text-sm text-slate-300">{props.sublabel}</div>
        </div>
        <div class="font-[var(--font-display)] text-2xl font-medium text-white">{props.value}</div>
      </div>
      <div class="metric-meter">
        <span style={{ width: `${clampValue(props.ratio, 0, 1) * 100}%` }} />
      </div>
    </div>
  )
}

interface RangeFieldProps {
  label: string
  value: number
  valueLabel: string
  min: number
  max: number
  step: number
  onInput: (value: number) => void
}

function RangeField(props: RangeFieldProps) {
  const fill = () => `${((props.value - props.min) / (props.max - props.min)) * 100}%`

  return (
    <label class="block">
      <div class="mb-2 flex items-end justify-between gap-3">
        <span class="font-[var(--font-display)] text-lg text-white">{props.label}</span>
        <span class="font-[var(--font-mono)] text-[0.75rem] uppercase tracking-[0.2em] text-cyan-100">
          {props.valueLabel}
        </span>
      </div>
      <input
        type="range"
        class="pitch-slider"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ '--slider-fill': fill() }}
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
      <div class="mt-2 flex justify-between font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.24em] text-slate-500">
        <span>{props.min}</span>
        <span>{props.max}</span>
      </div>
    </label>
  )
}

interface HandednessButtonProps {
  label: Handedness
  active: boolean
  onClick: () => void
}

function HandednessButton(props: HandednessButtonProps) {
  return (
    <button
      type="button"
      class="rounded-full px-3 py-1.5 font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.26em] transition"
      classList={{
        'bg-cyan-300 text-slate-950': props.active,
        'text-slate-400 hover:text-white': !props.active,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

function formatSigned(value: number, unit: string): string {
  const rounded = roundTo(value, 1).toFixed(1)
  return `${value >= 0 ? '+' : ''}${rounded} ${unit}`
}

export default App
