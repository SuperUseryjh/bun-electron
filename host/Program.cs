using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

namespace BunElectron.Host;

static class Program
{
    private static readonly Dictionary<string, WindowState> Windows = new();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = false
    };

    [STAThread]
    static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // Hidden pump form to keep the message loop alive
        using var pump = new Form();
        pump.WindowState = FormWindowState.Minimized;
        pump.ShowInTaskbar = false;
        pump.Load += (_, _) =>
        {
            // Signal ready to Bun
            SendEvent(new JsonObject
            {
                ["event"] = "ready"
            });

            // Start reading stdin on background thread after pump is ready
            _ = Task.Run(() => StdinReaderLoop(pump));
        };
        pump.FormClosing += (_, _) => Environment.Exit(0);

        Application.Run(pump);
        Environment.Exit(0);
    }

    static async Task StdinReaderLoop(Form pump)
    {
        var reader = Console.In;
        string? line;
        var isFirstLine = true;

        while ((line = await reader.ReadLineAsync()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            // Strip BOM from first line if present
            if (isFirstLine && line.Length > 0 && line[0] == '\uFEFF')
            {
                line = line.Substring(1);
            }
            isFirstLine = false;

            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                var cmd = JsonNode.Parse(line)!;
                var type = cmd["cmd"]?.GetValue<string>() ?? "";

                // Dispatch to UI thread
                pump.BeginInvoke(() => DispatchCommand(type, cmd));
            }
            catch (Exception ex)
            {
                SendEvent(new JsonObject
                {
                    ["event"] = "error",
                    ["message"] = JsonValue.Create(ex.Message)
                });
            }
        }

        // stdin closed -> quit
        pump.BeginInvoke(Application.Exit);
    }

    static void DispatchCommand(string type, JsonNode cmd)
    {
        switch (type)
        {
            case "create_window":
                HandleCreateWindow(cmd);
                break;
            case "navigate":
                HandleNavigate(cmd);
                break;
            case "eval":
                HandleEval(cmd);
                break;
            case "show_devtools":
                HandleShowDevTools(cmd);
                break;
            case "set_title":
                HandleSetTitle(cmd);
                break;
            case "set_size":
                HandleSetSize(cmd);
                break;
            case "close":
                HandleClose(cmd);
                break;
            case "send_to_renderer":
                HandleSendToRenderer(cmd);
                break;
            case "quit":
                Application.Exit();
                break;
        }
    }

    static void HandleCreateWindow(JsonNode cmd)
    {
        var id = cmd["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString();
        var url = cmd["url"]?.GetValue<string>() ?? "about:blank";
        var width = cmd["width"]?.GetValue<int>() ?? 1024;
        var height = cmd["height"]?.GetValue<int>() ?? 768;
        var title = cmd["title"]?.GetValue<string>() ?? "Bun Electron";
        var center = cmd["center"]?.GetValue<bool>() ?? true;

        var form = new Form
        {
            Text = title,
            Width = width,
            Height = height,
            StartPosition = center ? FormStartPosition.CenterScreen : FormStartPosition.Manual
        };

        var webView = new WebView2
        {
            Dock = DockStyle.Fill
        };

        form.Controls.Add(webView);

        // Initialize WebView2
        webView.CoreWebView2InitializationCompleted += (_, args) =>
        {
            if (!args.IsSuccess)
            {
                SendEvent(new JsonObject
                {
                    ["event"] = "error",
                    ["message"] = JsonValue.Create("WebView2 init failed")
                });
                return;
            }

            var core = webView.CoreWebView2!;
            core.Settings.IsScriptEnabled = true;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsWebMessageEnabled = true;

            // Handle IPC from renderer (via window.chrome.webview.postMessage)
            core.WebMessageReceived += (_, msgArgs) =>
            {
                try
                {
                    var json = msgArgs.TryGetWebMessageAsString();
                    var msg = JsonNode.Parse(json);
                    var channel = msg?["channel"]?.GetValue<string>();
                    var data = msg?["data"]?.ToString();

                    SendEvent(new JsonObject
                    {
                        ["event"] = "ipc_message",
                        ["window_id"] = JsonValue.Create(id),
                        ["channel"] = JsonValue.Create(channel),
                        ["data"] = data != null ? JsonValue.Create(data) : null
                    });
                }
                catch { }
            };

            // Inject IPC bridge into every page
            var bridge = """
(function() {
    window.__bunElectronBridge = {
        _listeners: {},
        on: function(ch, cb) {
            if (!this._listeners[ch]) this._listeners[ch] = [];
            this._listeners[ch].push(cb);
        },
        send: function(ch, data) {
            try {
                window.chrome.webview.postMessage(JSON.stringify({channel: ch, data: data}));
            } catch(e) {
                console.error('IPC send error:', e);
            }
        },
        _receive: function(ch, data) {
            if (this._listeners[ch]) this._listeners[ch].forEach(function(cb) { cb(data); });
        }
    };
    window.bunElectron = window.__bunElectronBridge;
})();
""";
            core.AddScriptToExecuteOnDocumentCreatedAsync(bridge);
        };

        webView.Source = new Uri(url);

        form.FormClosed += (_, _) =>
        {
            Windows.Remove(id);
            SendEvent(new JsonObject
            {
                ["event"] = "window_closed",
                ["window_id"] = JsonValue.Create(id)
            });
        };

        Windows[id] = new WindowState { Form = form, WebView = webView };
        form.Show();

        SendEvent(new JsonObject
        {
            ["event"] = "window_created",
            ["window_id"] = JsonValue.Create(id)
        });
    }

    static WindowState? GetWindow(string id)
    {
        return Windows.TryGetValue(id, out var w) ? w : null;
    }

    static void HandleNavigate(JsonNode cmd)
    {
        var id = cmd["window_id"]?.GetValue<string>();
        var url = cmd["url"]?.GetValue<string>();
        if (id == null || url == null) return;
        var w = GetWindow(id);
        w?.WebView.CoreWebView2?.Navigate(url);
    }

    static async void HandleEval(JsonNode cmd)
    {
        var id = cmd["window_id"]?.GetValue<string>();
        var code = cmd["code"]?.GetValue<string>();
        if (id == null || code == null) return;
        var w = GetWindow(id);
        if (w?.WebView.CoreWebView2 == null) return;

        try
        {
            var result = await w.WebView.CoreWebView2.ExecuteScriptAsync(code);
            SendEvent(new JsonObject
            {
                ["event"] = "eval_result",
                ["window_id"] = JsonValue.Create(id),
                ["result"] = JsonValue.Create(result)
            });
        }
        catch (Exception ex)
        {
            SendEvent(new JsonObject
            {
                ["event"] = "eval_result",
                ["window_id"] = JsonValue.Create(id),
                ["error"] = JsonValue.Create(ex.Message)
            });
        }
    }

    static void HandleShowDevTools(JsonNode cmd)
    {
        var id = cmd["window_id"]?.GetValue<string>();
        var w = GetWindow(id);
        w?.WebView.CoreWebView2?.OpenDevToolsWindow();
    }

    static void HandleSetTitle(JsonNode cmd)
    {
        var id = cmd["window_id"]?.GetValue<string>();
        var title = cmd["title"]?.GetValue<string>();
        if (id == null || title == null) return;
        var w = GetWindow(id);
        if (w != null) w.Form.Text = title;
    }

    static void HandleSetSize(JsonNode cmd)
    {
        var id = cmd["window_id"]?.GetValue<string>();
        var w = GetWindow(id);
        if (w == null) return;

        if (cmd["width"] is JsonValue wv) w.Form.Width = (int)wv;
        if (cmd["height"] is JsonValue hv) w.Form.Height = (int)hv;
        if (cmd["x"] is JsonValue xv) w.Form.Left = (int)xv;
        if (cmd["y"] is JsonValue yv) w.Form.Top = (int)yv;
    }

    static async void HandleSendToRenderer(JsonNode cmd)
    {
        var id = cmd["window_id"]?.GetValue<string>();
        var channel = cmd["channel"]?.GetValue<string>();
        var data = cmd["data"]?.ToString();
        if (id == null || channel == null) return;
        var w = GetWindow(id);
        if (w?.WebView.CoreWebView2 == null) return;

        var escaped = JsonSerializer.Serialize(data ?? "null");
        var js = $"window.__bunElectronBridge._receive({JsonSerializer.Serialize(channel)}, {escaped})";
        await w.WebView.CoreWebView2.ExecuteScriptAsync(js);
    }

    static void HandleClose(JsonNode cmd)
    {
        var id = cmd["window_id"]?.GetValue<string>();
        if (id == null) return;
        var w = GetWindow(id);
        w?.Form.Close();
    }

    static void SendEvent(JsonObject obj)
    {
        var json = obj.ToJsonString(JsonOptions);
        Console.Out.WriteLine(json);
        Console.Out.Flush();
    }
}

public class WindowState
{
    public required Form Form { get; init; }
    public required WebView2 WebView { get; init; }
}