import { createEffect, onCleanup, onMount } from 'solid-js'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import type { SimulationInputs, SimulationSnapshot, TrajectorySample, Vec3 } from '../lib/simulation'
import { resampleTrajectory } from '../lib/simulation'

const DISPLAY_SAMPLE_COUNT = 64
const MORPH_DURATION_MS = 220
const SEAM_COLOR = '#b91c1c'
const BASE_LEATHER = '#f6f1e8'
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
      class="pitch-scene relative h-full min-h-[30rem] overflow-hidden rounded-[2rem] border border-white/10 bg-[#061320]"
    >
      <canvas ref={canvasRef} class="size-full" />
      <div class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#04101d]/80 to-transparent" />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#04101d]/90 via-[#04101d]/10 to-transparent" />
    </div>
  )
}

class PitchSceneController {
  private readonly container: HTMLDivElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly resizeObserver: ResizeObserver
  private readonly trajectoryMaterial: THREE.MeshPhysicalMaterial
  private readonly ballGroup: THREE.Group
  private readonly ballMesh: THREE.Mesh
  private readonly spinAxisLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly releaseGlow: THREE.Mesh
  private readonly velocityArrow: THREE.ArrowHelper
  private readonly magnusArrow: THREE.ArrowHelper
  private readonly zoneBox: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>
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
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80)
    this.camera.position.set(-1.8, -7.2, 4.2)
    this.camera.up.set(0, 0, 1)

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

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minDistance = 9
    this.controls.maxDistance = 18
    this.controls.minPolarAngle = Math.PI / 5
    this.controls.maxPolarAngle = Math.PI / 2.1
    this.controls.target.set(12.5, 0, 0.95)

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
    this.velocityArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      0.75,
      0x6ee7f9,
      0.18,
      0.1,
    )
    this.magnusArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      0.7,
      0xffb347,
      0.2,
      0.11,
    )

    this.zoneBox = this.createStrikeZone()

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
    this.controls.dispose()
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

    this.zoneBox.geometry.dispose()
    this.zoneBox.material.dispose()
    this.renderer.dispose()
  }

  private setupScene() {
    this.scene.fog = new THREE.FogExp2(0x040b14, 0.024)

    const ambient = new THREE.AmbientLight(0x8ec4ff, 0.5)
    const hemisphere = new THREE.HemisphereLight(0xb5d8ff, 0x03101d, 1.2)
    const key = new THREE.DirectionalLight(0xeef6ff, 2.4)
    key.position.set(-6, -4, 8)
    const rim = new THREE.DirectionalLight(0x48b4ff, 1.4)
    rim.position.set(10, 7, 4)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 16, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x07111d,
        roughness: 0.95,
        metalness: 0.05,
        transparent: true,
        opacity: 0.96,
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
        color: 0x1f4d74,
        dashSize: 0.38,
        gapSize: 0.22,
        transparent: true,
        opacity: 0.55,
      }),
    )
    lane.computeLineDistances()

    const sideLane = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 1.1, 0.01),
        new THREE.Vector3(18.44, 1.1, 0.01),
      ]),
      new THREE.LineDashedMaterial({
        color: 0x11314d,
        dashSize: 0.28,
        gapSize: 0.18,
        transparent: true,
        opacity: 0.35,
      }),
    )
    sideLane.computeLineDistances()

    const mirroredLane = sideLane.clone()
    mirroredLane.position.y = -2.2

    const plate = this.createHomePlate()

    this.ballGroup.add(this.ballMesh)
    this.ballGroup.add(this.spinAxisLine)

    this.scene.add(ambient, hemisphere, key, rim)
    this.scene.add(ground, lane, sideLane, mirroredLane, plate, this.zoneBox)
    this.scene.add(this.releaseGlow)
    this.scene.add(this.ballGroup)
    this.scene.add(this.velocityArrow)
    this.scene.add(this.magnusArrow)
  }

  private createBallMesh() {
    const texture = createBallTexture()
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()

    const material = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughness: 0.62,
      metalness: 0.03,
      clearcoat: 0.9,
      clearcoatRoughness: 0.18,
      sheen: 0.5,
      sheenColor: new THREE.Color('#fff8f0'),
    })

    return new THREE.Mesh(new THREE.SphereGeometry(0.15, 64, 64), material)
  }

  private createSpinAxisLine() {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.26, 0, 0),
      new THREE.Vector3(0.26, 0, 0),
    ])
    const material = new THREE.LineBasicMaterial({
      color: 0x8ce7ff,
      transparent: true,
      opacity: 0.88,
    })

    return new THREE.Line(geometry, material)
  }

  private createReleaseGlow() {
    const geometry = new THREE.RingGeometry(0.13, 0.19, 48)
    const material = new THREE.MeshBasicMaterial({
      color: 0x70d7ff,
      transparent: true,
      opacity: 0.44,
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
        color: 0x8ab4d8,
        transparent: true,
        opacity: 0.45,
      }),
    )
    zone.position.set(18.44, 0, 0.76)

    return zone
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
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.86,
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
    this.controls.update()
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
    this.trajectoryMaterial.emissiveIntensity = 0.16 + Math.min(state.peakForce / 1.6, 1) * 0.36
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

    this.velocityArrow.position.copy(sample.position)
    this.velocityArrow.setDirection(sample.velocity.clone().normalize())
    this.velocityArrow.setLength(0.34 + speed * 0.018, 0.18, 0.1)

    this.magnusArrow.position.copy(sample.position)
    this.magnusArrow.setDirection(
      magnus > 0 ? sample.magnusForce.clone().normalize() : new THREE.Vector3(0, 0, 1),
    )
    this.magnusArrow.setLength(0.28 + magnus * 6.4, 0.18, 0.1)
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

function createBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create baseball texture canvas.')
  }

  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  background.addColorStop(0, '#fff9f1')
  background.addColorStop(0.45, BASE_LEATHER)
  background.addColorStop(1, '#f0e7d6')
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)

  for (let index = 0; index < 2400; index += 1) {
    context.fillStyle = `rgba(131, 91, 54, ${0.01 + Math.random() * 0.035})`
    context.beginPath()
    context.arc(
      Math.random() * canvas.width,
      Math.random() * canvas.height,
      Math.random() * 1.3 + 0.4,
      0,
      Math.PI * 2,
    )
    context.fill()
  }

  const seamPaths = [
    [
      [0.19, 0.08],
      [0.36, 0.22],
      [0.34, 0.47],
      [0.18, 0.62],
      [0.12, 0.82],
      [0.23, 0.94],
    ],
    [
      [0.81, 0.08],
      [0.64, 0.22],
      [0.66, 0.47],
      [0.82, 0.62],
      [0.88, 0.82],
      [0.77, 0.94],
    ],
  ]

  context.strokeStyle = SEAM_COLOR
  context.lineWidth = 18
  context.lineCap = 'round'
  context.lineJoin = 'round'

  seamPaths.forEach((path) => {
    drawSeamPath(context, path, canvas.width, canvas.height)
  })

  context.strokeStyle = '#fde7e7'
  context.lineWidth = 3.2

  seamPaths.forEach((path) => {
    drawStitches(context, path, canvas.width, canvas.height)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping

  return texture
}

function drawSeamPath(
  context: CanvasRenderingContext2D,
  points: number[][],
  width: number,
  height: number,
) {
  context.beginPath()
  context.moveTo(points[0][0] * width, points[0][1] * height)

  for (let index = 1; index < points.length - 2; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const controlX = current[0] * width
    const controlY = current[1] * height
    const midpointX = ((current[0] + next[0]) / 2) * width
    const midpointY = ((current[1] + next[1]) / 2) * height

    context.quadraticCurveTo(controlX, controlY, midpointX, midpointY)
  }

  const secondToLast = points[points.length - 2]
  const last = points[points.length - 1]
  context.quadraticCurveTo(
    secondToLast[0] * width,
    secondToLast[1] * height,
    last[0] * width,
    last[1] * height,
  )
  context.stroke()
}

function drawStitches(
  context: CanvasRenderingContext2D,
  points: number[][],
  width: number,
  height: number,
) {
  const segments = 26

  for (let segment = 0; segment <= segments; segment += 1) {
    const t = segment / segments
    const anchor = samplePolyline(points, t)
    const previous = samplePolyline(points, Math.max(0, t - 0.02))
    const next = samplePolyline(points, Math.min(1, t + 0.02))
    const tangentX = (next[0] - previous[0]) * width
    const tangentY = (next[1] - previous[1]) * height
    const normalLength = Math.hypot(tangentX, tangentY) || 1
    const normalX = (-tangentY / normalLength) * 11
    const normalY = (tangentX / normalLength) * 11
    const x = anchor[0] * width
    const y = anchor[1] * height

    context.beginPath()
    context.moveTo(x - normalX, y - normalY)
    context.lineTo(x + normalX, y + normalY)
    context.stroke()
  }
}

function samplePolyline(points: number[][], t: number): [number, number] {
  const maxIndex = points.length - 1
  const scaled = t * maxIndex
  const index = Math.min(Math.floor(scaled), maxIndex - 1)
  const ratio = scaled - index
  const current = points[index]
  const next = points[index + 1]

  return [
    current[0] + (next[0] - current[0]) * ratio,
    current[1] + (next[1] - current[1]) * ratio,
  ]
}

export default PitchScene
