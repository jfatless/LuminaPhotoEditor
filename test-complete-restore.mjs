import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = 9876;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const file = join(ROOT, path.replace(/^\//, ''));
      try {
        const data = readFileSync(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404).end('Not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function runPipeline(page, imagePath, label) {
  const result = { label, before: null, after: null, toast: '', ok: false };

  const onEditor = await page.evaluate(() => !document.getElementById('editor')?.classList.contains('hidden'));
  if (onEditor) {
    page.once('dialog', d => d.accept());
    await page.locator('#homeBtn').click();
    await page.waitForSelector('#welcome:not(.hidden)', { timeout: 5000 });
  }

  await page.locator('#openBtn').click();
  await page.locator('#fileInput').setInputFiles(imagePath);
  await page.waitForSelector('#editor:not(.hidden)', { timeout: 15000 });
  await page.waitForFunction(() => window.app?.engine?.width > 0, null, { timeout: 10000 });

  result.before = await page.evaluate(() => ({ w: app.engine.width, h: app.engine.height }));

  await page.locator('[data-tool="forensics"]').click();
  await page.locator('#aiCompleteRestoreBtn').click();

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    const toast = document.getElementById('toast');
    return loading?.classList.contains('hidden') && toast?.classList.contains('show');
  }, null, { timeout: 600000 });

  result.toast = await page.evaluate(() => document.getElementById('toast')?.textContent?.trim() || '');
  result.after = await page.evaluate(() => ({ w: app.engine.width, h: app.engine.height }));
  result.ok = !/failed/i.test(result.toast) && /2× enhanced|enhanced to/i.test(result.toast);
  return result;
}

async function main() {
  const cases = [
    { path: join(ROOT, 'test-assets', 'half-face-test.png'), label: 'half-image (mirror + 2x)' }
  ];
  const facePath = join(ROOT, 'test-assets', 'face-full.jpg');
  if (existsSync(facePath)) {
    cases.push({ path: facePath, label: 'real face (AI + 2x)' });
  }

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  console.log('=== Lumina Complete Restore 2x E2E ===\n');

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => typeof LuminaApp !== 'undefined', null, { timeout: 15000 });

    const results = [];
    for (const c of cases) {
      console.log(`Running: ${c.label}`);
      const r = await runPipeline(page, c.path, c.label);
      results.push(r);
      const doubled = r.after.w === r.before.w * 2 && r.after.h === r.before.h * 2;
      console.log(`  ${r.before.w}×${r.before.h} → ${r.after.w}×${r.after.h}`);
      console.log(`  Toast: ${r.toast}`);
      console.log(`  2× upscale: ${doubled ? 'yes' : 'no'}`);
      console.log('');
    }

    const allOk = results.every(r => r.ok);
    const faceCase = results.find(r => r.label.includes('real face'));
    if (faceCase && !/restored/i.test(faceCase.toast)) {
      console.log('NOTE: Face restore did not report restored faces (model may need larger/clearer face).');
    }

    if (errors.length) {
      console.log('Page errors:', errors);
      process.exitCode = 1;
    } else if (allOk) {
      console.log('RESULT: PASS — all pipeline cases completed');
      process.exitCode = 0;
    } else {
      console.log('RESULT: FAIL — one or more cases failed');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('TEST ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

main();
