import { For, createEffect, createMemo, onCleanup, onMount } from 'solid-js'
import * as THREE from 'three'

import { createBaseballMaterial } from '../lib/baseballVisuals'
import type { SimulationInputs, SimulationSnapshot, Vec3 } from '../lib/simulation'

const FORCE_LOW_COLOR = new THREE.Color('#67e8f9')
const FORCE_HIGH_COLOR = new THREE.Color('#f59e0b')
const CAMERA_HEIGHT = 5.6

const CLOCK_MARKERS = Array.from({ length: 12 }, (_, index) => {
  const hour = index === 0 ? 12 : index
  const angle = (index / 12) * Math.PI * 2 - Math.PI / 2

  return {
    label: String(hour),
    x: 50 + Math.cos(angle) * 29,
    y: 50 + Math.sin(angle) * 29,
  }
})

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
  const spinModeLabel = createMemo(() =>
    props.snapshot.referenceMagnusForce.z >= 0 ? 'Backspin bias' : 'Topspin bias',
  )

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
      class="pitch-scene relative h-full min-h-[30rem] overflow-hidden rounded-[2rem] border border-black/10 bg-[#f4f5f7] xl:min-h-0"
    >
      <canvas ref={canvasRef} class="size-full" />
      <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/80 to-transparent" />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-slate-200/75 via-slate-200/12 to-transparent" />
      <svg
        class="pointer-events-none absolute inset-0"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <circle cx="50" cy="50" r="24" fill="none" stroke="rgba(148,163,184,0.34)" stroke-width="0.6" />
        <circle cx="50" cy="50" r="18" fill="none" stroke="rgba(203,213,225,0.34)" stroke-width="0.4" />
        <line x1="50" y1="23" x2="50" y2="77" stroke="rgba(203,213,225,0.42)" stroke-width="0.32" />
        <line x1="23" y1="50" x2="77" y2="50" stroke="rgba(203,213,225,0.42)" stroke-width="0.32" />
        <For each={CLOCK_MARKERS}>
          {(marker) => (
            <text
              x={marker.x}
              y={marker.y}
              fill="rgba(71,85,105,0.95)"
              font-size="3.1"
              text-anchor="middle"
              dominant-baseline="middle"
              font-family="var(--font-mono), monospace"
            >
              {marker.label}
            </text>
          )}
        </For>
      </svg>
      <div class="pointer-events-none absolute left-4 top-4 sm:left-6 sm:top-5">
        <div class="font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.28em] text-slate-500">
          Ball Spin (Tilt)
        </div>
        <div class="mt-1 font-[var(--font-display)] text-lg text-slate-900">Pitcher&apos;s View</div>
      </div>
      <div class="pointer-events-none absolute right-4 top-4 rounded-full border border-slate-300/90 bg-white/78 px-3 py-1 font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.22em] text-slate-600 shadow-[0_10px_25px_rgba(15,23,42,0.08)] sm:right-6 sm:top-5">
        {spinModeLabel()}
      </div>
      <div class="pointer-events-none absolute inset-x-4 bottom-4 grid grid-cols-2 gap-3 sm:inset-x-6 sm:bottom-6 sm:grid-cols-4">
        <For each={overlayCards()}>
          {(card) => (
            <div class="rounded-[1.15rem] border border-slate-200/90 bg-white/88 px-3 py-2.5 shadow-[0_16px_36px_rgba(15,23,42,0.08)] backdrop-blur">
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
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly resizeObserver: ResizeObserver
  private readonly ballGroup: THREE.Group
  private readonly ballMesh: THREE.Mesh
  private readonly spinAxisLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly forceArrow: THREE.ArrowHelper
  private readonly coreGlow: THREE.Mesh
  private animationFrame = 0
  private targetState: SpinLabState | undefined
  private currentState: SpinLabState | undefined

  constructor(container: HTMLDivElement, canvas: HTMLCanvasElement) {
    this.container = container
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0xf3f4f6, 0.012)

    this.camera = new THREE.OrthographicCamera(-4, 4, 2.8, -2.8, 0.1, 20)
    this.camera.position.set(8, 0, 0)
    this.camera.up.set(0, 0, 1)
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
        opacity: 0.28,
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
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.05,
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
    this.renderer.dispose()
  }

  private setupScene() {
    const ambient = new THREE.AmbientLight(0xffffff, 1.18)
    const key = new THREE.DirectionalLight(0xffffff, 1.84)
    key.position.set(6, -2.6, 5.6)
    const rim = new THREE.DirectionalLight(0xcbd5e1, 0.66)
    rim.position.set(-2.4, 2.2, 3.8)

    const lane = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -2.4, 0),
        new THREE.Vector3(0, 2.4, 0),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 2.4),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -2.4),
      ]),
      new THREE.LineDashedMaterial({
        color: 0x94a3b8,
        dashSize: 0.24,
        gapSize: 0.12,
        transparent: true,
        opacity: 0.45,
      }),
    )
    lane.computeLineDistances()

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(5.2, 5.2)),
      new THREE.LineBasicMaterial({
        color: 0xcbd5e1,
        transparent: true,
        opacity: 0.72,
      }),
    )
    frame.rotation.y = Math.PI / 2
    this.coreGlow.rotation.y = Math.PI / 2

    this.ballGroup.add(this.ballMesh)
    this.ballGroup.add(this.spinAxisLine)

    this.scene.add(ambient, key, rim)
    this.scene.add(frame, lane, this.coreGlow)
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

    const projectedAxis = new THREE.Vector3(0, this.currentState.spinAxis.y, this.currentState.spinAxis.z)
    if (projectedAxis.lengthSq() < 1e-6) {
      projectedAxis.set(0, 0, 1)
    } else {
      projectedAxis.normalize()
    }
    const positions = this.spinAxisLine.geometry.attributes.position.array as Float32Array
    positions[0] = -projectedAxis.x * 0.76
    positions[1] = -projectedAxis.y * 0.76
    positions[2] = -projectedAxis.z * 0.76
    positions[3] = projectedAxis.x * 0.76
    positions[4] = projectedAxis.y * 0.76
    positions[5] = projectedAxis.z * 0.76
    this.spinAxisLine.geometry.attributes.position.needsUpdate = true

    const spinRps = getVisualSpinRps(this.currentState.spinRateRpm)
    this.ballMesh.quaternion.setFromAxisAngle(
      this.currentState.spinAxis,
      (now / 1000) * spinRps * Math.PI * 2,
    )

    const projectedMagnus = new THREE.Vector3(
      0,
      this.currentState.magnusForce.y,
      this.currentState.magnusForce.z,
    )
    const forceMagnitude = projectedMagnus.length()
    const forceDirection =
      forceMagnitude < 1e-6 ? new THREE.Vector3(0, 0, 1) : projectedMagnus.clone().normalize()
    const arrowColor = FORCE_LOW_COLOR.clone().lerp(
      FORCE_HIGH_COLOR,
      clamp01(forceMagnitude / 1.2),
    )
    this.forceArrow.position.set(0, 0, 0)
    this.forceArrow.setDirection(forceDirection)
    this.forceArrow.setLength(0.38 + forceMagnitude * 1.95, 0.26, 0.14)
    this.forceArrow.setColor(arrowColor)

    const glowMaterial = this.coreGlow.material
    if (!Array.isArray(glowMaterial)) {
      glowMaterial.opacity = 0.05 + clamp01(forceMagnitude / 1.2) * 0.08
    }
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
