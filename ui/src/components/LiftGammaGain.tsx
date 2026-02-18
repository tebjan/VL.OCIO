import { useState } from 'react'
import { ColorWheel } from './ColorWheel'
import type { Vector3 } from '../types/settings'

interface LiftGammaGainProps {
  lift: Vector3
  gamma: Vector3
  gain: Vector3
  onLiftChange: (value: Vector3) => void
  onGammaChange: (value: Vector3) => void
  onGainChange: (value: Vector3) => void
  mobile?: boolean
}

// Default sensitivities:
// Lift (centered at 0): 0.3 works well
// Gamma/Gain (centered at 1): 0.1 for similar feel
const DEFAULT_LIFT_SENSITIVITY = 0.3
const DEFAULT_GAMMA_SENSITIVITY = 0.1
const DEFAULT_GAIN_SENSITIVITY = 0.1

export function LiftGammaGain({
  lift,
  gamma,
  gain,
  onLiftChange,
  onGammaChange,
  onGainChange,
  mobile = false,
}: LiftGammaGainProps) {
  const [liftSensitivity, setLiftSensitivity] = useState(DEFAULT_LIFT_SENSITIVITY)
  const [gammaSensitivity, setGammaSensitivity] = useState(DEFAULT_GAMMA_SENSITIVITY)
  const [gainSensitivity, setGainSensitivity] = useState(DEFAULT_GAIN_SENSITIVITY)

  const wheelSize = mobile ? 200 : 150

  return (
    <div className={mobile ? 'flex flex-col items-center gap-6' : 'flex justify-center gap-4'}>
      <ColorWheel
        label="Lift"
        value={lift}
        defaultValue={{ x: 0, y: 0, z: 0 }}
        onChange={onLiftChange}
        size={wheelSize}
        sensitivity={liftSensitivity}
        defaultSensitivity={DEFAULT_LIFT_SENSITIVITY}
        onSensitivityChange={setLiftSensitivity}
      />
      <ColorWheel
        label="Gamma"
        value={gamma}
        defaultValue={{ x: 1, y: 1, z: 1 }}
        onChange={onGammaChange}
        size={wheelSize}
        sensitivity={gammaSensitivity}
        defaultSensitivity={DEFAULT_GAMMA_SENSITIVITY}
        onSensitivityChange={setGammaSensitivity}
      />
      <ColorWheel
        label="Gain"
        value={gain}
        defaultValue={{ x: 1, y: 1, z: 1 }}
        onChange={onGainChange}
        size={wheelSize}
        sensitivity={gainSensitivity}
        defaultSensitivity={DEFAULT_GAIN_SENSITIVITY}
        onSensitivityChange={setGainSensitivity}
      />
    </div>
  )
}
