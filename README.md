# Bun Electron

A lightweight Electron alternative using **Bun** + **WebView2** for building desktop applications on Windows.

## Why Bun Electron?

| Feature | Electron | Bun Electron |
|---------|----------|--------------|
| Runtime | Node.js | **Bun** (2-4x faster JS execution) |
| Renderer | Bundled Chromium (~200MB) | **System WebView2** (< 1MB) |
| Memory | ~300-500MB baseline | **~50-100MB baseline** |
| Startup | Slow (Chromium load) | **Fast** (native WebView2) |
| Distribution | Heavy installer | **Lightweight** (~1MB host binary) |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Bun Main Process                         │
│  (TypeScript/JavaScript - App logic, IPC, file serving)    │
└─────────────────────┬───────────────────────────────────────┘
                      │  stdin/stdout JSON-RPC
                      ▼
┌─────────────────────────────────────────────────────────────┐
│               .NET WebView2 Host (C#)                       │
│  (Window management, WebView2 control, native APIs)        │
└─────────────────────┬───────────────────────────────────────┘
                      │  WebView2 API
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              WebView2 Renderer (Edge Chromium)              │
│  (HTML/CSS/JS UI, IPC bridge to main process)              │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Bun** >= 1.0 ([Install Bun](https://bun.sh))
- **.NET SDK** >= 9.0 ([Install .NET](https://dotnet.microsoft.com/download))
- **Windows 10/11** (WebView2 is built-in on Windows 11, auto-installed on Windows 10)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/yourname/bun-electron.git
cd bun-electron

# Build the C# WebView2 host
bun run build:host

# Run the demo
bun run demo
```

A window will open with a demo app demonstrating IPC communication between the renderer and main process.

## Project Structure

```
bun-electron/
├── host/                   # C# WebView2 native host
│   ├── WebViewHost.csproj  # .NET project file
│   └── Program.cs          # Window management & IPC bridge
├── src/                    # Bun TypeScript API
│   ├── index.ts            # Entry point & initialization
│   ├── app.ts              # App lifecycle (ready, quit)
│   ├── browser-window.ts   # BrowserWindow class
│   ├── host-manager.ts     # Host process management
│   └── ipc-main.ts         # IPC main process handlers
├── demo/                   # Demo application
│   ├── main.ts             # Demo entry point
│   └── public/index.html   # Demo frontend
└── build/host/             # Compiled host binary, not included in repo
    └── WebViewHost.exe
```

## API Reference

### Initialization

```typescript
import { init, BrowserWindow } from "bun-electron";

// Initialize the runtime (starts the C# host)
const { app, ipcMain, host } = await init();
```

### App Lifecycle

```typescript
// Wait for app to be ready
await app.whenReady();

// Quit the application
await app.quit();

// Get system paths
app.getPath("home");      // User home directory
app.getPath("appData");   // %APPDATA%
app.getPath("userData");  // App-specific data folder
app.getPath("temp");      // Temp directory
```

### BrowserWindow

```typescript
const win = new BrowserWindow(host, {
  width: 1024,
  height: 768,
  title: "My App",
  center: true,
  webPreferences: {
    devTools: true,
  },
});

// Load a URL
await win.loadURL("https://example.com");

// Load a local file (auto-served via HTTP)
await win.loadFile("public/index.html");

// Set window title
await win.setTitle("New Title");

// Resize window
await win.setBounds({ width: 800, height: 600 });

// Open DevTools
await win.toggleDevTools();

// Close window
await win.close();

// Events
win.on("closed", () => {
  console.log("Window closed");
});
```

### IPC Communication

**Main Process (Bun):**

```typescript
ipcMain.on("channel-name", (event, data) => {
  console.log("Received:", data);

  // Reply to renderer
  event.sender.send("reply-channel", { result: "ok" });
});

// Handle with async response
ipcMain.handle("fetch-data", async (event, query) => {
  const result = await fetchData(query);
  return result;
});
```

**Renderer Process (WebView2):**

```javascript
// Send message to main process
window.bunElectron.send("channel-name", { data: "hello" });

// Listen for messages from main process
window.bunElectron.on("reply-channel", (data) => {
  console.log("Reply:", data);
});
```

### WebContents

```typescript
// Access webContents from BrowserWindow
win.webContents.send("channel", data);

// Execute JavaScript in renderer
const result = await win.webContents.executeJavaScript("document.title");
```

## How It Works

### IPC Bridge

The C# host injects a JavaScript bridge into every page:

```javascript
window.bunElectron = {
  send: (channel, data) => { /* post to host */ },
  on: (channel, callback) => { /* register listener */ },
};
```

Messages flow through stdin/stdout as JSON lines:

```
Bun → Host: {"cmd":"create_window","id":"abc123","url":"..."}
Host → Bun: {"event":"window_created","window_id":"abc123"}
Renderer → Host: {"channel":"my-event","data":"hello"}
Host → Bun: {"event":"ipc_message","window_id":"abc123","channel":"my-event","data":"hello"}
```

### Static File Serving

When you call `win.loadFile("path/to/file.html")`, Bun automatically starts a local HTTP server to serve the file and navigates the WebView2 to that URL. This enables:

- Loading local HTML/CSS/JS files
- SPA routing (fallback to index.html)
- Hot reload during development

## Scripts

| Command | Description |
|---------|-------------|
| `bun run build:host` | Compile C# WebView2 host |
| `bun run demo` | Run the demo application |

## Development Tips

### Debugging

```typescript
// Open DevTools for debugging
await win.toggleDevTools();
```

### Hot Reload

For development, you can use Bun's built-in watch mode:

```bash
bun --watch run demo/main.ts
```

### Custom Host Path

```typescript
await init({
  hostPath: "./custom/path/WebViewHost.exe",
});
```

## Limitations (PoC)

This is a proof-of-concept. Current limitations:

- **Windows only** (WebView2 is Windows-specific)
- **No menu API** (can be added via WinForms)
- **No tray icon** (can be added via WinForms)
- **No multi-window IPC sync** (basic implementation)
- **No Node.js integration in renderer** (pure browser environment)

## Roadmap

Potential future enhancements:

- [ ] Menu API (`Menu`, `MenuItem`)
- [ ] Tray icon support
- [ ] Clipboard API
- [ ] File dialog API
- [ ] Notification API
- [ ] macOS support (via WKWebView)
- [ ] Linux support (via WebKitGTK)

## Comparison with Alternatives

| Framework | Runtime | Renderer | Size | Platform |
|-----------|---------|----------|------|----------|
| **Electron** | Node.js | Chromium | ~200MB | Win/Mac/Linux |
| **Tauri** | Rust | WebView | ~3MB | Win/Mac/Linux |
| **NW.js** | Node.js | Chromium | ~150MB | Win/Mac/Linux |
| **Bun Electron** | Bun | WebView2 | ~1MB | Windows |

## License

MIT

## Contributing

Contributions welcome! This is an experimental project exploring Bun's potential for desktop app development.

---

Built with [Bun](https://bun.sh) + [.NET WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)