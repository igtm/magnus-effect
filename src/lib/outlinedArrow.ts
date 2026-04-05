import * as THREE from 'three'

const UP = new THREE.Vector3(0, 1, 0)

interface OutlinedArrowOptions {
  color: THREE.ColorRepresentation
  outlineColor?: THREE.ColorRepresentation
  shaftRadius?: number
  headRadius?: number
}

export class OutlinedArrow {
  readonly group = new THREE.Group()

  private readonly shaft: THREE.Mesh<
    THREE.CylinderGeometry,
    THREE.MeshBasicMaterial
  >
  private readonly shaftOutline: THREE.Mesh<
    THREE.CylinderGeometry,
    THREE.MeshBasicMaterial
  >
  private readonly head: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>
  private readonly headOutline: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>
  private readonly shaftRadius: number
  private readonly headRadius: number

  constructor(options: OutlinedArrowOptions) {
    this.shaftRadius = options.shaftRadius ?? 0.028
    this.headRadius = options.headRadius ?? 0.092

    this.shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 20),
      new THREE.MeshBasicMaterial({ color: options.color }),
    )
    this.shaftOutline = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 20),
      new THREE.MeshBasicMaterial({ color: options.outlineColor ?? 0x0f172a }),
    )
    this.head = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 24),
      new THREE.MeshBasicMaterial({ color: options.color }),
    )
    this.headOutline = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 24),
      new THREE.MeshBasicMaterial({ color: options.outlineColor ?? 0x0f172a }),
    )

    this.group.add(this.shaftOutline, this.shaft, this.headOutline, this.head)
    this.setLength(0.6)
  }

  setPosition(position: THREE.Vector3) {
    this.group.position.copy(position)
  }

  setDirection(direction: THREE.Vector3) {
    const normalized = direction.lengthSq() < 1e-6 ? UP : direction.clone().normalize()
    this.group.quaternion.setFromUnitVectors(UP, normalized)
  }

  setLength(length: number, headLength = this.headRadius * 1.45) {
    const safeLength = Math.max(length, 0.08)
    const clampedHeadLength = Math.min(headLength, safeLength * 0.68)
    const shaftLength = Math.max(safeLength - clampedHeadLength, 0.04)
    const outlineScale = 1.34

    this.shaft.scale.set(this.shaftRadius, shaftLength, this.shaftRadius)
    this.shaft.position.set(0, shaftLength / 2, 0)

    this.shaftOutline.scale.set(
      this.shaftRadius * outlineScale,
      shaftLength + 0.01,
      this.shaftRadius * outlineScale,
    )
    this.shaftOutline.position.set(0, shaftLength / 2, 0)

    this.head.scale.set(this.headRadius, clampedHeadLength, this.headRadius)
    this.head.position.set(0, shaftLength + clampedHeadLength / 2, 0)

    this.headOutline.scale.set(
      this.headRadius * outlineScale,
      clampedHeadLength * 1.1,
      this.headRadius * outlineScale,
    )
    this.headOutline.position.set(0, shaftLength + clampedHeadLength / 2, 0)
  }

  setColor(color: THREE.ColorRepresentation) {
    this.shaft.material.color.set(color)
    this.head.material.color.set(color)
  }

  dispose() {
    this.shaft.geometry.dispose()
    this.shaft.material.dispose()
    this.shaftOutline.geometry.dispose()
    this.shaftOutline.material.dispose()
    this.head.geometry.dispose()
    this.head.material.dispose()
    this.headOutline.geometry.dispose()
    this.headOutline.material.dispose()
  }
}
