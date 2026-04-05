export type Handedness = 'RHP' | 'LHP'

export type PitchPresetId =
  | 'four-seam'
  | 'sinker'
  | 'slider'
  | 'curveball'
  | 'changeup'
  | 'custom'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface SimulationInputs {
  presetId: PitchPresetId
  handedness: Handedness
  velocityMph: number
  spinRateRpm: number
  axisAzimuthDeg: number
  axisElevationDeg: number
  releaseSideOffsetDeg: number
  releaseLiftOffsetDeg: number
}

export interface TrajectorySample {
  time: number
  position: Vec3
  velocity: Vec3
  magnusForce: Vec3
}

export interface SimulationMetrics {
  flightTimeMs: number
  horizontalBreakIn: number
  verticalBreakIn: number
  magnusForceN: number
  dragForceN: number
  spinEfficiencyPct: number
}

export interface LaunchAngles {
  autoYawDeg: number
  autoLiftDeg: number
  appliedYawDeg: number
  appliedLiftDeg: number
}

export interface SimulationSnapshot {
  samples: TrajectorySample[]
  plateSample: TrajectorySample
  metrics: SimulationMetrics
  spinAxis: Vec3
  releasePosition: Vec3
  platePosition: Vec3
  initialVelocity: Vec3
  referenceDragForce: Vec3
  referenceMagnusForce: Vec3
  reachesPlate: boolean
  launchAngles: LaunchAngles
}

export interface PitchPresetDefinition {
  id: Exclude<PitchPresetId, 'custom'>
  label: string
  shortLabel: string
  summary: string
  defaults: {
    velocityMph: number
    spinRateRpm: number
    axisAzimuthDeg: number
    axisElevationDeg: number
    releaseSideOffsetDeg: number
    releaseLiftOffsetDeg: number
  }
}

const BALL_RADIUS_METERS = 0.0366
const BALL_AREA_METERS = Math.PI * BALL_RADIUS_METERS ** 2
const BALL_MASS_KG = 0.145
const AIR_DENSITY = 1.225
const DRAG_COEFFICIENT = 0.35
const RELEASE_SIDE_OFFSET_METERS = 0.55
const RELEASE_HEIGHT_METERS = 1.85
const PLATE_DISTANCE_METERS = 18.44
const TARGET_HEIGHT_METERS = 0.76
const GRAVITY_METERS = 9.80665
const SIMULATION_DT_SECONDS = 1 / 240
const MAX_SIMULATION_SECONDS = 1.4
const METERS_TO_INCHES = 39.3701
const MPH_TO_METERS_PER_SECOND = 0.44704
const RPM_TO_RAD_PER_SECOND = (Math.PI * 2) / 60
const PLATE_EPSILON_METERS = 0.03
const LAUNCH_SOLVER_STEP_DEG = 0.35
const LAUNCH_SOLVER_MAX_DEG = 2.4

const TARGET_POINT: Vec3 = {
  x: PLATE_DISTANCE_METERS,
  y: 0,
  z: TARGET_HEIGHT_METERS,
}

export const PRESET_DEFINITIONS: PitchPresetDefinition[] = [
  {
    id: 'four-seam',
    label: 'Four-Seam',
    shortLabel: '4S',
    summary: 'Carry through the zone with minimal side drift.',
    defaults: {
      velocityMph: 95,
      spinRateRpm: 2400,
      axisAzimuthDeg: -90,
      axisElevationDeg: 7,
      releaseSideOffsetDeg: 0,
      releaseLiftOffsetDeg: 0,
    },
  },
  {
    id: 'sinker',
    label: 'Sinker',
    shortLabel: 'SI',
    summary: 'Arm-side run paired with late drop.',
    defaults: {
      velocityMph: 93,
      spinRateRpm: 2100,
      axisAzimuthDeg: 90,
      axisElevationDeg: 24,
      releaseSideOffsetDeg: 0,
      releaseLiftOffsetDeg: 0,
    },
  },
  {
    id: 'slider',
    label: 'Slider',
    shortLabel: 'SL',
    summary: 'Glove-side sweep with hard tilt.',
    defaults: {
      velocityMph: 85,
      spinRateRpm: 2500,
      axisAzimuthDeg: 90,
      axisElevationDeg: -33,
      releaseSideOffsetDeg: 0,
      releaseLiftOffsetDeg: 0,
    },
  },
  {
    id: 'curveball',
    label: 'Curveball',
    shortLabel: 'CB',
    summary: 'Topspin drop that still finishes through the plate.',
    defaults: {
      velocityMph: 82,
      spinRateRpm: 2550,
      axisAzimuthDeg: 138,
      axisElevationDeg: -10,
      releaseSideOffsetDeg: 0,
      releaseLiftOffsetDeg: 0,
    },
  },
  {
    id: 'changeup',
    label: 'Changeup',
    shortLabel: 'CH',
    summary: 'Reduced speed with arm-side fade and sink.',
    defaults: {
      velocityMph: 84,
      spinRateRpm: 1750,
      axisAzimuthDeg: 90,
      axisElevationDeg: 18,
      releaseSideOffsetDeg: 0,
      releaseLiftOffsetDeg: 0,
    },
  },
]

export const DEFAULT_PRESET_ID: PitchPresetId = 'curveball'

export function getPresetDefinition(
  presetId: Exclude<PitchPresetId, 'custom'>,
): PitchPresetDefinition {
  const preset = PRESET_DEFINITIONS.find((entry) => entry.id === presetId)

  if (!preset) {
    throw new Error(`Unknown preset: ${presetId}`)
  }

  return preset
}

export function getPresetInputs(
  presetId: Exclude<PitchPresetId, 'custom'>,
  handedness: Handedness,
): SimulationInputs {
  const preset = getPresetDefinition(presetId)
  const defaults =
    handedness === 'RHP'
      ? preset.defaults
      : mirrorPresetAxis({
          velocityMph: preset.defaults.velocityMph,
          spinRateRpm: preset.defaults.spinRateRpm,
          axisAzimuthDeg: preset.defaults.axisAzimuthDeg,
          axisElevationDeg: preset.defaults.axisElevationDeg,
          releaseSideOffsetDeg: -preset.defaults.releaseSideOffsetDeg,
          releaseLiftOffsetDeg: preset.defaults.releaseLiftOffsetDeg,
        })

  return {
    presetId,
    handedness,
    ...defaults,
  }
}

export function mirrorCustomInputs(
  inputs: SimulationInputs,
  handedness: Handedness,
): SimulationInputs {
  if (handedness === inputs.handedness) {
    return inputs
  }

  const mirrored = mirrorPresetAxis({
    velocityMph: inputs.velocityMph,
    spinRateRpm: inputs.spinRateRpm,
    axisAzimuthDeg: inputs.axisAzimuthDeg,
    axisElevationDeg: inputs.axisElevationDeg,
    releaseSideOffsetDeg: -inputs.releaseSideOffsetDeg,
    releaseLiftOffsetDeg: inputs.releaseLiftOffsetDeg,
  })

  return {
    ...inputs,
    handedness,
    ...mirrored,
  }
}

export function simulatePitch(inputs: SimulationInputs): SimulationSnapshot {
  const releasePosition = getReleasePosition(inputs.handedness)
  const spinAxis = axisFromAngles(inputs.axisAzimuthDeg, inputs.axisElevationDeg)
  const spinVector = scale(spinAxis, inputs.spinRateRpm * RPM_TO_RAD_PER_SECOND)
  const launchAngles = solveLaunchAngles(inputs, releasePosition, spinVector)
  const initialVelocity = velocityFromAngles(
    inputs.velocityMph * MPH_TO_METERS_PER_SECOND,
    launchAngles.appliedYawDeg,
    launchAngles.appliedLiftDeg,
  )
  const displaySamples = simulateCore(releasePosition, initialVelocity, spinVector, true)
  const plateSamples = simulateCore(releasePosition, initialVelocity, spinVector, false)
  const spinlessPlateSamples = simulateCore(releasePosition, initialVelocity, zero(), false)
  const plateSample = getSampleAtPlate(plateSamples)
  const spinlessPlateSample = getSampleAtPlate(spinlessPlateSamples)
  const referenceDragForce = computeDragForce(initialVelocity)
  const referenceMagnusForce = computeMagnusForce(initialVelocity, spinVector)
  const peakMagnusForce = plateSamples.reduce((max, sample) => {
    return Math.max(max, magnitude(sample.magnusForce))
  }, 0)
  const spinEfficiency = computeSpinEfficiency(spinAxis, normalize(initialVelocity))
  const reachesPlate =
    displaySamples[displaySamples.length - 1].position.x >=
    PLATE_DISTANCE_METERS - PLATE_EPSILON_METERS

  return {
    samples: displaySamples,
    plateSample,
    spinAxis,
    releasePosition,
    platePosition: plateSample.position,
    initialVelocity,
    referenceDragForce,
    referenceMagnusForce,
    reachesPlate,
    launchAngles,
    metrics: {
      flightTimeMs: plateSample.time * 1000,
      horizontalBreakIn:
        (plateSample.position.y - spinlessPlateSample.position.y) * METERS_TO_INCHES,
      verticalBreakIn:
        (plateSample.position.z - spinlessPlateSample.position.z) * METERS_TO_INCHES,
      magnusForceN: peakMagnusForce,
      dragForceN: magnitude(referenceDragForce),
      spinEfficiencyPct: spinEfficiency * 100,
    },
  }
}

export function resampleTrajectory(
  samples: TrajectorySample[],
  count: number,
): TrajectorySample[] {
  if (samples.length === 0) {
    return []
  }

  if (count <= 1 || samples.length === 1) {
    return [samples[0]]
  }

  const duration = samples[samples.length - 1].time
  const result: TrajectorySample[] = []

  for (let index = 0; index < count; index += 1) {
    const targetTime = duration * (index / (count - 1))
    result.push(interpolateSampleAtTime(samples, targetTime))
  }

  return result
}

export function formatBreakLabel(
  handedness: Handedness,
  horizontalBreakIn: number,
): string {
  const magnitudeInches = Math.abs(horizontalBreakIn)

  if (magnitudeInches < 0.5) {
    return 'Nearly neutral lateral break'
  }

  const direction = horizontalBreakIn > 0 ? 'arm-side' : 'glove-side'
  const handedLabel =
    handedness === 'RHP' ? direction : direction === 'arm-side' ? 'glove-side' : 'arm-side'

  return `${magnitudeInches.toFixed(1)} in ${handedLabel} break`
}

export function describeAxisEffect(
  inputs: SimulationInputs,
  metrics: SimulationMetrics,
  reachesPlate: boolean,
): string[] {
  const lines: string[] = []
  const verticalMagnitude = Math.abs(metrics.verticalBreakIn)

  if (!reachesPlate) {
    lines.push('This release choice bounces early, so the displayed path is clipped at the dirt.')
  }

  if (verticalMagnitude < 1.5) {
    lines.push('The current axis stays close to neutral ride versus drop.')
  } else if (metrics.verticalBreakIn > 0) {
    lines.push('Backspin is winning enough to hold the ball above a spinless path.')
  } else {
    lines.push('Topspin is overpowering carry and pushing the ball downward.')
  }

  const horizontalMagnitude = Math.abs(metrics.horizontalBreakIn)

  if (horizontalMagnitude < 1.5) {
    lines.push('Side force is muted, so the pitch mostly rides on its vertical plane.')
  } else {
    const armSideIsPositive = inputs.handedness === 'RHP'
    const movesArmSide =
      (armSideIsPositive && metrics.horizontalBreakIn > 0) ||
      (!armSideIsPositive && metrics.horizontalBreakIn < 0)

    lines.push(
      movesArmSide
        ? 'Axis tilt is leaning the Magnus vector toward arm-side fade.'
        : 'Axis tilt is leaning the Magnus vector toward glove-side sweep.',
    )
  }

  if (inputs.spinRateRpm < 1600) {
    lines.push('Spin rate is low enough that drag dominates the shape change.')
  } else if (inputs.spinRateRpm > 2500) {
    lines.push('High spin is amplifying the seam rotation and force cueing.')
  } else {
    lines.push('Spin rate is in the active range where small axis changes stay visible.')
  }

  return lines
}

export function describeSpinLab(snapshot: SimulationSnapshot): string[] {
  const notes: string[] = []
  const magnusDirection = dominantAxis(snapshot.referenceMagnusForce)
  const windSpeedMph =
    magnitude(snapshot.initialVelocity) / MPH_TO_METERS_PER_SECOND

  notes.push(
    `Relative wind is set to ${roundTo(windSpeedMph, 0)} mph, matching the release speed.`,
  )

  if (magnusDirection.axis === 'z') {
    notes.push(
      magnusDirection.sign > 0
        ? 'Upper and lower flow split is generating upward lift.'
        : 'Upper and lower flow split is generating downward force.',
    )
  } else if (magnusDirection.axis === 'y') {
    notes.push(
      magnusDirection.sign > 0
        ? 'Flow is biased toward arm-side movement.'
        : 'Flow is biased toward glove-side movement.',
    )
  } else {
    notes.push('Most of the force stays aligned with the travel axis, so visible break stays muted.')
  }

  if (snapshot.metrics.spinEfficiencyPct > 90) {
    notes.push('The spin axis is nearly perpendicular to travel, so the airflow asymmetry is strong.')
  } else if (snapshot.metrics.spinEfficiencyPct < 55) {
    notes.push('A large share of the spin is gyro-like, which softens the Magnus response.')
  } else {
    notes.push('The spin axis is mixed, so the airflow bends without becoming fully lift-dominant.')
  }

  return notes
}

export function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export function getReleasePosition(handedness: Handedness): Vec3 {
  return {
    x: 0,
    y: handedness === 'RHP' ? RELEASE_SIDE_OFFSET_METERS : -RELEASE_SIDE_OFFSET_METERS,
    z: RELEASE_HEIGHT_METERS,
  }
}

function solveLaunchAngles(
  inputs: SimulationInputs,
  releasePosition: Vec3,
  spinVector: Vec3,
): LaunchAngles {
  const directVector = subtract(TARGET_POINT, releasePosition)
  let yawDeg = (Math.atan2(directVector.y, directVector.x) * 180) / Math.PI
  let liftDeg =
    (Math.atan2(directVector.z, Math.hypot(directVector.x, directVector.y)) * 180) /
    Math.PI
  const speedMps = inputs.velocityMph * MPH_TO_METERS_PER_SECOND

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const center = sampleAtPlateForLaunch(releasePosition, speedMps, spinVector, yawDeg, liftDeg)
    const errorY = center.position.y - TARGET_POINT.y
    const errorZ = center.position.z - TARGET_POINT.z

    if (Math.hypot(errorY, errorZ) < 0.01) {
      break
    }

    const yawOffset = sampleAtPlateForLaunch(
      releasePosition,
      speedMps,
      spinVector,
      yawDeg + LAUNCH_SOLVER_STEP_DEG,
      liftDeg,
    )
    const liftOffset = sampleAtPlateForLaunch(
      releasePosition,
      speedMps,
      spinVector,
      yawDeg,
      liftDeg + LAUNCH_SOLVER_STEP_DEG,
    )
    const jacobian = {
      yy: (yawOffset.position.y - center.position.y) / LAUNCH_SOLVER_STEP_DEG,
      yz: (liftOffset.position.y - center.position.y) / LAUNCH_SOLVER_STEP_DEG,
      zy: (yawOffset.position.z - center.position.z) / LAUNCH_SOLVER_STEP_DEG,
      zz: (liftOffset.position.z - center.position.z) / LAUNCH_SOLVER_STEP_DEG,
    }
    const determinant = jacobian.yy * jacobian.zz - jacobian.yz * jacobian.zy

    if (Math.abs(determinant) < 0.0001) {
      break
    }

    const yawCorrection =
      (-errorY * jacobian.zz + errorZ * jacobian.yz) / determinant
    const liftCorrection =
      (-jacobian.yy * errorZ + jacobian.zy * errorY) / determinant

    yawDeg += clampValue(yawCorrection, -LAUNCH_SOLVER_MAX_DEG, LAUNCH_SOLVER_MAX_DEG)
    liftDeg += clampValue(liftCorrection, -LAUNCH_SOLVER_MAX_DEG, LAUNCH_SOLVER_MAX_DEG)
  }

  return {
    autoYawDeg: yawDeg,
    autoLiftDeg: liftDeg,
    appliedYawDeg: yawDeg + inputs.releaseSideOffsetDeg,
    appliedLiftDeg: liftDeg + inputs.releaseLiftOffsetDeg,
  }
}

function sampleAtPlateForLaunch(
  releasePosition: Vec3,
  speedMps: number,
  spinVector: Vec3,
  yawDeg: number,
  liftDeg: number,
): TrajectorySample {
  const initialVelocity = velocityFromAngles(speedMps, yawDeg, liftDeg)
  const samples = simulateCore(releasePosition, initialVelocity, spinVector, false)

  return getSampleAtPlate(samples)
}

function velocityFromAngles(speedMps: number, yawDeg: number, liftDeg: number): Vec3 {
  const yaw = (yawDeg * Math.PI) / 180
  const lift = (liftDeg * Math.PI) / 180
  const cosLift = Math.cos(lift)

  return {
    x: speedMps * cosLift * Math.cos(yaw),
    y: speedMps * cosLift * Math.sin(yaw),
    z: speedMps * Math.sin(lift),
  }
}

function simulateCore(
  releasePosition: Vec3,
  initialVelocity: Vec3,
  spinVector: Vec3,
  stopAtGround: boolean,
): TrajectorySample[] {
  const samples: TrajectorySample[] = []
  let position = clone(releasePosition)
  let velocity = clone(initialVelocity)
  let time = 0

  samples.push({
    time,
    position: clone(position),
    velocity: clone(velocity),
    magnusForce: computeMagnusForce(velocity, spinVector),
  })

  while (
    time < MAX_SIMULATION_SECONDS &&
    position.x < PLATE_DISTANCE_METERS &&
    (!stopAtGround || position.z > 0)
  ) {
    const dragForce = computeDragForce(velocity)
    const magnusForce = computeMagnusForce(velocity, spinVector)
    const totalForce = add(add(dragForce, magnusForce), {
      x: 0,
      y: 0,
      z: -BALL_MASS_KG * GRAVITY_METERS,
    })
    const acceleration = scale(totalForce, 1 / BALL_MASS_KG)

    velocity = add(velocity, scale(acceleration, SIMULATION_DT_SECONDS))
    position = add(position, scale(velocity, SIMULATION_DT_SECONDS))
    time += SIMULATION_DT_SECONDS

    samples.push({
      time,
      position: clone(position),
      velocity: clone(velocity),
      magnusForce,
    })
  }

  return projectTerminalSample(samples, stopAtGround)
}

function projectTerminalSample(
  samples: TrajectorySample[],
  stopAtGround: boolean,
): TrajectorySample[] {
  if (samples.length < 2) {
    return samples
  }

  const projected = samples.slice(0, -1)
  const previous = samples[samples.length - 2]
  const current = samples[samples.length - 1]

  if (current.position.x >= PLATE_DISTANCE_METERS) {
    const span = current.position.x - previous.position.x
    const ratio = span === 0 ? 1 : (PLATE_DISTANCE_METERS - previous.position.x) / span
    projected.push(interpolateSamples(previous, current, ratio))
    return projected
  }

  if (stopAtGround && current.position.z <= 0) {
    const span = current.position.z - previous.position.z
    const ratio = span === 0 ? 1 : (0 - previous.position.z) / span
    projected.push(interpolateSamples(previous, current, ratio))
    return projected
  }

  projected.push(current)
  return projected
}

function getSampleAtPlate(samples: TrajectorySample[]): TrajectorySample {
  return samples[samples.length - 1]
}

function interpolateSampleAtTime(
  samples: TrajectorySample[],
  targetTime: number,
): TrajectorySample {
  if (targetTime <= samples[0].time) {
    return samples[0]
  }

  const last = samples[samples.length - 1]

  if (targetTime >= last.time) {
    return last
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]

    if (targetTime <= current.time) {
      const span = current.time - previous.time
      const ratio = span === 0 ? 1 : (targetTime - previous.time) / span
      return interpolateSamples(previous, current, ratio)
    }
  }

  return last
}

function interpolateSamples(
  previous: TrajectorySample,
  current: TrajectorySample,
  ratio: number,
): TrajectorySample {
  return {
    time: lerp(previous.time, current.time, ratio),
    position: mix(previous.position, current.position, ratio),
    velocity: mix(previous.velocity, current.velocity, ratio),
    magnusForce: mix(previous.magnusForce, current.magnusForce, ratio),
  }
}

function mirrorPresetAxis<T extends {
  axisAzimuthDeg: number
  axisElevationDeg: number
  releaseSideOffsetDeg: number
  releaseLiftOffsetDeg: number
}>(defaults: T): T {
  const axis = axisFromAngles(defaults.axisAzimuthDeg, defaults.axisElevationDeg)
  const mirroredAxis = {
    x: axis.x,
    y: axis.y,
    z: -axis.z,
  }
  const angles = anglesFromAxis(mirroredAxis)

  return {
    ...defaults,
    axisAzimuthDeg: angles.axisAzimuthDeg,
    axisElevationDeg: angles.axisElevationDeg,
  }
}

function axisFromAngles(axisAzimuthDeg: number, axisElevationDeg: number): Vec3 {
  const azimuth = (axisAzimuthDeg * Math.PI) / 180
  const elevation = (axisElevationDeg * Math.PI) / 180
  const cosElevation = Math.cos(elevation)

  return normalize({
    x: cosElevation * Math.cos(azimuth),
    y: cosElevation * Math.sin(azimuth),
    z: Math.sin(elevation),
  })
}

function anglesFromAxis(axis: Vec3): {
  axisAzimuthDeg: number
  axisElevationDeg: number
} {
  const normalized = normalize(axis)

  return {
    axisAzimuthDeg: (Math.atan2(normalized.y, normalized.x) * 180) / Math.PI,
    axisElevationDeg:
      (Math.atan2(normalized.z, Math.hypot(normalized.x, normalized.y)) * 180) /
      Math.PI,
  }
}

function computeSpinEfficiency(spinAxis: Vec3, travelDirection: Vec3): number {
  const axisAlignment = dot(spinAxis, travelDirection)
  return Math.sqrt(Math.max(0, 1 - axisAlignment ** 2))
}

function computeDragForce(velocity: Vec3): Vec3 {
  const speed = magnitude(velocity)

  if (speed === 0) {
    return zero()
  }

  const dragMagnitude =
    0.5 * AIR_DENSITY * DRAG_COEFFICIENT * BALL_AREA_METERS * speed ** 2

  return scale(normalize(velocity), -dragMagnitude)
}

function computeMagnusForce(velocity: Vec3, spinVector: Vec3): Vec3 {
  const speed = magnitude(velocity)
  const spinRate = magnitude(spinVector)

  if (speed === 0 || spinRate === 0) {
    return zero()
  }

  const spinRatio = (BALL_RADIUS_METERS * spinRate) / speed
  const liftCoefficient = clampValue(0.09 + 0.6 * spinRatio, 0, 0.35)
  const spinDirection = normalize(cross(spinVector, velocity))

  if (magnitude(spinDirection) === 0) {
    return zero()
  }

  const magnusMagnitude =
    0.5 * AIR_DENSITY * liftCoefficient * BALL_AREA_METERS * speed ** 2

  return scale(spinDirection, magnusMagnitude)
}

function dominantAxis(vector: Vec3): {
  axis: 'x' | 'y' | 'z'
  sign: number
} {
  const absX = Math.abs(vector.x)
  const absY = Math.abs(vector.y)
  const absZ = Math.abs(vector.z)

  if (absX >= absY && absX >= absZ) {
    return { axis: 'x', sign: Math.sign(vector.x) || 1 }
  }

  if (absY >= absZ) {
    return { axis: 'y', sign: Math.sign(vector.y) || 1 }
  }

  return { axis: 'z', sign: Math.sign(vector.z) || 1 }
}

function zero(): Vec3 {
  return { x: 0, y: 0, z: 0 }
}

function clone(vector: Vec3): Vec3 {
  return { ...vector }
}

function add(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  }
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  }
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  }
}

function mix(left: Vec3, right: Vec3, ratio: number): Vec3 {
  return {
    x: lerp(left.x, right.x, ratio),
    y: lerp(left.y, right.y, ratio),
    z: lerp(left.z, right.z, ratio),
  }
}

function magnitude(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalize(vector: Vec3): Vec3 {
  const length = magnitude(vector)

  if (length === 0) {
    return zero()
  }

  return scale(vector, 1 / length)
}

function dot(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio
}
