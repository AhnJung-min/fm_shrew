using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 선수의 몸값·주급·계약 만료일·국적처럼 세이브에서 읽지 못하는 것을 게임에 물어 받아 온다(앱의 영입 후보가 쓴다).
///
/// 게임이 선수 화면을 채울 때와 같은 통로를 쓴다(GameData): 그 선수를 가리키는 마디를 나무에 올리고 항목을 청한다.
/// 그래서 값은 게임이 감독에게 보여 주는 그대로다. 스카우트하지 않은 선수의 몸값은 게임에서처럼 넓은 범위로 나온다.
///
/// 선수를 가리키려면 게임 안의 "사람 색인"이 필요하다. 그 색인은 메모리의 선수 기록에 번호와 함께 적혀 있다(LiveMemory).
/// 한 번에 MaxPerRequest명까지 받고, 받은 뒤에는 올려 둔 마디와 청한 항목을 모두 거둔다.
/// </summary>
internal static class PersonInfo
{
    private const string Root = GameData.OurRoot + "q.";
    private const string HumanNode = Root + "human";
    public const int MaxPerRequest = 30;
    /// <summary>값이 다 오지 않아도 이만큼 기다렸으면 온 것만 돌려준다</summary>
    private const int WaitMs = 3000;
    /// <summary>모든 선수의 나이가 온 뒤 이만큼 더 기다려도 안 오는 항목은 없는 것으로 본다(소속이 없는 선수의 계약 등)</summary>
    private const int SettleMs = 700;
    private const int PollMs = 100;
    private const int MaxFailures = 5;

    /// <summary>앱에 돌려줄 이름, 선수 마디 아래의 경로, 수로 돌려줄지</summary>
    private static readonly (string Key, string Path, bool Number)[] Fields =
    {
        ("age", "Age", true),
        ("value", "TransferValueRange.TransferValueRangeString", false),
        ("valueSort", "TransferValueRange.BaseAskingPrice", true),
        ("wage", "FullContract.Wage.DisplayValue", false),
        ("wageSort", "FullContract.Wage.SortValue", true),
        ("contractEnd", "FullContract.EndDateShortText", false),
        ("nation", "NationalityText", false),
        ("club", "Club.Name", false),
        ("gender", "Gender", false)
    };

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

    private static string Node(uint uid) => Root + "p" + uid.ToString(CultureInfo.InvariantCulture);

    private static List<uint> Parse(string text)
    {
        var uids = new List<uint>();
        foreach (var part in text.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            if (!uint.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var uid) || uid == 0)
                throw new HttpError(400, "bad uid");
            if (!uids.Contains(uid)) uids.Add(uid);
        }
        if (uids.Count == 0 || uids.Count > MaxPerRequest) throw new HttpError(400, $"need 1 to {MaxPerRequest} uids");
        return uids;
    }

    /// <summary>
    /// 선수들의 정보를 JSON 배열로. 켜져 있는 게임에서 찾지 못한 선수는 빠진다.
    /// 요청을 받은 스레드에서 불리고, 게임을 건드리는 일만 메인 스레드에 맡긴다.
    /// </summary>
    public static string Get(string uidsText)
    {
        var uids = Parse(uidsText);
        if (failures >= MaxFailures) throw new HttpError(503, "person info is off after repeated failures");
        lock (Gate)
        {
            var people = new List<(uint Uid, int Index)>();
            foreach (var uid in uids)
                if (LiveMemory.PersonIndex(uid, out var index))
                    people.Add((uid, index));
            if (people.Count == 0) return "[]";

            try
            {
                var placed = MainThread.Run(() => Ask(people));
                if (placed != "ok") throw new HttpError(503, placed);
                var watch = Stopwatch.StartNew();
                long agesAt = -1;
                while (true)
                {
                    Thread.Sleep(PollMs);
                    var state = MainThread.Run(() => Arrived(people));
                    if (state == "all") break;
                    if (state == "ages" && agesAt < 0) agesAt = watch.ElapsedMilliseconds;
                    if (agesAt >= 0 && watch.ElapsedMilliseconds - agesAt >= SettleMs) break;
                    if (watch.ElapsedMilliseconds >= WaitMs) break;
                }
                return MainThread.Run(() => Collect(people));
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
                Plugin.Logger.LogWarning($"person info ({failures}/{MaxFailures}): {error.Message}");
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
                    Plugin.Logger.LogWarning($"person info: clean-up: {error.Message}");
                }
            }
        }
    }

    /// <summary>메인 스레드: 선수들을 가리키는 마디를 올리고 항목을 청한다.</summary>
    private static string Ask(List<(uint Uid, int Index)> people)
    {
        if (!GameData.Available) return "game data is not available";
        GameData.Drop(Root);
        // 몸값·계약처럼 "누가 보는지"에 따라 달라지는 항목은 같은 부모 아래의 human 마디에서 감독을 찾는다
        if (!GameData.Put(HumanNode, "Human")) return "not in a game";
        var asked = 0;
        foreach (var (uid, index) in people)
        {
            var node = Node(uid);
            if (!GameData.PutPerson(node, index)) continue;
            foreach (var field in Fields) GameData.Want(node + "." + field.Path);
            asked++;
        }
        if (asked == 0)
        {
            failures++;
            return "could not point at the players";
        }
        return "ok";
    }

    /// <summary>메인 스레드: 청한 값이 얼마나 왔는지. "all" 모두, "ages" 모든 선수의 나이까지, "" 아직</summary>
    private static string Arrived(List<(uint Uid, int Index)> people)
    {
        var all = true;
        foreach (var (uid, _) in people)
        {
            var node = Node(uid);
            if (!GameData.Arrived(node + ".Age")) return "";
            foreach (var field in Fields)
                if (!GameData.Arrived(node + "." + field.Path))
                    all = false;
        }
        return all ? "all" : "ages";
    }

    /// <summary>메인 스레드: 온 값들을 JSON으로.</summary>
    private static string Collect(List<(uint Uid, int Index)> people)
    {
        var json = new StringBuilder("[");
        var first = true;
        foreach (var (uid, _) in people)
        {
            var node = Node(uid);
            // 나이도 오지 않은 선수는 게임이 그 마디를 받아들이지 않은 것이다
            if (GameData.Text(node + ".Age") == null) continue;
            json.Append(first ? "" : ",").Append("{\"uid\":").Append(uid.ToString(CultureInfo.InvariantCulture));
            first = false;
            foreach (var field in Fields)
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
