using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 앱이 "지금 게임이 어떤 상태인가"를 물을 때 주는 답: 플러그인 버전과 게임 버전, 게임의 오늘 날짜, 세이브를 불러왔는지, 감독과 팀,
/// 내 팀 선수 이름과 고유 번호.
///
/// 값은 게임 화면이 쓰는 것과 같은 통로(GameData)로 청해 두고, 화면 스레드에서 가끔 모아 글로 만들어 둔다.
/// 앱의 요청(/state)은 만들어 둔 글을 그대로 돌려주므로 화면 스레드를 기다리지 않는다.
/// 내 팀 선수 이름은 앱이 세이브에서 내 팀을 찾는 데 쓴다(게임에서 따로 내보내지 않아도 되게).
/// 선수 고유 번호("playerIds")는 이름과 같은 순서로 싣는다. 앱은 전술을 물을 선수를 고를 때 번호로 먼저 찾고, 번호가 없으면 이름으로 찾는다.
/// 게임의 오늘 날짜("gameDate")는 "yyyy-MM-dd"이고, 아직 모르면 빈 글자다. 모두 읽기만 한다.
/// </summary>
internal static class LiveState
{
    private const string Root = "fmb.s";
    private const string Manager = "Human.Name";
    private const string Team = "Human.Team.Name";
    private const string TeamShort = "Human.Team.ShortName";
    private const string Players = "Human.Team.Players";
    /// <summary>게임의 오늘 날짜(GameDate 값. 풀이는 GameData.DateOf가 게임의 함수로 한다)</summary>
    private const string CurrentDate = "game.CurrentGameDate";
    private const int MaxPlayers = 60;
    private const int TickMs = 2000;
    /// <summary>선수 명단을 다시 올리는 간격(영입·방출로 바뀔 수 있다)</summary>
    private const int RosterMs = 30_000;

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static long nextTick;
    private static long nextRoster;
    private static int placed;
    private static bool wanted;
    private static volatile string current = "";
    /// <summary>
    /// 게임 버전(유니티의 Application.version). 게임 스레드에서 한 번 읽어 둔다(다른 스레드에서 유니티를 부르지 않으려고). 못 읽으면 빈 글자.
    /// 앱은 이것으로 게임이 앱이 확인한 판인지 본다(0.14.0부터).
    /// </summary>
    private static volatile string gameVersion = "";
    private static bool versionRead;

    /// <summary>만들어 둔 상태 글(JSON). 어느 스레드에서 불러도 된다.</summary>
    public static string Json()
    {
        var text = current;
        return text.Length > 0 ? text : Build(false, "", "", "", new List<string>(), "", new List<long>());
    }

    private static string Quote(string value)
    {
        var text = new StringBuilder("\"");
        foreach (var ch in value ?? "")
        {
            switch (ch)
            {
                case '"': text.Append("\\\""); break;
                case '\\': text.Append("\\\\"); break;
                case '\n': text.Append("\\n"); break;
                case '\r': text.Append("\\r"); break;
                case '\t': text.Append("\\t"); break;
                default:
                    if (ch < 0x20) text.Append("\\u").Append(((int)ch).ToString("x4"));
                    else text.Append(ch);
                    break;
            }
        }
        return text.Append('"').ToString();
    }

    /// <summary>date는 "yyyy-MM-dd"(모르면 빈 글자), playerIds는 players와 같은 순서(읽지 못한 번호는 0)</summary>
    private static string Build(bool loaded, string manager, string team, string teamShort, List<string> players, string date, List<long> playerIds)
    {
        var text = new StringBuilder("{");
        text.Append("\"version\":").Append(Quote(Plugin.Version));
        text.Append(",\"gameVersion\":").Append(Quote(gameVersion));
        text.Append(",\"gameDate\":").Append(Quote(date));
        text.Append(",\"loaded\":").Append(loaded ? "true" : "false");
        text.Append(",\"manager\":").Append(Quote(manager));
        text.Append(",\"team\":").Append(Quote(team));
        text.Append(",\"teamShort\":").Append(Quote(teamShort));
        text.Append(",\"records\":").Append(LiveMemory.Records);
        text.Append(",\"players\":[").Append(string.Join(",", players.Select(Quote))).Append(']');
        text.Append(",\"playerIds\":[").Append(string.Join(",", playerIds.Select(id => id.ToString(CultureInfo.InvariantCulture)))).Append("]}");
        return text.ToString();
    }

    /// <summary>화면 스레드에서 프레임마다 부른다.</summary>
    public static void Tick()
    {
        var now = Clock.ElapsedMilliseconds;
        if (now < nextTick) return;
        nextTick = now + TickMs;
        try
        {
            Step(now);
        }
        catch (Exception error)
        {
            nextTick = now + 10_000;
            Plugin.Logger.LogWarning($"live state: {error.Message}");
        }
    }

    /// <summary>화면 스레드에서 처음 한 번만 게임 버전을 읽어 둔다(읽지 못하면 빈 글자로 두고 다시 읽지 않는다)</summary>
    private static void ReadGameVersion()
    {
        if (versionRead) return;
        versionRead = true;
        try
        {
            gameVersion = UnityEngine.Application.version ?? "";
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"live state: game version: {error.Message}");
        }
    }

    private static void Step(long now)
    {
        ReadGameVersion();
        if (!GameData.Available)
        {
            current = Build(false, "", "", "", new List<string>(), "", new List<long>());
            return;
        }
        // 세이브를 불러오기 전(메인 메뉴)에는 "Human"이 없다
        if (!GameData.Exists("Human"))
        {
            if (wanted)
            {
                GameData.Drop(Root + ".");
                GameData.Drop("Human.");
                wanted = false;
                placed = 0;
            }
            current = Build(false, "", "", "", new List<string>(), "", new List<long>());
            return;
        }
        if (!wanted)
        {
            GameData.Want(Manager);
            GameData.Want(Team);
            GameData.Want(TeamShort);
            GameData.Want(Players);
            GameData.Want(CurrentDate);
            wanted = true;
            nextRoster = 0;
        }

        var count = Math.Min(MaxPlayers, GameData.Count(Players));
        if (count > 0 && now >= nextRoster)
        {
            nextRoster = now + RosterMs;
            placed = 0;
            for (var i = 0; i < count; i++)
            {
                var item = $"{Root}.p{i}";
                if (!GameData.Put(item, Players, i)) break;
                GameData.Want(item + ".Name");
                GameData.Want(item + ".UniqueId");
                placed++;
            }
        }

        var names = new List<string>();
        var ids = new List<long>();
        for (var i = 0; i < placed; i++)
        {
            var name = GameData.Text($"{Root}.p{i}.Name");
            if (string.IsNullOrEmpty(name)) continue;
            names.Add(name);
            // 번호는 이름과 같은 순서로 싣는다. 번호를 읽지 못한 선수는 0이고(앱이 건너뛴다), 그 때문에 이름이 빠지지는 않는다
            ids.Add(long.TryParse(GameData.Text($"{Root}.p{i}.UniqueId"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) && id > 0 ? id : 0);
        }
        var team = GameData.Text(Team) ?? "";
        current = Build(true, GameData.Text(Manager) ?? "", team, GameData.Text(TeamShort) ?? "", names, GameData.DateOf(CurrentDate) ?? "", ids);
    }
}
