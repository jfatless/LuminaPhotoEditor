class ImageEngine {
  constructor() {
    this.sourceCanvas = document.createElement('canvas');
    this.sourceCtx = this.sourceCanvas.getContext('2d', { willReadFrequently: true });
    this.originalImageData = null;
    this.width = 0;
    this.height = 0;
    this.adjustments = {};
    this.activeFilter = 'original';
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.straighten = 0;
    this.drawingLayer = null;
    this.textLayers = [];
    this._renderPending = false;
    this._cachedPixels = null;
    this._cacheKey = '';

    ADJUSTMENT_DEFS.forEach(a => { this.adjustments[a.id] = a.default; });
  }

  loadImage(img) {
    this.width = img.naturalWidth;
    this.height = img.naturalHeight;
    this.sourceCanvas.width = this.width;
    this.sourceCanvas.height = this.height;
    this.sourceCtx.drawImage(img, 0, 0);
    this.originalImageData = this.sourceCtx.getImageData(0, 0, this.width, this.height);
    this.resetAdjustments();
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.straighten = 0;
    this.drawingLayer = null;
    this.textLayers = [];
    this._invalidateCache();
  }

  resetAdjustments() {
    ADJUSTMENT_DEFS.forEach(a => { this.adjustments[a.id] = a.default; });
    this.activeFilter = 'original';
    this._invalidateCache();
  }

  setAdjustment(id, value) {
    this.adjustments[id] = value;
    this.activeFilter = 'custom';
    this._invalidateCache();
  }

  applyFilter(presetId) {
    const preset = FILTER_PRESETS[presetId];
    if (!preset) return;
    this.resetAdjustments();
    Object.entries(preset.adjustments).forEach(([k, v]) => {
      this.adjustments[k] = v;
    });
    this.activeFilter = presetId;
    this._invalidateCache();
  }

  _invalidateCache() {
    this._cachedPixels = null;
    this._cacheKey = '';
  }

  _getCacheKey() {
    return JSON.stringify({ adj: this.adjustments });
  }

  _getRotatedDimensions() {
    const rad = (this.rotation + this.straighten) * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    return {
      width: Math.ceil(this.width * cos + this.height * sin),
      height: Math.ceil(this.width * sin + this.height * cos)
    };
  }

  getProcessedImageData() {
    const key = this._getCacheKey();
    if (this._cachedPixels && this._cacheKey === key) {
      return this._cachedPixels;
    }

    const src = this.originalImageData;
    const data = new Uint8ClampedArray(src.data);
    const w = this.width;
    const h = this.height;
    const adj = this.adjustments;

    this._applyPixelAdjustments(data, w, h, adj);

    if (adj.sharpen > 0) {
      this._applySharpen(data, w, h, adj.sharpen / 100);
    }

    if (adj.grain > 0) {
      this._applyGrain(data, adj.grain / 100);
    }

    this._cachedPixels = new ImageData(data, w, h);
    this._cacheKey = key;
    return this._cachedPixels;
  }

  _applyPixelAdjustments(data, w, h, adj) {
    const brightness = adj.brightness / 100;
    const contrast = (adj.contrast / 100) * 1.5 + 1;
    const saturation = 1 + adj.saturation / 100;
    const vibrance = adj.vibrance / 100;
    const exposure = Math.pow(2, adj.exposure / 50);
    const highlights = adj.highlights / 100;
    const shadows = adj.shadows / 100;
    const clarity = adj.clarity / 100;
    const temperature = adj.temperature / 100;
    const tint = adj.tint / 100;
    const sepia = adj.sepia / 100;
    const fade = adj.fade / 100;
    const hueShift = adj.hue * Math.PI / 180;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      r *= exposure;
      g *= exposure;
      b *= exposure;

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 0.5) {
        const f = (lum - 0.5) * 2 * highlights;
        r -= f * 0.1; g -= f * 0.1; b -= f * 0.1;
      } else {
        const f = (0.5 - lum) * 2 * shadows;
        r += f * 0.15; g += f * 0.15; b += f * 0.15;
      }

      r += brightness * 0.4;
      g += brightness * 0.4;
      b += brightness * 0.4;

      r = ((r - 0.5) * contrast) + 0.5;
      g = ((g - 0.5) * contrast) + 0.5;
      b = ((b - 0.5) * contrast) + 0.5;

      if (clarity > 0) {
        const avg = (r + g + b) / 3;
        r += (r - avg) * clarity * 0.5;
        g += (g - avg) * clarity * 0.5;
        b += (b - avg) * clarity * 0.5;
      }

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC - minC;
      if (sat > 0) {
        const vibFactor = 1 + vibrance * (1 - Math.abs(maxC - 0.5) * 2);
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + (r - gray) * saturation * vibFactor;
        g = gray + (g - gray) * saturation * vibFactor;
        b = gray + (b - gray) * saturation * vibFactor;
      }

      r += temperature * 0.1;
      b -= temperature * 0.1;
      g += tint * 0.05;
      r -= tint * 0.025;
      b -= tint * 0.025;

      if (hueShift !== 0) {
        [r, g, b] = this._rotateHue(r, g, b, hueShift);
      }

      if (sepia > 0) {
        const sr = r * 0.393 + g * 0.769 + b * 0.189;
        const sg = r * 0.349 + g * 0.686 + b * 0.168;
        const sb = r * 0.272 + g * 0.534 + b * 0.131;
        r = r + (sr - r) * sepia;
        g = g + (sg - g) * sepia;
        b = b + (sb - b) * sepia;
      }

      if (fade > 0) {
        r = r + (0.85 - r) * fade * 0.3;
        g = g + (0.85 - g) * fade * 0.3;
        b = b + (0.85 - b) * fade * 0.3;
      }

      data[i] = Math.min(255, Math.max(0, r * 255));
      data[i + 1] = Math.min(255, Math.max(0, g * 255));
      data[i + 2] = Math.min(255, Math.max(0, b * 255));
    }

    if (adj.vignette > 0) {
      this._applyVignette(data, w, h, adj.vignette / 100);
    }
  }

  _rotateHue(r, g, b, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const mr = 0.299, mg = 0.587, mb = 0.114;
    const newR = r * (mr + cos * (1 - mr) + sin * (-mr)) +
                 g * (mg + cos * (-mg) + sin * (-mg)) +
                 b * (mb + cos * (-mb) + sin * (1 - mb));
    const newG = r * (mr + cos * (-mr) + sin * 0.143) +
                 g * (mg + cos * (1 - mg) + sin * 0.14) +
                 b * (mb + cos * (-mb) + sin * (-0.283));
    const newB = r * (mr + cos * (-mr) + sin * (-(1 - mr))) +
                 g * (mg + cos * (-mg) + sin * mg) +
                 b * (mb + cos * (1 - mb) + sin * mb);
    return [newR, newG, newB];
  }

  _applyVignette(data, w, h, amount) {
    const cx = w / 2, cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDist;
        const factor = 1 - amount * Math.pow(dist, 1.5);
        const i = (y * w + x) * 4;
        data[i] *= factor;
        data[i + 1] *= factor;
        data[i + 2] *= factor;
      }
    }
  }

  _applySharpen(data, w, h, amount) {
    const copy = new Uint8ClampedArray(data);
    const kernel = [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0];
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

  _applyGrain(data, amount) {
    for (let i = 0; i < data.length; i += 4) {
      const seed = ((i / 4) * 2654435761) % 10000;
      const noise = ((seed / 10000) - 0.5) * amount * 60;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
  }

  renderToCanvas(targetCanvas, showOriginal = false) {
    const ctx = targetCanvas.getContext('2d');
    const totalRotation = this.rotation + this.straighten;
    const rad = totalRotation * Math.PI / 180;
    const { width: outW, height: outH } = this._getRotatedDimensions();

    targetCanvas.width = outW;
    targetCanvas.height = outH;

    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rad);
    ctx.scale(this.flipH ? -1 : 1, this.flipV ? -1 : 1);

    if (showOriginal) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.width;
      tempCanvas.height = this.height;
      tempCanvas.getContext('2d').putImageData(this.originalImageData, 0, 0);
      ctx.drawImage(tempCanvas, -this.width / 2, -this.height / 2);
    } else {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.width;
      tempCanvas.height = this.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(this.getProcessedImageData(), 0, 0);

      const blur = this.adjustments.blur;
      if (blur > 0) {
        ctx.filter = `blur(${blur}px)`;
      }

      ctx.drawImage(tempCanvas, -this.width / 2, -this.height / 2);
      ctx.filter = 'none';
    }

    ctx.restore();

    if (!showOriginal) {
      if (this.drawingLayer) {
        ctx.drawImage(this.drawingLayer, 0, 0, outW, outH);
      }
      this.textLayers.forEach(t => {
        ctx.save();
        ctx.font = `${t.size}px ${t.font}`;
        ctx.fillStyle = t.color;
        ctx.textBaseline = 'top';
        ctx.fillText(t.text, t.x, t.y);
        ctx.restore();
      });
    }
  }

  getOutputDimensions() {
    return this._getRotatedDimensions();
  }

  rotate(degrees) {
    this.rotation = (this.rotation + degrees) % 360;
    this._invalidateCache();
  }

  flip(direction) {
    if (direction === 'h') this.flipH = !this.flipH;
    else this.flipV = !this.flipV;
    this._invalidateCache();
  }

  setStraighten(value) {
    this.straighten = value;
    this._invalidateCache();
  }

  crop(x, y, w, h) {
    const dims = this.getOutputDimensions();
    const flatCanvas = document.createElement('canvas');
    flatCanvas.width = dims.width;
    flatCanvas.height = dims.height;
    this.renderToCanvas(flatCanvas);

    const flatCtx = flatCanvas.getContext('2d');
    const ix = Math.max(0, Math.round(x));
    const iy = Math.max(0, Math.round(y));
    const iw = Math.min(Math.round(w), dims.width - ix);
    const ih = Math.min(Math.round(h), dims.height - iy);
    const cropped = flatCtx.getImageData(ix, iy, iw, ih);

    this.width = iw;
    this.height = ih;
    this.sourceCanvas.width = iw;
    this.sourceCanvas.height = ih;
    this.sourceCtx.putImageData(cropped, 0, 0);
    this.originalImageData = cropped;
    this.drawingLayer = null;
    this.textLayers = [];
    this.rotation = 0;
    this.straighten = 0;
    this.flipH = false;
    this.flipV = false;
    this._invalidateCache();
  }

  autoEnhance() {
    this.resetAdjustments();
    this.adjustments.contrast = 12;
    this.adjustments.saturation = 8;
    this.adjustments.clarity = 15;
    this.adjustments.shadows = 10;
    this.adjustments.highlights = -8;
    this.adjustments.vibrance = 12;
    this.activeFilter = 'auto';
    this._invalidateCache();
  }

  bakeTransform() {
    const dims = this.getOutputDimensions();
    const bakeCanvas = document.createElement('canvas');
    bakeCanvas.width = dims.width;
    bakeCanvas.height = dims.height;
    this.renderToCanvas(bakeCanvas);

    const ctx = bakeCanvas.getContext('2d');
    const baked = ctx.getImageData(0, 0, dims.width, dims.height);

    this.width = dims.width;
    this.height = dims.height;
    this.originalImageData = baked;
    this.rotation = 0;
    this.straighten = 0;
    this.flipH = false;
    this.flipV = false;
    this.drawingLayer = null;
    this.textLayers = [];
    this._invalidateCache();
  }

  initDrawingLayer() {
    const dims = this.getOutputDimensions();
    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    this.drawingLayer = canvas;
    return canvas;
  }

  addTextLayer(text, x, y, size, color, font) {
    this.textLayers.push({ text, x, y, size, color, font });
  }

  exportImage(format = 'png', quality = 0.92) {
    const exportCanvas = document.createElement('canvas');
    this.renderToCanvas(exportCanvas);
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    return exportCanvas.toDataURL(mime, quality);
  }

  getSnapshot() {
    return {
      imageData: new ImageData(new Uint8ClampedArray(this.originalImageData.data), this.width, this.height),
      width: this.width,
      height: this.height,
      adjustments: { ...this.adjustments },
      activeFilter: this.activeFilter,
      rotation: this.rotation,
      flipH: this.flipH,
      flipV: this.flipV,
      straighten: this.straighten,
      drawingLayer: this.drawingLayer ? this.drawingLayer.toDataURL() : null,
      textLayers: JSON.parse(JSON.stringify(this.textLayers))
    };
  }

  restoreSnapshot(snap) {
    this.width = snap.width;
    this.height = snap.height;
    this.originalImageData = snap.imageData;
    this.adjustments = { ...snap.adjustments };
    this.activeFilter = snap.activeFilter;
    this.rotation = snap.rotation;
    this.flipH = snap.flipH;
    this.flipV = snap.flipV;
    this.straighten = snap.straighten;
    this.textLayers = JSON.parse(JSON.stringify(snap.textLayers));

    if (snap.drawingLayer) {
      const img = new Image();
      const dims = this.getOutputDimensions();
      const canvas = document.createElement('canvas');
      canvas.width = dims.width;
      canvas.height = dims.height;
      this.drawingLayer = canvas;
      img.onload = () => {
        canvas.getContext('2d').drawImage(img, 0, 0);
      };
      img.src = snap.drawingLayer;
    } else {
      this.drawingLayer = null;
    }
    this._invalidateCache();
  }

  applyImageData(imageData) {
    this.width = imageData.width;
    this.height = imageData.height;
    this.originalImageData = new ImageData(
      new Uint8ClampedArray(imageData.data), imageData.width, imageData.height
    );
    this.rotation = 0;
    this.straighten = 0;
    this.flipH = false;
    this.flipV = false;
    this.drawingLayer = null;
    this.textLayers = [];
    this.resetAdjustments();
    this._invalidateCache();
  }
}