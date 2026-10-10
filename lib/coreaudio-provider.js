const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

class CoreAudioProvider {
    constructor({ root = path.join(__dirname, '..'), onStatus = () => {} } = {}) {
        this.root = root;
        this.onStatus = onStatus;
        this.listeners = new Set();
        this.child = null;
        this.running = false;
        this.retry = null;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    start() {
        if (this.running) return;
        this.running = true;
        try {
            if (process.platform !== 'darwin') throw new Error('CoreAudio requires macOS');
            const source = path.join(this.root, 'scripts/audio-capture.swift');
            const plist = path.join(this.root, 'scripts/audio-capture-info.plist');
            const cache = path.join(this.root, '.cache');
            fs.mkdirSync(cache, { recursive: true });
            this.binary = path.join(cache, 'audio-capture');
            if (!fs.existsSync(this.binary) || [source, plist].some(p => fs.statSync(p).mtimeMs > fs.statSync(this.binary).mtimeMs)) {
                execFileSync('swiftc', [source, '-O', '-o', this.binary, '-framework', 'CoreAudio', '-framework', 'Accelerate',
                    '-module-cache-path', path.join(cache, 'swift'), '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist]);
                execFileSync('codesign', ['--force', '--sign', '-', '--identifier', 'com.lee0233.lee-audio.capture', this.binary]);
            }
            this.launch();
        } catch (error) {
            this.running = false;
            this.onStatus({ state: 'unavailable', message: error.message });
        }
    }
    launch() {
        if (!this.running) return;
        this.onStatus({ state: 'connecting', message: 'Waiting for CoreAudio capture' });
        let received = false;
        const waiting = setTimeout(() => {
            if (!received) this.onStatus({ state: "unavailable", message: "No capture frames; check macOS System Audio Recording permission" });
        }, 10000);
        const child = this.child = spawn(this.binary, [], { stdio: ['ignore', 'pipe', 'pipe'] });
        const lines = readline.createInterface({ input: child.stdout });
        lines.on('line', line => {
            try {
                const data = JSON.parse(line);
                if (!received) { clearTimeout(waiting); received = true; this.onStatus({ state: 'live', message: 'CoreAudio connected' }); }
                for (const listener of this.listeners) listener(data);
            } catch (error) { this.onStatus({ state: 'error', message: error.message }); }
        });
        child.stderr.on('data', data => console.error(`[audio] ${data.toString().trim()}`));
        child.on('error', error => this.onStatus({ state: 'unavailable', message: error.message }));
        child.on('close', () => {
            clearTimeout(waiting);
            lines.close();
            this.child = null;
            if (!this.running) return;
            this.onStatus({ state: 'unavailable', message: 'Capture stopped; check audio permission and DAC connection' });
            this.retry = setTimeout(() => this.launch(), 5000);
        });
    }
    stop() {
        this.running = false;
        clearTimeout(this.retry);
        this.child?.kill('SIGTERM');
    }
}
module.exports = { CoreAudioProvider };
