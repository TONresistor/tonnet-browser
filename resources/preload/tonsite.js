const { contextBridge, ipcRenderer } = require('electron')
if (!process.contextIsolated) throw new Error('contextIsolation must be enabled')

// Only the pure page protections cross into the page world. IPC stays isolated.
try {
  const privacy = contextBridge.executeInMainWorld({ func: function installPrivacy() {
  'use strict';
  const applied = [];
  const failed = [];

  // === FUNCTION.PROTOTYPE.TOSTRING PATCH ===
  // Track patched functions so they return [native code] when inspected
  const patchedFunctions = new WeakMap();
  const originalToString = Function.prototype.toString;
  Function.prototype.toString = function() {
    const name = patchedFunctions.get(this);
    if (name !== undefined) {
      return 'function ' + name + '() { [native code] }';
    }
    return originalToString.call(this);
  };
  patchedFunctions.set(Function.prototype.toString, 'toString');

  // Helper: wrap each section so one failure doesn't kill the entire script
  function protect(name, fn) {
    try { fn(); applied.push(name); } catch { failed.push(name); }
  }

  // === NAVIGATOR PROPERTIES SPOOFING ===
  protect('NavigatorSpoofing', () => {
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'platform', {
      get: () => 'Win32',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'language', {
      get: () => 'en-US',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'languages', {
      get: () => ['en-US', 'en'],
      enumerable: true,
      configurable: false
    });

    // Block Client Hints API (prevents UA bypass in Chrome 90+)
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => undefined,
      enumerable: true,
      configurable: false
    });

    // Derived properties for consistency
    Object.defineProperty(Navigator.prototype, 'appVersion', {
      get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'vendor', {
      get: () => 'Google Inc.',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'product', {
      get: () => 'Gecko',
      enumerable: true,
      configurable: false
    });
  });

  // === CANVAS FINGERPRINT PROTECTION ===
  // Session seed for deterministic noise (stable per session)
  const sessionSeed = crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF;

  const noisifyCanvasData = (original, width, height) => {
    const data = new Uint8ClampedArray(original);
    for (let i = 0; i < data.length; i += 4) {
      const noise = ((sessionSeed * (i % 233)) % 3) - 1;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
      data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
    }
    return data;
  };

  protect('CanvasFingerprint', () => {
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      const imageData = originalGetImageData.apply(this, args);
      imageData.data.set(noisifyCanvasData(imageData.data, args[2], args[3]));
      return imageData;
    };
    patchedFunctions.set(CanvasRenderingContext2D.prototype.getImageData, 'getImageData');

    const copyForExport = (canvas) => {
      if (canvas.width === 0 || canvas.height === 0) return canvas;
      // Read with the original method: exporting must neither double-noise nor
      // temporarily mutate the source (including during an asynchronous toBlob).
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const imageData = originalGetImageData.call(ctx, 0, 0, canvas.width, canvas.height);
      imageData.data.set(noisifyCanvasData(imageData.data, canvas.width, canvas.height));
      ctx.putImageData(imageData, 0, 0);
      return copy;
    };
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      return originalToDataURL.apply(copyForExport(this), args);
    };
    patchedFunctions.set(HTMLCanvasElement.prototype.toDataURL, 'toDataURL');

    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(...args) {
      return originalToBlob.apply(copyForExport(this), args);
    };
    patchedFunctions.set(HTMLCanvasElement.prototype.toBlob, 'toBlob');
  });

  // === WEBGL FINGERPRINT PROTECTION ===
  protect('WebGLFingerprint', () => {
    const getParameterProto = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      const spoofed = {
        37445: 'Intel Inc.',
        37446: 'Intel Iris OpenGL Engine',
      };
      return spoofed[param] || getParameterProto.call(this, param);
    };
    patchedFunctions.set(WebGLRenderingContext.prototype.getParameter, 'getParameter');

    if (window.WebGL2RenderingContext) {
      const getParameterProto2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        const spoofed = {
          37445: 'Intel Inc.',
          37446: 'Intel Iris OpenGL Engine',
        };
        return spoofed[param] || getParameterProto2.call(this, param);
      };
      patchedFunctions.set(WebGL2RenderingContext.prototype.getParameter, 'getParameter');
    }

    const originalReadPixels = WebGLRenderingContext.prototype.readPixels;
    WebGLRenderingContext.prototype.readPixels = function(...args) {
      originalReadPixels.apply(this, args);
      const pixels = args[6];
      if (pixels) {
        for (let i = 0; i < pixels.length; i++) {
          const noise = ((sessionSeed * (i % 233)) % 3) - 1;
          pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
        }
      }
    };
    patchedFunctions.set(WebGLRenderingContext.prototype.readPixels, 'readPixels');

    // WebGL2: noise readPixels (same as WebGL1)
    if (window.WebGL2RenderingContext) {
      const originalReadPixels2 = WebGL2RenderingContext.prototype.readPixels;
      WebGL2RenderingContext.prototype.readPixels = function(...args) {
        originalReadPixels2.apply(this, args);
        var pixels = args[6];
        if (pixels) {
          for (var i = 0; i < pixels.length; i++) {
            var noise = ((sessionSeed * (i % 233)) % 3) - 1;
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
          }
        }
      };
      patchedFunctions.set(WebGL2RenderingContext.prototype.readPixels, 'readPixels');
    }
  });

  // === AUDIOCONTEXT FINGERPRINT PROTECTION ===
  protect('AudioContext', () => {
    const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
    if (OriginalAudioContext) {
      const originalCreateAnalyser = OriginalAudioContext.prototype.createAnalyser;
      OriginalAudioContext.prototype.createAnalyser = function() {
        const analyser = originalCreateAnalyser.call(this);
        const origGetFloatFrequencyData = analyser.getFloatFrequencyData;
        analyser.getFloatFrequencyData = function(array) {
          origGetFloatFrequencyData.call(this, array);
          for (let i = 0; i < array.length; i++) {
            array[i] += (((sessionSeed * (i % 233)) % 0.001) - 0.0005);
          }
        };
        return analyser;
      };
      patchedFunctions.set(OriginalAudioContext.prototype.createAnalyser, 'createAnalyser');

      const originalCreateOscillator = OriginalAudioContext.prototype.createOscillator;
      OriginalAudioContext.prototype.createOscillator = function() {
        const osc = originalCreateOscillator.call(this);
        const origStart = osc.start;
        osc.start = function(...args) {
          if (osc.frequency) {
            osc.frequency.value += (sessionSeed % 0.01) - 0.005;
          }
          return origStart.apply(this, args);
        };
        return osc;
      };
      patchedFunctions.set(OriginalAudioContext.prototype.createOscillator, 'createOscillator');
    }
  });

  // === WEBRTC IP LEAK PROTECTION ===
  protect('WebRTC', () => {
    if (window.RTCPeerConnection) {
      const origRTCPeerConnection = window.RTCPeerConnection;

      // Regex patterns for IPv4 and IPv6 addresses
      const ipv4Re = /([0-9]{1,3}\.){3}[0-9]{1,3}/g;
      const ipv6Re = /([a-f0-9]{1,4}:){7}[a-f0-9]{1,4}/gi;

      // Strip IP addresses from an ICE candidate string
      const sanitizeCandidate = (candidate) =>
        candidate.replace(ipv4Re, '0.0.0.0').replace(ipv6Re, '::');

      // Wrap an icecandidate callback to redact IP addresses from candidates
      const wrapIceCandidateListener = (fn, ctx) => {
        return (event) => {
          let delivered = event;
          if (event.candidate && event.candidate.candidate) {
            const modified = new RTCIceCandidate({
              candidate: sanitizeCandidate(event.candidate.candidate),
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              usernameFragment: event.candidate.usernameFragment,
            })
            const modifiedEvent = new Event('icecandidate')
            Object.defineProperty(modifiedEvent, 'candidate', { value: modified })
            Object.defineProperties(modifiedEvent, { target: { value: ctx }, currentTarget: { value: ctx } })
            delivered = modifiedEvent;
          }
          if (typeof fn === 'function') fn.call(ctx, delivered);
          else fn.handleEvent(delivered);
        }
      }

      // Intercept addEventListener to wrap icecandidate listeners
      const origAddEventListener = RTCPeerConnection.prototype.addEventListener;
      const origRemoveEventListener = RTCPeerConnection.prototype.removeEventListener;
      const listenerWrappers = new WeakMap();
      const captureFlag = (options) => typeof options === 'boolean' ? options : !!(options && options.capture);
      const getWrapper = (target, listener, options, create) => {
        if (!listener || (typeof listener !== 'function' && typeof listener !== 'object')) return listener;
        let listeners = listenerWrappers.get(target);
        if (!listeners && create) { listeners = new WeakMap(); listenerWrappers.set(target, listeners); }
        let captures = listeners && listeners.get(listener);
        if (!captures && create) { captures = new Map(); listeners.set(listener, captures); }
        const capture = captureFlag(options);
        if (captures && !captures.has(capture) && create) captures.set(capture, wrapIceCandidateListener(listener, target));
        return captures && captures.get(capture) || listener;
      };
      RTCPeerConnection.prototype.addEventListener = function(type, listener, options) {
        if (type === 'icecandidate') {
          return origAddEventListener.call(this, type, getWrapper(this, listener, options, true), options)
        }
        return origAddEventListener.call(this, type, listener, options)
      }
      RTCPeerConnection.prototype.removeEventListener = function(type, listener, options) {
        return origRemoveEventListener.call(this, type, type === 'icecandidate' ? getWrapper(this, listener, options, false) : listener, options);
      };
      patchedFunctions.set(RTCPeerConnection.prototype.addEventListener, 'addEventListener');
      patchedFunctions.set(RTCPeerConnection.prototype.removeEventListener, 'removeEventListener');

      // Intercept onicecandidate property setter
      const origOnIceCandidateDesc = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'onicecandidate');
      const propertyListeners = new WeakMap();
      if (origOnIceCandidateDesc) {
        Object.defineProperty(RTCPeerConnection.prototype, 'onicecandidate', {
          set(fn) {
            if (typeof fn === 'function') {
              propertyListeners.set(this, fn);
              origOnIceCandidateDesc.set.call(this, wrapIceCandidateListener(fn, this))
            } else {
              propertyListeners.delete(this);
              origOnIceCandidateDesc.set.call(this, fn)
            }
          },
          get() { return propertyListeners.get(this) || origOnIceCandidateDesc.get.call(this) },
          configurable: true,
        })
      }

      const wrappedRTC = function(config, ...args) {
        // Force disable mDNS candidate gathering (prevents local IP leak)
        if (config) {
          config.iceServers = config.iceServers || [];
          config.iceCandidatePoolSize = 0;
        }
        const pc = new origRTCPeerConnection(config, ...args);

        // Block local IP candidates
        const origAddIceCandidate = pc.addIceCandidate;
        pc.addIceCandidate = function(candidate) {
          if (candidate && candidate.candidate) {
            // Block candidates containing local IPs (192.168, 10., 172.16-31)
            if (/((192[.]168)|(10[.])|(172[.](1[6-9]|2[0-9]|3[0-1])))/.test(candidate.candidate)) {
              console.log('[Privacy] Blocked local IP leak via WebRTC');
              return Promise.resolve();
            }
          }
          return origAddIceCandidate.apply(this, arguments);
        };
        return pc;
      };
      wrappedRTC.prototype = origRTCPeerConnection.prototype;
      Object.setPrototypeOf(wrappedRTC, origRTCPeerConnection);
      patchedFunctions.set(wrappedRTC, 'RTCPeerConnection');
      Object.defineProperty(window, 'RTCPeerConnection', {
        value: wrappedRTC,
        writable: true,
        configurable: true
      });
    }
  });

  // === NETWORK INFORMATION API SPOOFING ===
  protect('NetworkInformationAPI', () => {
    if (navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          type: 'unknown',
          downlink: 10,
          rtt: 50,
          saveData: false,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
        configurable: false,
      })
    }
  });

  // === HARDWARE/PLUGIN ENUMERATION PROTECTION ===
  // Disable Battery API (fingerprinting)
  protect('BatteryAPI', () => {
    if (navigator.getBattery) {
      Object.defineProperty(navigator, 'getBattery', {
        value: () => Promise.reject('Battery API disabled for privacy'),
        writable: false
      });
    }
  });

  // Disable Sensor APIs (fingerprinting)
  protect('DeviceMotionEvent', () => {
    Object.defineProperty(window, 'DeviceMotionEvent', { value: undefined, configurable: true });
  });
  protect('DeviceOrientationEvent', () => {
    Object.defineProperty(window, 'DeviceOrientationEvent', { value: undefined, configurable: true });
  });

  protect('HardwareEnumeration', () => {
    // Spoof navigator.plugins (empty list)
    Object.defineProperty(Navigator.prototype, 'plugins', { get: () => [], enumerable: true, configurable: false });
    Object.defineProperty(Navigator.prototype, 'mimeTypes', { get: () => [], enumerable: true, configurable: false });
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, enumerable: true, configurable: false });
    if ('deviceMemory' in navigator) {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8, enumerable: true, configurable: false });
    }
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 0, enumerable: true, configurable: false });
    if (navigator.getGamepads) {
      Object.defineProperty(navigator, 'getGamepads', { value: () => [], writable: false, configurable: true });
    }
    if (navigator.usb) {
      Object.defineProperty(navigator, 'usb', { get: () => undefined, enumerable: true, configurable: true });
    }
    if (navigator.bluetooth) {
      Object.defineProperty(navigator, 'bluetooth', { get: () => undefined, enumerable: true, configurable: true });
    }
  });

  protect('ScreenSpoofing', () => {
    const defineBucketed = (prop, bucket, fallback) => {
      const orig = Object.getOwnPropertyDescriptor(Screen.prototype, prop);
      Object.defineProperty(Screen.prototype, prop, {
        get: function() {
          const real = (orig && orig.get) ? orig.get.call(this) : fallback;
          return Math.floor(real / bucket) * bucket;
        },
        enumerable: true, configurable: false
      });
    };
    defineBucketed('width', 200, 1920);
    defineBucketed('height', 100, 1080);
    defineBucketed('availWidth', 200, 1920);
    defineBucketed('availHeight', 100, 1040);
    Object.defineProperty(Screen.prototype, 'colorDepth', { get: () => 24, enumerable: true, configurable: false });
    Object.defineProperty(Screen.prototype, 'pixelDepth', { get: () => 24, enumerable: true, configurable: false });
  });

  // Block timezone fingerprinting - return UTC offset
  protect('TimezoneOffset', () => {
    Object.defineProperty(Date.prototype, 'getTimezoneOffset', {
      value: function() { return 0; },
      writable: true,
      configurable: true
    });
  });

  // Spoof Intl.DateTimeFormat to UTC
  protect('DateTimeFormat', () => {
    const OrigDateTimeFormat = Intl.DateTimeFormat;
    const DateTimeFormat = function(locales, options) {
      return new OrigDateTimeFormat(locales, { ...options, timeZone: 'UTC' });
    };
    DateTimeFormat.prototype = OrigDateTimeFormat.prototype;
    Object.setPrototypeOf(DateTimeFormat, OrigDateTimeFormat);
    patchedFunctions.set(DateTimeFormat, 'DateTimeFormat');
    Object.defineProperty(Intl, 'DateTimeFormat', {
      value: DateTimeFormat,
      writable: true,
      configurable: true
    });
  });

  // === FONT FINGERPRINTING PROTECTION ===
  // Shared font whitelist (used by both JS API filter and CSS enumeration protection)
  const ALLOWED_FONTS = [
    'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
    'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana',
    'Helvetica', 'Helvetica Neue', 'Lucida Console', 'Lucida Sans Unicode',
    'Palatino Linotype', 'Tahoma', 'serif', 'sans-serif', 'monospace',
    'cursive', 'fantasy', 'system-ui', '-apple-system', 'BlinkMacSystemFont'
  ];

  protect('FontFingerprint', () => {

    if (document.fonts) {
      const originalCheck = document.fonts.check.bind(document.fonts);
      document.fonts.check = function(font, text) {
        const fontFamily = font.split(' ').pop().replace(/['"]/g, '');
        if (ALLOWED_FONTS.some(f => fontFamily.toLowerCase().includes(f.toLowerCase()))) {
          return originalCheck(font, text);
        }
        return false;
      };

      const originalLoad = document.fonts.load.bind(document.fonts);
      document.fonts.load = function(font, text) {
        const fontFamily = font.split(' ').pop().replace(/['"]/g, '');
        if (ALLOWED_FONTS.some(f => fontFamily.toLowerCase().includes(f.toLowerCase()))) {
          return originalLoad(font, text);
        }
        return Promise.resolve([]);
      };

      const originalForEach = document.fonts.forEach.bind(document.fonts);
      document.fonts.forEach = function(callback, thisArg) {
        originalForEach(function(fontFace, index, set) {
          if (ALLOWED_FONTS.some(f => fontFace.family.toLowerCase().includes(f.toLowerCase()))) {
            callback.call(thisArg, fontFace, index, set);
          }
        }, thisArg);
      };

      Object.defineProperty(document.fonts, 'size', {
        get: () => ALLOWED_FONTS.length,
        enumerable: true,
        configurable: true
      });
    }
  });

  // === OFFSCREENCANVAS FINGERPRINT PROTECTION ===
  protect('OffscreenCanvasFingerprint', () => {
    if (typeof OffscreenCanvas !== 'undefined') {
      const patchedContexts = new WeakSet();
      var origGetContext = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function(type) {
        var ctx = origGetContext.apply(this, arguments);
        if (ctx && type === '2d' && !patchedContexts.has(ctx)) {
          patchedContexts.add(ctx);
          var origGetImageData = ctx.getImageData;
          ctx.getImageData = function() {
            var imageData = origGetImageData.apply(this, arguments);
            imageData.data.set(noisifyCanvasData(imageData.data, arguments[2], arguments[3]));
            return imageData;
          };
          patchedFunctions.set(ctx.getImageData, 'getImageData');
        }
        return ctx;
      };
      patchedFunctions.set(OffscreenCanvas.prototype.getContext, 'getContext');
    }
  });

  // === CSS FONT ENUMERATION PROTECTION ===
  protect('CSSFontEnumeration', () => {
    var ALLOWED_SET = new Set(ALLOWED_FONTS.map(function(f) { return f.toLowerCase(); }));
    var GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system', 'blinkmacsystemfont'];

    // Check if element uses only allowed fonts via computed style
    var usesAllowedFonts = function(el) {
      try {
        var computed = getComputedStyle(el).fontFamily;
        var families = computed.split(',');
        for (var i = 0; i < families.length; i++) {
          var f = families[i].trim().replace(/['"]/g, '').toLowerCase();
          if (!ALLOWED_SET.has(f) && GENERIC_FAMILIES.indexOf(f) === -1) return false;
        }
        return true;
      } catch(e) { return true; }
    };

    // Bucket dimensions to 8px grid for non-allowed fonts
    var origOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    var origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

    if (origOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        get: function() {
          var w = origOffsetWidth.get.call(this);
          if (!usesAllowedFonts(this)) return Math.round(w / 8) * 8;
          return w;
        },
        configurable: true
      });
    }

    if (origOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        get: function() {
          var h = origOffsetHeight.get.call(this);
          if (!usesAllowedFonts(this)) return Math.round(h / 8) * 8;
          return h;
        },
        configurable: true
      });
    }

    var origGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      var rect = origGetBCR.call(this);
      if (!usesAllowedFonts(this)) {
        return new DOMRect(rect.x, rect.y, Math.round(rect.width / 8) * 8, Math.round(rect.height / 8) * 8);
      }
      return rect;
    };
    patchedFunctions.set(Element.prototype.getBoundingClientRect, 'getBoundingClientRect');
  });

  // === VIEWPORT DIMENSION SPOOFING ===
  protect('ViewportSpoofing', () => {
    const originalInnerWidth = Object.getOwnPropertyDescriptor(Window.prototype, 'innerWidth');
    const originalInnerHeight = Object.getOwnPropertyDescriptor(Window.prototype, 'innerHeight');
    const originalOuterWidth = Object.getOwnPropertyDescriptor(Window.prototype, 'outerWidth');
    const originalOuterHeight = Object.getOwnPropertyDescriptor(Window.prototype, 'outerHeight');

    if (originalInnerWidth && originalInnerHeight) {
      Object.defineProperty(window, 'innerWidth', {
        get: function() { return Math.floor((originalInnerWidth.get?.call(this) || 1024) / 200) * 200; },
        enumerable: true, configurable: false
      });
      Object.defineProperty(window, 'innerHeight', {
        get: function() { return Math.floor((originalInnerHeight.get?.call(this) || 768) / 100) * 100; },
        enumerable: true, configurable: false
      });
    }

    if (originalOuterWidth && originalOuterHeight) {
      Object.defineProperty(window, 'outerWidth', {
        get: function() { return Math.floor((originalOuterWidth.get?.call(this) || 1024) / 200) * 200; },
        enumerable: true, configurable: false
      });
      Object.defineProperty(window, 'outerHeight', {
        get: function() { return Math.floor((originalOuterHeight.get?.call(this) || 768) / 100) * 100; },
        enumerable: true, configurable: false
      });
    }
  });

  return { applied, failed };
  } });
  if (privacy.failed.length) console.warn('[Privacy] Protection installation incomplete:', privacy.failed.join(', '));
  else console.log('[Privacy] Page protections installed:', privacy.applied.length);
} catch (error) {
  console.error('[Privacy] Page protection installation failed:', error.message);
}

// === TON BRIDGE API ===
contextBridge.exposeInMainWorld('tonBridge', {
  send: function (data) {
    if (typeof data !== 'string' || data.length > 65536) return
    ipcRenderer.invoke('bridge:send', data)
  },
  onMessage: function (callback) {
    var listener = function (_event, data) { callback(data) }
    ipcRenderer.on('bridge:message', listener)
    return function () { ipcRenderer.removeListener('bridge:message', listener) }
  },
  payForXhr: function (url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 8192) {
      return Promise.resolve({ success: false, error: 'invalid-url' })
    }
    return ipcRenderer.invoke('wallet:pay-for-xhr', { url: url })
  },
})

var TONCONNECT_FEATURES = [
  { name: 'SendTransaction', maxMessages: 4, extraCurrencySupported: false },
  { name: 'SignData', types: ['text', 'binary', 'cell'] },
]
var TONNET_WALLET_IMAGE =
  'data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgdmlld0JveD0iMCAwIDIyIDE4IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8ZyBpZD0iU2hhcGUiPgo8cGF0aCBkPSJNMCA1LjIzNjM2QzAgMy40MDM0NiAwIDIuNDg3MDEgMC4zMzk1MiAxLjc4Njk0QzAuNjM4MTY5IDEuMTcxMTQgMS4xMTQ3MSAwLjY3MDQ3MyAxLjcwMDg0IDAuMzU2NzA2QzIuMzY3MTkgMCAzLjIzOTQ4IDAgNC45ODQwNyAwSDE2LjA0MjVDMTcuNzg3MSAwIDE4LjY1OTQgMCAxOS4zMjU3IDAuMzU2NzA2QzE5LjkxMTggMC42NzA0NzMgMjAuMzg4NCAxLjE3MTE0IDIwLjY4NyAxLjc4Njk0QzIwLjk0NzEgMi4zMjMxNCAyMS4wMDc5IDIuOTg2MjggMjEuMDIyMiA0LjA5MDkxSDE1LjU3NTJDMTQuMTIzOCA0LjA5MDkxIDEzLjM5ODEgNC4wOTA5MSAxMi44MjU2IDQuMzQwMDNDMTIuMDYyNCA0LjY3MjE5IDExLjQ1NTkgNS4zMDkzMSAxMS4xMzk4IDYuMTExMjJDMTAuOTAyNyA2LjcxMjY1IDEwLjkwMjcgNy40NzUxIDEwLjkwMjcgOUMxMC45MDI3IDEwLjUyNDkgMTAuOTAyNyAxMS4yODczIDExLjEzOTggMTEuODg4OEMxMS40NTU5IDEyLjY5MDcgMTIuMDYyNCAxMy4zMjc4IDEyLjgyNTYgMTMuNjZDMTMuMzk4MSAxMy45MDkxIDE0LjEyMzggMTMuOTA5MSAxNS41NzUyIDEzLjkwOTFIMjEuMDIyMkMyMS4wMDc5IDE1LjAxMzcgMjAuOTQ3MSAxNS42NzY5IDIwLjY4NyAxNi4yMTMxQzIwLjM4ODQgMTYuODI4OSAxOS45MTE4IDE3LjMyOTUgMTkuMzI1NyAxNy42NDMzQzE4LjY1OTQgMTggMTcuNzg3MSAxOCAxNi4wNDI1IDE4SDQuOTg0MDdDMy4yMzk0OCAxOCAyLjM2NzE5IDE4IDEuNzAwODQgMTcuNjQzM0MxLjExNDcxIDE3LjMyOTUgMC42MzgxNjkgMTYuODI4OSAwLjMzOTUyIDE2LjIxMzFDMCAxNS41MTMgMCAxNC41OTY1IDAgMTIuNzYzNlY1LjIzNjM2WiIgZmlsbD0iIzAwOEJGRiIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEyLjI2NTUgOC43OTU0NUMxMi4yNjU1IDcuNjQ5ODkgMTIuMjY1NSA3LjA3NzExIDEyLjQ3NzcgNi42Mzk1NkMxMi42NjQzIDYuMjU0NjkgMTIuOTYyMiA1Ljk0MTc3IDEzLjMyODUgNS43NDU2N0MxMy43NDUgNS41MjI3MyAxNC4yOTAyIDUuNTIyNzMgMTUuMzgwNSA1LjUyMjczSDE4Ljg4NUMxOS45NzUzIDUuNTIyNzMgMjAuNTIwNSA1LjUyMjczIDIwLjkzNyA1Ljc0NTY3QzIxLjMwMzMgNS45NDE3NyAyMS42MDExIDYuMjU0NjkgMjEuNzg3OCA2LjYzOTU2QzIyIDcuMDc3MTEgMjIgNy42NDk4OSAyMiA4Ljc5NTQ1VjkuMjA0NTVDMjIgMTAuMzUwMSAyMiAxMC45MjI5IDIxLjc4NzggMTEuMzYwNEMyMS42MDExIDExLjc0NTMgMjEuMzAzMyAxMi4wNTgyIDIwLjkzNyAxMi4yNTQzQzIwLjUyMDUgMTIuNDc3MyAxOS45NzUzIDEyLjQ3NzMgMTguODg1IDEyLjQ3NzNIMTUuMzgwNUMxNC4yOTAyIDEyLjQ3NzMgMTMuNzQ1IDEyLjQ3NzMgMTMuMzI4NSAxMi4yNTQzQzEyLjk2MjIgMTIuMDU4MiAxMi42NjQzIDExLjc0NTMgMTIuNDc3NyAxMS4zNjA0QzEyLjI2NTUgMTAuOTIyOSAxMi4yNjU1IDEwLjM1MDEgMTIuMjY1NSA5LjIwNDU1VjguNzk1NDVaTTE3LjEzMjcgOUMxNy4xMzI3IDkuOTAzNzQgMTYuNDM1NCAxMC42MzY0IDE1LjU3NTIgMTAuNjM2NEMxNC43MTUgMTAuNjM2NCAxNC4wMTc3IDkuOTAzNzQgMTQuMDE3NyA5QzE0LjAxNzcgOC4wOTYyNiAxNC43MTUgNy4zNjM2NCAxNS41NzUyIDcuMzYzNjRDMTYuNDM1NCA3LjM2MzY0IDE3LjEzMjcgOC4wOTYyNiAxNy4xMzI3IDlaIiBmaWxsPSIjMDA4QkZGIi8+CjwvZz4KPC9zdmc+Cg=='

// Bound what an untrusted page can push across the IPC boundary (mirrors the
// tonBridge.send / payForXhr caps). Legit dApp payloads are far smaller.
var MAX_TONCONNECT_PAYLOAD = 65536
var MAX_MANIFEST_URL = 8192
// Soft cap on distinct event listeners a page may register.
var MAX_TONCONNECT_LISTENERS = 64

// A single ipcRenderer listener fans out to all page callbacks, so repeated
// listen() calls can never accumulate ipcRenderer listeners (leak / MaxListeners).
var tonconnectCallbacks = []
var tonconnectListenerRegistered = false
function ensureTonconnectListener() {
  if (tonconnectListenerRegistered) return
  tonconnectListenerRegistered = true
  ipcRenderer.on('tonconnect:event', function (_event, data) {
    for (var i = 0; i < tonconnectCallbacks.length; i++) {
      try {
        tonconnectCallbacks[i](data)
      } catch (e) {
        /* a page callback throwing must not break the fan-out */
      }
    }
  })
}

async function isTonconnectEnabled() {
  try {
    var availability = await ipcRenderer.invoke('tonconnect:availability')
    return availability && availability.enabled === true
  } catch (_error) {
    return false
  }
}

contextBridge.exposeInMainWorld('tonnet', {
  tonconnect: {
    deviceInfo: {
      platform: 'browser',
      appName: 'tonnet',
      appVersion: '1.0.0',
      maxProtocolVersion: 2,
      features: TONCONNECT_FEATURES,
    },
    walletInfo: {
      name: 'Tonnet',
      app_name: 'tonnet',
      image: TONNET_WALLET_IMAGE,
      about_url: 'https://github.com/TONresistor/Tonnet-Browser',
      platforms: ['macos', 'windows', 'linux'],
      features: TONCONNECT_FEATURES,
    },
    protocolVersion: 2,
    isWalletBrowser: true,
    isEnabled: isTonconnectEnabled,
    connect: function (protocolVersion, request) {
      if (request && typeof request.manifestUrl === 'string' && request.manifestUrl.length > MAX_MANIFEST_URL) {
        return Promise.reject(new Error('tonconnect: manifestUrl too large'))
      }
      return ipcRenderer.invoke('tonconnect:request', {
        method: 'connect',
        protocolVersion: protocolVersion,
        request: request,
      })
    },
    restoreConnection: function () {
      return ipcRenderer.invoke('tonconnect:request', { method: 'restore' })
    },
    send: function (message) {
      if (
        message &&
        message.params &&
        typeof message.params[0] === 'string' &&
        message.params[0].length > MAX_TONCONNECT_PAYLOAD
      ) {
        return Promise.reject(new Error('tonconnect: payload too large'))
      }
      return ipcRenderer.invoke('tonconnect:request', { method: 'send', message: message })
    },
    disconnect: function () {
      return ipcRenderer.invoke('tonconnect:request', { method: 'disconnect' })
    },
    listen: function (callback) {
      if (typeof callback !== 'function' || tonconnectCallbacks.length >= MAX_TONCONNECT_LISTENERS) {
        return function () {}
      }
      ensureTonconnectListener()
      tonconnectCallbacks.push(callback)
      return function () {
        var idx = tonconnectCallbacks.indexOf(callback)
        if (idx !== -1) tonconnectCallbacks.splice(idx, 1)
      }
    },
  },
})

function doInjectFetchShim(parent) {
  var script = document.createElement('script')
  script.textContent = [
    ';(function(){',
    '  if (window.__tonnetFetchPatched) return;',
    '  window.__tonnetFetchPatched = true;',
    '  var origFetch = window.fetch.bind(window);',
    '  window.fetch = async function(input, init){',
    '    var url = "";',
    '    try { url = (typeof input === "string") ? input : (input && input.url) || ""; } catch (e) {}',
    '    if (/wallets-v2\\.json/.test(url) && window.tonnet && window.tonnet.tonconnect && window.tonnet.tonconnect.walletInfo && await window.tonnet.tonconnect.isEnabled()) {',
    '      var response = await origFetch(input, init);',
    '      if (!response.ok) return response;',
    '      var wallets;',
    '      try { wallets = await response.clone().json(); } catch (e) { return response; }',
    '      if (!Array.isArray(wallets)) return response;',
    '      var wi = window.tonnet.tonconnect.walletInfo;',
    '      var entry = { app_name: wi.app_name, name: wi.name, image: wi.image, about_url: wi.about_url, bridge: [{ type: "js", key: "tonnet" }], platforms: wi.platforms, features: wi.features };',
    '      wallets = wallets.filter(function(wallet) { return !wallet || wallet.app_name !== "tonnet"; });',
    '      wallets.unshift(entry);',
    '      var headers = new Headers(response.headers);',
    '      headers.delete("content-length");',
    '      headers.delete("content-encoding");',
    '      headers.delete("etag");',
    '      headers.set("content-type", "application/json");',
    '      return new Response(JSON.stringify(wallets), { status: response.status, statusText: response.statusText, headers: headers });',
    '    }',
    '    if (!window.tonBridge || typeof window.tonBridge.payForXhr !== "function") return origFetch(input, init);',
    '    var req;',
    '    try { req = new Request(input, init); } catch (e) { return origFetch(input, init); }',
    '    var cloned = req.clone();',
    '    var res = await origFetch(req);',
    '    if (res.status !== 402) return res;',
    '    var u = req.url;',
    '    try {',
    '      var result = await window.tonBridge.payForXhr(u);',
    '      if (!result || !result.success) return res;',
    '      return await origFetch(cloned);',
    '    } catch (e) { return res; }',
    '  };',
    '})();',
  ].join('\n')
  parent.appendChild(script)
  script.remove()
}

function injectFetchShim() {
  if (document.documentElement) {
    doInjectFetchShim(document.documentElement)
    return
  }
  var obs = new MutationObserver(function () {
    if (document.documentElement) {
      obs.disconnect()
      doInjectFetchShim(document.documentElement)
    }
  })
  obs.observe(document, { childList: true, subtree: true })
}
injectFetchShim()
