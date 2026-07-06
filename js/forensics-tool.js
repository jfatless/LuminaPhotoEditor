class ForensicsTool {
  constructor(selectOverlay, maskCanvas, engine, app) {
    this.selectOverlay = selectOverlay;
    this.maskCanvas = maskCanvas;
    this.maskCtx = maskCanvas.getContext('2d');
    this.engine = engine;
    this.app = app;
    this.active = false;
    this.scale = 1;
    this.subMode = 'select';
    this.selection = null;
    this.dragging = null;
    this.brushSize = 30;
    this.painting = false;
    this._bindEvents();
  }

  setTransform(scale) {
    this.scale = scale;
    if (this.selection) this._renderSelection();
  }

  setSubMode(mode) {
    this.subMode = mode;
    this.selectOverlay.style.pointerEvents = mode === 'select' ? 'auto' : 'none';
    this.maskCanvas.style.pointerEvents = mode === 'mask' ? 'auto' : 'none';
    if (mode === 'mask') this._syncMaskCanvas();
    else this._renderSelection();
  }

  activate() {
    this.active = true;
    this.selectOverlay.classList.remove('hidden');
    this.maskCanvas.classList.remove('hidden');
    this.setSubMode('select');
  }

  deactivate() {
    this.active = false;
    this.selectOverlay.classList.add('hidden');
    this.maskCanvas.classList.add('hidden');
    this.selectOverlay.innerHTML = '';
    this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    this.selection = null;
    this.painting = false;
  }

  clearMask() {
    this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
  }

  clearSelection() {
    this.selection = null;
    this.selectOverlay.innerHTML = '';
  }

  setBrushSize(s) { this.brushSize = s; }

  _syncMaskCanvas() {
    const dims = this.engine.getOutputDimensions();
    if (this.maskCanvas.width !== dims.width || this.maskCanvas.height !== dims.height) {
      const prev = document.createElement('canvas');
      prev.width = this.maskCanvas.width;
      prev.height = this.maskCanvas.height;
      prev.getContext('2d').drawImage(this.maskCanvas, 0, 0);
      this.maskCanvas.width = dims.width;
      this.maskCanvas.height = dims.height;
      this.maskCtx.drawImage(prev, 0, 0, dims.width, dims.height);
    }
  }

  _toImageCoords(clientX, clientY) {
    const rect = this.selectOverlay.getBoundingClientRect();
    return { x: (clientX - rect.left) / this.scale, y: (clientY - rect.top) / this.scale };
  }

  _bindEvents() {
    this.selectOverlay.addEventListener('mousedown', e => {
      if (!this.active || this.subMode !== 'select') return;
      const pos = this._toImageCoords(e.clientX, e.clientY);
      this.dragging = { startX: pos.x, startY: pos.y };
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!this.dragging || this.subMode !== 'select') return;
      const pos = this._toImageCoords(e.clientX, e.clientY);
      const dims = this.engine.getOutputDimensions();
      const x = Math.max(0, Math.min(this.dragging.startX, pos.x));
      const y = Math.max(0, Math.min(this.dragging.startY, pos.y));
      let w = Math.abs(pos.x - this.dragging.startX);
      let h = Math.abs(pos.y - this.dragging.startY);
      if (x + w > dims.width) w = dims.width - x;
      if (y + h > dims.height) h = dims.height - y;
      this.selection = { x, y, w: Math.max(8, w), h: Math.max(8, h) };
      this._renderSelection();
    });

    document.addEventListener('mouseup', () => { this.dragging = null; });

    this.maskCanvas.addEventListener('mousedown', e => this._paint(e));
    this.maskCanvas.addEventListener('mousemove', e => { if (this.painting) this._paint(e); });
    this.maskCanvas.addEventListener('mouseup', () => { this.painting = false; });
    this.maskCanvas.addEventListener('mouseleave', () => { this.painting = false; });
  }

  _paint(e) {
    if (!this.active || this.subMode !== 'mask') return;
    this.painting = true;
    const rect = this.maskCanvas.getBoundingClientRect();
    const dims = this.engine.getOutputDimensions();
    const x = (e.clientX - rect.left) * (dims.width / rect.width);
    const y = (e.clientY - rect.top) * (dims.height / rect.height);
    this.maskCtx.fillStyle = 'rgba(129, 140, 248, 0.55)';
    this.maskCtx.beginPath();
    this.maskCtx.arc(x, y, this.brushSize / 2, 0, Math.PI * 2);
    this.maskCtx.fill();
  }

  _renderSelection() {
    if (!this.selection) return;
    const { x, y, w, h } = this.selection;
    this.selectOverlay.innerHTML = `
      <div class="forensics-selection" style="left:${x * this.scale}px;top:${y * this.scale}px;width:${w * this.scale}px;height:${h * this.scale}px">
        <span class="forensics-label">Selected region</span>
      </div>
    `;
  }

  getSelection() {
    if (!this.selection) return null;
    const { x, y, w, h } = this.selection;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  getMask() {
    const dims = this.engine.getOutputDimensions();
    const w = dims.width, h = dims.height;
    const mask = new Uint8Array(w * h);
    const img = this.maskCtx.getImageData(0, 0, w, h);
    for (let i = 0; i < w * h; i++) {
      mask[i] = img.data[i * 4 + 3] > 20 ? 1 : 0;
    }
    return mask;
  }

  hasMask() {
    return this.getMask().some(v => v === 1);
  }

  _setFaceProgress(pct, msg) {
    const wrap = document.getElementById('faceProgress');
    const bar = document.getElementById('faceProgressBar');
    const label = document.getElementById('faceProgressLabel');
    if (wrap) wrap.classList.toggle('hidden', !msg);
    if (label) label.textContent = msg || '';
    if (bar) bar.style.width = (pct != null ? pct : 0) + '%';
  }

  _mirrorFillLabel(mirror) {
    if (!mirror.needed) return '';
    const map = { vertical: { left: 'right', right: 'left' }, horizontal: { top: 'bottom', bottom: 'top' } };
    return map[mirror.axis][mirror.keepSide];
  }

  async aiCompleteAndRestore() {
    this.app.showLoading();
    this._setFaceProgress(0, 'Analyzing image…');
    const loadingP = document.querySelector('#loading p');
    if (loadingP) loadingP.textContent = 'Starting full forensic pipeline…';
    await this._yield();

    let mirrored = false;
    let mirrorInfo = { needed: false };
    let faceCount = 0;

    try {
      let flat = this._getFlatImageData();
      mirrorInfo = ForensicsEngine.detectMirrorNeeded(flat);

      if (mirrorInfo.needed) {
        const fillSide = this._mirrorFillLabel(mirrorInfo);
        this._setFaceProgress(10, `Completing missing ${fillSide} half…`);
        if (loadingP) loadingP.textContent = `Mirroring visible half to fill ${fillSide} side…`;
        await this._yield();
        flat = ForensicsEngine.mirrorComplete(flat, mirrorInfo.axis, mirrorInfo.keepSide);
        mirrored = true;
      }

      this._setFaceProgress(18, 'AI face reconstruction…');
      const onProgress = (pct, msg) => {
        const mapped = 18 + pct * 0.52;
        this._setFaceProgress(mapped, msg);
        if (loadingP) loadingP.textContent = msg;
      };

      const restored = await faceRestore.restore(flat, onProgress);
      faceCount = restored.faceCount;
      let result = faceCount > 0 ? restored.imageData : flat;

      this._setFaceProgress(72, '2× enhance — upscaling & sharpening…');
      if (loadingP) loadingP.textContent = 'Applying 2× forensic resolution enhance…';
      await this._yield();
      result = ForensicsEngine.enhanceFull(result, 2);
      this._setFaceProgress(95, 'Finalizing…');

      this.engine.applyImageData(result);
      this.app.pushHistory();
      this.app.fitToScreen();
      this.app.render();

      const parts = [];
      if (mirrored) parts.push(`filled ${this._mirrorFillLabel(mirrorInfo)} half`);
      if (faceCount > 0) parts.push(`restored ${faceCount} face${faceCount > 1 ? 's' : ''}`);
      parts.push(`2× enhanced to ${result.width}×${result.height}`);
      this.app.showToast(parts.join(' · '), 'success');
    } catch (err) {
      console.error('Complete & restore failed:', err);
      this.app.showToast('Failed — check internet for first-time AI model download');
    } finally {
      this._setFaceProgress(null, '');
      if (loadingP) loadingP.textContent = 'Processing image…';
      this.app.hideLoading();
    }
  }

  async aiFaceRestoreOnly() {
    this.app.showLoading();
    this._setFaceProgress(0, 'Initializing AI face reconstruction…');
    const loadingP = document.querySelector('#loading p');
    if (loadingP) loadingP.textContent = 'Loading GFPGAN AI models…';
    await this._yield();
    try {
      const { imageData, faceCount } = await faceRestore.restore(this._getFlatImageData(), (pct, msg) => {
        this._setFaceProgress(pct, msg);
        if (loadingP) loadingP.textContent = msg;
      });
      if (faceCount === 0) {
        this.app.showToast('No faces detected — try Complete & Restore Face for half-cut images');
        return;
      }
      this.engine.applyImageData(imageData);
      this.app.pushHistory();
      this.app.render();
      this.app.showToast(`AI reconstructed ${faceCount} face${faceCount > 1 ? 's' : ''} with GFPGAN`, 'success');
    } catch (err) {
      console.error('Face restore failed:', err);
      this.app.showToast('AI face restore failed — check internet connection for first-time model download');
    } finally {
      this._setFaceProgress(null, '');
      if (loadingP) loadingP.textContent = 'Processing image…';
      this.app.hideLoading();
    }
  }

  async oneClickEnhance(factor = 2) {
    this.app.showLoading();
    document.querySelector('#loading p').textContent = 'Forensic enhancement — upscaling & recovering detail…';
    await this._yield();
    try {
      const flat = this._getFlatImageData();
      const enhanced = ForensicsEngine.enhanceFull(flat, factor);
      this.engine.applyImageData(enhanced);
      this.app.pushHistory();
      this.app.fitToScreen();
      this.app.render();
      this.app.showToast(`Image enhanced to ${enhanced.width}×${enhanced.height}`, 'success');
    } finally {
      document.querySelector('#loading p').textContent = 'Processing image…';
      this.app.hideLoading();
    }
  }

  async enhanceRegion() {
    const sel = this.getSelection();
    if (!sel) { this.app.showToast('Drag to select a region first (face, blur, etc.)'); return; }
    this.app.showLoading();
    document.querySelector('#loading p').textContent = 'Enhancing selected region…';
    await this._yield();
    try {
      const flat = this._getFlatImageData();
      const result = ForensicsEngine.enhanceRegion(flat, sel.x, sel.y, sel.w, sel.h);
      this.engine.applyImageData(result);
      this.app.pushHistory();
      this.app.render();
      this.app.showToast('Region enhanced — deblur + detail recovery applied', 'success');
    } finally {
      document.querySelector('#loading p').textContent = 'Processing image…';
      this.app.hideLoading();
    }
  }

  async deblurRegion() {
    const sel = this.getSelection();
    if (!sel) { this.app.showToast('Select the blurred area first'); return; }
    this.app.showLoading();
    await this._yield();
    try {
      const flat = this._getFlatImageData();
      const result = ForensicsEngine.deblurRegion(flat, sel.x, sel.y, sel.w, sel.h, 8);
      this.engine.applyImageData(result);
      this.app.pushHistory();
      this.app.render();
      this.app.showToast('Deblur applied to selection', 'success');
    } finally {
      this.app.hideLoading();
    }
  }

  async reconstructMask() {
    if (!this.hasMask()) { this.app.showToast('Paint over the missing or damaged area first'); return; }
    this.app.showLoading();
    document.querySelector('#loading p').textContent = 'Reconstructing from surrounding pixels…';
    await this._yield();
    try {
      const flat = this._getFlatImageData();
      const mask = this.getMask();
      const result = ForensicsEngine.inpaint(flat, mask, 9);
      this.engine.applyImageData(result);
      this.clearMask();
      this.app.pushHistory();
      this.app.render();
      this.app.showToast('Area reconstructed from surrounding texture', 'success');
    } finally {
      document.querySelector('#loading p').textContent = 'Processing image…';
      this.app.hideLoading();
    }
  }

  async mirrorComplete(axis, keepSide) {
    this.app.showLoading();
    document.querySelector('#loading p').textContent = 'Completing image via symmetry…';
    await this._yield();
    try {
      const flat = this._getFlatImageData();
      const result = ForensicsEngine.mirrorComplete(flat, axis, keepSide);
      this.engine.applyImageData(result);
      this.app.pushHistory();
      this.app.render();
      this.app.showToast('Symmetric half generated — check result against original', 'success');
    } finally {
      document.querySelector('#loading p').textContent = 'Processing image…';
      this.app.hideLoading();
    }
  }

  _getFlatImageData() {
    const canvas = document.createElement('canvas');
    this.engine.renderToCanvas(canvas);
    const ctx = canvas.getContext('2d');
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  _yield() {
    return new Promise(r => setTimeout(r, 40));
  }
}