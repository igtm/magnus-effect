import { describe, expect, it } from 'vitest'

import { getPresetInputs, simulatePitch } from './simulation'

describe('simulatePitch', () => {
  it('returns effectively zero Magnus force for zero spin', () => {
    const snapshot = simulatePitch({
      presetId: 'custom',
      handedness: 'RHP',
      velocityMph: 92,
      spinRateRpm: 0,
      axisAzimuthDeg: -90,
      axisElevationDeg: 0,
      releaseSideOffsetDeg: 0,
      releaseLiftOffsetDeg: 0,
    })

    expect(snapshot.metrics.magnusForceN).toBeLessThan(0.0001)
    expect(Math.abs(snapshot.metrics.horizontalBreakIn)).toBeLessThan(0.01)
    expect(Math.abs(snapshot.metrics.verticalBreakIn)).toBeLessThan(0.01)
  })

  it('separates ride and drop between four-seam and curveball profiles', () => {
    const fourSeam = simulatePitch(getPresetInputs('four-seam', 'RHP'))
    const curveball = simulatePitch(getPresetInputs('curveball', 'RHP'))

    expect(fourSeam.reachesPlate).toBe(true)
    expect(curveball.reachesPlate).toBe(true)
    expect(fourSeam.metrics.verticalBreakIn).toBeGreaterThan(0)
    expect(curveball.metrics.verticalBreakIn).toBeLessThan(0)
    expect(fourSeam.metrics.verticalBreakIn).toBeGreaterThan(
      curveball.metrics.verticalBreakIn + 12,
    )
  })

  it('mirrors horizontal movement between handedness presets', () => {
    const rightHandedSlider = simulatePitch(getPresetInputs('slider', 'RHP'))
    const leftHandedSlider = simulatePitch(getPresetInputs('slider', 'LHP'))

    expect(rightHandedSlider.reachesPlate).toBe(true)
    expect(leftHandedSlider.reachesPlate).toBe(true)
    expect(rightHandedSlider.metrics.horizontalBreakIn).toBeLessThan(0)
    expect(leftHandedSlider.metrics.horizontalBreakIn).toBeGreaterThan(0)
    expect(
      Math.abs(
        rightHandedSlider.metrics.horizontalBreakIn +
          leftHandedSlider.metrics.horizontalBreakIn,
      ),
    ).toBeLessThan(1.2)
  })

  it('reduces flight time when release velocity increases', () => {
    const slower = simulatePitch({
      presetId: 'custom',
      handedness: 'RHP',
      velocityMph: 78,
      spinRateRpm: 2200,
      axisAzimuthDeg: -90,
      axisElevationDeg: 10,
      releaseSideOffsetDeg: 0,
      releaseLiftOffsetDeg: 0,
    })
    const faster = simulatePitch({
      presetId: 'custom',
      handedness: 'RHP',
      velocityMph: 98,
      spinRateRpm: 2200,
      axisAzimuthDeg: -90,
      axisElevationDeg: 10,
      releaseSideOffsetDeg: 0,
      releaseLiftOffsetDeg: 0,
    })

    expect(faster.metrics.flightTimeMs).toBeLessThan(slower.metrics.flightTimeMs)
  })

  it('keeps every built-in preset reaching the plate with auto-aim', () => {
    for (const presetId of [
      'four-seam',
      'sinker',
      'slider',
      'curveball',
      'changeup',
      'gyroball',
    ] as const) {
      const snapshot = simulatePitch(getPresetInputs(presetId, 'RHP'))
      expect(snapshot.reachesPlate).toBe(true)
      expect(snapshot.platePosition.x).toBeGreaterThan(18.43)
      expect(snapshot.platePosition.z).toBeGreaterThan(0.1)
    }
  })

  it('keeps gyroball movement muted versus a four-seam', () => {
    const gyroball = simulatePitch(getPresetInputs('gyroball', 'RHP'))
    const fourSeam = simulatePitch(getPresetInputs('four-seam', 'RHP'))

    expect(gyroball.metrics.magnusForceN).toBeLessThan(fourSeam.metrics.magnusForceN * 0.4)
    expect(Math.abs(gyroball.metrics.horizontalBreakIn)).toBeLessThan(6)
    expect(Math.abs(gyroball.metrics.verticalBreakIn)).toBeLessThan(6)
  })
})
