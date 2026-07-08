'use strict';
// MSR remittance parser runner: spawns parse_msr_remittance.py (pdfplumber) and
// returns its { ok, rows, statementTotal } result. Mirrors amh-runner's spawn
// mechanism (packaged vs dev interpreter, JSON over stdin/stdout) but needs no
// Edge/creds -- it only reads a local PDF.
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

// Resolve interpreter + a named script. Packaged: bundled embeddable Python + script
// under resources/. Dev: system python + repo script. (Same layout as amh-runner.)
function pythonPaths(scriptName) {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return { python: path.join(res, 'python', 'python.exe'), script: path.join(res, scriptName) };
  }
  return { python: process.platform === 'win32' ? 'python' : 'python3',
           script: path.join(__dirname, scriptName) };
}

// Shared spawn: run a remittance parser script, send the PDF path as a JSON string on
// stdin, resolve the parsed JSON stdout. Rejects on spawn / non-zero exit / bad output.
function runParser(scriptName, pdfPath) {
  return new Promise((resolve, reject) => {
    const { python, script } = pythonPaths(scriptName);
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

// Parse one MSR "Vendor ACH Payment Detail" PDF -> { ok, rows, statementTotal }.
function parseMsrRemittance(pdfPath) { return runParser('parse_msr_remittance.py', pdfPath); }

// Parse one AMH "ACHVendor" PDF -> { ok, rows, paymentTotal, eftNo }.
function parseAmhRemittance(pdfPath) { return runParser('parse_amh_remittance.py', pdfPath); }

module.exports = { parseMsrRemittance, parseAmhRemittance };
