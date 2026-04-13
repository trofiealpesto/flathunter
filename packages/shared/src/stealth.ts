export function buildStealthInitScript(): () => void {
  return () => {
    const globalWindow = window as typeof window & {
      chrome?: Record<string, unknown> & {
        runtime?: Record<string, unknown>;
      };
      Permissions?: {
        prototype?: {
          query?: (parameters: any) => Promise<any>;
        };
      };
    };

    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      enumerable: true,
      get: () => undefined
    });

    Object.defineProperty(navigator, "languages", {
      configurable: true,
      enumerable: true,
      get: () => ["de-DE", "de", "en-US", "en"]
    });

    Object.defineProperty(navigator, "platform", {
      configurable: true,
      enumerable: true,
      get: () => "MacIntel"
    });

    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      enumerable: true,
      get: () => "Google Inc."
    });

    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      get: () => 8
    });

    try {
      Object.defineProperty(navigator, "deviceMemory", {
        configurable: true,
        get: () => 8
      });
    } catch {}

    try {
      if (typeof Plugin !== "undefined" && typeof PluginArray !== "undefined") {
        const makeFakePlugin = (name: string, filename: string, description: string) => {
          const plugin = Object.create(Plugin.prototype);
          Object.defineProperties(plugin, {
            name: { value: name, enumerable: true },
            filename: { value: filename, enumerable: true },
            description: { value: description, enumerable: true },
            length: { value: 0, enumerable: true }
          });
          return plugin;
        };

        const fakePlugins = [
          makeFakePlugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
          makeFakePlugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
          makeFakePlugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format")
        ];

        Object.defineProperty(navigator, "plugins", {
          configurable: true,
          enumerable: true,
          get: () => {
            const array = [...fakePlugins] as unknown as PluginArray;
            Object.setPrototypeOf(array, PluginArray.prototype);
            return array;
          }
        });
      }
    } catch {}

    globalWindow.chrome = {
      ...globalWindow.chrome,
      app: {
        isInstalled: false,
        InstallState: {
          DISABLED: "disabled",
          INSTALLED: "installed",
          NOT_INSTALLED: "not_installed"
        },
        RunningState: {
          CANNOT_RUN: "cannot_run",
          READY_TO_RUN: "ready_to_run",
          RUNNING: "running"
        }
      },
      runtime: {
        ...(globalWindow.chrome?.runtime ?? {}),
        PlatformOs: {
          MAC: "mac",
          WIN: "win",
          ANDROID: "android",
          CROS: "cros",
          LINUX: "linux"
        },
        PlatformArch: {
          ARM: "arm",
          X86_32: "x86-32",
          X86_64: "x86-64"
        },
        OnInstalledReason: {
          INSTALL: "install",
          UPDATE: "update",
          CHROME_UPDATE: "chrome_update"
        }
      },
      loadTimes: () => ({}),
      csi: () => ({})
    };

    const permissions = globalWindow.Permissions;
    const originalQuery = permissions?.prototype?.query;

    if (typeof originalQuery === "function") {
      permissions.prototype.query = function query(this: unknown, parameters: any) {
        if (parameters?.name === "notifications") {
          const notificationPermission =
            typeof Notification !== "undefined" ? Notification.permission : "default";

          return Promise.resolve({
            state: notificationPermission,
            onchange: null
          });
        }

        return originalQuery.call(this, parameters);
      };
    }

    try {
      Object.defineProperty(window, "outerWidth", {
        configurable: true,
        get: () => window.innerWidth + 16
      });
      Object.defineProperty(window, "outerHeight", {
        configurable: true,
        get: () => window.innerHeight + 88
      });
    } catch {}

    try {
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function patchedGetParameter(param: number) {
          if (param === 37445) {
            return "Apple Inc.";
          }

          if (param === 37446) {
            return "Apple M-series GPU";
          }

          return getParameter.call(this, param);
        };
      }
    } catch {}
  };
}
