const OCR_PREPROCESS = {
  _optimalScale(canvas) {
    const maxDim = Math.max(canvas.width, canvas.height);
    if (maxDim < 800) return 2;
    if (maxDim < 1600) return 1.5;
    return 1;
  },

  _upscale(canvas, scale) {
    if (scale <= 1) return canvas;
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  },

  _enhance(canvas, opts = {}) {
    const contrast = opts.contrast ?? 1.3;
    const sharpen = opts.sharpen ?? 0.5;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = Math.min(255, Math.max(0, gray + (data[i] - gray) * contrast));
      data[i + 1] = Math.min(255, Math.max(0, gray + (data[i + 1] - gray) * contrast));
      data[i + 2] = Math.min(255, Math.max(0, gray + (data[i + 2] - gray) * contrast));
    }

    if (sharpen > 0) {
      const w = canvas.width, h = canvas.height;
      const copy = new Uint8ClampedArray(data);
      const kernel = [0, -sharpen, 0, -sharpen, 1 + 4 * sharpen, -sharpen, 0, -sharpen, 0];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          for (let c = 0; c < 3; c++) {
            let val = 0;
            let ki = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                val += copy[((y + ky) * w + (x + kx)) * 4 + c] * kernel[ki++];
              }
            }
            data[(y * w + x) * 4 + c] = Math.min(255, Math.max(0, val));
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  },

  prepare(canvas, options = {}) {
    const scale = options.scale ?? this._optimalScale(canvas);
    let result = this._upscale(canvas, scale);
    result = this._enhance(result, options);
    return result;
  },

  toBinary(canvas, threshold) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    const gray = new Float32Array(img.width * img.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      gray[i / 4] = g;
      sum += g;
    }
    const t = threshold ?? sum / gray.length;
    const out = ctx.createImageData(img.width, img.height);
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i] < t ? 0 : 255;
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }
};
