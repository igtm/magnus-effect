import { createEffect, onCleanup, onMount } from 'solid-js'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { createBaseballMaterial } from '../lib/baseballVisuals'
import type { SimulationInputs, SimulationSnapshot, Vec3 } from '../lib/simulation'

const FLOW_LOW_COLOR = new THREE.Color('#22d3ee')
const FLOW_HIGH_COLOR = new THREE.Color('#fb923c')

interface SpinLabSceneProps {
  snapshot: SimulationSnapshot
  inputs: SimulationInputs
}

interface SpinLabState {
  relativeWind: THREE.Vector3
  dragForce: THREE.Vector3
  magnusForce: THREE.Vector3
  spinAxis: THREE.Vector3
  spinRateRpm: number
  speedMph: number
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
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly resizeObserver: ResizeObserver
  private readonly ballGroup: THREE.Group
  private readonly ballMesh: THREE.Mesh
  private readonly spinAxisLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly windArrow: THREE.ArrowHelper
  private readonly dragArrow: THREE.ArrowHelper
  private readonly magnusArrow: THREE.ArrowHelper
  private readonly resultArrow: THREE.ArrowHelper
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
    this.scene.fog = new THREE.FogExp2(0x04101d, 0.03)

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60)
    this.camera.position.set(-3.8, -4.9, 2.5)
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
    this.renderer.toneMappingExposure = 1.18

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minDistance = 4.8
    this.controls.maxDistance = 10
    this.controls.target.set(0, 0, 0.3)

    this.ballGroup = new THREE.Group()
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 64, 64),
      createBaseballMaterial(this.renderer.capabilities.getMaxAnisotropy()),
    )
    this.spinAxisLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.72, 0, 0),
        new THREE.Vector3(0.72, 0, 0),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x93e8ff,
        transparent: true,
        opacity: 0.92,
      }),
    )
    this.windArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1.8, 0, 0),
      1.2,
      0x7dd3fc,
      0.3,
      0.16,
    )
    this.dragArrow = new THREE.ArrowHelper(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(),
      0.7,
      0x94a3b8,
      0.24,
      0.14,
    )
    this.magnusArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      1,
      0xf59e0b,
      0.28,
      0.16,
    )
    this.resultArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      0.9,
      0xffffff,
      0.24,
      0.14,
    )

    this.coreGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.66, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.07,
        side: THREE.BackSide,
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
      dragForce: toThreeVector(snapshot.referenceDragForce),
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
    this.controls.dispose()
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
    const ambient = new THREE.AmbientLight(0x8cc5ff, 0.68)
    const hemi = new THREE.HemisphereLight(0xbde5ff, 0x03101d, 1.24)
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(-4, -3, 6)
    const rim = new THREE.DirectionalLight(0x22d3ee, 1.5)
    rim.position.set(4, 3, 2)

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.3, 64),
      new THREE.MeshBasicMaterial({
        color: 0x07121f,
        transparent: true,
        opacity: 0.74,
        side: THREE.DoubleSide,
      }),
    )
    floor.position.set(0, 0, -0.68)

    const tunnelRings = new THREE.Group()
    for (let index = 0; index < 4; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.7 + index * 0.45, 0.01, 12, 90),
        new THREE.MeshBasicMaterial({
          color: 0x12304c,
          transparent: true,
          opacity: 0.42 - index * 0.07,
        }),
      )
      ring.rotation.y = Math.PI / 2
      tunnelRings.add(ring)
    }

    this.ballGroup.add(this.ballMesh)
    this.ballGroup.add(this.spinAxisLine)

    this.scene.add(ambient, hemi, key, rim)
    this.scene.add(floor, tunnelRings, this.coreGlow)
    this.scene.add(this.flowGroup)
    this.scene.add(this.ballGroup)
    this.scene.add(this.windArrow)
    this.scene.add(this.dragArrow)
    this.scene.add(this.magnusArrow)
    this.scene.add(this.resultArrow)
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
    this.updateState(now)
    this.updateParticles(now)
    this.renderer.render(this.scene, this.camera)
  }

  private updateState(now: number) {
    if (!this.targetState || !this.currentState) {
      return
    }

    dampVector(this.currentState.relativeWind, this.targetState.relativeWind, 0.12)
    dampVector(this.currentState.dragForce, this.targetState.dragForce, 0.12)
    dampVector(this.currentState.magnusForce, this.targetState.magnusForce, 0.12)
    dampVector(this.currentState.spinAxis, this.targetState.spinAxis, 0.12)
    this.currentState.spinAxis.normalize()
    this.currentState.spinRateRpm = lerp(
      this.currentState.spinRateRpm,
      this.targetState.spinRateRpm,
      0.12,
    )
    this.currentState.speedMph = lerp(this.currentState.speedMph, this.targetState.speedMph, 0.12)

    const spinAxis = this.currentState.spinAxis
    const positions = this.spinAxisLine.geometry.attributes.position.array as Float32Array
    positions[0] = -spinAxis.x * 0.72
    positions[1] = -spinAxis.y * 0.72
    positions[2] = -spinAxis.z * 0.72
    positions[3] = spinAxis.x * 0.72
    positions[4] = spinAxis.y * 0.72
    positions[5] = spinAxis.z * 0.72
    this.spinAxisLine.geometry.attributes.position.needsUpdate = true

    const spinRps = Math.min(this.currentState.spinRateRpm / 60, 18)
    this.ballMesh.quaternion.setFromAxisAngle(
      spinAxis,
      (now / 1000) * spinRps * Math.PI * 2,
    )

    this.windArrow.position.copy(this.currentState.relativeWind.clone().multiplyScalar(-1.55))
    this.windArrow.setDirection(this.currentState.relativeWind.clone().normalize())
    this.windArrow.setLength(0.9 + this.currentState.speedMph * 0.018, 0.3, 0.16)

    this.dragArrow.setDirection(this.currentState.dragForce.clone().normalize())
    this.dragArrow.setLength(0.36 + this.currentState.dragForce.length() * 0.95, 0.24, 0.14)

    this.magnusArrow.setDirection(this.currentState.magnusForce.clone().normalize())
    this.magnusArrow.setLength(
      0.36 + this.currentState.magnusForce.length() * 1.4,
      0.28,
      0.16,
    )

    const resultant = this.currentState.dragForce.clone().add(this.currentState.magnusForce)
    this.resultArrow.setDirection(resultant.clone().normalize())
    this.resultArrow.setLength(0.4 + resultant.length() * 1.15, 0.24, 0.14)

    const glowMaterial = this.coreGlow.material
    if (!Array.isArray(glowMaterial)) {
      glowMaterial.opacity = 0.05 + Math.min(this.currentState.magnusForce.length() / 1.2, 1) * 0.08
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
        opacity: 0.68,
      })
      const line = new THREE.Line(geometry, material)
      this.flowGroup.add(line)

      if (index % 2 === 0) {
        const particle = new THREE.Mesh(this.particleGeometry, this.particleMaterial.clone())
        this.flowGroup.add(particle)
        this.particleBindings.push({
          mesh: particle,
          path: path.points,
          offset: index * 0.11,
          speed: 0.11 + (index % 3) * 0.018,
        })
      }
    })
  }

  private clearFlowGroup() {
    this.flowGroup.children.forEach((child) => {
      const line = child as THREE.Line | THREE.Mesh
      if ('geometry' in line) {
        if (line.geometry !== this.particleGeometry) {
          line.geometry.dispose()
        }
      }
      if ('material' in line) {
        const material = line.material
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
      const t = (now * 0.00018 * binding.speed + binding.offset + index * 0.07) % 1
      binding.mesh.position.copy(sampleVectorPath(binding.path, t))
    })
  }
}

function buildFlowPaths(state: SpinLabState): FlowPath[] {
  const flowDir = state.relativeWind.clone().normalize()
  const basisUp = Math.abs(flowDir.z) > 0.82 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  const basisY = new THREE.Vector3().crossVectors(basisUp, flowDir).normalize()
  const basisZ = new THREE.Vector3().crossVectors(flowDir, basisY).normalize()
  const spinLocal = new THREE.Vector3(
    state.spinAxis.dot(flowDir),
    state.spinAxis.dot(basisY),
    state.spinAxis.dot(basisZ),
  )
  const swirlStrength = 0.35 + Math.min(state.magnusForce.length() / 0.8, 1) * 0.7
  const baseSpeed = 1.28
  const seeds = [
    [-1.2, -0.95],
    [-0.6, -0.95],
    [0, -0.95],
    [0.6, -0.95],
    [1.2, -0.95],
    [-1.2, -0.35],
    [-0.75, -0.2],
    [0.75, -0.2],
    [1.2, -0.35],
    [-1.2, 0.35],
    [-0.75, 0.2],
    [0.75, 0.2],
    [1.2, 0.35],
    [-1.2, 0.95],
    [-0.6, 0.95],
    [0, 0.95],
    [0.6, 0.95],
    [1.2, 0.95],
  ]

  return seeds.map(([seedY, seedZ]) => {
    const local = new THREE.Vector3(-2.8, seedY, seedZ)
    const points: THREE.Vector3[] = []
    const colors: THREE.Color[] = []

    for (let step = 0; step < 94; step += 1) {
      const worldPoint = localToWorld(local, flowDir, basisY, basisZ)
      points.push(worldPoint)
      const field = computeFlowField(local, spinLocal, swirlStrength, baseSpeed)
      const speedRatio = field.length() / baseSpeed
      colors.push(colorForFlow(speedRatio, local))

      local.add(field.normalize().multiplyScalar(0.085))

      if (local.x > 2.95 || Math.abs(local.y) > 2.35 || Math.abs(local.z) > 2.35) {
        break
      }
    }

    return { points, colors }
  })
}

function computeFlowField(
  point: THREE.Vector3,
  spinAxis: THREE.Vector3,
  swirlStrength: number,
  baseSpeed: number,
): THREE.Vector3 {
  const radial = point.clone()
  const dist = Math.max(radial.length(), 0.5)
  const crossSection = Math.max(Math.hypot(point.y, point.z), 0.25)
  const avoidance = Math.exp(-Math.abs(point.x) * 0.7) * 0.72 / crossSection
  const swirl = new THREE.Vector3()
    .crossVectors(spinAxis, radial)
    .multiplyScalar(swirlStrength / (dist * dist + 0.25))

  return new THREE.Vector3(
    baseSpeed + Math.exp(-(point.y * point.y + point.z * point.z) * 0.7) * 0.18,
    (point.y / crossSection) * avoidance + swirl.y,
    (point.z / crossSection) * avoidance + swirl.z,
  )
}

function colorForFlow(speedRatio: number, point: THREE.Vector3): THREE.Color {
  const turbulence = Math.min(Math.hypot(point.y, point.z) / 1.45, 1)
  return FLOW_LOW_COLOR.clone()
    .lerp(FLOW_HIGH_COLOR, clamp01((speedRatio - 0.8) / 0.85))
    .lerp(new THREE.Color('#fef3c7'), turbulence * 0.08)
}

function localToWorld(
  point: THREE.Vector3,
  flowDir: THREE.Vector3,
  basisY: THREE.Vector3,
  basisZ: THREE.Vector3,
): THREE.Vector3 {
  return flowDir
    .clone()
    .multiplyScalar(point.x)
    .add(basisY.clone().multiplyScalar(point.y))
    .add(basisZ.clone().multiplyScalar(point.z))
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

function cloneLabState(state: SpinLabState): SpinLabState {
  return {
    relativeWind: state.relativeWind.clone(),
    dragForce: state.dragForce.clone(),
    magnusForce: state.magnusForce.clone(),
    spinAxis: state.spinAxis.clone(),
    spinRateRpm: state.spinRateRpm,
    speedMph: state.speedMph,
  }
}

function dampVector(current: THREE.Vector3, target: THREE.Vector3, factor: number) {
  current.lerp(target, factor)
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

export default SpinLabScene
