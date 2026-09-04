/** Isolated Electron fixture: real tab lifecycle/preload, local proxy, disposable profile. */
import { app, BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'

const profile = process.env.TONNET_RUNTIME_PROFILE
const report = (message: string): void => {
  process.stdout.write(`${message}\n`)
}
if (!profile) throw new Error('Runtime checks require a disposable profile')
mkdirSync(join(profile, 'logs'), { recursive: true })
app.setName('Tonnet Runtime Check')
app.setPath('userData', profile)
app.setPath('logs', join(profile, 'logs'))
app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'disable_non_proxied_udp')
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')

const firstScript = `window.firstScript = { timezone: new Date().getTimezoneOffset(),
  cores: navigator.hardwareConcurrency, platform: navigator.platform,
  node: typeof require, privileged: typeof window.electron,
  intlStatic: typeof Intl.DateTimeFormat.supportedLocalesOf }`
const html = (path: string) => `<!doctype html><title>${path}</title><script src="/probe.js"></script>
  <body><h1>${path}</h1><canvas id="canvas" width="2" height="2"></canvas></body>`

async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 8_000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function deadline<T>(label: string, promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 8_000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

process.on('uncaughtException', (error) => {
  console.error(error)
  app.exit(1)
})
process.on('unhandledRejection', (error) => {
  console.error(error)
  app.exit(1)
})

void app
  .whenReady()
  .then(async () => {
    const { TabManager } = await import('../../tabs')
    const { setMainWindow } = await import('../../main')
    const events: Array<{ channel: string; args: unknown[] }> = []
    let image: Buffer | undefined
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://alpha.ton')
      if (url.pathname === '/slow') return
      if (url.pathname === '/broken') {
        response.destroy()
        return
      }
      if (url.pathname === '/redirect') {
        response.writeHead(302, { Location: '/two' })
        response.end()
        return
      }
      if (url.pathname === '/probe.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' })
        response.end(firstScript)
        return
      }
      if (url.pathname === '/image.png' && image) {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(image)
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'self'" })
      response.end(html(url.pathname))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert(address && typeof address !== 'string')
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    setMainWindow(window)
    await window.loadURL('data:text/html,<body>Runtime fixture</body>')
    const send = window.webContents.send.bind(window.webContents)
    window.on('show', () => {
      throw new Error('Runtime verification must never display a window')
    })
    window.webContents.send = (channel: string, ...args: unknown[]) => {
      events.push({ channel, args })
      send(channel, ...args)
    }
    const manager = new TabManager()
    const bagPath = join(profile, 'storage', 'a'.repeat(64))
    await mkdir(bagPath, { recursive: true })
    await writeFile(join(bagPath, 'file.html'), '<!doctype html><title>Storage fixture</title><body>Local file</body>')
    manager.attachWindow(window, address.port, {
      overlayManager: {
        hideAll() {},
        show() {
          return false
        },
        hide() {},
      },
      proxyManager: new EventEmitter(),
      storageManager: { getBagDetails: async () => ({ path: bagPath, dir_name: '', files: [{ name: 'file.html' }] }) },
      historyManager: { addEntry() {} },
      paymentInterceptor: { consumeXhrPaymentToken: () => null, registerOnSession() {} },
    } as never)
    try {
      await manager.createTab('test', 'http://alpha.ton/one')
      const view = manager.getActiveView()!
      const wc = view.webContents
      const privacyLogs: string[] = []
      wc.on('console-message', (details) => {
        if (details.message.startsWith('[Privacy]')) privacyLogs.push(details.message)
      })
      const loaded = async (path: string) =>
        until(
          () =>
            wc.getURL() === `http://alpha.ton${path}` && !wc.isLoading() && window.contentView.children.includes(view),
          path
        )
      await manager.navigateInTab('test', 'http://alpha.ton/one')
      await loaded('/one')
      assert.deepEqual(await wc.executeJavaScript('window.firstScript'), {
        timezone: 0,
        cores: 4,
        platform: 'Win32',
        node: 'undefined',
        privileged: 'undefined',
        intlStatic: 'function',
      })
      assert(privacyLogs.some((line) => line.includes('Page protections installed:')))
      assert(!privacyLogs.some((line) => /failed|incomplete/.test(line)))
      report('PASS: protections visible to the first page script under strict CSP; Node/privileged IPC isolated')

      await wc.executeJavaScript(
        `const ctx = document.getElementById('canvas').getContext('2d'); ctx.fillStyle = 'rgb(100,110,120)'; ctx.fillRect(0,0,2,2);`
      )
      const rawPixels = () =>
        wc.executeJavaScriptInIsolatedWorld(999, [
          { code: "Array.from(document.getElementById('canvas').getContext('2d').getImageData(0,0,2,2).data)" },
        ])
      const original = await rawPixels()
      const exported = await wc.executeJavaScript(`(async () => {
      const canvas = document.getElementById('canvas');
      const before = Array.from(canvas.getContext('2d').getImageData(0,0,2,2).data);
      const url = canvas.toDataURL();
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      const after = Array.from(canvas.getContext('2d').getImageData(0,0,2,2).data);
      const zero = document.createElement('canvas'); zero.width = 0;
      let invalidCallback = false; try { canvas.toBlob(null); } catch (error) { invalidCallback = error.name === 'TypeError'; }
      const options = { year: 'numeric' }; new Intl.DateTimeFormat('en', options);
      return { before, after, url, size: blob.size, zero: zero.toDataURL(), invalidCallback, options };
    })()`)
      assert.deepEqual(await rawPixels(), original)
      assert.deepEqual(exported.before, exported.after)
      assert.notDeepEqual(exported.before, original)
      assert(exported.size > 0 && exported.url.startsWith('data:image/png'))
      assert.equal(exported.zero, 'data:,')
      assert.equal(exported.invalidCallback, true)
      assert.deepEqual(exported.options, { year: 'numeric' })
      const compatibility = await wc.executeJavaScript(`(() => {
        const unused = document.createElement('canvas'); unused.toDataURL();
        const transferred = !!unused.transferControlToOffscreen();
        const offscreen = new OffscreenCanvas(2,2); const ctx = offscreen.getContext('2d');
        const method = ctx.getImageData;
        for (let i=0;i<1000;i++) offscreen.getContext('2d');
        const pc = new RTCPeerConnection({ iceServers: [] });
        let calls = 0; const listener = () => calls++;
        pc.addEventListener('icecandidate', listener); pc.addEventListener('icecandidate', listener);
        pc.dispatchEvent(new Event('icecandidate')); pc.removeEventListener('icecandidate', listener);
        pc.dispatchEvent(new Event('icecandidate'));
        const object = { handleEvent() { calls++; } }; pc.addEventListener('icecandidate', object);
        pc.dispatchEvent(new Event('icecandidate')); pc.removeEventListener('icecandidate', object);
        pc.dispatchEvent(new Event('icecandidate'));
        pc.onicecandidate = listener; const propertyIdentity = pc.onicecandidate === listener;
        pc.onicecandidate = null; pc.close();
        return { transferred, wrapperStable: ctx.getImageData === method, calls, propertyIdentity };
      })()`)
      assert.deepEqual(compatibility, { transferred: true, wrapperStable: true, calls: 2, propertyIdentity: true })
      const exportPixels = await deadline(
        'decode exported PNG',
        wc.executeJavaScriptInIsolatedWorld(999, [
          {
            code: `(async () => {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve; image.onerror = () => reject(new Error('Exported PNG failed to load'));
          image.src = ${JSON.stringify(exported.url)};
        });
        const copy = document.createElement('canvas'); copy.width = 2; copy.height = 2;
        const ctx = copy.getContext('2d'); ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(0,0,2,2).data);
      })()`,
          },
        ])
      )
      assert.deepEqual(exportPixels, exported.before)
      image = Buffer.from(exported.url.split(',')[1], 'base64')
      const tainted = await deadline(
        'cross-origin tainted canvas',
        wc.executeJavaScript(`(async () => {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve; image.onerror = () => reject(new Error('Foreign PNG failed to load'));
          image.src = 'http://foreign.ton/image.png';
        });
        const canvas = document.createElement('canvas'); canvas.getContext('2d').drawImage(image,0,0);
        const errors = [];
        try { canvas.toDataURL(); } catch (error) { errors.push(error.name); }
        try { canvas.toBlob(() => {}); } catch (error) { errors.push(error.name); }
        return errors;
      })()`)
      )
      assert.deepEqual(tainted, ['SecurityError', 'SecurityError'])
      const webgl = await wc.executeJavaScript(`(() => {
        const gl = document.createElement('canvas').getContext('webgl');
        return { available: !!gl, vendor: gl ? gl.getParameter(37445) : null,
          rtcStatic: typeof RTCPeerConnection.generateCertificate };
      })()`)
      if (webgl.available) assert.equal(webgl.vendor, 'Intel Inc.')
      assert.equal(webgl.rtcStatic, 'function')
      report('PASS: canvas exports leave source pixels intact; read noise stable; native edge cases preserved')

      await wc.executeJavaScript("location.href = '/two'")
      await loaded('/two')
      await manager.navigateInTab('test', 'http://alpha.ton/redirect')
      await loaded('/two')
      report('PASS: native link and redirect event order reattaches the page')

      const eventCount = events.filter((event) => event.channel === 'page:navigate').length
      await wc.executeJavaScript("history.replaceState({}, '', '#'+ 'x'.repeat(20000))")
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(events.filter((event) => event.channel === 'page:navigate').length, eventCount)
      await manager.navigateInTab('test', 'http://alpha.ton/one')
      await loaded('/one')
      report('PASS: long same-document URL cannot escape the page-event boundary')

      await wc.executeJavaScript(
        "const frame = document.createElement('iframe'); frame.src = 'http://frame.ton/broken'; document.body.append(frame)"
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(wc.getURL(), 'http://alpha.ton/one')
      await manager.navigateInTab('test', 'http://alpha.ton/slow')
      await until(() => !window.contentView.children.includes(view), 'slow navigation detaches')
      assert.equal(manager.stopActivePage(), true)
      await until(() => !wc.isLoading(), 'stop loading')
      assert(window.contentView.children.includes(view))
      manager.hideAllViews('test')
      assert.equal(manager.stopActivePage(), false)
      assert(!window.contentView.children.includes(view))
      const retained = wc.getURL()
      const historyLength = wc.navigationHistory.getAllEntries().length
      await manager.navigateInTab('test', retained)
      assert(window.contentView.children.includes(view))
      assert.equal(wc.navigationHistory.getAllEntries().length, historyLength)
      report('PASS: subframe failure stays isolated; Stop and internal-page return preserve visible content/history')

      const firstSession = wc.session
      await manager.navigateInTab('test', 'http://beta.ton/one')
      await until(
        () =>
          manager.getActiveView()?.webContents.getURL() === 'http://beta.ton/one' &&
          !manager.getActiveView()?.webContents.isLoading(),
        'domain replacement'
      )
      const second = manager.getActiveView()!.webContents
      assert.notEqual(second.session, firstSession)
      assert(wc.isDestroyed())
      const metric = app.getAppMetrics().find((process) => process.pid === second.getOSProcessId())
      if (process.platform !== 'linux') assert.equal(metric?.sandboxed, true)
      await second.executeJavaScriptInIsolatedWorld(999, [{ code: 'window.__isolationProbe = true; undefined' }])
      assert.equal(await second.executeJavaScript('typeof window.__isolationProbe'), 'undefined')
      await manager.loadBagFile('test', 'a'.repeat(64), 'file.html')
      assert(manager.getActiveView()!.webContents.getURL().startsWith('file:'))
      assert.equal(await manager.getActiveView()!.webContents.executeJavaScript('typeof require'), 'undefined')
      assert(manager.sessions.getTabDomain('test') === `bag:${'a'.repeat(64)}`)
      report('PASS: domain and Storage-file session isolation preserved')
    } finally {
      manager.dispose()
      window.destroy()
      server.closeAllConnections()
      server.close()
    }
    app.exit(0)
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    app.exit(1)
  })
