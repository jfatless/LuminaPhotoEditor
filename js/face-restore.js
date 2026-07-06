const FACE_MODEL_URLS = {
  yolo: 'https://huggingface.co/deepghs/yolo-face/resolve/main/yolov8n-face/model.onnx',
  gfpgan: 'https://huggingface.co/facefusion/models-3.0.0/resolve/main/gfpgan_1.4.onnx'
};
const FACE_CACHE = 'lumina-face-models';
const YOLO_SIZE = 640;
const GFPGAN_SIZE = 512;
const ORT_VERSION = '1.21.0';

class FaceRestore {
  constructor() {
    this.yoloSession = null;
    this.gfpganSession = null;
    this.ready = false;
    this.loading = false;
  }

  async init(onProgress) {
    if (this.ready) return;
    if (this.loading) {
      while (this.loading) await new Promise(r => setTimeout(r, 200));
      return;
    }
    this.loading = true;

    if (typeof ort === 'undefined') {
      await this._loadScript(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.min.js`);
    }
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

    const useWebGPU = await this._hasWebGPU();
    const sessionOpts = useWebGPU
      ? { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }
      : { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };

    onProgress?.(5, 'Downloading face detector…');
    const yoloBuf = await this._download(FACE_MODEL_URLS.yolo, (c, t) => {
      onProgress?.(5 + (c / (t || 1)) * 25, 'Downloading face detector…');
    });

    onProgress?.(35, 'Downloading GFPGAN AI model…');
    const gfpganBuf = await this._download(FACE_MODEL_URLS.gfpgan, (c, t) => {
      onProgress?.(35 + (c / (t || 1)) * 45, 'Downloading GFPGAN (~330MB first time)…');
    });

    onProgress?.(85, 'Loading AI models…');
    try {
      this.yoloSession = await ort.InferenceSession.create(yoloBuf, sessionOpts);
    } catch {
      this.yoloSession = await ort.InferenceSession.create(yoloBuf, { executionProviders: ['wasm'] });
    }
    try {
      this.gfpganSession = await ort.InferenceSession.create(gfpganBuf, sessionOpts);
    } catch {
      this.gfpganSession = await ort.InferenceSession.create(gfpganBuf, { executionProviders: ['wasm'] });
    }

    this.ready = true;
    this.loading = false;
    onProgress?.(100, 'AI ready');
  }

  async restore(imageData, onProgress) {
    await this.init(onProgress);
    const w = imageData.width;
    const h = imageData.height;
    let data = this._toFloatHWC(imageData);

    onProgress?.(10, 'Detecting faces…');
    const faces = await this._detectFaces(data, w, h);
    if (faces.length === 0) return { imageData, faceCount: 0 };

    onProgress?.(20, `Reconstructing ${faces.length} face${faces.length > 1 ? 's' : ''}…`);
    for (let i = 0; i < faces.length; i++) {
      const pct = 20 + ((i + 1) / faces.length) * 75;
      onProgress?.(pct, `AI restoring face ${i + 1} of ${faces.length}…`);
      const { data: faceIn, cropBox } = this._cropFace(data, w, h, faces[i], GFPGAN_SIZE);
      const enhanced = await this._runGFPGAN(faceIn);
      const mask = this._ellipseMask(GFPGAN_SIZE);
      data = this._pasteFace(data, enhanced, mask, w, h, cropBox);
      await new Promise(r => setTimeout(r, 0));
    }

    return { imageData: this._toImageData(data, w, h), faceCount: faces.length };
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async _hasWebGPU() {
    try {
      if (!navigator.gpu) return false;
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    } catch { return false; }
  }

  async _download(url, onProgress) {
    const cache = await caches.open(FACE_CACHE);
    const cached = await cache.match(url);
    if (cached) {
      const buf = await cached.arrayBuffer();
      onProgress?.(buf.byteLength, buf.byteLength);
      return buf;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const total = parseInt(res.headers.get('content-length') || '0', 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(received, total);
    }
    const buf = new Uint8Array(received);
    let pos = 0;
    for (const c of chunks) { buf.set(c, pos); pos += c.length; }
    try { await cache.put(url, new Response(buf.buffer)); } catch {}
    return buf.buffer;
  }

  _toFloatHWC(imageData) {
    const { data, width, height } = imageData;
    const out = new Float32Array(width * height * 3);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
      out[p] = data[i] / 255;
      out[p + 1] = data[i + 1] / 255;
      out[p + 2] = data[i + 2] / 255;
    }
    return out;
  }

  _toImageData(floatHWC, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, p = 0; p < floatHWC.length; i += 4, p += 3) {
      out[i] = Math.min(255, Math.max(0, Math.round(floatHWC[p] * 255)));
      out[i + 1] = Math.min(255, Math.max(0, Math.round(floatHWC[p + 1] * 255)));
      out[i + 2] = Math.min(255, Math.max(0, Math.round(floatHWC[p + 2] * 255)));
      out[i + 3] = 255;
    }
    return new ImageData(out, w, h);
  }

  _letterbox(data, sw, sh, size) {
    const scale = Math.min(size / sw, size / sh);
    const nw = Math.round(sw * scale);
    const nh = Math.round(sh * scale);
    const padX = Math.floor((size - nw) / 2);
    const padY = Math.floor((size - nh) / 2);
    const out = new Float32Array(3 * size * size);
    out.fill(0.5);
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          const sx = x / scale, sy = y / scale;
          const x0 = Math.floor(sx), y0 = Math.floor(sy);
          const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
          const xf = sx - x0, yf = sy - y0;
          const v = (data[(y0 * sw + x0) * 3 + c] * (1 - xf) + data[(y0 * sw + x1) * 3 + c] * xf) * (1 - yf) +
                    (data[(y1 * sw + x0) * 3 + c] * (1 - xf) + data[(y1 * sw + x1) * 3 + c] * xf) * yf;
          out[c * size * size + (padY + y) * size + (padX + x)] = v;
        }
      }
    }
    return { data: out, scale, padX, padY };
  }

  async _detectFaces(data, w, h) {
    const { data: input, scale, padX, padY } = this._letterbox(data, w, h, YOLO_SIZE);
    const tensor = new ort.Tensor('float32', input, [1, 3, YOLO_SIZE, YOLO_SIZE]);
    const name = this.yoloSession.inputNames[0];
    const res = await this.yoloSession.run({ [name]: tensor });
    const out = res[Object.keys(res)[0]].data;
    const boxes = [];
    const n = out.length / 5;
    for (let i = 0; i < n; i++) {
      const conf = out[4 * n + i];
      if (conf < 0.35) continue;
      const xc = out[0 * n + i], yc = out[1 * n + i];
      const bw = out[2 * n + i], bh = out[3 * n + i];
      const x = (xc - padX) / scale - bw / (2 * scale);
      const y = (yc - padY) / scale - bh / (2 * scale);
      const bw2 = bw / scale, bh2 = bh / scale;
      const bx = Math.max(0, x), by = Math.max(0, y);
      boxes.push({
        x: bx, y: by,
        width: Math.min(bw2, w - bx), height: Math.min(bh2, h - by),
        confidence: conf
      });
    }
    return this._nms(boxes, 0.45);
  }

  _nms(boxes, thresh) {
    const remaining = [...boxes].sort((a, b) => b.confidence - a.confidence);
    const out = [];
    while (remaining.length) {
      const best = remaining.shift();
      out.push(best);
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (this._iou(best, remaining[i]) > thresh) remaining.splice(i, 1);
      }
    }
    return out;
  }

  _iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.width * a.height + b.width * b.height - inter;
    return inter / union;
  }

  _cropFace(data, w, h, box, size) {
    const pad = 0.25;
    let cx = box.x - box.width * pad;
    let cy = box.y - box.height * pad;
    let cs = Math.max(box.width, box.height) * (1 + pad * 2);
    cx -= (cs - box.width - box.width * pad * 2) / 2;
    cy -= (cs - box.height - box.height * pad * 2) / 2;
    cx = Math.max(0, cx); cy = Math.max(0, cy);
    cs = Math.min(cs, Math.min(w - cx, h - cy));
    const out = new Float32Array(3 * size * size);
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sx = cx + (x / size) * cs, sy = cy + (y / size) * cs;
          const x0 = Math.floor(sx), y0 = Math.floor(sy);
          const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
          const xf = sx - x0, yf = sy - y0;
          let v = (data[(y0 * w + x0) * 3 + c] * (1 - xf) + data[(y0 * w + x1) * 3 + c] * xf) * (1 - yf) +
                    (data[(y1 * w + x0) * 3 + c] * (1 - xf) + data[(y1 * w + x1) * 3 + c] * xf) * yf;
          out[c * size * size + y * size + x] = (v - 0.5) / 0.5;
        }
      }
    }
    return { data: out, cropBox: { x: cx, y: cy, w: cs, h: cs } };
  }

  async _runGFPGAN(faceData) {
    const tensor = new ort.Tensor('float32', faceData, [1, 3, GFPGAN_SIZE, GFPGAN_SIZE]);
    const name = this.gfpganSession.inputNames[0];
    const res = await this.gfpganSession.run({ [name]: tensor });
    return new Float32Array(res[Object.keys(res)[0]].data);
  }

  _ellipseMask(size) {
    const mask = new Uint8Array(size * size);
    const cx = size / 2, cy = size / 2, rx = size * 0.44, ry = size * 0.48;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        mask[y * size + x] = d <= 1 ? 255 : d <= 1.15 ? Math.round(255 * (1.15 - d) / 0.15) : 0;
      }
    }
    return mask;
  }

  _pasteFace(orig, enhanced, mask, w, h, crop) {
    const result = new Float32Array(orig);
    const { x: cx, y: cy, w: cw, h: ch } = crop;
    const feather = 10;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < cx || x >= cx + cw || y < cy || y >= cy + ch) continue;
        const fx = ((x - cx) / cw) * GFPGAN_SIZE;
        const fy = ((y - cy) / ch) * GFPGAN_SIZE;
        const fx0 = Math.floor(fx), fy0 = Math.floor(fy);
        const fx1 = Math.min(fx0 + 1, GFPGAN_SIZE - 1);
        const fy1 = Math.min(fy0 + 1, GFPGAN_SIZE - 1);
        const xff = fx - fx0, yff = fy - fy0;
        const m00 = mask[fy0 * GFPGAN_SIZE + fx0], m10 = mask[fy0 * GFPGAN_SIZE + fx1];
        const m01 = mask[fy1 * GFPGAN_SIZE + fx0], m11 = mask[fy1 * GFPGAN_SIZE + fx1];
        let alpha = ((m00 * (1 - xff) + m10 * xff) * (1 - yff) + (m01 * (1 - xff) + m11 * xff) * yff) / 255;
        const edge = Math.min(x - cx, cx + cw - x, y - cy, cy + ch - y);
        alpha *= Math.min(1, edge / feather);
        if (alpha < 0.01) continue;
        for (let c = 0; c < 3; c++) {
          const v00 = enhanced[c * GFPGAN_SIZE * GFPGAN_SIZE + fy0 * GFPGAN_SIZE + fx0];
          const v10 = enhanced[c * GFPGAN_SIZE * GFPGAN_SIZE + fy0 * GFPGAN_SIZE + fx1];
          const v01 = enhanced[c * GFPGAN_SIZE * GFPGAN_SIZE + fy1 * GFPGAN_SIZE + fx0];
          const v11 = enhanced[c * GFPGAN_SIZE * GFPGAN_SIZE + fy1 * GFPGAN_SIZE + fx1];
          let v = (v00 * (1 - xff) + v10 * xff) * (1 - yff) + (v01 * (1 - xff) + v11 * xff) * yff;
          v = Math.max(0, Math.min(1, (v + 1) / 2));
          const i = (y * w + x) * 3 + c;
          result[i] = orig[i] * (1 - alpha) + v * alpha;
        }
      }
    }
    return result;
  }
}

window.faceRestore = new FaceRestore();
