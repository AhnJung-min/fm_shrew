using System.Collections.Specialized;
using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 이 PC 안에서만 열리는 작은 HTTP 서버. 요청마다 암호(토큰)를 확인하고, 브라우저에서 온 요청은 받지 않는다.
/// </summary>
internal static class Server
{
    private const int FirstPort = 48526;

    public static int Port { get; private set; }
    public static string Host { get; private set; } = "127.0.0.1";

    private static HttpListener listener;
    private static byte[] token = Array.Empty<byte>();

    public static void Start()
    {
        var tokenText = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        token = Encoding.ASCII.GetBytes(tokenText);

        // 두 주소 모두 이 PC 안에서만 닿는다. Windows 설정에 따라 한쪽만 관리자 권한 없이 열린다
        foreach (var host in new[] { "127.0.0.1", "localhost" })
        {
            for (var port = FirstPort; port < FirstPort + 10 && listener == null; port++)
            {
                var candidate = new HttpListener();
                candidate.Prefixes.Add($"http://{host}:{port}/");
                try
                {
                    candidate.Start();
                    listener = candidate;
                    Port = port;
                    Host = host;
                }
                catch (HttpListenerException)
                {
                    candidate.Close();
                }
            }
        }
        if (listener == null) throw new InvalidOperationException("쓸 수 있는 포트가 없습니다.");

        BridgeFiles.WriteInfo(Host, Port, tokenText);
        new Thread(Loop) { IsBackground = true, Name = "FmBojwagwanBridge" }.Start();
    }

    private static void Loop()
    {
        while (listener is { IsListening: true })
        {
            HttpListenerContext context;
            try
            {
                context = listener.GetContext();
            }
            catch
            {
                break;
            }
            Task.Run(() => Handle(context));
        }
    }

    private static void Handle(HttpListenerContext context)
    {
        var status = 200;
        string body;
        try
        {
            var request = context.Request;
            if (request.Headers["Origin"] != null) throw new HttpError(403, "browser requests are not allowed");
            var given = request.Headers["X-Bridge-Token"] ?? request.QueryString["token"] ?? "";
            if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(given), token))
                throw new HttpError(401, "bad token");
            var sent = "";
            if (request.HasEntityBody)
            {
                using var reader = new StreamReader(request.InputStream, Encoding.UTF8);
                sent = reader.ReadToEnd();
            }
            body = Route(request.Url?.AbsolutePath ?? "/", request.QueryString, sent);
        }
        catch (HttpError error)
        {
            status = error.Status;
            body = error.Message;
        }
        catch (TimeoutException error)
        {
            status = 504;
            body = error.Message;
        }
        catch (Exception error)
        {
            status = 500;
            body = error.ToString();
        }

        try
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            context.Response.StatusCode = status;
            context.Response.ContentType = "text/plain; charset=utf-8";
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.Close();
        }
        catch
        {
            // 받는 쪽이 먼저 끊었다
        }
    }

    private static string Route(string path, NameValueCollection query, string sent)
    {
        bool Flag(string name) => query[name] is "1" or "true";
        int Number(string name, int fallback) => int.TryParse(query[name], out var value) ? value : fallback;
        string Need(string name) => query[name] ?? throw new HttpError(400, $"missing '{name}'");

        switch (path)
        {
            case "/ping":
                return $"fm-bojwagwan-bridge {Plugin.Version}";

            // 게임 안 "직접 답변" 칸과 앱 사이의 통로. poll은 새 말이 생길 때까지 이 스레드에서 기다린다
            case "/talk/poll":
                return TalkBox.Poll(Number("after", 0), Number("wait", 25));
            case "/talk/shouts":
                return TalkBox.Shouts();
            case "/talk/reply":
                return TalkBox.Reply(Number("seq", 0), sent);

            // 화면 구조
            case "/tree":
                return MainThread.Run(() => UiTree.Dump(new UiTree.Options
                {
                    IncludeHidden = Flag("all"),
                    WithIds = !Flag("noids"),
                    MaxDepth = Number("depth", 200),
                    WithPaths = Flag("paths"),
                    RootId = Number("root", 0)
                }));
            case "/dump":
                return MainThread.Run(() => Watcher.DumpToFile(query["tag"] ?? "manual"));

            // 게임 객체 조회(개발용)
            case "/inspect":
                return MainThread.Run(() => Il2.Inspect(Need("id"), Flag("values"), Flag("deep")));
            case "/get":
                return MainThread.Run(() => Il2.Member(Need("id"), Need("member"), query.GetValues("arg") ?? Array.Empty<string>()));
            case "/list":
                return MainThread.Run(() => Il2.List(Need("id"), Number("max", 100)));
            case "/find":
                return MainThread.Run(() => Il2.FindObjects(Need("type"), Number("max", 50)));
            case "/classes":
                return MainThread.Run(() => Il2.Classes(Need("match"), Number("max", 500)), 30_000);
            case "/reset":
                return MainThread.Run(() =>
                {
                    Handles.Clear();
                    return "ok";
                });

            // 게임이 화면에 넣어 주는 값들(개발용, 읽기만)
            case "/data":
                return MainThread.Run(() => DataTree.Dump(query["path"], Number("depth", 3), Number("max", 600)), 30_000);
            case "/datadump":
                return MainThread.Run(() => Watcher.DumpDataToFile(query["tag"] ?? "manual"), 30_000);

            // 대상마다 달라고 할 수 있는 항목 이름(개발용, 읽기만)
            case "/props":
                return MainThread.Run(() => DataNames.Props(Need("type"), query["match"]), 60_000);
            case "/owners":
                return MainThread.Run(() => DataNames.Owners(Need("match"), Il2.Classes("^FM[.]UI[.][A-Za-z0-9]+Reference$", 3000)), 60_000);

            // 화면에 없는 값을 게임에 청해 보기(개발용)
            case "/bind":
                return MainThread.Run(() => DataProbe.Bind(Need("path")));
            case "/bound":
                return MainThread.Run(DataProbe.Bound);
            case "/alias":
                return MainThread.Run(() => DataProbe.Alias(Need("name"), Need("from"), Number("index", -1)));
            case "/probe/clear":
                return MainThread.Run(DataProbe.Clear);
            // 카드가 게임에서 받아 둔 값들
            case "/gamedata":
                return MainThread.Run(GameData.Dump);

            // 견본 카드 띄우기(개발용): kind = goal, multi, hat, best
            case "/card/test":
                return MainThread.Run(() => MatchCards.Test(query["kind"] ?? "goal"));

            // 누르기(실험)
            case "/click":
                return MainThread.Run(() => Clicker.Click(Number("id", 0), query["mode"] ?? "clickable"));

            default:
                throw new HttpError(404, "unknown path");
        }
    }
}

internal sealed class HttpError : Exception
{
    public int Status { get; }

    public HttpError(int status, string message) : base(message) => Status = status;
}
