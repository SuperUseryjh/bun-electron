/**
 * Demo App - demonstrates the Bun Electron API
 */

import { init, BrowserWindow } from "../src/index";

async function main() {
  // Initialize the Bun Electron runtime (starts the C# host)
  const { app, ipcMain, host } = await init();

  console.log("Bun Electron demo starting...");
  console.log(`PID: ${process.pid}`);

  // Handle IPC messages from renderer
  ipcMain.on("counter:increment", (event, currentCount) => {
    const newCount = (typeof currentCount === "number" ? currentCount : 0) + 1;
    console.log(`Counter incremented to: ${newCount}`);

    // Send updated count back to the renderer
    event.sender.send("counter:updated", newCount);
  });

  ipcMain.on("counter:reset", (event) => {
    console.log("Counter reset");
    event.sender.send("counter:updated", 0);
  });

  // Create the main window
  const win = new BrowserWindow(host, {
    width: 900,
    height: 680,
    title: "Bun Electron Demo",
    center: true,
    webPreferences: {
      devTools: true,
    },
  });

  // Load the demo HTML page (served by Bun's built-in HTTP server)
  await win.loadFile("demo/public/index.html");

  // When window is closed, quit the app
  win.on("closed", () => {
    console.log("Window closed, quitting...");
    app.quit();
  });

  console.log("Demo app running! Open the window to see the UI.");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});