class OCRTool {
  constructor(overlayEl, engine, app) {
    this.overlay = overlayEl;
    this.engine = engine;
    this.app = app;
    this.active = false;
    this.scale = 1;
    this.scanning = false;
    this.worker = null;
    this.mode = 'full';
    this.language = 'eng';
    this.words = [];
    this.lines = [];
    this.fullText = '';
    this.selectedIndex = -1;
    this.region = null;
    this.regionDrag = null;
    this.offsetX = 0;
    this.offsetY = 0;
    this._bindEvents();
  }

  setTransform(scale) {
    this.scale = scale;
    if (this.words.length) this._renderBoxes();
    else if (this.region) this._renderRegion();
  }

  setMode(mode) {
    this.mode = mode;
    this.region = null;
    this._clearOverlay();
    if (mode === 'region') this._renderRegionHint();
  }

  setLanguage(lang) { this.language = lang; }

  activate() {
    this.active = true;
    this.overlay.classList.remove('hidden');
    if (this.words.length) this._renderBoxes();
    else if (this.mode === 'region' && !this.region) this._renderRegionHint();
    else if (this.region) this._renderRegion();
  }

  deactivate() {
    this.active = false;
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.regionDrag = null;
  }

  clearResults() {
    this.words = [];
    this.lines = [];
    this.fullText = '';
    this.selectedIndex = -1;
    this.region = null;
    this._clearOverlay();
    if (this.active && this.mode === 'region') this._renderRegionHint();
    this._updatePanel();
  }

  _collectWords(data) {
    if (data.words && data.words.length) return data.words;
    const words = [];
    (data.blocks || []).forEach(block => {
      (block.paragraphs || []).forEach(p => {
        (p.lines || []).forEach(line => {
          (line.words || []).forEach(word => words.push(word));
        });
      });
    });
    return words;
  }

  _collectLines(data) {
    if (data.lines && data.lines.length) return data.lines;
    const lines = [];
    (data.blocks || []).forEach(block => {
      (block.paragraphs || []).forEach(p => {
        (p.lines || []).forEach(line => lines.push(line));
      });
    });
    return lines;
  }

  _clearOverlay() {
    this.overlay.innerHTML = '';
  }

  _bindEvents() {
    this.overlay.addEventListener('mousedown', e => this._onDown(e));
    document.addEventListener('mousemove', e => this._onMove(e));
    document.addEventListener('mouseup', () => { this.regionDrag = null; });

    this.overlay.addEventListener('touchstart', e => {
      if (this.mode !== 'region' || this.scanning) return;
      e.preventDefault();
      this._onDown(e.touches[0]);
    }, { passive: false });
    document.addEventListener('touchmove', e => {
      if (this.regionDrag) { e.preventDefault(); this._onMove(e.touches[0]); }
    }, { passive: false });
    document.addEventListener('touchend', () => { this.regionDrag = null; });
  }

  _toImageCoords(clientX, clientY) {
    const rect = this.overlay.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.scale,
      y: (clientY - rect.top) / this.scale
    };
  }

  _onDown(e) {
    if (!this.active || this.scanning) return;

    if (this.words.length) {
      const target = e.target.closest('.ocr-box');
      if (target) {
        const idx = parseInt(target.dataset.index, 10);
        this.selectWord(idx);
        return;
      }
    }

    if (this.mode === 'region' && !this.words.length) {
      const pos = this._toImageCoords(e.clientX, e.clientY);
      this.regionDrag = { startX: pos.x, startY: pos.y, start: { ...pos } };
      e.preventDefault();
    }
  }

  _onMove(e) {
    if (!this.regionDrag || this.mode !== 'region') return;
    const pos = this._toImageCoords(e.clientX, e.clientY);
    const dims = this.engine.getOutputDimensions();
    const x = Math.max(0, Math.min(this.regionDrag.startX, pos.x));
    const y = Math.max(0, Math.min(this.regionDrag.startY, pos.y));
    let w = Math.abs(pos.x - this.regionDrag.startX);
    let h = Math.abs(pos.y - this.regionDrag.startY);
    if (x + w > dims.width) w = dims.width - x;
    if (y + h > dims.height) h = dims.height - y;
    this.region = { x, y, w: Math.max(10, w), h: Math.max(10, h) };
    this._renderRegion();
    this._updateScanButton();
  }

  _renderRegionHint() {
    this.overlay.innerHTML = '<div class="ocr-hint">Drag tightly around the text you want to read</div>';
  }

  _renderRegion() {
    if (!this.region) return;
    const { x, y, w, h } = this.region;
    this.overlay.innerHTML = `
      <div class="ocr-region" style="left:${x * this.scale}px;top:${y * this.scale}px;width:${w * this.scale}px;height:${h * this.scale}px"></div>
    `;
  }

  _renderBoxes() {
    const html = this.words.map((w, i) => {
      const { x0, y0, x1, y1 } = w.bbox;
      const left = x0 * this.scale;
      const top = y0 * this.scale;
      const width = (x1 - x0) * this.scale;
      const height = (y1 - y0) * this.scale;
      const selected = i === this.selectedIndex ? ' selected' : '';
      const conf = Math.round(w.confidence);
      return `<div class="ocr-box${selected}" data-index="${i}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px" title="${this._escape(w.text)} (${conf}%)"><span class="ocr-conf">${conf}%</span></div>`;
    }).join('');
    this.overlay.innerHTML = html;
  }

  _escape(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  selectWord(index) {
    this.selectedIndex = index;
    this._renderBoxes();
    this._updatePanel();
    this._identifyFont(index);
    const item = document.querySelector(`.ocr-result-item[data-index="${index}"]`);
    if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  _identifyFont(index) {
    const fontSection = document.getElementById('ocrFontMatch');
    const fontTop = document.getElementById('ocrFontTop');
    const fontList = document.getElementById('ocrFontList');
    const fontNote = document.getElementById('ocrFontNote');
    if (!fontSection) return;

    const w = this.words[index];
    if (!w) {
      fontSection.classList.add('hidden');
      return;
    }

    const canvas = this.getIsolatedCanvas(index);
    const matches = FontIdentifier.identify(canvas, w.text);

    if (matches.length === 0) {
      fontSection.classList.add('hidden');
      return;
    }

    const top = matches[0];
    const category = FontIdentifier.classifyCategory(top);
    fontTop.innerHTML = `
      <span class="ocr-font-name" style="font-family:${top.family}">${top.name}</span>
      <span class="ocr-font-meta">${top.style} · ${category} · ${top.confidence}% match</span>
    `;

    fontList.innerHTML = matches.slice(1).map(m =>
      `<li><span style="font-family:${m.family}">${m.name}</span> <em>${m.style} · ${m.confidence}%</em></li>`
    ).join('');

    if (fontNote) {
      fontNote.textContent = matches.length === 1
        ? 'One close match found. Compare visually with the isolated text above.'
        : 'Ranked by shape similarity. The top match is the most likely font.';
    }

    fontSection.classList.remove('hidden');
  }

  _getScanCanvas() {
    const canvas = document.createElement('canvas');
    this.engine.renderToCanvas(canvas);

    if (this.mode === 'region' && this.region) {
      const { x, y, w, h } = this.region;
      const cropped = document.createElement('canvas');
      cropped.width = Math.round(w);
      cropped.height = Math.round(h);
      cropped.getContext('2d').drawImage(
        canvas,
        Math.round(x), Math.round(y), Math.round(w), Math.round(h),
        0, 0, Math.round(w), Math.round(h)
      );
      return { canvas: cropped, offsetX: x, offsetY: y };
    }

    return { canvas, offsetX: 0, offsetY: 0 };
  }

  _getPSMModes() {
    if (this.mode === 'region') {
      const r = this.region;
      if (r && (r.w < r.h * 2) && r.h < 80) return [Tesseract.PSM.SINGLE_LINE, Tesseract.PSM.SINGLE_BLOCK];
      return [Tesseract.PSM.SINGLE_BLOCK, Tesseract.PSM.SPARSE_TEXT];
    }
    return [Tesseract.PSM.AUTO, Tesseract.PSM.SINGLE_BLOCK];
  }

  _parseResult(data, offsetX, offsetY, ocrScale) {
    const inv = 1 / ocrScale;
    const lines = this._collectLines(data)
      .map(line => ({
        text: OCRPreprocessor.cleanText(line.text),
        confidence: line.confidence,
        bbox: line.bbox
      }))
      .filter(l => l.text && l.confidence > 20);

    const rawWords = this._collectWords(data)
      .map(word => ({
        text: OCRPreprocessor.cleanText(word.text),
        confidence: word.confidence,
        bbox: word.bbox
      }))
      .filter(w => OCRPreprocessor.isValidToken(w.text, w.confidence));

    const items = lines.length >= rawWords.length * 0.3 ? lines : rawWords;

    const mapped = items.map(item => ({
      text: item.text,
      confidence: item.confidence,
      bbox: {
        x0: item.bbox.x0 * inv + offsetX,
        y0: item.bbox.y0 * inv + offsetY,
        x1: item.bbox.x1 * inv + offsetX,
        y1: item.bbox.y1 * inv + offsetY
      }
    }));

    const fullText = OCRPreprocessor.cleanText(data.text || mapped.map(m => m.text).join('\n'));
    const avgConf = mapped.length
      ? mapped.reduce((s, m) => s + m.confidence, 0) / mapped.length
      : 0;

    return { mapped, fullText, avgConf, count: mapped.length };
  }

  _scoreResult(result) {
    if (result.count === 0) return 0;
    const textLen = result.fullText.length;
    return result.avgConf * Math.log10(textLen + 10) * Math.sqrt(result.count);
  }

  async scan() {
    if (this.scanning || !this.engine.originalImageData) return;
    if (this.mode === 'region' && !this.region) {
      this.app.showToast('Drag tightly around the text first');
      return;
    }
    if (typeof Tesseract === 'undefined') {
      this.app.showToast('OCR engine loading — please wait and try again');
      return;
    }

    this.scanning = true;
    this.words = [];
    this.lines = [];
    this.selectedIndex = -1;
    this._updatePanel();
    this._setProgress(0, 'Enhancing image…');

    const { canvas, offsetX, offsetY } = this._getScanCanvas();
    this.offsetX = offsetX;
    this.offsetY = offsetY;

    try {
      if (this.worker) {
        await this.worker.terminate();
        this.worker = null;
      }

      this.worker = await Tesseract.createWorker(this.language, 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            this._setProgress(Math.round((m.progress || 0) * 100), 'Reading text…');
          } else if (m.status) {
            this._setProgress(null, m.status.replace(/-/g, ' ') + '…');
          }
        }
      });

      await this.worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_do_invert: '0'
      });

      const variants = OCRPreprocessor.prepare(canvas);
      const psmModes = this._getPSMModes();
      let best = null;
      let bestScore = -1;
      const totalPasses = variants.length * psmModes.length;
      let pass = 0;

      for (const variant of variants) {
        for (const psm of psmModes) {
          pass++;
          this._setProgress(
            Math.round((pass / totalPasses) * 90),
            `Scanning (${variant.label}, pass ${pass}/${totalPasses})…`
          );

          await this.worker.setParameters({ tessedit_pageseg_mode: psm });
          const { data } = await this.worker.recognize(variant.canvas);
          const parsed = this._parseResult(data, offsetX, offsetY, variant.scale);
          const score = this._scoreResult(parsed);

          if (score > bestScore) {
            bestScore = score;
            best = parsed;
          }
        }
      }

      await this.worker.terminate();
      this.worker = null;

      if (!best || best.count === 0) {
        this.fullText = '';
        this.words = [];
        this._renderBoxes();
        this._updatePanel();
        this._setProgress(0, '');
        this.app.showToast('No text found — try Select Area and drag tightly around the text');
        return;
      }

      this.fullText = best.fullText;
      this.words = best.mapped;
      this.lines = best.mapped;

      this._renderBoxes();
      this._updatePanel();
      this._setProgress(100, 'Done');

      const avg = Math.round(best.mapped.reduce((s, w) => s + w.confidence, 0) / best.mapped.length);
      this.app.showToast(
        `Found ${best.count} text block${best.count !== 1 ? 's' : ''} · ${avg}% avg confidence`,
        'success'
      );
    } catch (err) {
      console.error('OCR failed:', err);
      this.app.showToast('Text detection failed — check your internet connection');
      this._setProgress(0, 'Scan failed');
    } finally {
      this.scanning = false;
      setTimeout(() => this._setProgress(null, ''), 2500);
    }
  }

  _setProgress(pct, msg) {
    const bar = document.getElementById('ocrProgressBar');
    const label = document.getElementById('ocrProgressLabel');
    const wrap = document.getElementById('ocrProgress');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !msg && pct === null);
    if (label) label.textContent = msg || '';
    if (bar) bar.style.width = (pct != null ? pct : 0) + '%';
  }

  _updateScanButton() {
    const btn = document.getElementById('ocrScanBtn');
    if (!btn) return;
    const canScan = this.mode === 'full' || (this.mode === 'region' && this.region);
    btn.disabled = this.scanning || !canScan;
  }

  _updatePanel() {
    const list = document.getElementById('ocrResultsList');
    const textarea = document.getElementById('ocrFullText');
    const preview = document.getElementById('ocrIsolatePreview');
    const isolateText = document.getElementById('ocrIsolateText');
    const count = document.getElementById('ocrResultCount');
    if (!list) return;

    if (textarea) textarea.value = this.fullText;

    if (count) {
      count.textContent = this.words.length
        ? `${this.words.length} block${this.words.length !== 1 ? 's' : ''} detected`
        : 'No text detected yet';
    }

    if (this.words.length === 0) {
      list.innerHTML = '<p class="ocr-empty">Click "Detect Text" to scan the image</p>';
      if (preview) preview.classList.add('hidden');
      this._updateScanButton();
      return;
    }

    list.innerHTML = this.words.map((w, i) => {
      const selected = i === this.selectedIndex ? ' selected' : '';
      const conf = Math.round(w.confidence);
      return `<button class="ocr-result-item${selected}" data-index="${i}" type="button">
        <span class="ocr-result-text">${this._escape(w.text)}</span>
        <span class="ocr-result-conf">${conf}%</span>
      </button>`;
    }).join('');

    list.querySelectorAll('.ocr-result-item').forEach(item => {
      item.addEventListener('click', () => this.selectWord(parseInt(item.dataset.index, 10)));
    });

    if (this.selectedIndex >= 0 && preview && isolateText) {
      const w = this.words[this.selectedIndex];
      isolateText.textContent = w.text;
      preview.classList.remove('hidden');
      const img = document.getElementById('ocrIsolateImg');
      if (img) img.src = this.getIsolatedDataUrl(this.selectedIndex);
      this._identifyFont(this.selectedIndex);
    } else if (preview) {
      preview.classList.add('hidden');
    }

    this._updateScanButton();
  }

  getIsolatedCanvas(index) {
    const w = this.words[index];
    if (!w) return null;
    const { x0, y0, x1, y1 } = w.bbox;
    const pad = 6;
    const dims = this.engine.getOutputDimensions();
    const sx = Math.max(0, Math.floor(x0) - pad);
    const sy = Math.max(0, Math.floor(y0) - pad);
    const sw = Math.min(dims.width - sx, Math.ceil(x1 - x0) + pad * 2);
    const sh = Math.min(dims.height - sy, Math.ceil(y1 - y0) + pad * 2);

    const source = document.createElement('canvas');
    this.engine.renderToCanvas(source);
    const isolated = document.createElement('canvas');
    isolated.width = sw;
    isolated.height = sh;
    isolated.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return isolated;
  }

  getIsolatedDataUrl(index) {
    const c = this.getIsolatedCanvas(index);
    return c ? c.toDataURL('image/png') : '';
  }

  copyAllText() {
    if (!this.fullText) { this.app.showToast('No text to copy'); return; }
    navigator.clipboard.writeText(this.fullText).then(() => {
      this.app.showToast('All text copied', 'success');
    });
  }

  copySelectedText() {
    if (this.selectedIndex < 0) { this.app.showToast('Click a text region first'); return; }
    const text = this.words[this.selectedIndex].text;
    navigator.clipboard.writeText(text).then(() => {
      this.app.showToast('Text copied', 'success');
    });
  }

  saveIsolatedImage() {
    if (this.selectedIndex < 0) return;
    const dataUrl = this.getIsolatedDataUrl(this.selectedIndex);
    const text = this.words[this.selectedIndex].text.slice(0, 20).replace(/[^a-z0-9]/gi, '-');
    const link = document.createElement('a');
    link.download = `text-${text || 'region'}.png`;
    link.href = dataUrl;
    link.click();
    this.app.showToast('Isolated text saved as PNG', 'success');
  }
}