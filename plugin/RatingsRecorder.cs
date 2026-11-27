using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 경기 평점 기록(개편 요구서 F-10의 기록 부분).
/// 내 팀의 "방금 끝난 경기"(Human.Team.LastFixture)가 바뀌면, 두 팀 선수의 경기 기록 목록(PlayerMatchStats)에서
/// 고유 번호, 평점, 뛴 시간, 뛴 자리를 모아 %LOCALAPPDATA%\FmBojwagwan\records\ratings.jsonl에 경기 한 줄로 덧붙인다.
/// 앱이 이 파일을 세이브별 기록으로 옮겨 간다. 숙련 감점 계수를 실제 평점으로 어림하는 자료다(반영은 나중 단계).
///
/// 확인한 것(FM26 26.3, 읽기만 해서):
///   경기에 "홈 팀인가"(isHomeTeam)를 조건으로 붙이면 그 팀의 목록이 온다. 줄마다
///   Player.UniqueId, TotalRating(안 뛴 교체 선수는 값이 없다), Position(선발만. 포지션 비트 + 왼쪽·오른쪽 표시),
///   IncidentType(0 없음, 1 교체로 들어옴, 2 교체로 나감), MatchTime(그 분), PlayerTeamSelectionIndex(맡은 자리 번호, 나갔으면 -1).
///   선발은 목록의 0~10번 줄이고 줄 번호가 처음 자리 번호다. 교체로 들어온 선수는 대신한 선발의 자리 번호를 이어받는다.
/// 경기 중에는 읽지 않는다. 게임 화면은 건드리지 않고, 우리 이름(fmb.r)의 마디만 잠깐 올렸다가 지운다.
/// </summary>
internal static class RatingsRecorder
{
    private const string Root = "fmb.r";
    private const string Fixture = "Human.Team.LastFixture";
    private const int CheckMs = 15_000;
    private const int StepMs = 200;
    private const int WaitMs = 5_000;
    private const int MaxRows = 40;
    private const int MaxTries = 3;
    private const int MaxFailures = 5;
    private static readonly string[] KeyPaths = { "FixtureDate", "HomeTeam.UniqueId", "AwayTeam.UniqueId", "HomeScore", "AwayScore" };
    private static readonly string[] MetaPaths = { "HomeTeam", "AwayTeam", "HomeTeam.Name", "AwayTeam.Name", "Competition.Name", "Competition.UniqueId" };
    private static readonly string[] RowPaths = { "Player.UniqueId", "TotalRating", "Position", "IncidentType", "MatchTime", "PlayerTeamSelectionIndex" };

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    /// <summary>0: 방금 끝난 경기를 지켜봄, 1: 두 팀 목록을 기다림, 2: 줄마다 항목을 기다림</summary>
    private static int stage;
    private static long nextStep;
    private static long since;
    /// <summary>마지막으로 적은 경기. 파일(ratings.last)에 남겨 게임을 다시 켜도 같은 경기를 또 적지 않는다</summary>
    private static string lastKey;
    private static string pendingKey = "";
    private static string pendingDate = "";
    private static int tries;
    private static int failures;
    /// <summary>팀마다(0 홈, 1 원정) 올린 줄 마디. 목록의 줄 번호와 같은 순서다</summary>
    private static readonly List<string>[] RowNodes = { new(), new() };

    private static string Folder => Path.Combine(BridgeFiles.Root, "records");

    private static string Side(int side) => side == 0 ? "h" : "a";

    /// <summary>매 프레임(메인 스레드). 대부분은 바로 돌아간다.</summary>
    public static void Tick()
    {
        var now = Clock.ElapsedMilliseconds;
        if (failures >= MaxFailures || now < nextStep) return;
        try
        {
            nextStep = now + StepMs;
            switch (stage)
            {
                case 0:
                    Watch(now);
                    break;
                case 1:
                    AskRows(now);
                    break;
                default:
                    Write(now);
                    break;
            }
        }
        catch (Exception error)
        {
            failures++;
            Plugin.Logger.LogWarning($"ratings ({failures}/{MaxFailures}): {error.Message}");
            Reset(now + CheckMs);
        }
    }

    private static void Reset(long next)
    {
        stage = 0;
        nextStep = next;
        RowNodes[0].Clear();
        RowNodes[1].Clear();
        try
        {
            GameData.Drop(Root + ".");
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"ratings: clean-up: {error.Message}");
        }
    }

    /// <summary>0단계: 방금 끝난 경기가 바뀌었는지 본다. 바뀌었으면 두 팀의 목록을 청한다.</summary>
    private static void Watch(long now)
    {
        nextStep = now + CheckMs;
        if (!GameData.Available) return;
        GameData.Want("game.IsDuringMatch");
        GameData.Want("const.True");
        GameData.Want("const.False");
        GameData.Want("Human.Team");
        foreach (var path in KeyPaths) GameData.Want($"{Fixture}.{path}");
        if (GameData.Text("game.IsDuringMatch") == "True") return;
        if (!GameData.Has("const.True") || !GameData.Has("const.False") || KeyPaths.Any(path => !GameData.Has($"{Fixture}.{path}"))) return;
        var date = GameData.DateOf($"{Fixture}.FixtureDate");
        if (date == null) return;
        var key = $"{date}|{GameData.Text($"{Fixture}.HomeTeam.UniqueId")}|{GameData.Text($"{Fixture}.AwayTeam.UniqueId")}|" +
                  $"{GameData.Text($"{Fixture}.HomeScore")}-{GameData.Text($"{Fixture}.AwayScore")}";
        lastKey ??= ReadLastKey();
        if (key == lastKey) return;
        if (key != pendingKey)
        {
            pendingKey = key;
            tries = 0;
        }
        if (++tries > MaxTries)
        {
            // 몇 번 청해도 목록이 오지 않는 경기는 건너뛴다(다음 경기부터 다시 본다)
            Plugin.Logger.LogInfo($"ratings: giving up on {key}");
            SaveLastKey(key);
            return;
        }

        pendingDate = date;
        GameData.Drop(Root + ".");
        foreach (var path in MetaPaths) GameData.Want($"{Fixture}.{path}");
        for (var side = 0; side < 2; side++)
        {
            var node = $"{Root}.{Side(side)}";
            if (!GameData.Put(node + ".isHomeTeam", side == 0 ? "const.True" : "const.False") || !GameData.Put(node + ".m", Fixture)) return;
            GameData.Want(node + ".m.PlayerMatchStats");
        }
        stage = 1;
        since = now;
        nextStep = now + StepMs;
    }

    /// <summary>1단계: 목록이 오면 줄마다 우리 마디를 올려 항목을 청한다.</summary>
    private static void AskRows(long now)
    {
        var counts = new int[2];
        for (var side = 0; side < 2; side++) counts[side] = GameData.Count($"{Root}.{Side(side)}.m.PlayerMatchStats");
        if ((counts[0] <= 0 || counts[1] <= 0) && now - since < WaitMs) return;
        if (counts[0] <= 0 && counts[1] <= 0)
        {
            Plugin.Logger.LogInfo($"ratings: no player lists for {pendingKey}");
            Reset(now + CheckMs);
            return;
        }
        for (var side = 0; side < 2; side++)
        {
            var list = $"{Root}.{Side(side)}.m.PlayerMatchStats";
            for (var i = 0; i < counts[side] && i < MaxRows; i++)
            {
                var item = $"{Root}.{Side(side)}.p{i}";
                if (!GameData.Put(item, list, i)) break;
                foreach (var path in RowPaths) GameData.Want($"{item}.{path}");
                RowNodes[side].Add(item);
            }
        }
        stage = 2;
        since = now;
    }

    /// <summary>2단계: 항목이 다 오면(늦어도 WaitMs 뒤) 경기 한 줄을 적는다.</summary>
    private static void Write(long now)
    {
        var arrived = RowNodes.SelectMany(nodes => nodes).All(item => RowPaths.All(path => GameData.Arrived($"{item}.{path}")));
        if (!arrived && now - since < WaitMs) return;
        var line = BuildLine();
        Directory.CreateDirectory(Folder);
        File.AppendAllText(Path.Combine(Folder, "ratings.jsonl"), line + "\n", new UTF8Encoding(false));
        SaveLastKey(pendingKey);
        Plugin.Logger.LogInfo($"ratings: recorded {pendingKey} ({RowNodes[0].Count}+{RowNodes[1].Count} rows{(arrived ? "" : ", some values missing")})");
        Reset(now + CheckMs);
    }

    private sealed class Row
    {
        public long? Uid;
        public float? Rating;
        public long Position;
        public int Incident;
        public int Minute;
        public int Slot = -1;
    }

    private static string BuildLine()
    {
        int? Int(string path) => int.TryParse(GameData.Text(path), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : null;
        long? Long(string path) => long.TryParse(GameData.Text(path), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : null;

        var rows = new List<Row>[2];
        for (var side = 0; side < 2; side++)
        {
            rows[side] = new List<Row>();
            foreach (var item in RowNodes[side])
            {
                rows[side].Add(new Row
                {
                    Uid = Long($"{item}.Player.UniqueId"),
                    Rating = float.TryParse(GameData.Text($"{item}.TotalRating"), NumberStyles.Float, CultureInfo.InvariantCulture, out var rating) ? rating : null,
                    Position = Long($"{item}.Position") ?? 0,
                    Incident = Int($"{item}.IncidentType") ?? 0,
                    Minute = Int($"{item}.MatchTime") ?? 0,
                    Slot = Int($"{item}.PlayerTeamSelectionIndex") ?? -1
                });
            }
        }
        // 교체가 100분 이후에 있었으면 연장전까지 간 경기로 본다(90분대의 교체는 추가 시간일 수 있다)
        var full = rows.SelectMany(list => list).Any(row => row.Minute >= 100) ? 120 : 90;

        var json = new StringBuilder("{\"v\":1");
        json.Append(",\"gameDate\":").Append(Json(pendingDate));
        json.Append(",\"comp\":").Append(Json(GameData.Text($"{Fixture}.Competition.Name")));
        json.Append(",\"compUid\":").Append(Num(Long($"{Fixture}.Competition.UniqueId")));
        json.Append(",\"home\":").Append(Team("HomeTeam", "HomeScore", Long));
        json.Append(",\"away\":").Append(Team("AwayTeam", "AwayScore", Long));
        json.Append(",\"myTeamId\":").Append(Num(GameData.RecordIndexOf("Human.Team")));
        json.Append(",\"full\":").Append(full);
        json.Append(",\"players\":[");
        var first = true;
        for (var side = 0; side < 2; side++)
        {
            // 선발의 처음 자리 번호 = 목록의 줄 번호
            var startPosition = new Dictionary<int, long>();
            for (var i = 0; i < rows[side].Count; i++)
                if (rows[side][i].Position != 0) startPosition[i] = rows[side][i].Position;

            foreach (var row in rows[side])
            {
                // 평점이 없는 줄(안 뛴 교체 선수 등)은 적지 않는다. 앱은 평점이 수인 줄만 받는다
                if (row.Rating == null) continue;
                long position;
                int? minutes;
                if (row.Position != 0)
                {
                    position = row.Position;
                    minutes = row.Incident == 0 ? full : row.Minute > 0 ? row.Minute : null;
                }
                else if (row.Incident == 1)
                {
                    position = startPosition.TryGetValue(row.Slot, out var taken) ? taken : 0;
                    minutes = Math.Max(1, full - row.Minute);
                }
                else
                {
                    position = 0;
                    minutes = null;
                }
                json.Append(first ? "" : ",");
                first = false;
                json.Append("{\"uid\":").Append(Num(row.Uid));
                json.Append(",\"side\":\"").Append(side == 0 ? "home" : "away").Append('"');
                json.Append(",\"pos\":").Append(position.ToString(CultureInfo.InvariantCulture));
                json.Append(",\"min\":").Append(Num(minutes));
                json.Append(",\"rating\":").Append(Math.Round(row.Rating.Value, 2).ToString("0.##", CultureInfo.InvariantCulture));
                json.Append(",\"inc\":").Append(row.Incident);
                json.Append(",\"t\":").Append(row.Minute);
                json.Append(",\"slot\":").Append(row.Slot);
                json.Append('}');
            }
        }
        return json.Append("]}").ToString();
    }

    private static string Team(string team, string score, Func<string, long?> number) =>
        "{\"id\":" + Num(GameData.RecordIndexOf($"{Fixture}.{team}")) +
        ",\"uid\":" + Num(number($"{Fixture}.{team}.UniqueId")) +
        ",\"name\":" + Json(GameData.Text($"{Fixture}.{team}.Name")) +
        ",\"goals\":" + Num(number($"{Fixture}.{score}")) + "}";

    private static string Num(long? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "null";

    private static string Num(int? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "null";

    private static string Json(string text)
    {
        if (text == null) return "null";
        var builder = new StringBuilder("\"");
        foreach (var c in text)
        {
            switch (c)
            {
                case '"':
                    builder.Append("\\\"");
                    break;
                case '\\':
                    builder.Append("\\\\");
                    break;
                default:
                    if (c < 0x20) builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else builder.Append(c);
                    break;
            }
        }
        return builder.Append('"').ToString();
    }

    private static string ReadLastKey()
    {
        try
        {
            var path = Path.Combine(Folder, "ratings.last");
            return File.Exists(path) ? File.ReadAllText(path).Trim() : "";
        }
        catch
        {
            return "";
        }
    }

    private static void SaveLastKey(string key)
    {
        lastKey = key;
        try
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(Path.Combine(Folder, "ratings.last"), key, new UTF8Encoding(false));
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"ratings: could not remember the last match: {error.Message}");
        }
    }
}
