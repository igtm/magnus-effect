import * as THREE from 'three'

const SEAM_COLOR = '#b91c1c'
const BASE_LEATHER = '#f6f1e8'

export function createBaseballMaterial(maxAnisotropy: number): THREE.MeshPhysicalMaterial {
  const texture = createBallTexture()
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = maxAnisotropy

  return new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.62,
    metalness: 0.03,
    clearcoat: 0.9,
    clearcoatRoughness: 0.18,
    sheen: 0.5,
    sheenColor: new THREE.Color('#fff8f0'),
  })
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
