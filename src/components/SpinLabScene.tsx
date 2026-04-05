import { For, createEffect, createMemo, onCleanup, onMount } from 'solid-js'
import * as THREE from 'three'

import { createBaseballMaterial } from '../lib/baseballVisuals'
import { OutlinedArrow } from '../lib/outlinedArrow'
import type { SimulationInputs, SimulationSnapshot, Vec3 } from '../lib/simulation'

const FORCE_COLOR = new THREE.Color('#38bdf8')
const CAMERA_HEIGHT = 5.6
const LAB_OFFSET_Z = 0.7
const BAND_INNER_RADIUS = 0.42
const BAND_OUTER_RADIUS = 0.66
const DRAG_RADIUS = 1.55
const MPH_TO_METERS_PER_SECOND = 0.44704
const RPM_TO_RAD_PER_SECOND = (Math.PI * 2) / 60
const BALL_RADIUS_METERS = 0.0366
const BALL_AREA_METERS = Math.PI * BALL_RADIUS_METERS ** 2
const AIR_DENSITY = 1.225

interface SpinLabSceneProps {
  snapshot: SimulationSnapshot
  inputs: SimulationInputs
  onAxisChange?: (axisAzimuthDeg: number, axisElevationDeg: number) => void
}

interface SpinLabState {
  relativeWind: THREE.Vector3
  magnusForce: THREE.Vector3
  spinAxis: THREE.Vector3
  spinRateRpm: number
  speedMph: number
}

function SpinLabScene(props: SpinLabSceneProps) {
  let containerRef!: HTMLDivElement
  let canvasRef!: HTMLCanvasElement
  let controller: SpinLabSceneController | undefined

  const overlayCards = createMemo(() => [
    {
      label: 'Pitch Speed',
      value: `${Math.round(props.inputs.velocityMph)} mph`,
    },
    {
      label: 'Total Spin',
      value: `${Math.round(props.inputs.spinRateRpm)} rpm`,
    },
    {
      label: 'Magnus',
      value: `${props.snapshot.metrics.magnusForceN.toFixed(2)} N`,
    },
    {
      label: 'Spin Eff',
      value: `${Math.round(props.snapshot.metrics.spinEfficiencyPct)}%`,
    },
  ])

  onMount(() => {
    controller = new SpinLabSceneController(containerRef, canvasRef, props.onAxisChange)
    controller.setSnapshot(props.snapshot, props.inputs)
  })

  createEffect(() => {
    controller?.setAxisChangeHandler(props.onAxisChange)
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
      <canvas ref={canvasRef} class="size-full cursor-grab active:cursor-grabbing" />
      <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/80 to-transparent" />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-200/72 via-slate-200/10 to-transparent" />
      <div class="pointer-events-none absolute left-4 top-4 sm:left-6 sm:top-5">
        <div class="font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.28em] text-slate-500">
          Ball Spin
        </div>
        <div class="mt-1 font-[var(--font-display)] text-lg text-slate-900">Pitcher&apos;s View</div>
      </div>
      <div class="pointer-events-none absolute right-4 top-4 rounded-full border border-slate-300/90 bg-white/78 px-3 py-1 font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.22em] text-slate-600 shadow-[0_10px_25px_rgba(15,23,42,0.08)] sm:right-6 sm:top-5">
        Drag Axis
      </div>
      <div class="pointer-events-none absolute bottom-[5.85rem] left-4 rounded-full border border-slate-300/90 bg-white/78 px-3 py-1 font-[var(--font-mono)] text-[0.58rem] uppercase tracking-[0.22em] text-slate-500 shadow-[0_10px_25px_rgba(15,23,42,0.06)] sm:bottom-[6.35rem] sm:left-6">
        Center = Gyro
      </div>
      <div class="pointer-events-none absolute inset-x-4 bottom-4 grid grid-cols-2 gap-3 sm:inset-x-6 sm:bottom-6 sm:grid-cols-4">
        <For each={overlayCards()}>
          {(card) => (
            <div class="rounded-[1.1rem] border border-slate-200/90 bg-white/88 px-3 py-2 shadow-[0_16px_36px_rgba(15,23,42,0.08)] backdrop-blur">
              <div class="font-[var(--font-mono)] text-[0.58rem] uppercase tracking-[0.24em] text-slate-500">
                {card.label}
              </div>
              <div class="mt-1 font-[var(--font-display)] text-lg text-slate-900">{card.value}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

class SpinLabSceneController {
  private readonly container: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly resizeObserver: ResizeObserver
  private readonly labGroup = new THREE.Group()
  private readonly ballGroup = new THREE.Group()
  private readonly ballMesh: THREE.Mesh
  private readonly spinAxisLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly forceArrow: OutlinedArrow
  private readonly bandGroup = new THREE.Group()
  private readonly bandMesh: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  >
  private readonly bandTexture: THREE.CanvasTexture
  private animationFrame = 0
  private targetState: SpinLabState | undefined
  private currentState: SpinLabState | undefined
  private axisChangeHandler: SpinLabSceneProps['onAxisChange']
  private draggingPointerId: number | undefined

  constructor(
    container: HTMLDivElement,
    canvas: HTMLCanvasElement,
    axisChangeHandler: SpinLabSceneProps['onAxisChange'],
  ) {
    this.container = container
    this.canvas = canvas
    this.axisChangeHandler = axisChangeHandler
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0xf3f4f6, 0.012)

    this.camera = new THREE.OrthographicCamera(-4, 4, 2.8, -2.8, 0.1, 20)
    this.camera.position.set(8, 0, LAB_OFFSET_Z)
    this.camera.up.set(0, 0, 1)
    this.camera.lookAt(0, 0, LAB_OFFSET_Z)

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

    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.54, 64, 64),
      createBaseballMaterial(this.renderer.capabilities.getMaxAnisotropy()),
    )
    this.spinAxisLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -0.78, 0),
        new THREE.Vector3(0, 0.78, 0),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x0f172a,
        transparent: true,
        opacity: 0.38,
      }),
    )
    this.forceArrow = new OutlinedArrow({
      color: 0x38bdf8,
      outlineColor: 0x0ea5e9,
      shaftRadius: 0.055,
      headRadius: 0.14,
    })
    const { texture, material } = createSpinBandMaterial()
    this.bandTexture = texture
    this.bandMesh = new THREE.Mesh(
      new THREE.RingGeometry(BAND_INNER_RADIUS, BAND_OUTER_RADIUS, 128),
      material,
    )

    this.setupScene()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
    this.renderFrame = this.renderFrame.bind(this)
    this.animationFrame = requestAnimationFrame(this.renderFrame)
    this.canvas.addEventListener('pointerdown', this.handlePointerDown)
    this.canvas.addEventListener('pointermove', this.handlePointerMove)
    this.canvas.addEventListener('pointerup', this.handlePointerUp)
    this.canvas.addEventListener('pointercancel', this.handlePointerUp)
  }

  setAxisChangeHandler(axisChangeHandler: SpinLabSceneProps['onAxisChange']) {
    this.axisChangeHandler = axisChangeHandler
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
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    this.canvas.removeEventListener('pointermove', this.handlePointerMove)
    this.canvas.removeEventListener('pointerup', this.handlePointerUp)
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp)

    this.ballMesh.geometry.dispose()
    const ballMaterial = this.ballMesh.material
    if (Array.isArray(ballMaterial)) {
      ballMaterial.forEach((entry) => entry.dispose())
    } else {
      ballMaterial.dispose()
    }

    this.spinAxisLine.geometry.dispose()
    this.spinAxisLine.material.dispose()
    this.bandMesh.geometry.dispose()
    this.bandMesh.material.dispose()
    this.bandTexture.dispose()
    this.forceArrow.dispose()
    this.renderer.dispose()
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.draggingPointerId = event.pointerId
    this.canvas.setPointerCapture(event.pointerId)
    this.updateAxisFromPointer(event)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (this.draggingPointerId !== event.pointerId) {
      return
    }

    this.updateAxisFromPointer(event)
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.draggingPointerId !== event.pointerId) {
      return
    }

    this.draggingPointerId = undefined
    this.canvas.releasePointerCapture(event.pointerId)
  }

  private setupScene() {
    const ambient = new THREE.AmbientLight(0xffffff, 1.16)
    const key = new THREE.DirectionalLight(0xffffff, 1.62)
    key.position.set(6.2, -2.4, 5.6)
    const rim = new THREE.DirectionalLight(0xcbd5e1, 0.62)
    rim.position.set(-2.2, 2.1, 3.5)

    const crosshair = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -2.25, 0),
        new THREE.Vector3(0, 2.25, 0),
        new THREE.Vector3(0, 0, -2.05),
        new THREE.Vector3(0, 0, 2.05),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.28,
      }),
    )

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(5.2, 5.2)),
      new THREE.LineBasicMaterial({
        color: 0xcbd5e1,
        transparent: true,
        opacity: 0.52,
      }),
    )
    frame.rotation.y = Math.PI / 2

    this.bandGroup.add(this.bandMesh)
    this.ballGroup.add(this.ballMesh)
    this.ballGroup.add(this.spinAxisLine)
    this.ballGroup.add(this.bandGroup)

    this.labGroup.position.z = LAB_OFFSET_Z
    this.labGroup.add(frame, crosshair, this.ballGroup, this.forceArrow.group)

    this.scene.add(ambient, key, rim)
    this.scene.add(this.labGroup)
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
    this.renderer.render(this.scene, this.camera)
  }

  private updateState(now: number) {
    if (!this.targetState || !this.currentState) {
      return
    }

    dampVector(this.currentState.relativeWind, this.targetState.relativeWind, 0.14)
    dampVector(this.currentState.magnusForce, this.targetState.magnusForce, 0.14)
    dampVector(this.currentState.spinAxis, this.targetState.spinAxis, 0.14)
    this.currentState.spinAxis.normalize()
    this.currentState.spinRateRpm = lerp(
      this.currentState.spinRateRpm,
      this.targetState.spinRateRpm,
      0.14,
    )
    this.currentState.speedMph = lerp(this.currentState.speedMph, this.targetState.speedMph, 0.14)

    const projectedAxis = new THREE.Vector3(0, this.currentState.spinAxis.y, this.currentState.spinAxis.z)
    if (projectedAxis.lengthSq() < 1e-6) {
      projectedAxis.set(0, 0, 1)
    } else {
      projectedAxis.normalize()
    }

    const positions = this.spinAxisLine.geometry.attributes.position.array as Float32Array
    positions[0] = -projectedAxis.x * 0.82
    positions[1] = -projectedAxis.y * 0.82
    positions[2] = -projectedAxis.z * 0.82
    positions[3] = projectedAxis.x * 0.82
    positions[4] = projectedAxis.y * 0.82
    positions[5] = projectedAxis.z * 0.82
    this.spinAxisLine.geometry.attributes.position.needsUpdate = true

    const spinRps = getVisualSpinRps(this.currentState.spinRateRpm)
    const spinAngle = (now / 1000) * spinRps * Math.PI * 2
    this.ballMesh.quaternion.setFromAxisAngle(this.currentState.spinAxis, spinAngle)
    this.bandGroup.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      this.currentState.spinAxis.clone().normalize(),
    )
    this.bandMesh.rotation.z = spinAngle

    const projectedMagnus = new THREE.Vector3(
      0,
      this.currentState.magnusForce.y,
      this.currentState.magnusForce.z,
    )
    const forceMagnitude = projectedMagnus.length()
    const forceDirection =
      forceMagnitude < 1e-6 ? new THREE.Vector3(0, 0, 1) : projectedMagnus.clone().normalize()
    this.forceArrow.setPosition(new THREE.Vector3(0, 0, 0))
    this.forceArrow.setDirection(forceDirection)
    this.forceArrow.setLength(0.18 + forceMagnitude * 0.68, 0.13)
    this.forceArrow.setColor(FORCE_COLOR)
  }

  private updateAxisFromPointer(event: PointerEvent) {
    const localPoint = this.pointerToLocalPoint(event)

    if (!localPoint) {
      return
    }

    let y = localPoint.y / DRAG_RADIUS
    let z = localPoint.z / DRAG_RADIUS
    const radialLength = Math.hypot(y, z)

    if (radialLength > 1) {
      y /= radialLength
      z /= radialLength
    }

    const signX = Math.sign(this.targetState?.spinAxis.x ?? this.currentState?.spinAxis.x ?? 1) || 1
    const x = Math.sqrt(Math.max(0, 1 - y ** 2 - z ** 2)) * signX
    const nextAxis = new THREE.Vector3(x, y, z).normalize()
    const nextMagnus = estimateMagnusForce(
      nextAxis,
      this.targetState?.relativeWind ?? this.currentState?.relativeWind ?? new THREE.Vector3(-1, 0, 0),
      this.targetState?.speedMph ?? this.currentState?.speedMph ?? 90,
      this.targetState?.spinRateRpm ?? this.currentState?.spinRateRpm ?? 2200,
    )

    if (this.currentState) {
      this.currentState.spinAxis.copy(nextAxis)
      this.currentState.magnusForce.copy(nextMagnus)
    }

    if (this.targetState) {
      this.targetState.spinAxis.copy(nextAxis)
      this.targetState.magnusForce.copy(nextMagnus)
    }

    const angles = axisToAngles(nextAxis)
    this.axisChangeHandler?.(angles.axisAzimuthDeg, angles.axisElevationDeg)
  }

  private pointerToLocalPoint(event: PointerEvent): THREE.Vector3 | undefined {
    const rect = this.canvas.getBoundingClientRect()

    if (rect.width === 0 || rect.height === 0) {
      return undefined
    }

    const ndc = new THREE.Vector3(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      0,
    )
    ndc.unproject(this.camera)

    return this.labGroup.worldToLocal(ndc)
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

function toThreeVector(vector: Vec3): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z)
}

function axisToAngles(axis: THREE.Vector3) {
  const normalized = axis.clone().normalize()

  return {
    axisAzimuthDeg: (Math.atan2(normalized.y, normalized.x) * 180) / Math.PI,
    axisElevationDeg:
      (Math.atan2(normalized.z, Math.hypot(normalized.x, normalized.y)) * 180) /
      Math.PI,
  }
}

function estimateMagnusForce(
  spinAxis: THREE.Vector3,
  relativeWind: THREE.Vector3,
  speedMph: number,
  spinRateRpm: number,
) {
  const velocity = relativeWind.clone().multiplyScalar(-speedMph * MPH_TO_METERS_PER_SECOND)
  const speed = velocity.length()

  if (speed === 0 || spinRateRpm === 0) {
    return new THREE.Vector3()
  }

  const spinRate = spinRateRpm * RPM_TO_RAD_PER_SECOND
  const travelDirection = velocity.clone().normalize()
  const forceDirection = new THREE.Vector3().crossVectors(spinAxis, travelDirection)
  const spinEfficiency = forceDirection.length()

  if (spinEfficiency === 0) {
    return new THREE.Vector3()
  }

  const effectiveSpinRate = spinRate * spinEfficiency
  const spinRatio = (BALL_RADIUS_METERS * effectiveSpinRate) / speed
  const liftCoefficient = Math.min(0.35, Math.max(0, 0.09 + 0.6 * spinRatio))
  const magnusMagnitude =
    0.5 * AIR_DENSITY * liftCoefficient * BALL_AREA_METERS * speed ** 2

  return forceDirection.normalize().multiplyScalar(magnusMagnitude)
}

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function createSpinBandMaterial() {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 320

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create spin band texture canvas.')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)

  const ribbon = context.createLinearGradient(0, 0, 0, canvas.height)
  ribbon.addColorStop(0, 'rgba(56, 189, 248, 0.22)')
  ribbon.addColorStop(0.12, 'rgba(56, 189, 248, 0.96)')
  ribbon.addColorStop(0.5, 'rgba(125, 211, 252, 1)')
  ribbon.addColorStop(0.88, 'rgba(56, 189, 248, 0.96)')
  ribbon.addColorStop(1, 'rgba(56, 189, 248, 0.22)')
  context.fillStyle = ribbon
  context.fillRect(0, 28, canvas.width, canvas.height - 56)

  context.strokeStyle = 'rgba(224, 242, 254, 0.98)'
  context.lineWidth = 18
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (let x = 108; x < canvas.width + 108; x += 182) {
    context.beginPath()
    context.moveTo(x - 34, 106)
    context.lineTo(x + 24, 160)
    context.lineTo(x - 34, 214)
    context.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    opacity: 0.98,
  })

  return { texture, material }
}

function getVisualSpinRps(spinRateRpm: number): number {
  if (spinRateRpm <= 0) {
    return 0
  }

  return 0.45 + clamp01(spinRateRpm / 3200) * 1.55
}

export default SpinLabScene
