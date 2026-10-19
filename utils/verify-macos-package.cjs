const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { listPackage } = require('@electron/asar')
const WebSocket = require('ws')

async function main() {
  const app = path.resolve(process.argv[2] || 'release/mac-universal/Hurmet.app')
  const executable = path.join(app, 'Contents/MacOS/Hurmet')
  const architectures = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' })
  assert.ok(architectures.includes('x86_64') && architectures.includes('arm64'),
    'The app must support both Intel and Apple Silicon')
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  const files = listPackage(path.join(app, 'Contents/Resources/app.asar'))
  for (const file of ['/electron/main.cjs', '/electron/context-menu.cjs',
    '/electron/preload.cjs', '/electron/shell.css',
    '/site/index.html', '/site/prosemirror.min.js', '/site/editing.css',
    '/node_modules/ws/index.js']) {
    assert.ok(files.includes(file), `Missing packaged file: ${file}`)
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hurmet-package-'))
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run'
  ], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HURMET_DESKTOP_SMOKE: '' } })
  let socket
  let logs = ''
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`App did not start:\n${logs}`)), 30000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', code => {
        clearTimeout(timeout)
        reject(new Error(`App exited with code ${code}:\n${logs}`))
      })
      child.stderr.on('data', data => {
        logs = (logs + data.toString()).slice(-20000)
        const match = logs.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)
        if (match) { clearTimeout(timeout); resolve(Number(match[1])) }
      })
    })
    let target
    for (let attempt = 0; attempt < 100; attempt++) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = targets.find(item => item.type === 'page' && item.url.startsWith('hurmet:'))
      if (target) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(target, `Packaged editor window did not open:\n${logs}`)
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await once(socket, 'open')
    let ready = false
    let response
    // The first page target may still be navigating. Poll from Node so a
    // replaced renderer context cannot destroy an in-page readiness promise.
    const deadline = Date.now() + 30000
    while (Date.now() < deadline && !ready) {
      const result = new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout)
          socket.removeListener('message', onMessage)
          socket.removeListener('error', onError)
        }
        const onMessage = data => {
          const message = JSON.parse(data)
          if (message.id === 1) { cleanup(); resolve(message) }
        }
        const onError = error => { cleanup(); reject(error) }
        const timeout = setTimeout(() => {
          cleanup()
          reject(new Error(`Packaged editor stopped responding:\n${logs}`))
        }, 5000)
        socket.on('message', onMessage)
        socket.once('error', onError)
      })
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
        expression: `!!window.view && !!window.hurmetDesktop &&
          !!document.querySelector('.desktop-text-style') &&
          getComputedStyle(document.querySelector('nav')).display === 'none'`,
        returnByValue: true
      } }))
      response = await result
      ready = response.result?.result?.value === true
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(ready, `Packaged editor did not load: ${JSON.stringify(response)}\n${logs}`)
    console.log('Universal app signature, bundled files, and editor launch verified.')
  } finally {
    socket?.terminate()
    const exited = child.exitCode !== null || child.signalCode !== null
    if (!exited) {
      const exit = once(child, 'exit')
      child.kill('SIGKILL')
      await exit
    }
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
