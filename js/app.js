class LuminaApp {
  constructor() {
    this.engine = new ImageEngine();
    this.history = [];
    this.historyIndex = -1;
    this.zoom = 1;
    this.currentTool = 'adjust';
    this.exportFormat = 'png';
    this.comparing = false;
    this.renderScheduled = false;
    this.panning = false;
    this.spaceHeld = false;
    this.panStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };

    this.mainCanvas = document.getElementById('mainCanvas');
    this.overlayCanvas = document.getElementById('overlayCanvas');
    this.canvasArea = document.getElementById('canvasArea');
    this.canvasScroll = document.getElementById('canvasScroll');
    this.canvasWrapper = document.getElementById('canvasWrapper');
    this.compareCanvas = null;

    this.cropTool = new CropTool(
      document.getElementById('cropOverlay'),
      this.engine,
      () => { this.pushHistory(); this.fitToScreen(); this.render(); }
    );
    this.drawTool = new DrawTool(
      this.overlayCanvas,
      this.engine,
      () => { this.pushHistory(); this.render(); }
    );
    this.textTool = new TextTool(
      this.canvasArea,
      this.engine,
      () => { this.pushHistory(); this.render(); }
    );
    this.ocrTool = new OCRTool(
      document.getElementById('ocrOverlay'),
      this.engine,
      this
    );
    this.forensicsTool = new ForensicsTool(
      document.getElementById('forensicsOverlay'),
      document.getElementById('forensicsMaskCanvas'),
      this.engine,
      this
    );

    this._buildAdjustSliders();
    this._buildFilterGrid();
    this._bindEvents();
  }

  _rebindEngine() {
    this.cropTool.engine = this.engine;
    this.drawTool.engine = this.engine;
    this.textTool.engine = this.engine;
    this.ocrTool.engine = this.engine;
    this.forensicsTool.engine = this.engine;
  }

  _scheduleRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  showToast(msg, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  showLoading() { document.getElementById('loading').classList.remove('hidden'); }
  hideLoading() { document.getElementById('loading').classList.add('hidden'); }

  _buildAdjustSliders() {
    const container = document.getElementById('adjustSliders');
    ADJUSTMENT_DEFS.forEach(adj => {
      const group = document.createElement('div');
      group.className = 'slider-group';
      group.innerHTML = `
        <label>${adj.label} <span id="val-${adj.id}">${adj.default}</span></label>
        <input type="range" id="adj-${adj.id}" min="${adj.min}" max="${adj.max}" value="${adj.default}" step="${adj.step || 1}">
      `;
      container.appendChild(group);

      const slider = group.querySelector('input');
      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        document.getElementById(`val-${adj.id}`).textContent =
          adj.id === 'blur' ? val.toFixed(1) : Math.round(val);
        this.engine.setAdjustment(adj.id, val);
        this._updateFilterSelection('custom');
        this._scheduleRender();
      });
      slider.addEventListener('change', () => this.pushHistory());
    });
  }

  _buildFilterGrid() {
    const grid = document.getElementById('filterGrid');
    Object.entries(FILTER_PRESETS).forEach(([id, preset]) => {
      const card = document.createElement('div');
      card.className = `filter-card${id === 'original' ? ' active' : ''}`;
      card.dataset.filter = id;
      const thumb = document.createElement('canvas');
      thumb.width = 80;
      thumb.height = 80;
      card.appendChild(thumb);
      const label = document.createElement('span');
      label.textContent = preset.label;
      card.appendChild(label);
      grid.appendChild(card);

      card.addEventListener('click', () => {
        this.engine.applyFilter(id);
        this._syncUIToEngine();
        this._updateFilterSelection(id);
        this.pushHistory();
        this.render();
        this._updateFilterThumbnails();
      });
    });
  }

  _updateFilterSelection(activeId) {
    document.querySelectorAll('.filter-card').forEach(c => {
      c.classList.toggle('active', activeId !== 'custom' && activeId !== 'auto' && c.dataset.filter === activeId);
    });
  }

  _syncUIToEngine() {
    ADJUSTMENT_DEFS.forEach(adj => {
      const slider = document.getElementById(`adj-${adj.id}`);
      const val = this.engine.adjustments[adj.id];
      slider.value = val;
      document.getElementById(`val-${adj.id}`).textContent =
        adj.id === 'blur' ? val.toFixed(1) : Math.round(val);
    });
    const straighten = this.engine.straighten;
    document.getElementById('straightenSlider').value = straighten;
    document.getElementById('straightenVal').textContent = straighten + '┬░';
  }

  _updateFilterThumbnails() {
    if (!this.engine.originalImageData) return;
    document.querySelectorAll('.filter-card').forEach(card => {
      const thumb = card.querySelector('canvas');
      const ctx = thumb.getContext('2d');
      const preset = FILTER_PRESETS[card.dataset.filter];

      const tempEngine = new ImageEngine();
      const img = new Image();
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = this.engine.width;
      srcCanvas.height = this.engine.height;
      srcCanvas.getContext('2d').putImageData(this.engine.originalImageData, 0, 0);

      img.onload = () => {
        tempEngine.loadImage(img);
        if (preset.adjustments) {
          Object.entries(preset.adjustments).forEach(([k, v]) => {
            tempEngine.adjustments[k] = v;
          });
        }
        const size = 80;
        const renderCanvas = document.createElement('canvas');
        tempEngine.renderToCanvas(renderCanvas);
        const scale = Math.min(size / renderCanvas.width, size / renderCanvas.height);
        const tw = renderCanvas.width * scale;
        const th = renderCanvas.height * scale;
        ctx.fillStyle = '#1a1a20';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(renderCanvas, (size - tw) / 2, (size - th) / 2, tw, th);
      };
      img.src = srcCanvas.toDataURL();
    });
  }

  _bindEvents() {
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');

    document.getElementById('openBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) this.loadFile(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', e => {
      if (e.target.id !== 'openBtn') fileInput.click();
    });

    document.getElementById('homeBtn').addEventListener('click', () => this.goHome());
    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());
    document.getElementById('zoomInBtn').addEventListener('click', () => this.setZoom(this.zoom * 1.25));
    document.getElementById('zoomOutBtn').addEventListener('click', () => this.setZoom(this.zoom / 1.25));
    document.getElementById('fitBtn').addEventListener('click', () => this.fitToScreen());

    const compareBtn = document.getElementById('compareBtn');
    compareBtn.addEventListener('mousedown', () => { this.comparing = true; this.render(); });
    compareBtn.addEventListener('mouseup', () => { this.comparing = false; this.render(); });
    compareBtn.addEventListener('mouseleave', () => { this.comparing = false; this.render(); });

    document.getElementById('exportBtn').addEventListener('click', () => this.showExportModal());
    document.getElementById('cancelExportBtn').addEventListener('click', () => this.hideExportModal());
    document.getElementById('confirmExportBtn').addEventListener('click', () => this.exportImage());
    document.querySelector('#exportModal .modal-backdrop').addEventListener('click', () => this.hideExportModal());

    document.querySelectorAll('#exportModal .format-btns .chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#exportModal .format-btns .chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.exportFormat = btn.dataset.format;
        document.getElementById('qualityGroup').style.display = this.exportFormat === 'png' ? 'none' : 'block';
        this._updateExportInfo();
      });
    });

    document.getElementById('qualitySlider').addEventListener('input', e => {
      document.getElementById('qualityVal').textContent = e.target.value + '%';
      this._updateExportInfo();
    });

    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    });

    document.getElementById('autoEnhanceBtn').addEventListener('click', () => {
      this.engine.autoEnhance();
      this._syncUIToEngine();
      this._updateFilterSelection('auto');
      this.pushHistory();
      this.render();
      this.showToast('Auto enhance applied', 'success');
    });

    document.getElementById('resetAdjustBtn').addEventListener('click', () => {
      this.engine.resetAdjustments();
      this._syncUIToEngine();
      this._updateFilterSelection('original');
      this.pushHistory();
      this.render();
    });

    document.getElementById('rotateLeftBtn').addEventListener('click', () => {
      this.engine.rotate(-90);
      this.pushHistory();
      this._applyZoom();
      this.render();
    });
    document.getElementById('rotateRightBtn').addEventListener('click', () => {
      this.engine.rotate(90);
      this.pushHistory();
      this._applyZoom();
      this.render();
    });
    document.getElementById('flipHBtn').addEventListener('click', () => {
      this.engine.flip('h');
      this.pushHistory();
      this.render();
    });
    document.getElementById('flipVBtn').addEventListener('click', () => {
      this.engine.flip('v');
      this.pushHistory();
      this.render();
    });

    document.getElementById('straightenSlider').addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      document.getElementById('straightenVal').textContent = val + '┬░';
      this.engine.setStraighten(val);
      this._applyZoom();
      this._scheduleRender();
    });
    document.getElementById('straightenSlider').addEventListener('change', () => this.pushHistory());

    document.querySelectorAll('#aspectRatios .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#aspectRatios .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.cropTool.setRatio(chip.dataset.ratio);
      });
    });
    document.getElementById('applyCropBtn').addEventListener('click', () => this.cropTool.apply());
    document.getElementById('cancelCropBtn').addEventListener('click', () => {
      this.cropTool.deactivate();
      this.setTool('adjust');
    });

    document.getElementById('brushColor').addEventListener('input', e => this.drawTool.setColor(e.target.value));
    document.getElementById('brushSize').addEventListener('input', e => {
      this.drawTool.setSize(parseInt(e.target.value));
      document.getElementById('brushSizeVal').textContent = e.target.value + 'px';
    });
    document.getElementById('brushOpacity').addEventListener('input', e => {
      this.drawTool.setOpacity(parseInt(e.target.value));
      document.getElementById('brushOpacityVal').textContent = e.target.value + '%';
    });
    document.getElementById('clearDrawBtn').addEventListener('click', () => this.drawTool.clear());

    document.getElementById('brushModeBtn').addEventListener('click', () => {
      this.drawTool.setEraser(false);
      document.getElementById('brushModeBtn').classList.add('active');
      document.getElementById('eraserModeBtn').classList.remove('active');
      document.getElementById('brushColorRow').classList.remove('hidden');
    });
    document.getElementById('eraserModeBtn').addEventListener('click', () => {
      this.drawTool.setEraser(true);
      document.getElementById('eraserModeBtn').classList.add('active');
      document.getElementById('brushModeBtn').classList.remove('active');
      document.getElementById('brushColorRow').classList.add('hidden');
    });

    document.getElementById('helpBtn').addEventListener('click', () => this.showHelp());
    document.getElementById('closeHelpBtn').addEventListener('click', () => this.hideHelp());
    document.querySelector('#helpModal .modal-backdrop').addEventListener('click', () => this.hideHelp());

    document.getElementById('ocrScanBtn').addEventListener('click', () => this.ocrTool.scan());
    document.getElementById('ocrCopyAllBtn').addEventListener('click', () => this.ocrTool.copyAllText());
    document.getElementById('ocrCopySelBtn').addEventListener('click', () => this.ocrTool.copySelectedText());
    document.getElementById('ocrClearBtn').addEventListener('click', () => this.ocrTool.clearResults());
    document.getElementById('ocrSaveIsolateBtn').addEventListener('click', () => this.ocrTool.saveIsolatedImage());
    document.getElementById('ocrLanguage').addEventListener('change', e => this.ocrTool.setLanguage(e.target.value));
    document.getElementById('ocrModeFull').addEventListener('click', () => {
      document.getElementById('ocrModeFull').classList.add('active');
      document.getElementById('ocrModeRegion').classList.remove('active');
      this.ocrTool.setMode('full');
      this.ocrTool.clearResults();
    });
    document.getElementById('ocrModeRegion').addEventListener('click', () => {
      document.getElementById('ocrModeRegion').classList.add('active');
      document.getElementById('ocrModeFull').classList.remove('active');
      this.ocrTool.setMode('region');
      this.ocrTool.clearResults();
    });

    document.getElementById('aiCompleteRestoreBtn').addEventListener('click', () => this.forensicsTool.aiCompleteAndRestore());
    document.getElementById('aiFaceRestoreBtn').addEventListener('click', () => this.forensicsTool.aiFaceRestoreOnly());
    document.getElementById('forensicOneClickBtn').addEventListener('click', () => this.forensicsTool.oneClickEnhance(2));
    document.getElementById('forensic4xBtn').addEventListener('click', () => this.forensicsTool.oneClickEnhance(4));
    document.getElementById('forensicClaheBtn').addEventListener('click', async () => {
      this.showLoading();
      await new Promise(r => setTimeout(r, 40));
      const canvas = document.createElement('canvas');
      this.engine.renderToCanvas(canvas);
      const ctx = canvas.getContext('2d');
      const flat = ctx.getImageData(0, 0, canvas.width, canvas.height);
      this.engine.applyImageData(ForensicsEngine.applyCLAHE(flat, 64, 3));
      this.pushHistory();
      this.render();
      this.hideLoading();
      this.showToast('CLAHE forensic contrast applied', 'success');
    });
    document.getElementById('forensicSelectBtn').addEventListener('click', () => {
      document.getElementById('forensicSelectBtn').classList.add('active');
      document.getElementById('forensicMaskBtn').classList.remove('active');
      document.getElementById('forensicBrushGroup').classList.add('hidden');
      this.forensicsTool.setSubMode('select');
    });
    document.getElementById('forensicMaskBtn').addEventListener('click', () => {
      document.getElementById('forensicMaskBtn').classList.add('active');
      document.getElementById('forensicSelectBtn').classList.remove('active');
      document.getElementById('forensicBrushGroup').classList.remove('hidden');
      this.forensicsTool.setSubMode('mask');
    });
    document.getElementById('forensicBrush').addEventListener('input', e => {
      this.forensicsTool.setBrushSize(parseInt(e.target.value));
      document.getElementById('forensicBrushVal').textContent = e.target.value + 'px';
    });
    document.getElementById('forensicEnhanceRegionBtn').addEventListener('click', () => this.forensicsTool.enhanceRegion());
    document.getElementById('forensicDeblurBtn').addEventListener('click', () => this.forensicsTool.deblurRegion());
    document.getElementById('forensicReconstructBtn').addEventListener('click', () => this.forensicsTool.reconstructMask());
    document.getElementById('forensicClearMaskBtn').addEventListener('click', () => this.forensicsTool.clearMask());
    document.getElementById('mirrorRightBtn').addEventListener('click', () => this.forensicsTool.mirrorComplete('vertical', 'left'));
    document.getElementById('mirrorLeftBtn').addEventListener('click', () => this.forensicsTool.mirrorComplete('vertical', 'right'));
    document.getElementById('mirrorBottomBtn').addEventListener('click', () => this.forensicsTool.mirrorComplete('horizontal', 'top'));
    document.getElementById('mirrorTopBtn').addEventListener('click', () => this.forensicsTool.mirrorComplete('horizontal', 'bottom'));

    document.getElementById('textInput').addEventListener('input', e => this.textTool.setText(e.target.value));
    document.getElementById('textColor').addEventListener('input', e => this.textTool.setColor(e.target.value));
    document.getElementById('textSize').addEventListener('input', e => {
      this.textTool.setSize(parseInt(e.target.value));
      document.getElementById('textSizeVal').textContent = e.target.value + 'px';
    });
    document.getElementById('textFont').addEventListener('change', e => this.textTool.setFont(e.target.value));

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.redo(); }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); this.showExportModal(); }
      if (e.key === '+' || e.key === '=') this.setZoom(this.zoom * 1.25);
      if (e.key === '-') this.setZoom(this.zoom / 1.25);
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); this.showHelp(); }
      if (e.code === 'Space' && !this.spaceHeld) {
        e.preventDefault();
        this.spaceHeld = true;
        this.canvasArea.classList.add('panning');
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        this.panning = false;
        this.canvasArea.classList.remove('panning');
      }
    });

    this.canvasArea.addEventListener('wheel', e => {
      if (!this.engine.originalImageData) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.setZoom(this.zoom * delta);
    }, { passive: false });

    this.canvasArea.addEventListener('mousedown', e => {
      if (!this.spaceHeld || e.button !== 0) return;
      this.panning = true;
      this.panStart = {
        x: e.clientX, y: e.clientY,
        scrollX: this.canvasScroll.scrollLeft,
        scrollY: this.canvasScroll.scrollTop
      };
    });
    document.addEventListener('mousemove', e => {
      if (!this.panning) return;
      this.canvasScroll.scrollLeft = this.panStart.scrollX - (e.clientX - this.panStart.x);
      this.canvasScroll.scrollTop = this.panStart.scrollY - (e.clientY - this.panStart.y);
    });
    document.addEventListener('mouseup', () => { this.panning = false; });

    window.addEventListener('resize', () => {
      if (this.engine.originalImageData) this._applyZoom();
    });
  }

  showHelp() { document.getElementById('helpModal').classList.remove('hidden'); }
  hideHelp() { document.getElementById('helpModal').classList.add('hidden'); }

  loadFile(file) {
    if (!file.type.startsWith('image/')) {
      this.showToast('Please select an image file');
      return;
    }
    this.showLoading();
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        setTimeout(() => {
          this.engine.loadImage(img);
          this.history = [];
          this.historyIndex = -1;
          this.pushHistory();
          document.getElementById('fileName').textContent = file.name;
          document.getElementById('welcome').classList.add('hidden');
          document.getElementById('editor').classList.remove('hidden');
          this.setTool('adjust');
          this.fitToScreen();
          this._updateFilterThumbnails();
          this.hideLoading();
          this.showToast(`Loaded ${file.name}`, 'success');
        }, 50);
      };
      img.onerror = () => { this.hideLoading(); this.showToast('Failed to load image'); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  goHome() {
    if (this.engine.originalImageData && !confirm('Start a new image? Unsaved changes will be lost.')) return;
    document.getElementById('editor').classList.add('hidden');
    document.getElementById('welcome').classList.remove('hidden');
    this.engine = new ImageEngine();
    this._rebindEngine();
    this.history = [];
    this.historyIndex = -1;
    this.compareCanvas = null;
    document.getElementById('fileInput').value = '';
  }

  setTool(tool) {
    this.cropTool.deactivate();
    this.drawTool.deactivate();
    this.textTool.deactivate();
    this.ocrTool.deactivate();
    this.forensicsTool.deactivate();
    this.canvasArea.classList.remove('drawing', 'text-mode', 'ocr-mode', 'forensics-mode');

    this.currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    document.querySelectorAll('.panel-section').forEach(p => {
      p.classList.toggle('hidden', p.dataset.panel !== tool);
    });

    if (tool === 'crop') this.cropTool.activate();
    if (tool === 'draw') {
      this.drawTool.activate();
      this.canvasArea.classList.add('drawing');
    }
    if (tool === 'text') {
      this.textTool.activate();
      this.canvasArea.classList.add('text-mode');
    }
    if (tool === 'ocr') {
      this.ocrTool.activate();
      this.canvasArea.classList.add('ocr-mode');
      document.getElementById('panel').classList.add('panel-wide');
    } else if (tool === 'forensics') {
      this.forensicsTool.activate();
      this.canvasArea.classList.add('forensics-mode');
      document.getElementById('panel').classList.add('panel-wide');
      document.getElementById('forensicBrushGroup').classList.add('hidden');
    } else {
      document.getElementById('panel').classList.remove('panel-wide');
    }
    this.render();
  }

  pushHistory() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.engine.getSnapshot());
    this.historyIndex = this.history.length - 1;
    if (this.history.length > 50) {
      this.history.shift();
      this.historyIndex--;
    }
    this._updateHistoryButtons();
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.engine.restoreSnapshot(this.history[this.historyIndex]);
    this._syncUIToEngine();
    this._updateFilterSelection(this.engine.activeFilter);
    this._updateHistoryButtons();
    this._applyZoom();
    this.render();
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this.engine.restoreSnapshot(this.history[this.historyIndex]);
    this._syncUIToEngine();
    this._updateFilterSelection(this.engine.activeFilter);
    this._updateHistoryButtons();
    this._applyZoom();
    this.render();
  }

  _updateHistoryButtons() {
    document.getElementById('undoBtn').disabled = this.historyIndex <= 0;
    document.getElementById('redoBtn').disabled = this.historyIndex >= this.history.length - 1;
  }

  setZoom(level) {
    this.zoom = Math.max(0.1, Math.min(8, level));
    document.getElementById('zoomLabel').textContent = Math.round(this.zoom * 100) + '%';
    document.getElementById('panHint').classList.toggle('hidden', this.zoom <= 1);
    this._applyZoom();
  }

  fitToScreen() {
    const dims = this.engine.getOutputDimensions();
    if (!dims.width) return;
    const area = this.canvasArea.getBoundingClientRect();
    const padding = 40;
    const scaleX = (area.width - padding) / dims.width;
    const scaleY = (area.height - padding) / dims.height;
    this.zoom = Math.min(scaleX, scaleY, 1);
    document.getElementById('zoomLabel').textContent = Math.round(this.zoom * 100) + '%';
    this._applyZoom();
  }

  _applyZoom() {
    const dims = this.engine.getOutputDimensions();
    const w = dims.width * this.zoom;
    const h = dims.height * this.zoom;
    this.canvasWrapper.style.width = w + 'px';
    this.canvasWrapper.style.height = h + 'px';
    this.mainCanvas.style.width = w + 'px';
    this.mainCanvas.style.height = h + 'px';
    this.overlayCanvas.style.width = w + 'px';
    this.overlayCanvas.style.height = h + 'px';

    this.cropTool.setTransform(this.zoom);
    this.ocrTool.setTransform(this.zoom);
    this.forensicsTool.setTransform(this.zoom);
    const fMask = document.getElementById('forensicsMaskCanvas');
    if (fMask) {
      fMask.style.width = w + 'px';
      fMask.style.height = h + 'px';
    }
    this.render();
  }

  render() {
    if (!this.engine.originalImageData) return;
    this.engine.renderToCanvas(this.mainCanvas, false);

    if (this.comparing) {
      if (!this.compareCanvas) {
        this.compareCanvas = document.createElement('canvas');
        this.compareCanvas.className = 'compare-original';
        this.canvasWrapper.appendChild(this.compareCanvas);
      }
      this.engine.renderToCanvas(this.compareCanvas, true);
      const dims = this.engine.getOutputDimensions();
      this.compareCanvas.style.width = dims.width * this.zoom + 'px';
      this.compareCanvas.style.height = dims.height * this.zoom + 'px';
      this.compareCanvas.style.display = 'block';
      this.canvasArea.classList.add('comparing');
    } else {
      this.canvasArea.classList.remove('comparing');
      if (this.compareCanvas) this.compareCanvas.style.display = 'none';
    }
  }

  showExportModal() {
    document.getElementById('exportModal').classList.remove('hidden');
    document.getElementById('qualityGroup').style.display = this.exportFormat === 'png' ? 'none' : 'block';
    this._updateExportInfo();
  }

  hideExportModal() {
    document.getElementById('exportModal').classList.add('hidden');
  }

  _updateExportInfo() {
    const dims = this.engine.getOutputDimensions();
    const info = document.getElementById('exportInfo');
    info.textContent = `${dims.width} ├ù ${dims.height} pixels ┬╖ ${this.exportFormat.toUpperCase()}`;
  }

  exportImage() {
    const quality = document.getElementById('qualitySlider').value / 100;
    const dataUrl = this.engine.exportImage(this.exportFormat, quality);
    const name = document.getElementById('fileName').textContent.replace(/\.[^.]+$/, '');
    const ext = this.exportFormat === 'jpeg' ? 'jpg' : this.exportFormat;
    const link = document.createElement('a');
    link.download = `${name}-edited.${ext}`;
    link.href = dataUrl;
    link.click();
    this.hideExportModal();
    this.showToast(`Saved ${name}-edited.${ext}`, 'success');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new LuminaApp();
});