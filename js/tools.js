class CropTool {
  constructor(overlayEl, engine, onApply) {
    this.overlay = overlayEl;
    this.engine = engine;
    this.onApply = onApply;
    this.active = false;
    this.ratio = null;
    this.cropBox = { x: 0, y: 0, w: 0, h: 0 };
    this.dragging = null;
    this.scale = 1;
    this._bindEvents();
  }

  setTransform(scale) {
    this.scale = scale;
  }

  setRatio(ratio) {
    if (ratio === 'free') { this.ratio = null; return; }
    const parts = ratio.split('/');
    this.ratio = parts.length === 2 ? parseFloat(parts[0]) / parseFloat(parts[1]) : parseFloat(ratio);
  }

  activate() {
    this.active = true;
    this.overlay.classList.remove('hidden');
    const dims = this.engine.getOutputDimensions();
    this.cropBox = { x: 0, y: 0, w: dims.width, h: dims.height };
    this._render();
  }

  deactivate() {
    this.active = false;
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
  }

  _screenToImage(clientX, clientY) {
    const rect = this.overlay.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.scale,
      y: (clientY - rect.top) / this.scale
    };
  }

  _render() {
    const { x, y, w, h } = this.cropBox;
    const sx = x * this.scale;
    const sy = y * this.scale;
    const sw = w * this.scale;
    const sh = h * this.scale;

    this.overlay.innerHTML = `
      <div class="crop-box" style="left:${sx}px;top:${sy}px;width:${sw}px;height:${sh}px">
        <div class="rule-of-thirds"></div>
        <div class="crop-handle nw"></div>
        <div class="crop-handle ne"></div>
        <div class="crop-handle sw"></div>
        <div class="crop-handle se"></div>
        <div class="crop-handle n"></div>
        <div class="crop-handle s"></div>
        <div class="crop-handle w"></div>
        <div class="crop-handle e"></div>
      </div>
    `;
  }

  _bindEvents() {
    this.overlay.addEventListener('mousedown', e => this._onDown(e));
    document.addEventListener('mousemove', e => this._onMove(e));
    document.addEventListener('mouseup', () => { this.dragging = null; });

    this.overlay.addEventListener('touchstart', e => { e.preventDefault(); this._onDown(e.touches[0]); }, { passive: false });
    document.addEventListener('touchmove', e => {
      if (this.dragging) { e.preventDefault(); this._onMove(e.touches[0]); }
    }, { passive: false });
    document.addEventListener('touchend', () => { this.dragging = null; });
  }

  _getHandle(e) {
    const handle = e.target.closest('.crop-handle');
    if (handle) {
      return handle.classList[1];
    }
    if (e.target.closest('.crop-box')) return 'move';
    return null;
  }

  _onDown(e) {
    if (!this.active) return;
    e.preventDefault();
    const handle = this._getHandle(e);
    if (!handle) return;
    const pos = this._screenToImage(e.clientX, e.clientY);
    this.dragging = { handle, startX: pos.x, startY: pos.y, startBox: { ...this.cropBox } };
  }

  _onMove(e) {
    if (!this.dragging || !this.active) return;
    const pos = this._screenToImage(e.clientX, e.clientY);
    const dx = pos.x - this.dragging.startX;
    const dy = pos.y - this.dragging.startY;
    const box = { ...this.dragging.startBox };
    const dims = this.engine.getOutputDimensions();
    const handle = this.dragging.handle;

    if (handle === 'move') {
      box.x = Math.max(0, Math.min(dims.width - box.w, box.x + dx));
      box.y = Math.max(0, Math.min(dims.height - box.h, box.y + dy));
    } else {
      if (handle.includes('w')) { box.x += dx; box.w -= dx; }
      if (handle.includes('e')) { box.w += dx; }
      if (handle.includes('n')) { box.y += dy; box.h -= dy; }
      if (handle.includes('s')) { box.h += dy; }

      if (this.ratio) {
        if (handle.includes('e') || handle.includes('w')) {
          box.h = box.w / this.ratio;
        } else {
          box.w = box.h * this.ratio;
        }
      }

      box.w = Math.max(20, box.w);
      box.h = Math.max(20, box.h);
      box.x = Math.max(0, box.x);
      box.y = Math.max(0, box.y);
      if (box.x + box.w > dims.width) box.w = dims.width - box.x;
      if (box.y + box.h > dims.height) box.h = dims.height - box.y;
    }

    this.cropBox = box;
    this._render();
  }

  apply() {
    const { x, y, w, h } = this.cropBox;
    this.engine.crop(x, y, w, h);
    this.deactivate();
    if (this.onApply) this.onApply();
  }
}

class DrawTool {
  constructor(overlayCanvas, engine, onUpdate) {
    this.canvas = overlayCanvas;
    this.ctx = overlayCanvas.getContext('2d');
    this.engine = engine;
    this.onUpdate = onUpdate;
    this.active = false;
    this.drawing = false;
    this.color = '#ffffff';
    this.size = 8;
    this.opacity = 1;
    this.eraser = false;
    this._bindEvents();
  }

  setEraser(on) { this.eraser = on; }

  activate() {
    this.active = true;
    if (!this.engine.drawingLayer) {
      const layer = this.engine.initDrawingLayer();
      this.canvas.width = layer.width;
      this.canvas.height = layer.height;
    } else {
      const dims = this.engine.getOutputDimensions();
      this.canvas.width = dims.width;
      this.canvas.height = dims.height;
      this.ctx.drawImage(this.engine.drawingLayer, 0, 0);
    }
  }

  deactivate() {
    this.active = false;
    this.drawing = false;
    this._syncToEngine();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setColor(c) { this.color = c; }
  setSize(s) { this.size = s; }
  setOpacity(o) { this.opacity = o / 100; }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.engine.drawingLayer = null;
    if (this.onUpdate) this.onUpdate();
  }

  _syncToEngine() {
    if (!this.engine.drawingLayer) return;
    const layerCtx = this.engine.drawingLayer.getContext('2d');
    layerCtx.clearRect(0, 0, this.engine.drawingLayer.width, this.engine.drawingLayer.height);
    layerCtx.drawImage(this.canvas, 0, 0);
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', e => this._start(e));
    this.canvas.addEventListener('mousemove', e => this._move(e));
    this.canvas.addEventListener('mouseup', () => this._end());
    this.canvas.addEventListener('mouseleave', () => this._end());

    this.canvas.addEventListener('touchstart', e => { e.preventDefault(); this._start(e.touches[0]); });
    this.canvas.addEventListener('touchmove', e => { e.preventDefault(); this._move(e.touches[0]); });
    this.canvas.addEventListener('touchend', () => this._end());
  }

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
    };
  }

  _ensureLayer() {
    if (!this.engine.drawingLayer) {
      const layer = this.engine.initDrawingLayer();
      this.canvas.width = layer.width;
      this.canvas.height = layer.height;
    }
  }

  _start(e) {
    if (!this.active) return;
    this._ensureLayer();
    this.drawing = true;
    const pos = this._getPos(e);
    this.lastPos = pos;
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
  }

  _move(e) {
    if (!this.drawing || !this.active) return;
    const pos = this._getPos(e);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = this.size;
    if (this.eraser) {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.globalAlpha = 1;
      this.ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.strokeStyle = this.color;
      this.ctx.globalAlpha = this.opacity;
    }
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
    this.lastPos = pos;
  }

  _end() {
    if (!this.drawing) return;
    this.drawing = false;
    this.ctx.globalCompositeOperation = 'source-over';
    this._syncToEngine();
    if (this.onUpdate) this.onUpdate();
  }
}

class TextTool {
  constructor(canvasArea, engine, onUpdate) {
    this.area = canvasArea;
    this.engine = engine;
    this.onUpdate = onUpdate;
    this.active = false;
    this.text = '';
    this.size = 48;
    this.color = '#ffffff';
    this.font = 'Inter, sans-serif';
    this._bindEvents();
  }

  activate() { this.active = true; }
  deactivate() { this.active = false; }

  setText(t) { this.text = t; }
  setSize(s) { this.size = s; }
  setColor(c) { this.color = c; }
  setFont(f) { this.font = f; }

  _bindEvents() {
    this.area.addEventListener('click', e => {
      if (!this.active || !this.text.trim()) return;
      const canvas = document.getElementById('mainCanvas');
      const rect = canvas.getBoundingClientRect();
      const dims = this.engine.getOutputDimensions();
      const x = (e.clientX - rect.left) * (dims.width / rect.width);
      const y = (e.clientY - rect.top) * (dims.height / rect.height);
      this.engine.addTextLayer(this.text, x, y, this.size, this.color, this.font);
      if (this.onUpdate) this.onUpdate();
    });
  }
}