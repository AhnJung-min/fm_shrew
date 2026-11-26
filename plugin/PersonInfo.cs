using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 세이브에서 읽지 못하는 것을 게임에 물어 받아 온다(앱의 영입 후보가 쓴다).
///   선수: 게임이 보여 주는 몸값 범위·주급·계약 만료일·국적·성별
///   팀: 이름, 구단 이름, 여자 팀인지      나라: 이름
///
/// 게임이 화면을 채울 때와 같은 통로를 쓴다(GameData): 대상을 가리키는 마디를 나무에 올리고 항목을 청한다.
/// 그래서 값은 게임이 감독에게 보여 주는 그대로다. 스카우트하지 않은 선수의 몸값은 게임에서처럼 넓은 범위로 나온다.
///
/// 대상을 가리키려면 게임 안의 순번(색인)이 필요하다. 팀과 나라는 세이브에 적힌 번호가 곧 그 순번이고,
/// 선수는 메모리의 선수 기록에 고유 번호와 함께 적혀 있다(LiveMemory).
/// 받은 뒤에는 올려 둔 마디와 청한 항목을 모두 거둔다.
/// </summary>
internal static class PersonInfo
{
    private const string Root = GameData.OurRoot + "q.";
    private const string HumanNode = Root + "human";
    public const int MaxPeople = 30;
    public const int MaxNames = 60;
    /// <summary>값이 다 오지 않아도 이만큼 기다렸으면 온 것만 돌려준다</summary>
    private const int WaitMs = 3000;
    /// <summary>모든 대상의 첫 항목이 온 뒤 이만큼 더 기다려도 안 오는 항목은 없는 것으로 본다(소속이 없는 선수의 계약 등)</summary>
    private const int SettleMs = 700;
    private const int PollMs = 100;
    private const int MaxFailures = 5;

    /// <summary>앱에 돌려줄 이름, 대상 마디 아래의 경로, 수로 돌려줄지. 첫 항목은 누구에게나 있는 것이어야 한다</summary>
    private sealed class Field
    {
        public readonly string Key;
        public readonly string Path;
        public readonly bool Number;

        public Field(string key, string path, bool number = false)
        {
            Key = key;
            Path = path;
            Number = number;
        }
    }

    private static readonly Field[] PersonFields =
    {
        new("age", "Age", true),
        new("value", "TransferValueRange.TransferValueRangeString"),
        new("valueSort", "TransferValueRange.BaseAskingPrice", true),
        new("wage", "FullContract.Wage.DisplayValue"),
        new("wageSort", "FullContract.Wage.SortValue", true),
        new("contractEnd", "FullContract.EndDateShortText"),
        new("nation", "NationalityText"),
        new("club", "Club.Name"),
        new("gender", "Gender")
    };

    private static readonly Field[] TeamFields = { new("name", "Name"), new("club", "Club.Name"), new("gender", "Gender") };
    private static readonly Field[] NationFields = { new("name", "Name") };

    private static readonly object Gate = new();
    private static int failures;

    private static string Quote(string value)
    {
        var text = new StringBuilder("\"");
        foreach (var c in value)
        {
            if (c == '"' || c == '\\') text.Append('\\').Append(c);
            else if (c < ' ') text.Append(' ');
            else text.Append(c);
        }
        return text.Append('"').ToString();
    }

    private static string Node(uint id) => Root + "x" + id.ToString(CultureInfo.InvariantCulture);

    private static List<uint> Parse(string text, int max)
    {
        var ids = new List<uint>();
        foreach (var part in text.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            if (!uint.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id == 0)
                throw new HttpError(400, "bad id");
            if (!ids.Contains(id)) ids.Add(id);
        }
        if (ids.Count == 0 || ids.Count > max) throw new HttpError(400, $"need 1 to {max} ids");
        return ids;
    }

    /// <summary>선수들의 정보를 JSON 배열로([{"uid":…,"value":…}]). 켜져 있는 게임에서 찾지 못한 선수는 빠진다.</summary>
    public static string People(string uidsText)
    {
        var targets = new List<(uint Id, int Index)>();
        foreach (var uid in Parse(uidsText, MaxPeople))
            if (LiveMemory.PersonIndex(uid, out var index))
                targets.Add((uid, index));
        return Query(GameData.RecordKind.Person, targets, PersonFields, "uid");
    }

    /// <summary>팀이나 나라의 이름을 JSON 배열로([{"id":…,"name":…}]). 번호는 세이브에 적힌 그 번호다.</summary>
    public static string Names(string kind, string idsText)
    {
        var ids = Parse(idsText, MaxNames);
        var targets = ids.Where(id => id <= int.MaxValue).Select(id => (id, (int)id)).ToList();
        return kind switch
        {
            "team" => Query(GameData.RecordKind.Team, targets, TeamFields, "id"),
            "nation" => Query(GameData.RecordKind.Nation, targets, NationFields, "id"),
            _ => throw new HttpError(400, "kind must be team or nation")
        };
    }

    /// <summary>요청을 받은 스레드에서 불린다. 게임을 건드리는 일만 메인 스레드에 맡기고 값이 올 때까지 기다린다.</summary>
    private static string Query(GameData.RecordKind kind, List<(uint Id, int Index)> targets, Field[] fields, string idKey)
    {
        if (failures >= MaxFailures) throw new HttpError(503, "game queries are off after repeated failures");
        if (targets.Count == 0) return "[]";
        lock (Gate)
        {
            try
            {
                var placed = MainThread.Run(() => Ask(kind, targets, fields));
                if (placed != "ok") throw new HttpError(503, placed);
                var watch = Stopwatch.StartNew();
                long firstsAt = -1;
                while (true)
                {
                    Thread.Sleep(PollMs);
                    var state = MainThread.Run(() => Arrived(targets, fields));
                    if (state == "all") break;
                    if (state == "firsts" && firstsAt < 0) firstsAt = watch.ElapsedMilliseconds;
                    if (firstsAt >= 0 && watch.ElapsedMilliseconds - firstsAt >= SettleMs) break;
                    if (watch.ElapsedMilliseconds >= WaitMs) break;
                }
                return MainThread.Run(() => Collect(targets, fields, idKey));
            }
            catch (HttpError)
            {
                throw;
            }
            catch (TimeoutException error)
            {
                // 게임이 날짜를 넘기는 중이거나 불러오는 중이다. 고장이 아니므로 세지 않는다
                throw new HttpError(503, error.Message);
            }
            catch (Exception error)
            {
                failures++;
                Plugin.Logger.LogWarning($"game query ({failures}/{MaxFailures}): {error.Message}");
                throw new HttpError(503, error.Message);
            }
            finally
            {
                try
                {
                    MainThread.Run(() =>
                    {
                        GameData.Drop(Root);
                        return "";
                    });
                }
                catch (Exception error)
                {
                    Plugin.Logger.LogWarning($"game query: clean-up: {error.Message}");
                }
            }
        }
    }

    /// <summary>메인 스레드: 대상을 가리키는 마디를 올리고 항목을 청한다.</summary>
    private static string Ask(GameData.RecordKind kind, List<(uint Id, int Index)> targets, Field[] fields)
    {
        if (!GameData.Available) return "game data is not available";
        GameData.Drop(Root);
        // 몸값·계약처럼 "누가 보는지"에 따라 달라지는 항목은 같은 부모 아래의 human 마디에서 감독을 찾는다
        if (!GameData.Put(HumanNode, "Human")) return "not in a game";
        var asked = 0;
        foreach (var (id, index) in targets)
        {
            var node = Node(id);
            if (!GameData.PutRecord(node, kind, index)) continue;
            foreach (var field in fields) GameData.Want(node + "." + field.Path);
            asked++;
        }
        if (asked == 0)
        {
            failures++;
            return "could not point at the records";
        }
        return "ok";
    }

    /// <summary>메인 스레드: 청한 값이 얼마나 왔는지. "all" 모두, "firsts" 모든 대상의 첫 항목까지, "" 아직</summary>
    private static string Arrived(List<(uint Id, int Index)> targets, Field[] fields)
    {
        var all = true;
        foreach (var (id, _) in targets)
        {
            var node = Node(id);
            if (!GameData.Arrived(node + "." + fields[0].Path)) return "";
            foreach (var field in fields)
                if (!GameData.Arrived(node + "." + field.Path))
                    all = false;
        }
        return all ? "all" : "firsts";
    }

    /// <summary>메인 스레드: 온 값들을 JSON으로.</summary>
    private static string Collect(List<(uint Id, int Index)> targets, Field[] fields, string idKey)
    {
        var json = new StringBuilder("[");
        var first = true;
        foreach (var (id, _) in targets)
        {
            var node = Node(id);
            // 첫 항목도 오지 않은 대상은 게임이 그 마디를 받아들이지 않은 것이다
            if (GameData.Text(node + "." + fields[0].Path) == null) continue;
            json.Append(first ? "" : ",").Append("{\"").Append(idKey).Append("\":").Append(id.ToString(CultureInfo.InvariantCulture));
            first = false;
            foreach (var field in fields)
            {
                var text = GameData.Text(node + "." + field.Path);
                if (string.IsNullOrEmpty(text) || text == "null") continue;
                if (field.Number)
                {
                    if (long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var number))
                        json.Append(",\"").Append(field.Key).Append("\":").Append(number.ToString(CultureInfo.InvariantCulture));
                }
                else
                {
                    json.Append(",\"").Append(field.Key).Append("\":").Append(Quote(text));
                }
            }
            json.Append('}');
        }
        return json.Append(']').ToString();
    }
}
