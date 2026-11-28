using System.Collections.Specialized;
using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 이 PC 안에서만 열리는 작은 HTTP 서버. 요청마다 암호(토큰)를 확인하고, 브라우저에서 온 요청은 받지 않는다.
/// 게임 구조를 조사하는 개발용 창구는 -p:DevEndpoints=true로 빌드한 것에만 들어 있다(일반 배포본에는 없다).
/// </summary>
internal static class Server
{
    private const int FirstPort = 48526;

    public static int Port { get; private set; }
    public static string Host { get; private set; } = "127.0.0.1";

#if DEV_ENDPOINTS
    public const bool DevEndpoints = true;
#else
    public const bool DevEndpoints = false;
#endif

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
        var path = "/";
        try
        {
            var request = context.Request;
            path = request.Url?.AbsolutePath ?? "/";
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
            // 모든 선수의 지금 값은 양이 많아 글이 아니라 바이트 덩어리로 준다
            if (path == "/live/all")
            {
                var packed = LiveMemory.All(request.QueryString["rescan"] is "1" or "true");
                context.Response.StatusCode = 200;
                context.Response.ContentType = "application/octet-stream";
                context.Response.ContentLength64 = packed.Length;
                context.Response.OutputStream.Write(packed, 0, packed.Length);
                context.Response.Close();
                return;
            }
            body = Route(path, request.QueryString, sent);
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
            // 응답에는 요약만 싣고, 자세한 내용은 BepInEx 기록에 남긴다(개편 N-03)
            status = 500;
            body = Summary(error);
            Plugin.Logger.LogWarning($"request {path} failed: {error}");
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

    /// <summary>예외의 종류와 첫 줄만(게임 쪽 호출 경로나 메모리 주소를 응답에 싣지 않는다).</summary>
    private static string Summary(Exception error)
    {
        var inner = error.InnerException ?? error;
        var line = (inner.Message ?? "").Split('\n')[0].Trim();
        if (line.Length > 160) line = line[..160];
        return $"{inner.GetType().Name}: {line}";
    }

    /// <summary>
    /// 지금 게임이 네트워크(온라인) 게임인지. 게임이 알려 주는 game.IsOnlineGame을 읽는다.
    /// 1초 안에 알 수 없으면 false(막지 않는다)로 보고 기록에 남긴다.
    /// </summary>
    private static bool OnlineGame()
    {
        for (var i = 0; i < 10; i++)
        {
            var text = MainThread.Run(() =>
            {
                GameData.Want("game.IsOnlineGame");
                return GameData.Text("game.IsOnlineGame") ?? "";
            });
            if (text.Length > 0) return text == "True";
            Thread.Sleep(100);
        }
        Plugin.Logger.LogWarning("live edit: could not tell whether this is an online game");
        return false;
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
            // 앱이 게임 상태를 물을 때: 세이브를 불러왔는지, 감독과 팀, 내 팀 선수 이름
            case "/state":
                return LiveState.Json();

            // 게임 안 "직접 답변" 칸과 앱 사이의 통로. poll은 새 말이 생길 때까지 이 스레드에서 기다린다
            case "/talk/poll":
                return TalkBox.Poll(Number("after", 0), Number("wait", 25));
            case "/talk/shouts":
                return TalkBox.Shouts();
            case "/talk/reply":
                return TalkBox.Reply(Number("seq", 0), sent);

            // 화면 구조(직접 답변이 지금 화면을 알 때 쓴다)
            case "/tree":
                return MainThread.Run(() => UiTree.Dump(new UiTree.Options
                {
                    IncludeHidden = Flag("all"),
                    WithIds = !Flag("noids"),
                    MaxDepth = Number("depth", 200),
                    WithPaths = Flag("paths"),
                    RootId = Number("root", 0)
                }));

            // 에디터의 실시간 반영: 켜져 있는 게임의 메모리에서 선수 기록을 읽고 고친다(이 스레드에서 돈다)
            case "/live/player":
                return LiveMemory.Player(Need("uid"));
            case "/live/set":
                // 네트워크 게임에서는 쓰지 않는다(개편 N-03)
                if (OnlineGame()) throw new HttpError(403, "online game: editor writes are off");
                return LiveMemory.Set(Need("uid"), query["positions"], query["attributes"], query["ca"], query["pa"]);
            // 선수의 몸값·주급·계약·국적, 팀·나라의 이름: 게임에 물어 받아 온다(이 스레드에서 기다린다)
            case "/people":
                return PersonInfo.People(Need("uids"));
            case "/names":
                return PersonInfo.Names(Need("kind"), Need("ids"));
            // 내 구단의 프로필·시설·재정, 1군 선수들의 건강과 경기력(게임에 물어 받아 온다)
            case "/club":
                return ClubInfo.Club(Need("team"));
            case "/health":
                return ClubInfo.Health(Need("uids"), query["team"]);
            // 지금 게임 전술(자리 11개의 포지션·역할, 점유 시와 비점유 시)과 선수들의 역할 별점(0.14.0부터, 읽기만)
            case "/tactic":
                return TacticInfo.Tactic(Need("team"), Need("uid"), Flag("roles"));
            case "/rolestars":
                return TacticInfo.RoleStars(Need("team"), Need("uids"));

#if DEV_ENDPOINTS
            // ── 아래는 개발용 창구(게임 구조 조사). -p:DevEndpoints=true로 빌드한 것에만 있다 ──
            case "/dump":
                return MainThread.Run(() => Watcher.DumpToFile(query["tag"] ?? "manual"));

            // 게임 객체 조회
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

            // 게임이 화면에 넣어 주는 값들(읽기만)
            case "/data":
                return MainThread.Run(() => DataTree.Dump(query["path"], Number("depth", 3), Number("max", 600)), 30_000);
            case "/datadump":
                return MainThread.Run(() => Watcher.DumpDataToFile(query["tag"] ?? "manual"), 30_000);

            // 대상마다 달라고 할 수 있는 항목 이름(읽기만)
            case "/props":
                return MainThread.Run(() => DataNames.Props(Need("type"), query["match"]), 60_000);
            case "/owners":
                return MainThread.Run(() => DataNames.Owners(Need("match"), Il2.Classes("^FM[.]UI[.][A-Za-z0-9]+Reference$", 3000)), 60_000);

            // 화면에 없는 값을 게임에 청해 보기
            case "/bind":
                return MainThread.Run(() => DataProbe.Bind(Need("path")));
            case "/bound":
                return MainThread.Run(DataProbe.Bound);
            case "/alias":
                return MainThread.Run(() => DataProbe.Alias(Need("name"), Need("from"), Number("index", -1)));
            case "/probe/clear":
                return MainThread.Run(DataProbe.Clear);
            // 한 팀이나 선수에 임의의 항목 경로를 청해 본다(조건 값 ctx, 목록 list·items는 0.12.0부터)
            case "/fields":
                return ClubInfo.Fields(Need("kind"), Need("id"), Need("f"), query["team"], query["ctx"], query["list"], query["items"], Number("max", 40));
            // 번호로 선수를 가리키는 마디를 올린다. 그 뒤 /bind로 항목을 청해 본다
            case "/alias/person":
            {
                var name = Need("name");
                if (!name.StartsWith(GameData.OurRoot, StringComparison.OrdinalIgnoreCase)) throw new HttpError(400, "name must start with fmb.");
                if (!uint.TryParse(Need("uid"), out var uid) || !LiveMemory.PersonIndex(uid, out var index)) return "player not found";
                return MainThread.Run(() => GameData.PutRecord(name, GameData.RecordKind.Person, index) ? $"{name} = person {index}" : "failed");
            }
            // 메모리 조사(읽기만)
            case "/mem/find":
                return LiveMemory.Find(Need("hex"), Number("max", 20));
            case "/mem/dump":
                return LiveMemory.Dump(Need("addr"), Number("len", 256));

            // 카드가 게임에서 받아 둔 값들
            case "/gamedata":
                return MainThread.Run(GameData.Dump);

            // 견본 카드 띄우기: kind = goal, multi, hat, best
            case "/card/test":
                return MainThread.Run(() => MatchCards.Test(query["kind"] ?? "goal", query["person"]));

            // 누르기(실험)
            case "/click":
                return MainThread.Run(() => Clicker.Click(Number("id", 0), query["mode"] ?? "clickable"));
#endif

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
