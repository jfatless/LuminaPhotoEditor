class ForensicsEngine {
  static enhanceFull(imageData, factor = 2) {
    let data = this._clone(imageData);
    data = this._upscale(data, factor);
    data = this.applyCLAHE(data, 48, 2.5);
    data = this._unsharp(data, 1.2, 1.5);
    data = this._edgeEnhance(data, 0.35);
    data = this._denoiseBilateral(data, 1);
    return data;
  }

  static enhanceRegion(imageData, x, y, w, h) {
    const out = this._clone(imageData);
    const region = this._extract(out, x, y, w, h);
    let enhanced = this._upscale(region, 2);
    enhanced = this.applyCLAHE(enhanced, 32, 3.0);
    enhanced = this._deblur(enhanced, 4);
    enhanced = this._unsharp(enhanced, 1.5, 2.0);
    enhanced = this._downscale(enhanced, w, h);
    this._paste(out, enhanced, x, y);
    this._featherBlend(out, imageData, x, y, w, h, 12);
    return out;
  }

  static deblurRegion(imageData, x, y, w, h, strength = 6) {
    const out = this._clone(imageData);
    const region = this._extract(out, x, y, w, h);
    const deb = this._deblur(region, strength);
    const sharp = this._unsharp(deb, 1.0, 1.8);
    this._paste(out, sharp, x, y);
    this._featherBlend(out, imageData, x, y, w, h, 8);
    return out;
  }

  static detectMirrorNeeded(imageData) {
    const { width: w, height: h, data } = imageData;
    const midX = Math.floor(w / 2);
    const midY = Math.floor(h / 2);

    const regionScore = (x0, y0, rw, rh) => {
      let sum = 0, sumSq = 0, edge = 0, n = 0;
      for (let y = y0; y < y0 + rh; y++) {
        for (let x = x0; x < x0 + rw; x++) {
          const i = (y * w + x) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += lum;
          sumSq += lum * lum;
          n++;
          if (x > x0 && y > y0) {
            const i2 = (y * w + x - 1) * 4;
            const lum2 = 0.299 * data[i2] + 0.587 * data[i2 + 1] + 0.114 * data[i2 + 2];
            edge += Math.abs(lum - lum2);
          }
        }
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      return variance + edge / n * 2;
    };

    const left = regionScore(0, 0, midX, h);
    const right = regionScore(midX, 0, w - midX, h);
    const top = regionScore(0, 0, w, midY);
    const bottom = regionScore(0, midY, w, h - midY);

    const hRatio = Math.max(left, right) / (Math.min(left, right) + 1);
    const vRatio = Math.max(top, bottom) / (Math.min(top, bottom) + 1);
    const threshold = 1.3;

    if (hRatio >= vRatio && hRatio > threshold) {
      return {
        needed: true,
        axis: 'vertical',
        keepSide: left >= right ? 'left' : 'right',
        confidence: Math.min(1, (hRatio - 1) / 1.5)
      };
    }
    if (vRatio > threshold) {
      return {
        needed: true,
        axis: 'horizontal',
        keepSide: top >= bottom ? 'top' : 'bottom',
        confidence: Math.min(1, (vRatio - 1) / 1.5)
      };
    }
    return { needed: false, confidence: 0 };
  }

  static mirrorComplete(imageData, axis, keepSide) {
    const { width: w, height: h, data } = imageData;
    const out = new Uint8ClampedArray(data);
    const blend = 16;

    if (axis === 'vertical') {
      const mid = Math.floor(w / 2);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let srcX;
          if (keepSide === 'left') {
            if (x < mid) continue;
            srcX = (x < mid + blend) ? mid - (x - mid) - 1 : 2 * mid - x - 1;
          } else {
            if (x >= mid) continue;
            srcX = (x >= mid - blend) ? mid + (mid - x) : 2 * mid - x - 1;
          }
          srcX = Math.max(0, Math.min(w - 1, srcX));
          const alpha = (keepSide === 'left' && x < mid + blend && x >= mid)
            ? (x - mid) / blend : (keepSide === 'right' && x >= mid - blend && x < mid)
            ? (mid - x) / blend : 1;
          const di = (y * w + x) * 4;
          const si = (y * w + srcX) * 4;
          for (let c = 0; c < 3; c++) {
            out[di + c] = out[di + c] * (1 - alpha) + data[si + c] * alpha;
          }
        }
      }
    } else {
      const mid = Math.floor(h / 2);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let srcY;
          if (keepSide === 'top') {
            if (y < mid) continue;
            srcY = (y < mid + blend) ? mid - (y - mid) - 1 : 2 * mid - y - 1;
          } else {
            if (y >= mid) continue;
            srcY = (y >= mid - blend) ? mid + (mid - y) : 2 * mid - y - 1;
          }
          srcY = Math.max(0, Math.min(h - 1, srcY));
          const alpha = (keepSide === 'top' && y < mid + blend && y >= mid)
            ? (y - mid) / blend : (keepSide === 'bottom' && y >= mid - blend && y < mid)
            ? (mid - y) / blend : 1;
          const di = (y * w + x) * 4;
          const si = (srcY * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            out[di + c] = out[di + c] * (1 - alpha) + data[si + c] * alpha;
          }
        }
      }
    }
    return new ImageData(out, w, h);
  }

  static inpaint(imageData, mask, patchSize = 7) {
    const { width: w, height: h } = imageData;
    const out = new Uint8ClampedArray(imageData.data);
    const known = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) known[i] = mask[i] ? 0 : 1;

    const bounds = this._maskBounds(mask, w, h);
    if (!bounds) return imageData;

    const { x0, y0, x1, y1 } = bounds;
    const half = Math.floor(patchSize / 2);
    let changed = true;
    let passes = 0;

    while (changed && passes < 12) {
      changed = false;
      passes++;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          if (!mask[i] || !this._hasKnownNeighbor(known, w, h, x, y)) continue;

          let bestScore = Infinity;
          let bestPatch = null;

          for (let sy = half; sy < h - half; sy += 2) {
            for (let sx = half; sx < w - half; sx += 2) {
              if (!known[sy * w + sx]) continue;
              const score = this._patchDistance(out, known, w, x, y, sx, sy, half);
              if (score < bestScore) {
                bestScore = score;
                bestPatch = { sx, sy };
              }
            }
          }

          if (bestPatch) {
            const pi = (y * w + x) * 4;
            const si = (bestPatch.sy * w + bestPatch.sx) * 4;
            for (let c = 0; c < 3; c++) out[pi + c] = out[si + c];
            known[i] = 1;
            changed = true;
          }
        }
      }
    }

    return new ImageData(out, w, h);
  }

  static applyCLAHE(imageData, tileSize = 64, clipLimit = 2.0) {
    const { width: w, height: h, data } = imageData;
    const out = new Uint8ClampedArray(data.length);
    const tilesX = Math.ceil(w / tileSize);
    const tilesY = Math.ceil(h / tileSize);
    const maps = [];

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        maps.push(this._tileHistogram(data, w, h, tx * tileSize, ty * tileSize, tileSize, clipLimit));
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        const tx = x / tileSize;
        const ty = y / tileSize;
        const tx0 = Math.floor(tx), ty0 = Math.floor(ty);
        const tx1 = Math.min(tx0 + 1, tilesX - 1);
        const ty1 = Math.min(ty0 + 1, tilesY - 1);
        const fx = tx - tx0, fy = ty - ty0;

        const v00 = maps[ty0 * tilesX + tx0][lum];
        const v10 = maps[ty0 * tilesX + tx1][lum];
        const v01 = maps[ty1 * tilesX + tx0][lum];
        const v11 = maps[ty1 * tilesX + tx1][lum];
        const newLum = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
        const gain = (newLum + 1) / (lum + 1);

        for (let c = 0; c < 3; c++) {
          out[i + c] = Math.min(255, Math.max(0, data[i + c] * gain));
        }
        out[i + 3] = data[i + 3];
      }
    }
    return new ImageData(out, w, h);
  }

  static _tileHistogram(data, w, h, ox, oy, size, clipLimit) {
    const hist = new Array(256).fill(0);
    const x1 = Math.min(ox + size, w);
    const y1 = Math.min(oy + size, h);
    let count = 0;
    for (let y = oy; y < y1; y++) {
      for (let x = ox; x < x1; x++) {
        const i = (y * w + x) * 4;
        const lum = Math.min(255, Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
        hist[lum]++;
        count++;
      }
    }
    const clipThreshold = Math.max(1, Math.floor(clipLimit * count / 256));
    let excess = 0;
    for (let i = 0; i < 256; i++) {
      if (hist[i] > clipThreshold) { excess += hist[i] - clipThreshold; hist[i] = clipThreshold; }
    }
    const redist = Math.floor(excess / 256);
    for (let i = 0; i < 256; i++) hist[i] += redist;

    const cdf = new Float32Array(256);
    let sum = 0;
    for (let i = 0; i < 256; i++) { sum += hist[i]; cdf[i] = sum; }
    const map = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      map[i] = (cdf[i] / sum) * 255;
    }
    return map;
  }

  static _deblur(imageData, iterations) {
    const { width: w, height: h, data } = imageData;
    let est = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) est[i] = data[i];

    const kernel = [0, 1, 0, 1, 4, 1, 0, 1, 0];
    const kSum = 12;

    for (let iter = 0; iter < iterations; iter++) {
      const conv = new Float32Array(data.length);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          for (let c = 0; c < 3; c++) {
            let val = 0, ki = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                val += est[((y + ky) * w + (x + kx)) * 4 + c] * kernel[ki++];
              }
            }
            conv[(y * w + x) * 4 + c] = val / kSum;
          }
        }
      }
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          for (let c = 0; c < 3; c++) {
            const i = (y * w + x) * 4 + c;
            const ratio = data[i] / (conv[i] + 0.5);
            est[i] = Math.min(255, Math.max(0, est[i] * (0.6 + 0.4 * ratio)));
          }
        }
      }
    }
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i++) out[i] = Math.round(est[i]);
    return new ImageData(out, w, h);
  }

  static _unsharp(imageData, amount, radius) {
    const blurred = this._gaussianBlur(imageData, radius);
    const out = new Uint8ClampedArray(imageData.data.length);
    for (let i = 0; i < imageData.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = imageData.data[i + c] - blurred.data[i + c];
        out[i + c] = Math.min(255, Math.max(0, imageData.data[i + c] + diff * amount));
      }
      out[i + 3] = imageData.data[i + 3];
    }
    return new ImageData(out, imageData.width, imageData.height);
  }

  static _edgeEnhance(imageData, amount) {
    const { width: w, height: h, data } = imageData;
    const out = new Uint8ClampedArray(data);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          const i = (y * w + x) * 4 + c;
          const lap =
            -data[((y - 1) * w + x) * 4 + c] - data[(y * w + x - 1) * 4 + c] +
            4 * data[i] - data[(y * w + x + 1) * 4 + c] - data[((y + 1) * w + x) * 4 + c];
          out[i] = Math.min(255, Math.max(0, data[i] + lap * amount));
        }
      }
    }
    return new ImageData(out, w, h);
  }

  static _denoiseBilateral(imageData, strength) {
    const { width: w, height: h, data } = imageData;
    const out = new Uint8ClampedArray(data);
    const r = 2;
    for (let y = r; y < h - r; y++) {
      for (let x = r; x < w - r; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0, weight = 0;
          const ci = (y * w + x) * 4 + c;
          const center = data[ci];
          for (let ky = -r; ky <= r; ky++) {
            for (let kx = -r; kx <= r; kx++) {
              const ni = ((y + ky) * w + (x + kx)) * 4 + c;
              const spatial = Math.exp(-(kx * kx + ky * ky) / (2 * r * r));
              const diff = data[ni] - center;
              const range = Math.exp(-(diff * diff) / (2 * strength * strength * 255 * 255));
              const wgt = spatial * range;
              sum += data[ni] * wgt;
              weight += wgt;
            }
          }
          out[ci] = Math.round(sum / weight);
        }
      }
    }
    return new ImageData(out, w, h);
  }

  static _gaussianBlur(imageData, sigma) {
    const size = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = this._gaussianKernel(size, sigma);
    const { width: w, height: h, data } = imageData;
    const temp = new Float32Array(data.length);
    const out = new Uint8ClampedArray(data.length);
    const half = Math.floor(size / 2);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0;
          for (let k = 0; k < size; k++) {
            const sx = Math.min(w - 1, Math.max(0, x + k - half));
            val += data[(y * w + sx) * 4 + c] * kernel[k];
          }
          temp[(y * w + x) * 4 + c] = val;
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0;
          for (let k = 0; k < size; k++) {
            const sy = Math.min(h - 1, Math.max(0, y + k - half));
            val += temp[(sy * w + x) * 4 + c] * kernel[k];
          }
          out[(y * w + x) * 4 + c] = Math.min(255, Math.max(0, val));
        }
        out[(y * w + x) * 4 + 3] = data[(y * w + x) * 4 + 3];
      }
    }
    return new ImageData(out, w, h);
  }

  static _gaussianKernel(size, sigma) {
    const k = new Float32Array(size);
    const half = Math.floor(size / 2);
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const x = i - half;
      k[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      sum += k[i];
    }
    for (let i = 0; i < size; i++) k[i] /= sum;
    return k;
  }

  static _upscale(imageData, factor) {
    const nw = Math.round(imageData.width * factor);
    const nh = Math.round(imageData.height * factor);
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    const out = document.createElement('canvas');
    out.width = nw;
    out.height = nh;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, nw, nh);
    return ctx.getImageData(0, 0, nw, nh);
  }

  static _downscale(imageData, tw, th) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    const out = document.createElement('canvas');
    out.width = tw;
    out.height = th;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, tw, th);
    return ctx.getImageData(0, 0, tw, th);
  }

  static _extract(imageData, x, y, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return out.getContext('2d').getImageData(0, 0, w, h);
  }

  static _paste(imageData, patch, x, y) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    const p = document.createElement('canvas');
    p.width = patch.width;
    p.height = patch.height;
    p.getContext('2d').putImageData(patch, 0, 0);
    ctx.drawImage(p, x, y);
    imageData.data.set(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  }

  static _featherBlend(target, source, x, y, w, h, feather) {
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const distEdge = Math.min(px, py, w - 1 - px, h - 1 - py);
        const alpha = Math.min(1, distEdge / feather);
        const ti = ((y + py) * target.width + (x + px)) * 4;
        const si = ti;
        for (let c = 0; c < 3; c++) {
          target.data[ti + c] = Math.round(target.data[ti + c] * alpha + source.data[si + c] * (1 - alpha));
        }
      }
    }
  }

  static _clone(imageData) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }

  static _maskBounds(mask, w, h) {
    let x0 = w, y0 = h, x1 = 0, y1 = 0, found = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          found = true;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
    }
    return found ? { x0, y0, x1, y1 } : null;
  }

  static _hasKnownNeighbor(known, w, h, x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && known[ny * w + nx]) return true;
      }
    }
    return false;
  }

  static _patchDistance(data, known, w, px, py, sx, sy, half) {
    let dist = 0, count = 0;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const xi = px + dx, yi = py + dy;
        const xj = sx + dx, yj = sy + dy;
        if (xi < 0 || xi >= w || yi < 0 || yi >= data.length / (w * 4) || !known[yi * w + xi]) continue;
        if (xj < 0 || xj >= w || yj < 0 || yj >= data.length / (w * 4) || !known[yj * w + xj]) continue;
        for (let c = 0; c < 3; c++) {
          const di = (yi * w + xi) * 4 + c;
          const dj = (yj * w + xj) * 4 + c;
          const diff = data[di] - data[dj];
          dist += diff * diff;
        }
        count++;
      }
    }
    return count ? dist / count : Infinity;
  }
}
