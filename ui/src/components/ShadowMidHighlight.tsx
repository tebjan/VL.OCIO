import { useState } from 'react'
import { ColorWheel } from './ColorWheel'
import type { Vector3 } from '../types/settings'

interface ShadowMidHighlightProps {
  shadowColor: Vector3
  midtoneColor: Vector3
  highlightColor: Vector3
  onShadowColorChange: (value: Vector3) => void
  onMidtoneColorChange: (value: Vector3) => void
  onHighlightColorChange: (value: Vector3) => void
  mobile?: boolean
}

const DEFAULT_SENSITIVITY = 0.1

export function ShadowMidHighlight({
  shadowColor,
  midtoneColor,
  highlightColor,
  onShadowColorChange,
  onMidtoneColorChange,
  onHighlightColorChange,
  mobile = false,
}: ShadowMidHighlightProps) {
  const [shadowSensitivity, setShadowSensitivity] = useState(DEFAULT_SENSITIVITY)
  const [midtoneSensitivity, setMidtoneSensitivity] = useState(DEFAULT_SENSITIVITY)
  const [highlightSensitivity, setHighlightSensitivity] = useState(DEFAULT_SENSITIVITY)

  const wheelSize = mobile ? 200 : 150

  return (
    <div className={mobile ? 'flex flex-col items-center gap-6' : 'flex justify-center gap-4'}>
      <ColorWheel
        label="Shadow"
        value={shadowColor}
        defaultValue={{ x: 0, y: 0, z: 0 }}
        onChange={onShadowColorChange}
        size={wheelSize}
        sensitivity={shadowSensitivity}
        defaultSensitivity={DEFAULT_SENSITIVITY}
        onSensitivityChange={setShadowSensitivity}
      />
      <ColorWheel
        label="Midtone"
        value={midtoneColor}
        defaultValue={{ x: 0, y: 0, z: 0 }}
        onChange={onMidtoneColorChange}
        size={wheelSize}
        sensitivity={midtoneSensitivity}
        defaultSensitivity={DEFAULT_SENSITIVITY}
        onSensitivityChange={setMidtoneSensitivity}
      />
      <ColorWheel
        label="Highlight"
        value={highlightColor}
        defaultValue={{ x: 0, y: 0, z: 0 }}
        onChange={onHighlightColorChange}
        size={wheelSize}
        sensitivity={highlightSensitivity}
        defaultSensitivity={DEFAULT_SENSITIVITY}
        onSensitivityChange={setHighlightSensitivity}
      />
    </div>
  )
}
