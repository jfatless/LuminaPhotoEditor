class OCRPreprocessor {
  static prepare(sourceCanvas) {
    const scale = this._optimalScale(sourceCanvas);
    const upscaled = this._upscale(sourceCanvas, scale);
    const variants = [
      { canvas: this._enhance(upscaled, { contrast: 1.5, sharpen: 1.2 }), scale, label: 'enhanced' },
      { canvas: this._enhance(upscaled, { contrast: 1.8, sharpen: 0, binarize: true }), scale, label: 'binary' },
      { canvas: this._enhance(upscaled, { contrast: 1.2, sharpen: 0.8, invert: this._isMostlyDark(upscaled) }), scale, label: 'inverted' }
    ];
    return variants;
  }

  static _optimalScale(canvas) {
    const maxDim = Math.max(canvas.width, canvas.height);
    const minDim = Math.min(canvas.width, canvas.height);
    if (maxDim < 400) return 4;
    if (maxDim < 800) return 3;
    if (maxDim < 1400) return 2;
    if (minDim < 80) return 3;
    return 1.5;
  }

  static _upscale(canvas, scale) {
    const w = Math.round(canvas.width * scale);
    const h = Math.round(canvas.height * scale);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = scale < 2;
    ctx.drawImage(canvas, 0, 0, w, h);
    return out;
  }

  static _isMostlyDark(canvas) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    const step = 4;
    for (let i = 0; i < img.data.length; i += 4 * step) {
      const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      if (lum < 128) dark++;
    }
    return dark > (img.data.length / (4 * step)) * 0.55;
  }

  static _enhance(canvas, opts = {}) {
    const { contrast = 1.3, sharpen = 0, binarize = false, invert = false } = opts;
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const img = ctx.getImageData(0, 0, out.width, out.height);
    const data = img.data;

    const histogram = new Array(256).fill(0);
    const gray = new Float32Array(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      histogram[Math.floor(gray[p])]++;
    }
    const threshold = binarize ? this._otsuThreshold(histogram, gray.length) : null;
    const midpoint = 128;
    const factor = contrast;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      let v = gray[p];
      v = (v - midpoint) * factor + midpoint;
      if (binarize) v = v < threshold ? 0 : 255;
      if (invert && !binarize) v = 255 - v;
      v = Math.min(255, Math.max(0, v));
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }

    if (sharpen > 0 && !binarize) {
      this._sharpen(data, out.width, out.height, sharpen);
    }

    ctx.putImageData(img, 0, 0);
    return out;
  }

  static _otsuThreshold(histogram, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];
    let sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;
      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);
      if (variance > maxVar) { maxVar = variance; threshold = t; }
    }
    return threshold;
  }

  static _sharpen(data, w, h, amount) {
    const copy = new Uint8ClampedArray(data);
    const kernel = [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0, ki = 0;
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

  static cleanText(text) {
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[|]/g, 'I')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  static isValidToken(text, confidence) {
    const t = text.trim();
    if (!t || t.length === 0) return false;
    if (confidence < 25) return false;
    if (t.length === 1 && confidence < 55 && !/[A-Za-z0-9]/.test(t)) return false;
    if (/^[^A-Za-z0-9\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF]+$/.test(t) && confidence < 70) return false;
    return true;
  }
}
