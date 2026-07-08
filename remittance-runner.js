'use strict';
// MSR remittance parser runner: spawns parse_msr_remittance.py (pdfplumber) and
// returns its { ok, rows, statementTotal } result. Mirrors amh-runner's spawn
// mechanism (packaged vs dev interpreter, JSON over stdin/stdout) but needs no
// Edge/creds -- it only reads a local PDF.
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

// Resolve interpreter + script. Packaged: bundled embeddable Python + script under
// resources/. Dev: system python + repo script. (Same layout as amh-runner.)
function pythonPaths() {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return { python: path.join(res, 'python', 'python.exe'),
             script: path.join(res, 'parse_msr_remittance.py') };
  }
  return { python: process.platform === 'win32' ? 'python' : 'python3',
           script: path.join(__dirname, 'parse_msr_remittance.py') };
}

// Parse one MSR remittance PDF. pdfPath = absolute path. Resolves the parsed
// { ok, rows, statementTotal } object; rejects on spawn / non-zero exit /
// unparseable output. The PDF path is sent as a JSON string on stdin.
function parseMsrRemittance(pdfPath) {
  return new Promise((resolve, reject) => {
    const { python, script } = pythonPaths();
    let proc;
    try {
      proc = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { return reject(new Error('Could not start Python: ' + e.message)); }

    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', e => reject(new Error('Python spawn failed: ' + e.message)));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Python exited ${code}: ${err.slice(-300)}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error('Could not parse Python output: ' + out.slice(0, 200))); }
    });
    proc.stdin.on('error', () => {});   // swallow EPIPE if Python exits before reading
    proc.stdin.write(JSON.stringify(String(pdfPath || '')));
    proc.stdin.end();
  });
}

module.exports = { parseMsrRemittance };
