const FONT_CANDIDATES = [
  { name: 'Arial', family: 'Arial, sans-serif', styles: ['normal', 'bold'] },
  { name: 'Calibri', family: 'Calibri, sans-serif', styles: ['normal', 'bold'] },
  { name: 'Segoe UI', family: '"Segoe UI", sans-serif', styles: ['normal', 'bold'] },
  { name: 'Verdana', family: 'Verdana, sans-serif', styles: ['normal', 'bold'] },
  { name: 'Tahoma', family: 'Tahoma, sans-serif', styles: ['normal', 'bold'] },
  { name: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif', styles: ['normal', 'bold'] },
  { name: 'Helvetica', family: 'Helvetica, Arial, sans-serif', styles: ['normal', 'bold'] },
  { name: 'Inter', family: 'Inter, sans-serif', styles: ['normal', 'bold'] },
  { name: 'Times New Roman', family: '"Times New Roman", serif', styles: ['normal', 'bold'] },
  { name: 'Georgia', family: 'Georgia, serif', styles: ['normal', 'bold'] },
  { name: 'Cambria', family: 'Cambria, serif', styles: ['normal', 'bold'] },
  { name: 'Palatino Linotype', family: '"Palatino Linotype", Palatino, serif', styles: ['normal', 'bold'] },
  { name: 'Garamond', family: 'Garamond, serif', styles: ['normal', 'bold'] },
  { name: 'Courier New', family: '"Courier New", monospace', styles: ['normal', 'bold'] },
  { name: 'Consolas', family: 'Consolas, monospace', styles: ['normal', 'bold'] },
  { name: 'Lucida Console', family: '"Lucida Console", monospace', styles: ['normal'] },
  { name: 'Impact', family: 'Impact, sans-serif', styles: ['normal'] },
  { name: 'Comic Sans MS', family: '"Comic Sans MS", cursive', styles: ['normal', 'bold'] },
  { name: 'Arial Black', family: '"Arial Black", sans-serif', styles: ['normal'] },
  { name: 'Franklin Gothic Medium', family: '"Franklin Gothic Medium", sans-serif', styles: ['normal'] },
  { name: 'Century Gothic', family: '"Century Gothic", sans-serif', styles: ['normal', 'bold'] },
  { name: 'Candara', family: 'Candara, sans-serif', styles: ['normal', 'bold'] },
  { name: 'Corbel', family: 'Corbel, sans-serif', styles: ['normal', 'bold'] },
  { name: 'Constantia', family: 'Constantia, serif', styles: ['normal', 'bold'] },
  { name: 'Book Antiqua', family: '"Book Antiqua", Palatino, serif', styles: ['normal', 'bold'] },
  { name: 'Lucida Sans Unicode', family: '"Lucida Sans Unicode", sans-serif', styles: ['normal'] },
  { name: 'Microsoft Sans Serif', family: '"Microsoft Sans Serif", sans-serif', styles: ['normal'] },
  { name: 'Oswald', family: 'Oswald, Impact, sans-serif', styles: ['normal', 'bold'] },
];

class FontIdentifier {
  static identify(sourceCanvas, text) {
    if (!text || !sourceCanvas || sourceCanvas.width < 4 || sourceCanvas.height < 4) {
      return [];
    }

    const cleanText = text.trim().replace(/\s+/g, ' ');
    if (!cleanText) return [];

    const scaled = OCRPreprocessor._upscale(sourceCanvas, OCRPreprocessor._optimalScale(sourceCanvas));
    const enhanced = OCRPreprocessor._enhance(scaled, { contrast: 1.5, sharpen: 0.8 });
    const target = this._binarize(enhanced);
    const baseSize = enhanced.height * 0.72;
    const sizes = [baseSize * 0.8, baseSize, baseSize * 1.15, baseSize * 1.3];
    const matchW = enhanced.width;
    const matchH = enhanced.height;

    const results = [];

    FONT_CANDIDATES.forEach(font => {
      font.styles.forEach(style => {
        let bestScore = 0;
        sizes.forEach(size => {
          const sample = this._renderSample(cleanText, font.family, style, size, matchW, matchH);
          const score = this._similarity(target, sample);
          if (score > bestScore) bestScore = score;
        });
        if (bestScore > 0.15) {
          results.push({
            name: font.name,
            family: font.family,
            style: style === 'bold' ? 'Bold' : 'Regular',
            score: bestScore
          });
        }
      });
    });

    results.sort((a, b) => b.score - a.score);

    const merged = [];
    results.forEach(r => {
      const existing = merged.find(m => m.name === r.name && m.style === r.style);
      if (!existing) merged.push({ ...r, confidence: Math.round(r.score * 100) });
      else if (r.score > existing.score) {
        existing.score = r.score;
        existing.confidence = Math.round(r.score * 100);
      }
    });

    return merged.slice(0, 5);
  }

  static _binarize(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height);
    const out = new Uint8ClampedArray(width * height);

    let sum = 0;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < img.data.length; i += 4) {
      const g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      gray[i / 4] = g;
      sum += g;
    }
    const threshold = sum / gray.length;

    for (let i = 0; i < gray.length; i++) {
      out[i] = gray[i] < threshold ? 1 : 0;
    }
    return { data: out, width, height };
  }

  static _renderSample(text, family, weight, size, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.font = `${weight} ${Math.round(size)}px ${family}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const display = text.length > 30 ? text.slice(0, 30) : text;
    ctx.fillText(display, width / 2, height / 2);
    return this._binarize(canvas);
  }

  static _similarity(a, b) {
    if (a.width !== b.width || a.height !== b.height) return 0;
    const len = a.data.length;
    let intersection = 0;
    let unionA = 0;
    let unionB = 0;

    for (let i = 0; i < len; i++) {
      if (a.data[i]) unionA++;
      if (b.data[i]) unionB++;
      if (a.data[i] && b.data[i]) intersection++;
    }

    const union = unionA + unionB - intersection;
    if (union === 0) return 0;
    return intersection / union;
  }

  static classifyCategory(topMatch) {
    if (!topMatch) return '';
    const f = topMatch.family.toLowerCase();
    if (f.includes('courier') || f.includes('consolas') || f.includes('monospace') || f.includes('lucida console')) {
      return 'Monospace';
    }
    if (f.includes('times') || f.includes('georgia') || f.includes('garamond') || f.includes('cambria') ||
        f.includes('palatino') || f.includes('constantia') || f.includes('book antiqua')) {
      return 'Serif';
    }
    if (f.includes('impact') || f.includes('arial black')) return 'Display';
    if (f.includes('comic')) return 'Casual';
    return 'Sans-serif';
  }
}