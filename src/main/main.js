import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const serverEntry = path.join(projectRoot, 'src', 'server', 'index.js');
const preloadPath = path.join(projectRoot, 'src', 'preload', 'preload.js');
const rendererPath = path.join(projectRoot, 'src', 'renderer', 'index.html');

let serverProcess;

function startServer() {
  serverProcess = fork(serverEntry, [], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  win.loadFile(rendererPath);
  win.once('ready-to-show', () => win.show());
  return win;
}

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:printReceipt', async (_event, receipt) => {
  const printWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const money = (value) => new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0
  }).format(value);

  const items = (receipt.items || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">${money(item.lineTotal)}</td>
    </tr>
  `).join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;width:320px;margin:0 auto;padding:16px;color:#111;font-size:13px}
  h1{font-size:20px;text-align:center;margin:0 0 4px}.muted{text-align:center;color:#666;margin-bottom:14px}
  table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px dashed #ddd}
  .total{font-size:17px;font-weight:700}.row{display:flex;justify-content:space-between;padding-top:7px}
</style></head><body>
<h1>COFFEE POS</h1><div class="muted">Hóa đơn ${escapeHtml(receipt.orderCode)}</div>
<table><tbody>${items}</tbody></table>
<div class="row"><span>Tạm tính</span><span>${money(receipt.subtotal)}</span></div>
<div class="row total"><span>TỔNG</span><span>${money(receipt.total)}</span></div>
<div class="row"><span>Thanh toán</span><span>${receipt.paymentMethod === 'CASH' ? 'Tiền mặt' : 'QR'}</span></div>
<div class="row"><span>Tiền nhận</span><span>${money(receipt.receivedAmount)}</span></div>
<div class="row"><span>Tiền thừa</span><span>${money(receipt.change)}</span></div>
<p style="text-align:center;margin-top:24px">Cảm ơn quý khách!</p>
</body></html>`;

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return new Promise((resolve) => {
    printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      printWindow.close();
      resolve({ success, failureReason: failureReason || null });
    });
  });
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

app.whenReady().then(async () => {
  startServer();

  // Allow the local API a moment to boot before opening the UI.
  setTimeout(createWindow, 800);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
