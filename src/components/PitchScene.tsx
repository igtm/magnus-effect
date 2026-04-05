import { createEffect, onCleanup, onMount } from 'solid-js'
import * as THREE from 'three'

import { createBaseballMaterial } from '../lib/baseballVisuals'
import { OutlinedArrow } from '../lib/outlinedArrow'
import type { SimulationInputs, SimulationSnapshot, TrajectorySample, Vec3 } from '../lib/simulation'
import { resampleTrajectory } from '../lib/simulation'

const DISPLAY_SAMPLE_COUNT = 64
const MORPH_DURATION_MS = 220
const FORCE_LOW_COLOR = '#22d3ee'
const FORCE_HIGH_COLOR = '#f59e0b'

interface PitchSceneProps {
  snapshot: SimulationSnapshot
  inputs: SimulationInputs
}

interface RenderSample {
  time: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  magnusForce: THREE.Vector3
}

interface RenderState {
  samples: RenderSample[]
  spinAxis: THREE.Vector3
  tubeColor: THREE.Color
  tubeRadius: number
  peakForce: number
  flightTimeMs: number
  spinRateRpm: number
}

function PitchScene(props: PitchSceneProps) {
  let containerRef!: HTMLDivElement
  let canvasRef!: HTMLCanvasElement
  let controller: PitchSceneController | undefined

  onMount(() => {
    controller = new PitchSceneController(containerRef, canvasRef)
    controller.setSnapshot(props.snapshot, props.inputs)
  })

  createEffect(() => {
    controller?.setSnapshot(props.snapshot, props.inputs)
  })

  onCleanup(() => {
    controller?.dispose()
  })

  return (
    <div
      ref={containerRef}
      class="pitch-scene relative h-full min-h-[30rem] overflow-hidden rounded-[2rem] border border-black/10 bg-[#f4f5f7] xl:min-h-0"
    >
      <canvas ref={canvasRef} class="size-full" />
      <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/80 to-transparent" />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-300/78 via-slate-300/18 to-transparent" />
    </div>
  )
}

class PitchSceneController {
  private readonly container: HTMLDivElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly resizeObserver: ResizeObserver
  private readonly trajectoryMaterial: THREE.MeshPhysicalMaterial
  private readonly ballGroup: THREE.Group
  private readonly ballMesh: THREE.Mesh
  private readonly spinAxisLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly releaseGlow: THREE.Mesh
  private readonly velocityArrow: OutlinedArrow
  private readonly magnusArrow: OutlinedArrow
  private readonly zoneBox: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>
  private readonly zoneGrid: THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >
  private readonly guideFan: THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >
  private readonly releaseGlowMaterial: THREE.MeshBasicMaterial
  private animationFrame = 0
  private morphStartTime = 0
  private pitchLoopStartTime = performance.now()
  private currentState: RenderState | undefined
  private fromState: RenderState | undefined
  private targetState: RenderState | undefined
  private trajectoryMesh: THREE.Mesh | undefined

  constructor(container: HTMLDivElement, canvas: HTMLCanvasElement) {
    this.container = container
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(23, 1, 0.1, 80)
    this.camera.position.set(20.9, 0, 1.02)
    this.camera.up.set(0, 0, 1)
    this.camera.lookAt(10.6, 0, 0.58)

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2

    this.trajectoryMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(FORCE_LOW_COLOR),
      roughness: 0.18,
      metalness: 0.3,
      clearcoat: 0.8,
      transparent: true,
      opacity: 0.95,
      emissive: new THREE.Color(FORCE_LOW_COLOR),
      emissiveIntensity: 0.3,
    })

    this.ballGroup = new THREE.Group()
    this.ballMesh = this.createBallMesh()
    this.spinAxisLine = this.createSpinAxisLine()
    const { mesh: releaseGlow, material: releaseGlowMaterial } = this.createReleaseGlow()
    this.releaseGlow = releaseGlow
    this.releaseGlowMaterial = releaseGlowMaterial
    this.velocityArrow = new OutlinedArrow({
      color: 0x38bdf8,
      shaftRadius: 0.024,
      headRadius: 0.08,
    })
    this.magnusArrow = new OutlinedArrow({
      color: 0xf59e0b,
      shaftRadius: 0.028,
      headRadius: 0.094,
    })

    this.zoneBox = this.createStrikeZone()
    this.zoneGrid = this.createStrikeZoneGrid()
    this.guideFan = this.createGuideFan()

    this.setupScene()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
    this.renderFrame = this.renderFrame.bind(this)
    this.animationFrame = requestAnimationFrame(this.renderFrame)
  }

  setSnapshot(snapshot: SimulationSnapshot, inputs: SimulationInputs) {
    const nextState = buildRenderState(snapshot, inputs)

    if (!this.targetState) {
      this.targetState = nextState
      this.currentState = cloneState(nextState)
      this.applyState(this.currentState)
      return
    }

    this.fromState = this.currentState ? cloneState(this.currentState) : cloneState(this.targetState)
    this.targetState = nextState
    this.morphStartTime = performance.now()
    this.pitchLoopStartTime = performance.now()
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    this.trajectoryMesh?.geometry.dispose()
    this.trajectoryMaterial.dispose()
    this.ballMesh.geometry.dispose()

    const ballMaterial = this.ballMesh.material

    if (Array.isArray(ballMaterial)) {
      ballMaterial.forEach((material) => material.dispose())
    } else {
      ballMaterial.dispose()
    }

    this.spinAxisLine.geometry.dispose()
    this.spinAxisLine.material.dispose()
    this.releaseGlow.geometry.dispose()
    this.releaseGlowMaterial.dispose()
    this.velocityArrow.dispose()
    this.magnusArrow.dispose()

    this.zoneBox.geometry.dispose()
    this.zoneBox.material.dispose()
    this.zoneGrid.geometry.dispose()
    this.zoneGrid.material.dispose()
    this.guideFan.geometry.dispose()
    this.guideFan.material.dispose()
    this.renderer.dispose()
  }

  private setupScene() {
    this.scene.fog = new THREE.FogExp2(0xf3f4f6, 0.015)

    const ambient = new THREE.AmbientLight(0xffffff, 1.25)
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xd4d4d8, 1.15)
    const key = new THREE.DirectionalLight(0xffffff, 1.8)
    key.position.set(-6.5, -3.2, 9.4)
    const rim = new THREE.DirectionalLight(0xdbeafe, 0.72)
    rim.position.set(10, 4.5, 5.2)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 16, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0xcfcfd2,
        roughness: 0.98,
        metalness: 0.02,
      }),
    )
    ground.position.set(9.2, 0, -0.01)
    ground.receiveShadow = false

    const lane = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0.01),
        new THREE.Vector3(18.44, 0, 0.01),
      ]),
      new THREE.LineDashedMaterial({
        color: 0xffffff,
        dashSize: 0.38,
        gapSize: 0.22,
        transparent: true,
        opacity: 0.34,
      }),
    )
    lane.computeLineDistances()

    const leftBox = this.createBatterBox(-0.98)
    const rightBox = this.createBatterBox(0.98)
    const plate = this.createHomePlate()

    this.ballGroup.add(this.ballMesh)
    this.ballGroup.add(this.spinAxisLine)

    this.scene.add(ambient, hemisphere, key, rim)
    this.scene.add(ground, lane, leftBox, rightBox, plate, this.zoneBox, this.zoneGrid, this.guideFan)
    this.scene.add(this.releaseGlow)
    this.scene.add(this.ballGroup)
    this.scene.add(this.velocityArrow.group)
    this.scene.add(this.magnusArrow.group)
  }

  private createBallMesh() {
    const material = createBaseballMaterial(this.renderer.capabilities.getMaxAnisotropy())

    return new THREE.Mesh(new THREE.SphereGeometry(0.055, 64, 64), material)
  }

  private createSpinAxisLine() {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.11, 0, 0),
      new THREE.Vector3(0.11, 0, 0),
    ])
    const material = new THREE.LineBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.4,
    })

    return new THREE.Line(geometry, material)
  }

  private createReleaseGlow() {
    const geometry = new THREE.RingGeometry(0.06, 0.085, 48)
    const material = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.y = Math.PI / 2
    mesh.position.set(0, 0, 1.85)

    return { mesh, material }
  }

  private createStrikeZone() {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.15, 0.43, 0.66))
    const zone = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0x111827,
        transparent: true,
        opacity: 0.88,
      }),
    )
    zone.position.set(18.44, 0, 0.76)

    return zone
  }

  private createStrikeZoneGrid() {
    const zoneCenterX = 18.44 + 0.076
    const zoneHalfWidth = 0.215
    const zoneHalfHeight = 0.33
    const horizontalStep = (zoneHalfHeight * 2) / 3
    const verticalStep = (zoneHalfWidth * 2) / 3
    const points = [
      new THREE.Vector3(zoneCenterX, -zoneHalfWidth + verticalStep, 0.76 - zoneHalfHeight),
      new THREE.Vector3(zoneCenterX, -zoneHalfWidth + verticalStep, 0.76 + zoneHalfHeight),
      new THREE.Vector3(zoneCenterX, -zoneHalfWidth + verticalStep * 2, 0.76 - zoneHalfHeight),
      new THREE.Vector3(zoneCenterX, -zoneHalfWidth + verticalStep * 2, 0.76 + zoneHalfHeight),
      new THREE.Vector3(zoneCenterX, -zoneHalfWidth, 0.76 - zoneHalfHeight + horizontalStep),
      new THREE.Vector3(zoneCenterX, zoneHalfWidth, 0.76 - zoneHalfHeight + horizontalStep),
      new THREE.Vector3(zoneCenterX, -zoneHalfWidth, 0.76 - zoneHalfHeight + horizontalStep * 2),
      new THREE.Vector3(zoneCenterX, zoneHalfWidth, 0.76 - zoneHalfHeight + horizontalStep * 2),
    ]

    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: 0x111827,
        transparent: true,
        opacity: 0.58,
      }),
    )
  }

  private createGuideFan() {
    const release = new THREE.Vector3(0, 0, 1.85)
    const zoneCenterX = 18.44
    const zoneHalfWidth = 0.215
    const zoneHalfHeight = 0.33
    const points = [
      release,
      new THREE.Vector3(zoneCenterX, -zoneHalfWidth, 0.76 - zoneHalfHeight),
      release,
      new THREE.Vector3(zoneCenterX, zoneHalfWidth, 0.76 - zoneHalfHeight),
      release,
      new THREE.Vector3(zoneCenterX, -zoneHalfWidth, 0.76 + zoneHalfHeight),
      release,
      new THREE.Vector3(zoneCenterX, zoneHalfWidth, 0.76 + zoneHalfHeight),
    ]

    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.22,
      }),
    )
  }

  private createBatterBox(yCenter: number) {
    const points = [
      new THREE.Vector3(18.86, yCenter - 0.47, 0.02),
      new THREE.Vector3(20.26, yCenter - 0.47, 0.02),
      new THREE.Vector3(20.26, yCenter + 0.47, 0.02),
      new THREE.Vector3(18.86, yCenter + 0.47, 0.02),
      new THREE.Vector3(18.86, yCenter - 0.47, 0.02),
    ]

    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
      }),
    )
  }

  private createHomePlate() {
    const halfWidth = 0.216
    const shape = new THREE.Shape()
    shape.moveTo(-0.12, -halfWidth)
    shape.lineTo(0.12, -halfWidth)
    shape.lineTo(0.216, 0)
    shape.lineTo(0.12, halfWidth)
    shape.lineTo(-0.12, halfWidth)
    shape.lineTo(-0.216, 0)
    shape.closePath()

    const geometry = new THREE.ShapeGeometry(shape)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(18.44, 0, 0.015)

    return mesh
  }

  private resize() {
    const { clientWidth, clientHeight } = this.container

    if (clientWidth === 0 || clientHeight === 0) {
      return
    }

    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(clientWidth, clientHeight, false)
  }

  private renderFrame(now: number) {
    this.animationFrame = requestAnimationFrame(this.renderFrame)
    this.updateMorph(now)
    this.updateBall(now)
    this.releaseGlowMaterial.opacity = 0.32 + Math.sin(now * 0.004) * 0.08
    this.renderer.render(this.scene, this.camera)
  }

  private updateMorph(now: number) {
    if (!this.targetState) {
      return
    }

    if (!this.fromState || !this.currentState || this.morphStartTime === 0) {
      this.currentState = cloneState(this.targetState)
      this.applyState(this.currentState)
      return
    }

    const progress = Math.min((now - this.morphStartTime) / MORPH_DURATION_MS, 1)
    const blended = interpolateState(this.fromState, this.targetState, easeInOut(progress))
    this.currentState = blended
    this.applyState(blended)

    if (progress >= 1) {
      this.fromState = undefined
      this.currentState = cloneState(this.targetState)
      this.morphStartTime = 0
    }
  }

  private applyState(state: RenderState) {
    this.updateTrajectory(state)
    this.updateSpinAxis(state.spinAxis)
    this.releaseGlow.position.set(
      state.samples[0].position.x,
      state.samples[0].position.y,
      state.samples[0].position.z,
    )
  }

  private updateTrajectory(state: RenderState) {
    this.trajectoryMesh?.geometry.dispose()
    this.scene.remove(this.trajectoryMesh ?? new THREE.Object3D())

    const curve = new THREE.CatmullRomCurve3(
      state.samples.map((sample) => sample.position),
      false,
      'centripetal',
    )
    const geometry = new THREE.TubeGeometry(
      curve,
      Math.max(48, state.samples.length * 3),
      state.tubeRadius,
      20,
      false,
    )
    this.trajectoryMaterial.color.copy(state.tubeColor)
    this.trajectoryMaterial.emissive.copy(state.tubeColor)
    this.trajectoryMaterial.opacity = 0.62
    this.trajectoryMaterial.emissiveIntensity = 0.04 + Math.min(state.peakForce / 1.6, 1) * 0.14
    this.trajectoryMesh = new THREE.Mesh(geometry, this.trajectoryMaterial)
    this.scene.add(this.trajectoryMesh)
  }

  private updateSpinAxis(axis: THREE.Vector3) {
    const geometry = this.spinAxisLine.geometry
    const positions = geometry.attributes.position.array as Float32Array
    positions[0] = -axis.x * 0.28
    positions[1] = -axis.y * 0.28
    positions[2] = -axis.z * 0.28
    positions[3] = axis.x * 0.28
    positions[4] = axis.y * 0.28
    positions[5] = axis.z * 0.28
    geometry.attributes.position.needsUpdate = true
  }

  private updateBall(now: number) {
    const state = this.currentState ?? this.targetState

    if (!state || state.samples.length === 0) {
      return
    }

    const travelMs = Math.max(880, state.flightTimeMs * 1.5)
    const holdMs = 420
    const loopMs = travelMs + holdMs
    const elapsedMs = (now - this.pitchLoopStartTime) % loopMs
    const normalizedProgress = elapsedMs >= travelMs ? 1 : easeInOut(elapsedMs / travelMs)
    const sample = sampleStateAtProgress(state, normalizedProgress)
    const spinAxis = state.spinAxis.clone().normalize()
    const visualSpinRps = Math.min(state.spinRateRpm / 60, 18)
    const angle = ((now - this.pitchLoopStartTime) / 1000) * visualSpinRps * Math.PI * 2

    this.ballGroup.position.copy(sample.position)
    this.ballMesh.quaternion.setFromAxisAngle(spinAxis, angle)

    const speed = sample.velocity.length()
    const magnus = sample.magnusForce.length()

    this.velocityArrow.setPosition(sample.position)
    this.velocityArrow.setDirection(sample.velocity.clone().normalize())
    this.velocityArrow.setLength(0.12 + speed * 0.008, 0.1)

    this.magnusArrow.setPosition(sample.position)
    this.magnusArrow.setDirection(
      magnus > 0 ? sample.magnusForce.clone().normalize() : new THREE.Vector3(0, 0, 1),
    )
    this.magnusArrow.setLength(0.1 + magnus * 1.75, 0.11)
  }
}

function buildRenderState(snapshot: SimulationSnapshot, inputs: SimulationInputs): RenderState {
  const samples = resampleTrajectory(snapshot.samples, DISPLAY_SAMPLE_COUNT).map(convertSample)
  const forceRatio = Math.min(snapshot.metrics.magnusForceN / 1.55, 1)
  const tubeColor = new THREE.Color(FORCE_LOW_COLOR).lerp(
    new THREE.Color(FORCE_HIGH_COLOR),
    forceRatio,
  )
  const tubeRadius = 0.04 + forceRatio * 0.05

  return {
    samples,
    spinAxis: toThreeVector(snapshot.spinAxis).normalize(),
    tubeColor,
    tubeRadius,
    peakForce: snapshot.metrics.magnusForceN,
    flightTimeMs: snapshot.metrics.flightTimeMs,
    spinRateRpm: inputs.spinRateRpm,
  }
}

function convertSample(sample: TrajectorySample): RenderSample {
  return {
    time: sample.time,
    position: toThreeVector(sample.position),
    velocity: toThreeVector(sample.velocity),
    magnusForce: toThreeVector(sample.magnusForce),
  }
}

function toThreeVector(vector: Vec3): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z)
}

function cloneState(state: RenderState): RenderState {
  return {
    ...state,
    tubeColor: state.tubeColor.clone(),
    spinAxis: state.spinAxis.clone(),
    samples: state.samples.map((sample) => ({
      time: sample.time,
      position: sample.position.clone(),
      velocity: sample.velocity.clone(),
      magnusForce: sample.magnusForce.clone(),
    })),
  }
}

function interpolateState(fromState: RenderState, toState: RenderState, ratio: number): RenderState {
  const maxIndex = Math.min(fromState.samples.length, toState.samples.length)
  const samples: RenderSample[] = []

  for (let index = 0; index < maxIndex; index += 1) {
    const previous = fromState.samples[index]
    const current = toState.samples[index]
    samples.push({
      time: lerp(previous.time, current.time, ratio),
      position: previous.position.clone().lerp(current.position, ratio),
      velocity: previous.velocity.clone().lerp(current.velocity, ratio),
      magnusForce: previous.magnusForce.clone().lerp(current.magnusForce, ratio),
    })
  }

  return {
    samples,
    spinAxis: fromState.spinAxis.clone().lerp(toState.spinAxis, ratio).normalize(),
    tubeColor: fromState.tubeColor.clone().lerp(toState.tubeColor, ratio),
    tubeRadius: lerp(fromState.tubeRadius, toState.tubeRadius, ratio),
    peakForce: lerp(fromState.peakForce, toState.peakForce, ratio),
    flightTimeMs: lerp(fromState.flightTimeMs, toState.flightTimeMs, ratio),
    spinRateRpm: lerp(fromState.spinRateRpm, toState.spinRateRpm, ratio),
  }
}

function sampleStateAtProgress(state: RenderState, progress: number): RenderSample {
  if (progress <= 0) {
    return state.samples[0]
  }

  const last = state.samples[state.samples.length - 1]

  if (progress >= 1) {
    return last
  }

  const scaledIndex = progress * (state.samples.length - 1)
  const index = Math.floor(scaledIndex)
  const ratio = scaledIndex - index
  const previous = state.samples[index]
  const current = state.samples[index + 1]

  return {
    time: lerp(previous.time, current.time, ratio),
    position: previous.position.clone().lerp(current.position, ratio),
    velocity: previous.velocity.clone().lerp(current.velocity, ratio),
    magnusForce: previous.magnusForce.clone().lerp(current.magnusForce, ratio),
  }
}

function easeInOut(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2
}

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio
}

export default PitchScene
