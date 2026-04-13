class FilePolyfill {}

if (!("File" in globalThis)) {
  Object.defineProperty(globalThis, "File", {
    value: FilePolyfill,
    configurable: true,
    writable: true
  });
}

