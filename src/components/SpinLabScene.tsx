import { createEffect, onCleanup, onMount } from 'solid-js'
import * as THREE from 'three'

import { createBaseballMaterial } from '../lib/baseballVisuals'
import type { SimulationInputs, SimulationSnapshot, Vec3 } from '../lib/simulation'

const FLOW_LOW_COLOR = new THREE.Color('#38bdf8')
const FLOW_HIGH_COLOR = new THREE.Color('#fb923c')
const FORCE_LOW_COLOR = new THREE.Color('#67e8f9')
const FORCE_HIGH_COLOR = new THREE.Color('#f59e0b')
const CAMERA_HEIGHT = 5.6
const STREAMLINE_RADIUS = 0.58
const STREAMLINE_RANGE_X = 3.2
const STREAMLINE_RANGE_Y = 2.3

interface SpinLabSceneProps {
  snapshot: SimulationSnapshot
  inputs: SimulationInputs
}

interface SpinLabState {
  relativeWind: THREE.Vector3
  magnusForce: THREE.Vector3
  spinAxis: THREE.Vector3
  spinRateRpm: number
  speedMph: number
}

interface LocalFrame {
  spinAxisLocal: THREE.Vector3
}

interface FlowPath {
  points: THREE.Vector3[]
  colors: THREE.Color[]
}

interface ParticleBinding {
  mesh: THREE.Mesh
  path: THREE.Vector3[]
  offset: number
  speed: number
}

function SpinLabScene(props: SpinLabSceneProps) {
  let containerRef!: HTMLDivElement
  let canvasRef!: HTMLCanvasElement
  let controller: SpinLabSceneController | undefined

  onMount(() => {
    controller = new SpinLabSceneController(containerRef, canvasRef)
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
      <div class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#04101d]/85 to-transparent" />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#04101d]/90 via-[#04101d]/10 to-transparent" />
    </div>
  )
}

class SpinLabSceneController {
  private readonly container: HTMLDivElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly resizeObserver: ResizeObserver
  private readonly ballGroup: THREE.Group
  private readonly ballMesh: THREE.Mesh
  private readonly spinAxisLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly forceArrow: THREE.ArrowHelper
  private readonly flowGroup = new THREE.Group()
  private readonly particleGeometry = new THREE.SphereGeometry(0.03, 16, 16)
  private readonly particleMaterial = new THREE.MeshBasicMaterial({
    color: 0xe0fbff,
    transparent: true,
    opacity: 0.82,
  })
  private readonly coreGlow: THREE.Mesh
  private animationFrame = 0
  private targetState: SpinLabState | undefined
  private currentState: SpinLabState | undefined
  private particleBindings: ParticleBinding[] = []

  constructor(container: HTMLDivElement, canvas: HTMLCanvasElement) {
    this.container = container
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x04101d, 0.025)

    this.camera = new THREE.OrthographicCamera(-4, 4, 2.8, -2.8, 0.1, 20)
    this.camera.position.set(0, 0, 8)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.14

    this.ballGroup = new THREE.Group()
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 64, 64),
      createBaseballMaterial(this.renderer.capabilities.getMaxAnisotropy()),
    )
    this.spinAxisLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.76, 0, 0),
        new THREE.Vector3(0.76, 0, 0),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x93e8ff,
        transparent: true,
        opacity: 0.92,
      }),
    )
    this.forceArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      1.2,
      0xf59e0b,
      0.28,
      0.16,
    )
    this.coreGlow = new THREE.Mesh(
      new THREE.CircleGeometry(0.94, 64),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.08,
      }),
    )

    this.setupScene()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
    this.renderFrame = this.renderFrame.bind(this)
    this.animationFrame = requestAnimationFrame(this.renderFrame)
  }

  setSnapshot(snapshot: SimulationSnapshot, inputs: SimulationInputs) {
    const nextState: SpinLabState = {
      relativeWind: toThreeVector(snapshot.initialVelocity).normalize().multiplyScalar(-1),
      magnusForce: toThreeVector(snapshot.referenceMagnusForce),
      spinAxis: toThreeVector(snapshot.spinAxis).normalize(),
      spinRateRpm: inputs.spinRateRpm,
      speedMph: inputs.velocityMph,
    }

    this.targetState = nextState

    if (!this.currentState) {
      this.currentState = cloneLabState(nextState)
    }

    this.rebuildFlowVisualization(nextState)
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    this.ballMesh.geometry.dispose()

    const material = this.ballMesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else {
      material.dispose()
    }

    this.spinAxisLine.geometry.dispose()
    this.spinAxisLine.material.dispose()
    this.particleGeometry.dispose()
    this.particleMaterial.dispose()
    this.clearFlowGroup()
    this.renderer.dispose()
  }

  private setupScene() {
    const ambient = new THREE.AmbientLight(0xa8d8ff, 0.82)
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(-3.8, -2.6, 6)
    const rim = new THREE.DirectionalLight(0x22d3ee, 1.1)
    rim.position.set(2.8, 2.2, 3.8)

    const lane = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-3.5, 0, -0.25),
        new THREE.Vector3(3.5, 0, -0.25),
      ]),
      new THREE.LineDashedMaterial({
        color: 0x12314d,
        dashSize: 0.24,
        gapSize: 0.12,
        transparent: true,
        opacity: 0.55,
      }),
    )
    lane.computeLineDistances()

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(7.2, 4.5)),
      new THREE.LineBasicMaterial({
        color: 0x10253a,
        transparent: true,
        opacity: 0.38,
      }),
    )
    frame.position.z = -0.35

    this.ballGroup.add(this.ballMesh)
    this.ballGroup.add(this.spinAxisLine)

    this.scene.add(ambient, key, rim)
    this.scene.add(frame, lane, this.coreGlow)
    this.scene.add(this.flowGroup)
    this.scene.add(this.ballGroup)
    this.scene.add(this.forceArrow)
  }

  private resize() {
    const { clientWidth, clientHeight } = this.container

    if (clientWidth === 0 || clientHeight === 0) {
      return
    }

    const aspect = clientWidth / clientHeight
    this.camera.left = (-CAMERA_HEIGHT * aspect) / 2
    this.camera.right = (CAMERA_HEIGHT * aspect) / 2
    this.camera.top = CAMERA_HEIGHT / 2
    this.camera.bottom = -CAMERA_HEIGHT / 2
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(clientWidth, clientHeight, false)
  }

  private renderFrame(now: number) {
    this.animationFrame = requestAnimationFrame(this.renderFrame)
    this.updateState(now)
    this.updateParticles(now)
    this.renderer.render(this.scene, this.camera)
  }

  private updateState(now: number) {
    if (!this.targetState || !this.currentState) {
      return
    }

    dampVector(this.currentState.relativeWind, this.targetState.relativeWind, 0.12)
    dampVector(this.currentState.magnusForce, this.targetState.magnusForce, 0.12)
    dampVector(this.currentState.spinAxis, this.targetState.spinAxis, 0.12)
    this.currentState.spinAxis.normalize()
    this.currentState.spinRateRpm = lerp(
      this.currentState.spinRateRpm,
      this.targetState.spinRateRpm,
      0.12,
    )
    this.currentState.speedMph = lerp(this.currentState.speedMph, this.targetState.speedMph, 0.12)

    const frame = getLocalFrame(this.currentState)
    const positions = this.spinAxisLine.geometry.attributes.position.array as Float32Array
    positions[0] = -frame.spinAxisLocal.x * 0.76
    positions[1] = -frame.spinAxisLocal.y * 0.76
    positions[2] = -frame.spinAxisLocal.z * 0.76
    positions[3] = frame.spinAxisLocal.x * 0.76
    positions[4] = frame.spinAxisLocal.y * 0.76
    positions[5] = frame.spinAxisLocal.z * 0.76
    this.spinAxisLine.geometry.attributes.position.needsUpdate = true

    const spinRps = getVisualSpinRps(this.currentState.spinRateRpm)
    this.ballMesh.quaternion.setFromAxisAngle(
      frame.spinAxisLocal,
      (now / 1000) * spinRps * Math.PI * 2,
    )

    const forceMagnitude = this.currentState.magnusForce.length()
    const arrowColor = FORCE_LOW_COLOR.clone().lerp(
      FORCE_HIGH_COLOR,
      clamp01(forceMagnitude / 1.2),
    )
    this.forceArrow.setDirection(new THREE.Vector3(0, 1, 0))
    this.forceArrow.setLength(0.42 + forceMagnitude * 1.6, 0.28, 0.16)
    this.forceArrow.setColor(arrowColor)

    const glowMaterial = this.coreGlow.material
    if (!Array.isArray(glowMaterial)) {
      glowMaterial.opacity = 0.05 + clamp01(forceMagnitude / 1.2) * 0.08
    }
  }

  private rebuildFlowVisualization(state: SpinLabState) {
    this.clearFlowGroup()
    const paths = buildFlowPaths(state)

    paths.forEach((path, index) => {
      if (path.points.length < 2) {
        return
      }

      const positions = new Float32Array(path.points.length * 3)
      const colors = new Float32Array(path.points.length * 3)

      path.points.forEach((point, pointIndex) => {
        positions[pointIndex * 3] = point.x
        positions[pointIndex * 3 + 1] = point.y
        positions[pointIndex * 3 + 2] = point.z
        colors[pointIndex * 3] = path.colors[pointIndex].r
        colors[pointIndex * 3 + 1] = path.colors[pointIndex].g
        colors[pointIndex * 3 + 2] = path.colors[pointIndex].b
      })

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
      })
      const line = new THREE.Line(geometry, material)
      this.flowGroup.add(line)

      if (index % 2 === 0) {
        const particle = new THREE.Mesh(this.particleGeometry, this.particleMaterial.clone())
        this.flowGroup.add(particle)
        this.particleBindings.push({
          mesh: particle,
          path: path.points,
          offset: index * 0.09,
          speed: 0.45 + (index % 3) * 0.08,
        })
      }
    })
  }

  private clearFlowGroup() {
    this.flowGroup.children.forEach((child) => {
      const drawable = child as THREE.Line | THREE.Mesh
      if ('geometry' in drawable && drawable.geometry !== this.particleGeometry) {
        drawable.geometry.dispose()
      }
      if ('material' in drawable) {
        const material = drawable.material
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose())
        } else {
          material.dispose()
        }
      }
    })

    this.flowGroup.clear()
    this.particleBindings = []
  }

  private updateParticles(now: number) {
    this.particleBindings.forEach((binding, index) => {
      const t = (now * 0.00012 * binding.speed + binding.offset + index * 0.06) % 1
      binding.mesh.position.copy(sampleVectorPath(binding.path, t))
    })
  }
}

function buildFlowPaths(state: SpinLabState): FlowPath[] {
  const circulation = (0.12 + clamp01(state.magnusForce.length() / 1.2) * 0.78) * state.speedMph / 105
  const seeds = [-1.75, -1.4, -1.05, -0.7, 0.7, 1.05, 1.4, 1.75]
  const paths: FlowPath[] = []

  seeds.forEach((seedY) => {
    let point = new THREE.Vector3(-STREAMLINE_RANGE_X, seedY, 0)
    const points: THREE.Vector3[] = []
    const colors: THREE.Color[] = []

    for (let step = 0; step < 180; step += 1) {
      const field = flowField(point.x, point.y, circulation)
      points.push(point.clone())
      colors.push(colorForFlow(field.length(), point.y))

      point = point.clone().add(field.normalize().multiplyScalar(0.07))

      const radial = Math.hypot(point.x, point.y)
      if (radial < STREAMLINE_RADIUS + 0.04) {
        const angle = Math.atan2(point.y, point.x)
        point.x = Math.cos(angle) * (STREAMLINE_RADIUS + 0.04)
        point.y = Math.sin(angle) * (STREAMLINE_RADIUS + 0.04)
      }

      if (point.x > STREAMLINE_RANGE_X || Math.abs(point.y) > STREAMLINE_RANGE_Y) {
        break
      }
    }

    if (points.length > 1) {
      paths.push({ points, colors })
    }
  })

  return paths
}

function flowField(x: number, y: number, circulation: number): THREE.Vector3 {
  const uniformVelocity = 1.12
  const radius = STREAMLINE_RADIUS
  const r = Math.max(Math.hypot(x, y), radius + 0.02)
  const theta = Math.atan2(y, x)
  const radiusSquared = radius * radius
  const rSquared = r * r
  const uRadial = uniformVelocity * (1 - radiusSquared / rSquared) * Math.cos(theta)
  const uTangential =
    -uniformVelocity * (1 + radiusSquared / rSquared) * Math.sin(theta) +
    circulation / (2 * Math.PI * r)

  const u = uRadial * Math.cos(theta) - uTangential * Math.sin(theta)
  const v = uRadial * Math.sin(theta) + uTangential * Math.cos(theta)

  return new THREE.Vector3(u, v, 0)
}

function colorForFlow(speed: number, y: number): THREE.Color {
  const speedRatio = clamp01((speed - 0.72) / 1.05)
  const bandAccent = clamp01(Math.abs(y) / 1.8) * 0.14

  return FLOW_LOW_COLOR.clone()
    .lerp(FLOW_HIGH_COLOR, speedRatio)
    .lerp(new THREE.Color('#fef3c7'), bandAccent)
}

function sampleVectorPath(path: THREE.Vector3[], t: number): THREE.Vector3 {
  if (path.length === 1) {
    return path[0].clone()
  }

  const maxIndex = path.length - 1
  const scaled = clamp01(t) * maxIndex
  const index = Math.min(Math.floor(scaled), maxIndex - 1)
  const ratio = scaled - index

  return path[index].clone().lerp(path[index + 1], ratio)
}

function getLocalFrame(state: SpinLabState): LocalFrame {
  const flowAxis = normalizeOrFallback(state.relativeWind, new THREE.Vector3(1, 0, 0))
  let forceAxis = state.magnusForce.clone()
  forceAxis.sub(flowAxis.clone().multiplyScalar(forceAxis.dot(flowAxis)))

  if (forceAxis.lengthSq() < 1e-5) {
    forceAxis = state.spinAxis
      .clone()
      .sub(flowAxis.clone().multiplyScalar(state.spinAxis.dot(flowAxis)))
  }

  const fallback = Math.abs(flowAxis.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  forceAxis = normalizeOrFallback(forceAxis, fallback)
  let normalAxis = new THREE.Vector3().crossVectors(flowAxis, forceAxis)

  if (normalAxis.lengthSq() < 1e-5) {
    normalAxis = new THREE.Vector3().crossVectors(flowAxis, fallback)
  }

  normalAxis.normalize()

  const spinAxisLocal = new THREE.Vector3(
    state.spinAxis.dot(flowAxis),
    state.spinAxis.dot(forceAxis),
    state.spinAxis.dot(normalAxis),
  )

  return {
    spinAxisLocal: normalizeOrFallback(spinAxisLocal, new THREE.Vector3(0, 1, 0)),
  }
}

function cloneLabState(state: SpinLabState): SpinLabState {
  return {
    relativeWind: state.relativeWind.clone(),
    magnusForce: state.magnusForce.clone(),
    spinAxis: state.spinAxis.clone(),
    spinRateRpm: state.spinRateRpm,
    speedMph: state.speedMph,
  }
}

function dampVector(current: THREE.Vector3, target: THREE.Vector3, factor: number) {
  current.lerp(target, factor)
}

function normalizeOrFallback(vector: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  if (vector.lengthSq() < 1e-6) {
    return fallback.clone().normalize()
  }

  return vector.clone().normalize()
}

function toThreeVector(vector: Vec3): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z)
}

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function getVisualSpinRps(spinRateRpm: number): number {
  if (spinRateRpm <= 0) {
    return 0
  }

  return 0.45 + clamp01(spinRateRpm / 3200) * 1.55
}

export default SpinLabScene
