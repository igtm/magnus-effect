import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js'

import PitchScene from './components/PitchScene'
import SpinLabScene from './components/SpinLabScene'
import './App.css'
import {
  DEFAULT_PRESET_ID,
  PRESET_DEFINITIONS,
  clampValue,
  describeAxisEffect,
  describeSpinLab,
  formatBreakLabel,
  getPresetDefinition,
  getPresetInputs,
  mirrorCustomInputs,
  roundTo,
  simulatePitch,
  type Handedness,
  type PitchPresetId,
  type SimulationInputs,
} from './lib/simulation'

type BuiltInPresetId = Exclude<PitchPresetId, 'custom'>
type ViewMode = 'flight' | 'spin-lab'

function App() {
  const [viewMode, setViewMode] = createSignal<ViewMode>('flight')
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
  const flightInsights = createMemo(() =>
    describeAxisEffect(inputs(), metrics(), snapshot().reachesPlate),
  )
  const spinInsights = createMemo(() => describeSpinLab(snapshot()))
  const currentPresetLabel = createMemo(() => activePreset()?.label ?? 'Custom Mix')
  const currentPresetSummary = createMemo(
    () => activePreset()?.summary ?? 'Manual axis, loft, and side aim are shaping this pitch.',
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
  const plateHeightLabel = createMemo(
    () => `${roundTo(snapshot().platePosition.z * 39.3701, 1).toFixed(1)} in`,
  )
  const magnusVectorLabel = createMemo(() =>
    getMagnusVectorLabel(snapshot().referenceMagnusForce, inputs().handedness),
  )
  const magnusVectorHint = createMemo(() =>
    getMagnusVectorHint(snapshot().referenceMagnusForce, inputs().handedness),
  )

  const selectPreset = (presetId: BuiltInPresetId) => {
    setInputs(getPresetInputs(presetId, inputs().handedness))
  }

  const setHandedness = (handedness: Handedness) => {
    const current = inputs()

    if (current.presetId === 'custom') {
      setInputs(mirrorCustomInputs(current, handedness))
      return
    }

    setInputs(getPresetInputs(current.presetId as BuiltInPresetId, handedness))
  }

  const updateNumericInput = <
    Key extends keyof Pick<
      SimulationInputs,
      | 'velocityMph'
      | 'spinRateRpm'
      | 'axisAzimuthDeg'
      | 'axisElevationDeg'
      | 'releaseSideOffsetDeg'
      | 'releaseLiftOffsetDeg'
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

  const updateAxisInputs = (axisAzimuthDeg: number, axisElevationDeg: number) => {
    const current = inputs()

    setInputs({
      ...current,
      presetId: 'custom',
      axisAzimuthDeg,
      axisElevationDeg,
    })
  }

  return (
    <main class="min-h-screen overflow-hidden bg-[#030917] text-slate-100 xl:h-[100svh] xl:min-h-[100svh]">
      <div class="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(61,158,255,0.18),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(255,155,66,0.12),transparent_24%),linear-gradient(180deg,#030917_0%,#08111d_45%,#030917_100%)]" />
      <div class="pointer-events-none fixed inset-0 aurora-grid opacity-70" />

      <div class="relative mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 xl:h-[100svh] xl:min-h-0 xl:flex-row xl:gap-7 xl:overflow-hidden xl:px-7">
        <section class="relative flex min-h-[36rem] flex-1 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03] shadow-[0_36px_140px_rgba(3,9,23,0.75)] backdrop-blur-sm xl:h-full xl:min-h-0">
          <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(24,40,67,0.92)_0%,rgba(6,14,26,0.45)_34%,rgba(6,14,26,0.2)_100%)]" />
          <div class="relative z-10 flex min-h-full w-full flex-col xl:min-h-0">
            <div class="flex flex-col gap-5 px-5 pb-2 pt-5 sm:px-7 sm:pt-7 xl:gap-4 xl:px-6 xl:pt-5">
              <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div class="max-w-xl">
                  <p class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.4em] text-cyan-200/80">
                    Magnus Effect
                  </p>
                  <h1 class="mt-3 max-w-[12ch] font-[var(--font-display)] text-4xl font-semibold leading-[0.92] text-white sm:text-5xl xl:text-[4.3rem]">
                    {viewMode() === 'flight' ? 'Shape a pitch. Watch the force.' : 'Freeze the ball. Reveal the force field.'}
                  </h1>
                  <p class="mt-4 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                    <Show
                      when={viewMode() === 'flight'}
                      fallback="Freeze the baseball on a TrackMan-style tilt view. Drag the axis directly, watch the band rotate, and read the outlined Magnus arrow immediately."
                    >
                      Auto-aim keeps the selected pitch finishing at the plate from a catcher-side TrackMan view, while side and loft offsets bias the release without breaking the readout.
                    </Show>
                  </p>
                </div>

                <div class="flex max-w-[24rem] flex-col gap-3 self-start rounded-[1.35rem] border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
                  <div class="flex flex-wrap gap-2">
                    <ModeButton
                      label="Flight Lab"
                      active={viewMode() === 'flight'}
                      onClick={() => setViewMode('flight')}
                    />
                    <ModeButton
                      label="Spin Lab"
                      active={viewMode() === 'spin-lab'}
                      onClick={() => setViewMode('spin-lab')}
                    />
                  </div>
                  <div>
                    <span class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-slate-400">
                      Live profile
                    </span>
                    <div class="mt-2 font-[var(--font-display)] text-2xl font-medium text-white">
                      {currentPresetLabel()}
                    </div>
                    <p class="mt-1 text-sm leading-6 text-slate-300">{currentPresetSummary()}</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="px-5 pb-3 sm:px-7 xl:px-6">
              <div class="hidden gap-4 rounded-[1.35rem] border border-white/10 bg-[#061320]/55 px-4 py-2.5 backdrop-blur md:grid md:grid-cols-4">
                <Switch>
                  <Match when={viewMode() === 'flight'}>
                    <LiveStrip
                      label="Velocity"
                      value={`${roundTo(inputs().velocityMph, 0)} mph`}
                      hint="Release speed"
                    />
                    <LiveStrip
                      label="Travel"
                      value={`${roundTo(metrics().flightTimeMs, 0)} ms`}
                      hint="Release to plate"
                    />
                    <LiveStrip
                      label="Plate height"
                      value={plateHeightLabel()}
                      hint={snapshot().reachesPlate ? 'Crosses home plate' : 'Bounces before plate'}
                    />
                    <LiveStrip
                      label="Aim"
                      value={`${formatSigned(snapshot().launchAngles.appliedLiftDeg, 'deg')} lift`}
                      hint={`${formatSigned(snapshot().launchAngles.appliedYawDeg, 'deg')} side`}
                    />
                  </Match>
                  <Match when={viewMode() === 'spin-lab'}>
                    <LiveStrip
                      label="Relative wind"
                      value={`${roundTo(inputs().velocityMph, 0)} mph`}
                      hint="Air speed over the ball"
                    />
                    <LiveStrip
                      label="Spin"
                      value={`${roundTo(inputs().spinRateRpm, 0)} rpm`}
                      hint="Seam rotation"
                    />
                    <LiveStrip
                      label="Magnus"
                      value={`${roundTo(metrics().magnusForceN, 2).toFixed(2)} N`}
                      hint="Reference force"
                    />
                    <LiveStrip
                      label="Magnus Vector"
                      value={magnusVectorLabel()}
                      hint={magnusVectorHint()}
                    />
                  </Match>
                </Switch>
              </div>
            </div>

            <div class="relative flex-1 px-2 pb-2 sm:px-4 sm:pb-4 xl:min-h-0">
              <Switch>
                <Match when={viewMode() === 'flight'}>
                  <PitchScene snapshot={snapshot()} inputs={inputs()} />
                </Match>
                <Match when={viewMode() === 'spin-lab'}>
                  <SpinLabScene
                    snapshot={snapshot()}
                    inputs={inputs()}
                    onAxisChange={updateAxisInputs}
                  />
                </Match>
              </Switch>
            </div>
          </div>
        </section>

        <aside class="relative w-full shrink-0 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.05] shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-sm xl:h-full xl:w-[27rem] xl:min-h-0">
          <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.01)_100%)]" />
          <div class="relative flex h-full flex-col xl:min-h-0">
            <div class="app-shell-scroll relative flex h-full flex-col xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <section class="border-b border-white/8 px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6 xl:px-5 xl:pb-4 xl:pt-5">
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

            <section class="border-b border-white/8 px-5 py-5 sm:px-6 sm:py-6 xl:px-5 xl:py-4">
              <Switch>
                <Match when={viewMode() === 'flight'}>
                  <SectionHeader
                    eyebrow="Movement readout"
                    title="Pitch outcome"
                    badge={snapshot().reachesPlate ? 'Plate reach' : 'Bounce early'}
                    badgeTone={snapshot().reachesPlate ? 'cyan' : 'amber'}
                  />
                  <div class="mt-5 space-y-4">
                    <MetricRail
                      label="Vertical break"
                      value={formatSigned(metrics().verticalBreakIn, 'in')}
                      sublabel={verticalDescriptor()}
                      ratio={clampValue((metrics().verticalBreakIn + 26) / 52, 0, 1)}
                    />
                    <MetricRail
                      label="Horizontal break"
                      value={formatSigned(metrics().horizontalBreakIn, 'in')}
                      sublabel={movementDescriptor()}
                      ratio={clampValue((Math.abs(metrics().horizontalBreakIn) + 1) / 22, 0, 1)}
                    />
                    <MetricRail
                      label="Plate height"
                      value={plateHeightLabel()}
                      sublabel="Crossing height at the front edge of home plate."
                      ratio={clampValue(snapshot().platePosition.z / 1.7, 0, 1)}
                    />
                    <MetricRail
                      label="Spin efficiency"
                      value={`${roundTo(metrics().spinEfficiencyPct, 0)}%`}
                      sublabel="Spin acting perpendicular to travel."
                      ratio={clampValue(metrics().spinEfficiencyPct / 100, 0, 1)}
                    />
                  </div>
                </Match>

                <Match when={viewMode() === 'spin-lab'}>
                  <SectionHeader
                    eyebrow="Force readout"
                    title="Wind tunnel"
                    badge={`${roundTo(inputs().velocityMph, 0)} mph`}
                    badgeTone="cyan"
                  />
                  <div class="mt-5 space-y-4">
                    <MetricRail
                      label="Magnus force"
                      value={`${roundTo(metrics().magnusForceN, 2).toFixed(2)} N`}
                      sublabel="Lift generated by spin and airflow asymmetry."
                      ratio={clampValue(metrics().magnusForceN / 1.6, 0, 1)}
                    />
                    <MetricRail
                      label="Magnus vector"
                      value={magnusVectorLabel()}
                      sublabel={magnusVectorHint()}
                      ratio={clampValue(Math.hypot(snapshot().referenceMagnusForce.y, snapshot().referenceMagnusForce.z) / metrics().magnusForceN, 0, 1)}
                    />
                    <MetricRail
                      label="Spin efficiency"
                      value={`${roundTo(metrics().spinEfficiencyPct, 0)}%`}
                      sublabel="How much of the spin feeds visible force."
                      ratio={clampValue(metrics().spinEfficiencyPct / 100, 0, 1)}
                    />
                    <MetricRail
                      label="Release axis"
                      value={`${roundTo(inputs().axisAzimuthDeg, 0)} / ${roundTo(inputs().axisElevationDeg, 0)} deg`}
                      sublabel="Azimuth and elevation of the spin axis."
                      ratio={clampValue((Math.abs(inputs().axisElevationDeg) + 10) / 80, 0, 1)}
                    />
                  </div>
                </Match>
              </Switch>
            </section>

            <section class="border-b border-white/8 px-5 py-5 sm:px-6 sm:py-6 xl:px-5 xl:py-4">
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
                  min={0}
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
                <Show when={viewMode() === 'flight'}>
                  <RangeField
                    label="Side aim offset"
                    value={inputs().releaseSideOffsetDeg}
                    valueLabel={formatSigned(inputs().releaseSideOffsetDeg, 'deg')}
                    min={-4}
                    max={4}
                    step={0.1}
                    onInput={(value) => updateNumericInput('releaseSideOffsetDeg', value)}
                  />
                  <RangeField
                    label="Lift offset"
                    value={inputs().releaseLiftOffsetDeg}
                    valueLabel={formatSigned(inputs().releaseLiftOffsetDeg, 'deg')}
                    min={-6}
                    max={6}
                    step={0.1}
                    onInput={(value) => updateNumericInput('releaseLiftOffsetDeg', value)}
                  />
                </Show>
              </div>

              <Switch>
                <Match when={viewMode() === 'flight'}>
                  <div class="mt-5 rounded-[1.2rem] border border-white/8 bg-black/15 p-4">
                    <div class="flex items-center justify-between gap-4">
                      <span class="font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.26em] text-slate-400">
                        Solved release
                      </span>
                      <span class="font-[var(--font-display)] text-lg text-white">
                        {formatSigned(snapshot().launchAngles.appliedLiftDeg, 'deg')} lift
                      </span>
                    </div>
                    <p class="mt-2 text-sm leading-6 text-slate-300">
                      Auto-aim solves the baseline path back to plate center. Side and lift sliders
                      then bias the launch by hand.
                    </p>
                  </div>
                </Match>
                <Match when={viewMode() === 'spin-lab'}>
                  <p class="mt-5 text-sm leading-6 text-slate-300">
                    Spin Lab inherits the same speed and axis inputs, then freezes the baseball on
                    a pitcher-view tilt view so the Magnus vector can be read directly while you
                    drag the axis and even collapse it into gyro.
                  </p>
                </Match>
              </Switch>
            </section>

            <section class="px-5 py-5 sm:px-6 sm:py-6 xl:px-5 xl:py-4">
              <p class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-slate-400">
                {viewMode() === 'flight' ? 'Axis notes' : 'Flow notes'}
              </p>
              <h2 class="mt-2 font-[var(--font-display)] text-2xl font-medium text-white">
                {viewMode() === 'flight' ? 'What this axis does' : 'What this flow means'}
              </h2>

              <div class="mt-5 rounded-[1.5rem] border border-amber-300/10 bg-[linear-gradient(180deg,rgba(255,179,71,0.12)_0%,rgba(255,179,71,0.03)_100%)] p-4">
                <ul class="space-y-3 text-sm leading-6 text-slate-200">
                  <For each={viewMode() === 'flight' ? flightInsights() : spinInsights()}>
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
          </div>
        </aside>
      </div>
    </main>
  )
}

interface SectionHeaderProps {
  eyebrow: string
  title: string
  badge: string
  badgeTone: 'cyan' | 'amber'
}

function SectionHeader(props: SectionHeaderProps) {
  return (
    <div class="flex items-end justify-between gap-4">
      <div>
        <p class="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-slate-400">
          {props.eyebrow}
        </p>
        <h2 class="mt-2 font-[var(--font-display)] text-2xl font-medium text-white">
          {props.title}
        </h2>
      </div>
      <span
        class="rounded-full border px-3 py-1 font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.28em]"
        classList={{
          'border-cyan-400/20 bg-cyan-400/10 text-cyan-100': props.badgeTone === 'cyan',
          'border-amber-300/20 bg-amber-300/10 text-amber-100': props.badgeTone === 'amber',
        }}
      >
        {props.badge}
      </span>
    </div>
  )
}

interface ModeButtonProps {
  label: string
  active: boolean
  onClick: () => void
}

function ModeButton(props: ModeButtonProps) {
  return (
    <button
      type="button"
      class="rounded-full border px-3 py-1.5 font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.26em] transition"
      classList={{
        'border-cyan-300/25 bg-cyan-300 text-slate-950': props.active,
        'border-white/10 text-slate-300 hover:border-cyan-300/30 hover:text-white': !props.active,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
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

function getMagnusVectorLabel(
  force: { y: number; z: number },
  handedness: Handedness,
): string {
  const vertical = force.z >= 0 ? 'Up' : 'Down'
  const armSideForce = handedness === 'RHP' ? force.y : -force.y

  if (Math.abs(force.y) < Math.abs(force.z) * 0.35) {
    return vertical
  }

  return `${vertical} / ${armSideForce >= 0 ? 'Arm-side' : 'Glove-side'}`
}

function getMagnusVectorHint(
  force: { y: number; z: number },
  handedness: Handedness,
): string {
  const armSideForce = handedness === 'RHP' ? force.y : -force.y

  if (Math.abs(force.y) < Math.abs(force.z) * 0.35) {
    return force.z >= 0
      ? 'The displayed arrow is lifting the pitch in the pitcher view.'
      : 'The displayed arrow is driving the pitch down in the pitcher view.'
  }

  return `${force.z >= 0 ? 'Upward' : 'Downward'} force with ${
    armSideForce >= 0 ? 'arm-side' : 'glove-side'
  } bias in the pitcher view.`
}

export default App
