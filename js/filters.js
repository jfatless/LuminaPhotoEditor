const FILTER_PRESETS = {
  original: { label: 'Original', adjustments: {} },
  vivid: {
    label: 'Vivid',
    adjustments: { saturation: 30, contrast: 15, vibrance: 20 }
  },
  dramatic: {
    label: 'Dramatic',
    adjustments: { contrast: 35, saturation: -10, shadows: -20, highlights: 15 }
  },
  noir: {
    label: 'Noir',
    adjustments: { saturation: -100, contrast: 40, brightness: -5 }
  },
  sepia: {
    label: 'Sepia',
    adjustments: { sepia: 80, contrast: 10, brightness: 5 }
  },
  vintage: {
    label: 'Vintage',
    adjustments: { sepia: 40, contrast: -10, saturation: -20, vignette: 40, temperature: 15 }
  },
  cool: {
    label: 'Cool',
    adjustments: { temperature: -25, tint: 5, saturation: 10 }
  },
  warm: {
    label: 'Warm',
    adjustments: { temperature: 30, tint: -5, saturation: 10, brightness: 5 }
  },
  fade: {
    label: 'Fade',
    adjustments: { contrast: -20, saturation: -15, brightness: 10, fade: 30 }
  },
  clarity: {
    label: 'Clarity',
    adjustments: { clarity: 40, contrast: 10, saturation: 5 }
  },
  soft: {
    label: 'Soft Glow',
    adjustments: { brightness: 10, contrast: -15, blur: 2, saturation: -5 }
  },
  punch: {
    label: 'Punch',
    adjustments: { contrast: 25, saturation: 25, clarity: 20, vibrance: 15 }
  }
};

const ADJUSTMENT_DEFS = [
  { id: 'brightness', label: 'Brightness', min: -100, max: 100, default: 0 },
  { id: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 },
  { id: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0 },
  { id: 'vibrance', label: 'Vibrance', min: -100, max: 100, default: 0 },
  { id: 'temperature', label: 'Temperature', min: -100, max: 100, default: 0 },
  { id: 'tint', label: 'Tint', min: -100, max: 100, default: 0 },
  { id: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 },
  { id: 'highlights', label: 'Highlights', min: -100, max: 100, default: 0 },
  { id: 'shadows', label: 'Shadows', min: -100, max: 100, default: 0 },
  { id: 'clarity', label: 'Clarity', min: 0, max: 100, default: 0 },
  { id: 'blur', label: 'Blur', min: 0, max: 20, default: 0, step: 0.5 },
  { id: 'sharpen', label: 'Sharpen', min: 0, max: 100, default: 0 },
  { id: 'vignette', label: 'Vignette', min: 0, max: 100, default: 0 },
  { id: 'sepia', label: 'Sepia', min: 0, max: 100, default: 0 },
  { id: 'fade', label: 'Fade', min: 0, max: 100, default: 0 },
  { id: 'hue', label: 'Hue Rotate', min: -180, max: 180, default: 0 },
  { id: 'grain', label: 'Film Grain', min: 0, max: 100, default: 0 }
];