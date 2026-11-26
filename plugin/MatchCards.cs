using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.UIElements;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 경기 중과 경기 뒤에 뜨는 중계 화면식 카드.
///
/// 골 카드: 점수판의 점수가 오르면, 게임이 화면 아래에 잠깐 띄우는 골 알림(득점자·도움)을 읽어
/// "누가, 몇 분에, 이번 경기 몇 번째 골인지"를 보여 준다.
///
/// 최우수 선수 카드: 경기가 끝나고 풀타임 보고서가 뜨면, 양 팀 선수 표(득점·도움·평점)에서
/// 평점이 가장 높은 선수를 골라 보여 준다.
///
/// 읽는 곳(FM26 26.3 기준, 화면 요소의 이름):
///   점수판      Panel "OverviewHeader" 안의 HomeScore, AwayScore, Time, HomeTeamText, AwayTeamText
///   골 알림     "LowerThirdSelector" 안. 골이면 "GoalIcon"이 있고, "InfoBlock" 안에 등번호·이름이,
///               "SIVisible_HasAssist" 안에 도움 선수의 등번호·이름이 있다
///   풀타임 보고서 Panel "FullTimeTeamReport" 안의 "AllPlayerStatsHomeTeam"·"AllPlayerStatsAwayTeam".
///               선수 한 줄(.virtualised-list__item)은 Position, Name, Subbed, Goals, Assists, Rating 칸으로 나뉜다.
///               득점은 숫자가 아니라 공 그림(.game-concepts-goal-N)으로 표시된다
/// </summary>
internal static class MatchCards
{
    public const string CardName = "FmBojwagwanCard";

    private const int TickMs = 300;
    private const int PanelScanMs = 2000;
    private const int PopupSearchMs = 600;
    /// <summary>골을 기다리는 중이 아닐 때 알림 자리를 찾는 간격</summary>
    private const int PopupIdleSearchMs = 3000;
    /// <summary>골 뒤에 이 시간 안에 뜬 기록 알림만 그 골의 것으로 본다</summary>
    private const int FactWaitMs = 120_000;
    /// <summary>점수가 바뀐 뒤 골 알림을 기다리는 시간. 지나면 득점자 없이 카드를 띄운다</summary>
    private const int PopupWaitMs = 7000;
    private const int GoalCardMs = 9000;
    /// <summary>순위표까지 붙은 골 카드는 읽을 것이 많아 더 오래 둔다</summary>
    private const int TableCardMs = 14000;
    private const int BestCardMs = 15000;
    private const int FadeInMs = 200;
    private const int FadeOutMs = 500;
    private const string GoalClass = "game-concepts-goal-";

    private sealed class Goal
    {
        public string Minute = "";
        /// <summary>득점한 선수의 팀(골 알림에 적힌 약칭). 알림을 못 읽었으면 점수가 오른 쪽</summary>
        public string Team = "";
        public string Number = "";
        public string Scorer = "";
        public string AssistNumber = "";
        public string Assist = "";
        public bool Own;
        public string Note = "";
        public string ScoreLine = "";
        /// <summary>골 뒤에 게임이 띄우는 기록 알림의 문장(예: "13경기에서 4득점을 달성했습니다"). 게임이 쓴 그대로 둔다</summary>
        public string Fact = "";
        public long At;

        // 게임에서 받아 온 것(도착하지 않았으면 비어 있다)
        public bool Enriched;
        public string Competition = "";
        /// <summary>이 대회 이번 시즌 득점·출전 수</summary>
        public int? SeasonGoals;
        public int? SeasonApps;
        public int? CareerLeagueGoals;
        public int? CareerGoals;
        public int? AssistSeason;
        public List<Ranked> TopGoals = new();
        public List<Ranked> TopAssists = new();
    }

    /// <summary>대회 기록 순위의 한 줄</summary>
    private sealed class Ranked
    {
        public string Position = "";
        public string Name = "";
        public string Team = "";
        public string Value = "";
    }

    /// <summary>풀타임 보고서의 선수 한 줄</summary>
    private sealed class Row
    {
        /// <summary>팀 약칭(표의 제목)</summary>
        public string Team = "";
        public string Club = "";
        public string Name = "";
        public string Position = "";
        /// <summary>교체돼 나간 선수는 표 아래쪽에 S1, S2…로 놓인다</summary>
        public bool Bench;
        public bool CameOn;
        public string SubMinute = "";
        public int Goals;
        public int Assists;
        public float Rating;
        public string RatingText = "";
    }

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly Regex ClockText = new(@"^(\d{1,3}):(\d{2})$", RegexOptions.CultureInvariant);
    private static readonly Regex Digits = new(@"^\d{1,3}$", RegexOptions.CultureInvariant);

    private static readonly Color Back = new(0.07f, 0.08f, 0.12f, 0.97f);
    private static readonly Color Gold = new(0.98f, 0.78f, 0.25f, 1f);
    private static readonly Color Soft = new(0.66f, 0.69f, 0.76f, 1f);
    private static readonly Color Line = new(0.22f, 0.25f, 0.32f, 1f);
    private static readonly Color Great = new(0.11f, 0.56f, 0.33f, 1f);
    private static readonly Color Good = new(0.24f, 0.45f, 0.2f, 1f);
    private static readonly Color Plain = new(0.26f, 0.29f, 0.36f, 1f);

    // 경기 화면에서 찾아 둔 요소
    private static VisualElement header;
    private static VisualElement homeScore;
    private static VisualElement awayScore;
    private static VisualElement time;
    private static VisualElement homeTeam;
    private static VisualElement awayTeam;
    private static VisualElement lowerThird;

    // 이번 경기
    private static string matchKey = "";
    private static int home = -1;
    private static int away = -1;
    private static readonly List<Goal> Goals = new();
    /// <summary>최우수 선수 카드를 이미 띄운 경기(팀과 점수). 같은 보고서를 다시 열어도 또 띄우지 않는다</summary>
    private static string bestShownFor = "";

    // 점수가 바뀌었고 골 알림을 기다리는 중
    private static Goal pending;
    private static long pendingUntil;
    private static long nextPopupSearch;
    private static string lastPopup = "";
    private static int popupDumps;

    // 떠 있는 카드
    private static VisualElement card;
    private static long cardFrom;
    private static long cardUntil;

    private static long nextTick;
    private static long nextPanelScan;
    private static int failures;

    public static void Tick()
    {
        var now = Clock.ElapsedMilliseconds;
        if (card != null) Fade(now);
        if (now < nextTick || failures > 8) return;
        nextTick = now + TickMs;
        try
        {
            Step(now);
        }
        catch (Exception error)
        {
            failures++;
            nextTick = now + 3000;
            Plugin.Logger.LogWarning($"match cards ({failures}): {error}");
        }
    }

    private static void Step(long now)
    {
        if (card != null && (now >= cardUntil || card.panel == null)) HideCard();
        if (header != null && (header.panel == null || !UiTree.Displayed(header))) ForgetScreen();

        if (now >= nextPanelScan)
        {
            nextPanelScan = now + PanelScanMs;
            VisualElement headerPanel = null, fullTime = null;
            foreach (var root in UiTree.Roots()) FindPanels(root, 0, ref headerPanel, ref fullTime);
            if (header == null && headerPanel != null && Adopt(headerPanel))
            {
                // 방금 경기 화면을 찾았다. 지금 점수는 그대로 받아들인다(골로 치지 않는다)
                var key = Read(homeTeam) + "|" + Read(awayTeam);
                if (key != matchKey)
                {
                    matchKey = key;
                    Goals.Clear();
                    pending = null;
                    ResetData();
                }
                ReadScore(out home, out away);
                return;
            }
            if (fullTime != null) ShowBestPlayer(fullTime, now);
        }
        if (header == null) return;
        DataStep(now);

        // 골 카드를 띄운 조금 뒤, 게임에서 받아 온 기록(시즌·통산 득점, 순위)을 덧붙여 다시 그린다
        var latest = Goals.Count > 0 ? Goals[^1] : null;
        if (latest != null && !latest.Enriched && now - latest.At >= EnrichAfterMs)
        {
            latest.Enriched = true;
            if (Enrich(latest) && card != null) ShowGoal(latest, true);
        }

        if (!ReadScore(out var h, out var a)) return;
        if (home < 0 || away < 0)
        {
            home = h;
            away = a;
        }
        else if (h != home || a != away)
        {
            var before = home + away;
            var homeScored = h > home;
            home = h;
            away = a;
            if (h + a == before + 1)
            {
                pending = new Goal
                {
                    Minute = Minute(Read(time)),
                    Team = Read(homeScored ? homeTeam : awayTeam),
                    ScoreLine = $"{Read(homeTeam)} {home} - {away} {Read(awayTeam)}".Trim()
                };
                pendingUntil = now + PopupWaitMs;
                nextPopupSearch = 0;
            }
            else if (h + a < before)
            {
                // 골이 취소됐다(VAR 등)
                pending = null;
                if (Goals.Count > 0) Goals.RemoveAt(Goals.Count - 1);
                HideCard();
            }
        }

        if (pending == null)
        {
            WatchPopups(now);
            return;
        }
        var popup = FindPopup(now);
        if ((popup != null && ReadPopup(popup, pending)) || now >= pendingUntil)
        {
            var goal = pending;
            pending = null;
            goal.At = now;
            Commit(goal);
        }
    }

    /// <summary>
    /// 골 알림이 뜨는 자리에는 다른 알림도 뜬다(교체, 카드, 그리고 "13경기에서 4득점을 달성했습니다" 같은 기록).
    /// 방금 골을 넣은 선수의 기록 알림이면 그 문장을 골 카드에 덧붙여 다시 띄운다.
    /// 어떤 알림이 뜨는지 알 수 있게 내용이 바뀔 때마다 로그에 적는다.
    /// </summary>
    private static void WatchPopups(long now)
    {
        var popup = FindPopup(now, PopupIdleSearchMs);
        if (popup == null)
        {
            lastPopup = "";
            return;
        }
        var isGoal = false;
        var texts = new List<string>();
        Ui.Walk(popup, element =>
        {
            if (element.name == "GoalIcon") isGoal = true;
            var text = Read(element);
            if (text.Length > 0 && !texts.Contains(text)) texts.Add(text);
            return false;
        });
        var joined = string.Join(" | ", texts);
        if (joined.Length == 0 || joined == lastPopup) return;
        lastPopup = joined;
        Plugin.Logger.LogInfo($"lower third{(isGoal ? " (goal)" : "")}: {joined}");
        if (isGoal) return;

        if (popupDumps < 4)
        {
            popupDumps++;
            Plugin.Logger.LogInfo("UI dump: " + Watcher.DumpToFile("lowerthird"));
        }
        var last = Goals.Count > 0 ? Goals[^1] : null;
        if (last == null || last.Scorer.Length == 0 || last.Fact.Length > 0 || now - last.At > FactWaitMs) return;
        if (!texts.Contains(last.Scorer)) return;
        var fact = texts.FirstOrDefault(text =>
            text != last.Scorer && text != last.Number && text != last.Team && text.Length >= 6 && text.Any(char.IsDigit));
        if (fact == null) return;
        last.Fact = fact;
        ShowGoal(last);
    }

    // ── 게임에서 받아 오는 기록 ───────────────────────────
    //
    // 경기 중에는 나무의 "Match"가 이 경기를 가리킨다.
    //   Match.Competition              이 경기의 대회
    //   Match.MatchLowerThirdPlayer1~  골 알림에 뜬 선수들(득점자, 도움)
    //   Match.PlayerOfTheMatch         게임이 뽑은 최우수 선수
    // 순위는 대회에 기록 종류(득점 2, 도움 5)와 단계(-1 = 전체)를 조건으로 붙여 청한다.

    private const int StatGoals = 2;
    private const int StatAssists = 5;
    private const int TopRows = 5;
    private const int EnrichAfterMs = 1500;
    private const string MatchRoot = "Match.";
    private static readonly string[] PopupPlayerValues =
    {
        "Person.Name", "GoalsInThisCompThisSeason", "AssistsInThisCompThisSeason", "AppsInThisCompThisSeason",
        "Person.TotalCareerLeagueGoals", "Person.TotalCareerGoals"
    };
    private static readonly string[] RankedValues = { "Player.Name", "Team.ShortName", "StatValue", "Position" };

    /// <summary>0: 아직 청하지 않음, 1: 대회를 기다림, 2: 순위 목록을 기다림, 3: 준비됨</summary>
    private static int dataStage;
    private static long dataSince;

    private static void ResetData()
    {
        dataStage = 0;
        if (!GameData.Available) return;
        GameData.Drop(GameData.OurRoot);
        GameData.Drop(MatchRoot);
    }

    private static string RankList(string kind) => $"{GameData.OurRoot}{kind}.comp.PlayerStats.Players";

    private static void DataStep(long now)
    {
        if (dataStage >= 3 || !GameData.Available) return;
        switch (dataStage)
        {
            case 0:
                GameData.Want(MatchRoot + "Competition");
                GameData.Want(MatchRoot + "Competition.Name");
                GameData.Want(MatchRoot + "PlayerOfTheMatch.Name");
                GameData.Want(MatchRoot + "PlayerOfTheMatchRating");
                for (var k = 1; k <= 2; k++)
                    foreach (var value in PopupPlayerValues)
                        GameData.Want($"{MatchRoot}MatchLowerThirdPlayer{k}.{value}");
                dataStage = 1;
                dataSince = now;
                break;

            case 1:
                if (!GameData.Has(MatchRoot + "Competition"))
                {
                    if (now - dataSince > 60_000) dataStage = 3;
                    break;
                }
                foreach (var (kind, type) in new[] { ("g", StatGoals), ("a", StatAssists) })
                {
                    var root = GameData.OurRoot + kind;
                    // 조건을 먼저 놓고 대회를 올린다
                    if (!GameData.PutInt(root + ".Type", type) || !GameData.PutInt(root + ".Stage", -1) ||
                        !GameData.Put(root + ".comp", MatchRoot + "Competition"))
                    {
                        dataStage = 3;
                        return;
                    }
                    GameData.Want(RankList(kind));
                }
                dataStage = 2;
                dataSince = now;
                break;

            case 2:
                var ready = GameData.Count(RankList("g")) >= 0 && GameData.Count(RankList("a")) >= 0;
                if (!ready && now - dataSince < 20_000) break;
                PlaceRanks("g");
                PlaceRanks("a");
                dataStage = 3;
                Plugin.Logger.LogInfo(
                    $"match data: {GameData.Text(MatchRoot + "Competition.Name")}, " +
                    $"goals list {GameData.Count(RankList("g"))}, assists list {GameData.Count(RankList("a"))}");
                break;
        }
    }

    /// <summary>순위 목록의 앞쪽 줄들을 나무에 올리고 그 값을 청한다. 목록이 바뀌었을 수 있을 때 다시 부른다.</summary>
    private static void PlaceRanks(string kind)
    {
        var total = Math.Min(TopRows, GameData.Count(RankList(kind)));
        for (var i = 0; i < total; i++)
        {
            var row = $"{GameData.OurRoot}{kind}.r{i}";
            if (!GameData.Put(row, RankList(kind), i)) break;
            foreach (var value in RankedValues) GameData.Want($"{row}.{value}");
        }
    }

    private static List<Ranked> ReadRanks(string kind)
    {
        var rows = new List<Ranked>();
        for (var i = 0; i < TopRows; i++)
        {
            var row = $"{GameData.OurRoot}{kind}.r{i}";
            var name = GameData.Text(row + ".Player.Name");
            var value = GameData.Text(row + ".StatValue");
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(value)) break;
            rows.Add(new Ranked
            {
                Name = name,
                Value = value,
                Team = GameData.Text(row + ".Team.ShortName") ?? "",
                Position = GameData.Text(row + ".Position") ?? ""
            });
        }
        return rows;
    }

    /// <summary>골 알림의 몇 번째 선수가 이 이름인지. 없으면 0</summary>
    private static int PopupPlayer(string name)
    {
        if (name.Length == 0) return 0;
        for (var k = 1; k <= 2; k++)
            if (GameData.Text($"{MatchRoot}MatchLowerThirdPlayer{k}.Person.Name") == name)
                return k;
        return 0;
    }

    /// <summary>게임에서 받아 온 기록을 골에 채운다. 하나라도 채웠으면 true</summary>
    private static bool Enrich(Goal goal)
    {
        if (!GameData.Available || dataStage == 0) return false;
        var any = false;
        goal.Competition = GameData.Text(MatchRoot + "Competition.Name") ?? "";

        var scorer = goal.Own ? 0 : PopupPlayer(goal.Scorer);
        if (scorer > 0)
        {
            var from = $"{MatchRoot}MatchLowerThirdPlayer{scorer}.";
            goal.SeasonGoals = GameData.Number(from + "GoalsInThisCompThisSeason");
            goal.SeasonApps = GameData.Number(from + "AppsInThisCompThisSeason");
            goal.CareerLeagueGoals = GameData.Number(from + "Person.TotalCareerLeagueGoals");
            goal.CareerGoals = GameData.Number(from + "Person.TotalCareerGoals");
            any = goal.SeasonGoals != null || goal.CareerLeagueGoals != null || goal.CareerGoals != null;
        }
        var helper = PopupPlayer(goal.Assist);
        if (helper > 0)
        {
            goal.AssistSeason = GameData.Number($"{MatchRoot}MatchLowerThirdPlayer{helper}.AssistsInThisCompThisSeason");
            any |= goal.AssistSeason != null;
        }

        goal.TopGoals = ReadRanks("g");
        goal.TopAssists = ReadRanks("a");
        any |= goal.TopGoals.Count > 0 || goal.TopAssists.Count > 0;

        Plugin.Logger.LogInfo(
            $"goal data: popup player {scorer}/{helper}, season {goal.SeasonGoals} in {goal.SeasonApps}, " +
            $"career {goal.CareerLeagueGoals}/{goal.CareerGoals}, assists {goal.AssistSeason}, " +
            $"tables {goal.TopGoals.Count}/{goal.TopAssists.Count}");
        return any;
    }

    // ── 화면 읽기 ─────────────────────────────────────────

    private static void ForgetScreen()
    {
        header = null;
        homeScore = null;
        awayScore = null;
        time = null;
        homeTeam = null;
        awayTeam = null;
        lowerThird = null;
        home = -1;
        away = -1;
    }

    private static string Read(VisualElement element) => element == null ? "" : Ui.Plain(Il2.TextOf(element.Pointer));

    /// <summary>보이는 화면(SI.Bindable.Panel) 가운데 경기 윗줄과 풀타임 보고서를 찾는다. 화면 안쪽까지는 내려가지 않는다.</summary>
    private static void FindPanels(VisualElement element, int depth, ref VisualElement headerPanel, ref VisualElement fullTime)
    {
        if (!UiTree.Displayed(element)) return;
        if (Il2.ClassName(Il2.ClassOf(element.Pointer)) == "SI.Bindable.Panel")
        {
            var name = element.name;
            if (name == "OverviewHeader") headerPanel = element;
            else if (name == "FullTimeTeamReport") fullTime = element;
            return;
        }
        if (depth > 12) return;
        var children = element.m_Children;
        if (children == null) return;
        var total = children.Count;
        for (var i = 0; i < total; i++)
        {
            var child = children[i];
            if (child != null) FindPanels(child, depth + 1, ref headerPanel, ref fullTime);
        }
    }

    /// <summary>경기 윗줄에서 점수판 요소를 찾아 둔다.</summary>
    private static bool Adopt(VisualElement panel)
    {
        VisualElement hs = null, aScore = null, clock = null, ht = null, at = null;
        Ui.Walk(panel, element =>
        {
            switch (element.name)
            {
                case "HomeScore": hs = element; break;
                case "AwayScore": aScore = element; break;
                case "Time": clock = element; break;
                case "HomeTeamText": ht = element; break;
                case "AwayTeamText": at = element; break;
            }
            return false;
        });
        if (hs == null || aScore == null) return false;
        header = panel;
        homeScore = hs;
        awayScore = aScore;
        time = clock;
        homeTeam = ht;
        awayTeam = at;
        return true;
    }

    private static bool ReadScore(out int h, out int a)
    {
        a = -1;
        return int.TryParse(Read(homeScore), out h) && int.TryParse(Read(awayScore), out a);
    }

    /// <summary>경기 시계("60:37")를 몇 분째인지("61'")로 바꾼다. 모르는 모양이면 그대로 둔다.</summary>
    private static string Minute(string clock)
    {
        var m = ClockText.Match(clock);
        return m.Success ? int.Parse(m.Groups[1].Value) + 1 + "'" : clock;
    }

    /// <summary>지금 떠 있는 골 알림. 없으면 null</summary>
    private static VisualElement FindPopup(long now, int searchEveryMs = PopupSearchMs)
    {
        if (lowerThird != null && lowerThird.panel == null) lowerThird = null;
        if (lowerThird == null)
        {
            if (now < nextPopupSearch) return null;
            nextPopupSearch = now + searchEveryMs;
            VisualElement found = null;
            foreach (var root in UiTree.Roots())
            {
                Ui.Walk(root, element =>
                {
                    if (element.name != "LowerThirdSelector") return false;
                    found = element;
                    return true;
                });
                if (found != null) break;
            }
            lowerThird = found;
        }
        return lowerThird != null && UiTree.Displayed(lowerThird) ? lowerThird : null;
    }

    /// <summary>골 알림에서 득점자와 도움을 읽어 goal에 채운다. 골 알림이 아니거나 아직 비어 있으면 false</summary>
    private static bool ReadPopup(VisualElement popup, Goal goal)
    {
        var isGoal = false;
        string club = null;
        var main = new List<string>();
        var assist = new List<string>();
        var extra = new List<string>();

        void Collect(VisualElement element, bool inInfo, bool inAssist, bool inOwn)
        {
            if (!UiTree.Displayed(element)) return;
            switch (element.name)
            {
                case "GoalIcon": isGoal = true; break;
                case "InfoBlock": inInfo = true; break;
                case "SIVisible_HasAssist": inAssist = true; break;
                case "BindableSwitchElement_owngoal": inOwn = true; break;
            }
            var text = Read(element);
            if (text.Length > 0)
            {
                if (!inInfo) club ??= text;
                else if (inAssist) assist.Add(text);
                else if (inOwn) extra.Add(text);
                else main.Add(text);
            }
            var children = element.m_Children;
            if (children == null) return;
            var total = children.Count;
            for (var i = 0; i < total; i++)
            {
                var child = children[i];
                if (child != null) Collect(child, inInfo, inAssist, inOwn);
            }
        }

        Collect(popup, false, false, false);
        if (!isGoal) return false;
        Split(main, out var number, out var name);
        if (name.Length == 0) return false;

        goal.Number = number;
        goal.Scorer = name;
        if (!string.IsNullOrEmpty(club)) goal.Team = club;
        Split(assist, out var assistNumber, out var assistName);
        // 도움이 없는 골에서는 도움 칸에 득점자가 그대로 남아 있기도 하다
        if (assistName.Length > 0 && assistName != name)
        {
            goal.AssistNumber = assistNumber;
            goal.Assist = assistName;
        }
        if (extra.Count > 0)
        {
            goal.Own = true;
            goal.Note = string.Join(" ", extra);
        }
        return true;
    }

    /// <summary>"등번호, 이름" 순으로 놓인 글자를 나눈다.</summary>
    private static void Split(List<string> parts, out string number, out string name)
    {
        number = "";
        name = "";
        foreach (var part in parts)
        {
            if (Digits.IsMatch(part))
            {
                if (number.Length == 0) number = part;
            }
            else if (name.Length == 0)
            {
                name = part;
            }
        }
    }

    // ── 골 카드 ───────────────────────────────────────────

    private static void Commit(Goal goal)
    {
        Goals.Add(goal);
        Plugin.Logger.LogInfo(
            $"goal: {goal.Minute} {goal.Team} #{goal.Number} {goal.Scorer}" +
            (goal.Assist.Length > 0 ? $" (assist #{goal.AssistNumber} {goal.Assist})" : "") +
            (goal.Own ? " [own goal]" : "") + $" {goal.ScoreLine}");
        // 순위 줄을 새로 올려 둔다(다른 경기 결과로 목록이 바뀌었을 수 있다). 값은 조금 뒤 Enrich에서 읽는다
        if (dataStage == 3 && GameData.Available)
        {
            PlaceRanks("g");
            PlaceRanks("a");
        }
        ShowGoal(goal);
    }

    /// <summary>적어 둔 골 기록에서 이 선수의 이번 경기 득점·도움 수를 세어 카드를 띄운다.</summary>
    private static void ShowGoal(Goal goal, bool refresh = false)
    {
        var upTo = Goals.IndexOf(goal);
        var earlier = upTo < 0 ? Goals : Goals.GetRange(0, upTo + 1);
        var scored = goal.Scorer.Length == 0 || goal.Own
            ? 0
            : earlier.Count(g => !g.Own && g.Scorer == goal.Scorer && g.Team == goal.Team);
        var assisted = goal.Assist.Length == 0
            ? 0
            : earlier.Count(g => g.Assist == goal.Assist && g.Team == goal.Team);
        ShowGoal(goal, scored, assisted, header?.panel?.visualTree, time, refresh);
    }

    private static string GoalTitle(Goal goal, int scored)
    {
        if (goal.Own) return "OWN GOAL";
        return scored switch
        {
            2 => "MULTI GOAL",
            3 => "HAT-TRICK",
            > 3 => scored + " GOALS",
            _ => "GOAL"
        };
    }

    private static void ShowGoal(Goal goal, int scored, int assisted, VisualElement root, VisualElement fontSample, bool refresh = false)
    {
        HideCard();
        if (root == null) return;
        var built = Frame(Gold);

        // 윗줄: 종류와 시간
        var top = Ui.Row();
        Ui.Try(() => top.style.justifyContent = new StyleEnum<Justify>(Justify.SpaceBetween));
        top.Add(Ui.Text(GoalTitle(goal, scored), 13, Gold));
        top.Add(Ui.Text(goal.Minute, 13, Color.white, TextAnchor.UpperRight));
        built.Add(top);

        // 득점자
        var who = Ui.Row();
        Ui.Try(() => who.style.alignItems = new StyleEnum<Align>(Align.FlexEnd));
        Ui.Try(() => who.style.marginTop = new StyleLength(6f));
        if (goal.Number.Length > 0)
        {
            var number = Ui.Text(goal.Number, 15, Soft);
            Ui.Try(() => number.style.marginRight = new StyleLength(8f));
            Ui.Try(() => number.style.marginBottom = new StyleLength(2f));
            who.Add(number);
        }
        var name = Ui.Text(goal.Scorer.Length > 0 ? goal.Scorer : goal.Team + " 골", 20, Color.white);
        Ui.Try(() => name.style.flexShrink = new StyleFloat(1f));
        who.Add(name);
        built.Add(who);

        var detail = goal.Own
            ? (goal.Note.Length > 0 ? goal.Note : "자책골")
            : scored > 0 ? $"이번 경기 {scored}호 골" : "";
        if (detail.Length > 0)
        {
            var line = Ui.Text(detail, 13, Gold);
            Ui.Try(() => line.style.marginTop = new StyleLength(2f));
            built.Add(line);
        }
        if (goal.Fact.Length > 0)
        {
            var fact = Ui.Text(goal.Fact, 13, Color.white);
            Ui.Try(() => fact.style.marginTop = new StyleLength(4f));
            built.Add(fact);
        }
        else if (goal.SeasonGoals != null)
        {
            var where = goal.Competition.Length > 0 ? goal.Competition + " " : "";
            var apps = goal.SeasonApps > 0 ? $" ({goal.SeasonApps}경기)" : "";
            var season = Ui.Text($"{where}이번 시즌 {goal.SeasonGoals}골{apps}", 13, Color.white);
            Ui.Try(() => season.style.marginTop = new StyleLength(4f));
            built.Add(season);
        }
        if (goal.CareerLeagueGoals != null || goal.CareerGoals != null)
        {
            var parts = new List<string>();
            if (goal.CareerLeagueGoals != null) parts.Add($"통산 리그 {goal.CareerLeagueGoals}골");
            if (goal.CareerGoals != null) parts.Add($"통산 {goal.CareerGoals}골");
            var career = Ui.Text(string.Join("   ", parts), 12, Soft);
            Ui.Try(() => career.style.marginTop = new StyleLength(2f));
            built.Add(career);
        }

        if (goal.Assist.Length > 0)
        {
            var row = Divided();
            var label = Ui.Text("도움", 12, Soft);
            Ui.Try(() => label.style.marginRight = new StyleLength(8f));
            row.Add(label);
            var helper = Ui.Text((goal.AssistNumber.Length > 0 ? goal.AssistNumber + "  " : "") + goal.Assist, 13, Color.white);
            Ui.Try(() => helper.style.flexGrow = new StyleFloat(1f));
            Ui.Try(() => helper.style.flexShrink = new StyleFloat(1f));
            row.Add(helper);
            if (goal.AssistSeason != null) row.Add(Ui.Text($"시즌 {goal.AssistSeason}도움", 12, Soft, TextAnchor.UpperRight));
            else if (assisted > 1) row.Add(Ui.Text($"이번 경기 {assisted}호", 12, Soft, TextAnchor.UpperRight));
            built.Add(row);
        }

        var score = Ui.Text(goal.ScoreLine, 12, Soft);
        Ui.Try(() => score.style.marginTop = new StyleLength(8f));
        built.Add(score);

        var league = goal.Competition.Length > 0 ? goal.Competition + " " : "";
        Table(built, league + "득점 순위", goal.TopGoals, goal.Own ? "" : goal.Scorer);
        Table(built, league + "도움 순위", goal.TopAssists, goal.Assist);

        Present(built, root, fontSample, goal.TopGoals.Count + goal.TopAssists.Count > 0 ? TableCardMs : GoalCardMs);
        if (refresh)
        {
            // 떠 있던 카드를 고쳐 그리는 것이라 다시 서서히 나타나게 하지 않는다
            cardFrom -= FadeInMs;
            Ui.Try(() => built.style.opacity = new StyleFloat(1f));
        }
    }

    /// <summary>순위표 하나: 제목 아래에 "순위  이름  팀  값" 줄들. who와 이름이 같은 줄은 강조한다.</summary>
    private static void Table(VisualElement built, string title, List<Ranked> rows, string who)
    {
        if (rows.Count == 0) return;
        var block = new VisualElement();
        Ui.Try(() => block.style.marginTop = new StyleLength(8f));
        Ui.Try(() => block.style.paddingTop = new StyleLength(8f));
        Ui.Try(() => block.style.borderTopWidth = new StyleFloat(1f));
        Ui.Try(() => block.style.borderTopColor = new StyleColor(Line));
        var head = Ui.Text(title, 11, Soft);
        Ui.Try(() => head.style.marginBottom = new StyleLength(4f));
        block.Add(head);
        foreach (var ranked in rows)
        {
            var mine = who.Length > 0 && ranked.Name == who;
            var color = mine ? Gold : Color.white;
            var row = Ui.Row();
            Ui.Try(() => row.style.marginBottom = new StyleLength(2f));
            var position = Ui.Text(ranked.Position, 12, Soft);
            Ui.Try(() => position.style.width = new StyleLength(18f));
            row.Add(position);
            var name = Ui.Text(ranked.Name, 12, color);
            Ui.Try(() => name.style.flexGrow = new StyleFloat(1f));
            Ui.Try(() => name.style.flexShrink = new StyleFloat(1f));
            Ui.Try(() => name.style.whiteSpace = new StyleEnum<WhiteSpace>(WhiteSpace.NoWrap));
            Ui.Try(() => name.style.overflow = new StyleEnum<Overflow>(Overflow.Hidden));
            row.Add(name);
            var team = Ui.Text(ranked.Team, 11, Soft, TextAnchor.UpperRight);
            Ui.Try(() => team.style.width = new StyleLength(40f));
            row.Add(team);
            var value = Ui.Text(ranked.Value, 12, color, TextAnchor.UpperRight);
            Ui.Try(() => value.style.width = new StyleLength(26f));
            row.Add(value);
            block.Add(row);
        }
        built.Add(block);
    }

    // ── 최우수 선수 카드 ──────────────────────────────────

    /// <summary>풀타임 보고서의 선수 표를 읽어 평점이 가장 높은 선수를 카드로 띄운다. 표가 아직 덜 채워졌으면 다음에 다시 본다.</summary>
    private static void ShowBestPlayer(VisualElement report, long now)
    {
        VisualElement homeTile = null, awayTile = null, sample = null;
        var clubs = new List<string>();
        string competition = null, result = null;
        Ui.Walk(report, element =>
        {
            switch (element.name)
            {
                case "AllPlayerStatsHomeTeam": homeTile = element; break;
                case "AllPlayerStatsAwayTeam": awayTile = element; break;
                case "ClubName":
                {
                    var text = Read(element);
                    if (text.Length > 0)
                    {
                        clubs.Add(text);
                        sample ??= element;
                    }
                    break;
                }
                case "ClubText":
                    if (competition == null && Read(element).Length > 0) competition = Read(element);
                    break;
                case "IsMatch":
                    if (result == null && Read(element).Length > 0) result = Read(element);
                    break;
            }
            return false;
        });
        if (homeTile == null && awayTile == null) return;

        var homeClub = clubs.Count > 0 ? clubs[0] : "";
        var awayClub = clubs.Count > 1 ? clubs[1] : "";
        var key = $"{homeClub}|{awayClub}|{result}";
        if (key == bestShownFor) return;

        var rows = new List<Row>();
        ReadRows(homeTile, homeClub, rows);
        ReadRows(awayTile, awayClub, rows);
        // 한 팀의 표만 보일 수도 있다(카드를 넘겨 둔 경우). 그래도 한 팀은 다 채워져 있어야 한다
        if (rows.Count < 11) return;

        bestShownFor = key;
        Row best = null;
        foreach (var row in rows)
            if (best == null || row.Rating > best.Rating)
                best = row;
        Plugin.Logger.LogInfo($"best player: {best.Team} {best.Name} {best.RatingText} ({best.Goals}G {best.Assists}A), {rows.Count} rows");

        var line = $"{homeClub} {result} {awayClub}".Trim();
        ShowBest(best, FullName(best), Story(best), competition ?? "", line, report.panel?.visualTree, sample);
        Plugin.Logger.LogInfo(
            $"best player (game): {GameData.Text(MatchRoot + "PlayerOfTheMatch.Name")} {GameData.Text(MatchRoot + "PlayerOfTheMatchRating")}");
    }

    private static void ReadRows(VisualElement tile, string club, List<Row> rows)
    {
        if (tile == null) return;
        var team = "";
        Ui.Walk(tile, element =>
        {
            if (team.Length == 0 && element.name == "title-text") team = Read(element);
            if (!element.ClassListContains("virtualised-list__item")) return false;
            var row = new Row { Team = team, Club = club };
            ReadRow(element, "", row);
            if (row.Name.Length > 0 && row.Rating > 0) rows.Add(row);
            return false;
        });
    }

    private static void ReadRow(VisualElement element, string section, Row row)
    {
        if (!UiTree.Displayed(element)) return;
        var name = element.name ?? "";
        if (name is "Position" or "Name" or "Subbed" or "Goals" or "Assists" or "Rating") section = name;
        if (section == "Position" && name == "Sub") row.Bench = true;

        if (section is "Subbed" or "Goals")
        {
            var classes = element.m_ClassList;
            if (classes != null)
            {
                for (var i = 0; i < classes.Count; i++)
                {
                    var c = classes[i];
                    if (c == null) continue;
                    if (section == "Subbed" && c.Contains("sub-on")) row.CameOn = true;
                    if (section == "Goals" && c.StartsWith(GoalClass) && int.TryParse(c[GoalClass.Length..], out var icon))
                        row.Goals = Math.Max(row.Goals, icon);
                }
            }
        }

        var text = Read(element);
        if (text.Length > 0)
        {
            switch (section)
            {
                case "Position": row.Position = text; break;
                case "Name": if (row.Name.Length == 0) row.Name = text; break;
                case "Subbed": row.SubMinute = text; break;
                case "Goals": if (int.TryParse(text, out var goals)) row.Goals = Math.Max(row.Goals, goals); break;
                case "Assists": if (int.TryParse(text, out var assists)) row.Assists = assists; break;
                case "Rating":
                    if (float.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var rating))
                    {
                        row.Rating = rating;
                        row.RatingText = text;
                    }
                    break;
            }
        }

        var children = element.m_Children;
        if (children == null) return;
        var total = children.Count;
        for (var i = 0; i < total; i++)
        {
            var child = children[i];
            if (child != null) ReadRow(child, section, row);
        }
    }

    /// <summary>
    /// 표에는 짧은 이름("B. Barcola")이, 골 알림에는 온전한 이름("브래들리 바르콜라")이 나온다.
    /// 경기 중에 적어 둔 골 기록에서 같은 팀이고 득점·도움 수가 꼭 맞는 선수가 한 명뿐이면 그 이름을 쓴다.
    /// </summary>
    private static string FullName(Row row)
    {
        // 게임이 뽑은 최우수 선수의 평점이 이 줄과 같으면 그 선수다
        var picked = GameData.Text(MatchRoot + "PlayerOfTheMatch.Name");
        if (!string.IsNullOrEmpty(picked) &&
            float.TryParse(GameData.Text(MatchRoot + "PlayerOfTheMatchRating"), NumberStyles.Float, CultureInfo.InvariantCulture, out var rating) &&
            Math.Abs(rating - row.Rating) < 0.051f)
            return picked;

        var mine = Goals.Where(g => g.Team == row.Team).ToList();
        if (mine.Any(g => g.Scorer == row.Name || g.Assist == row.Name)) return row.Name;
        if (row.Goals + row.Assists == 0) return null;
        var names = new List<string>();
        foreach (var goal in mine)
        {
            if (!goal.Own && goal.Scorer.Length > 0 && !names.Contains(goal.Scorer)) names.Add(goal.Scorer);
            if (goal.Assist.Length > 0 && !names.Contains(goal.Assist)) names.Add(goal.Assist);
        }
        var same = names.Where(n =>
            mine.Count(g => !g.Own && g.Scorer == n) == row.Goals && mine.Count(g => g.Assist == n) == row.Assists).ToList();
        return same.Count == 1 ? same[0] : null;
    }

    /// <summary>이 선수가 관여한 골을 시간 순으로 적는다. 이름을 맞추지 못했으면 비어 있다.</summary>
    private static List<string> Story(Row row)
    {
        var lines = new List<string>();
        var full = FullName(row);
        if (full == null) return lines;
        foreach (var goal in Goals)
        {
            if (goal.Team != row.Team) continue;
            if (!goal.Own && goal.Scorer == full)
                lines.Add($"{goal.Minute}  득점" + (goal.Assist.Length > 0 ? $" (도움 {goal.Assist})" : ""));
            else if (goal.Assist == full)
                lines.Add($"{goal.Minute}  도움 ({goal.Scorer} 득점)");
        }
        return lines;
    }

    private static string Played(Row row)
    {
        if (row.SubMinute.Length == 0) return "풀타임";
        if (row.CameOn && !row.Bench) return row.SubMinute + " 교체 투입";
        return row.SubMinute + " 교체 아웃";
    }

    private static void ShowBest(Row best, string fullName, List<string> story, string competition, string result, VisualElement root, VisualElement fontSample)
    {
        HideCard();
        if (root == null) return;
        var built = Frame(Great);

        // 윗줄: 종류와 평점
        var top = Ui.Row();
        Ui.Try(() => top.style.justifyContent = new StyleEnum<Justify>(Justify.SpaceBetween));
        Ui.Try(() => top.style.alignItems = new StyleEnum<Align>(Align.Center));
        top.Add(Ui.Text("PLAYER OF THE MATCH", 13, Gold));
        var rating = Ui.Text(best.RatingText, 18, Color.white, TextAnchor.MiddleCenter);
        Ui.Try(() => rating.style.backgroundColor = new StyleColor(best.Rating >= 8f ? Great : best.Rating >= 7f ? Good : Plain));
        Ui.Pad(rating, 2, 10);
        Ui.Round(rating, 4);
        top.Add(rating);
        built.Add(top);

        var name = Ui.Text(fullName ?? best.Name, 20, Color.white);
        Ui.Try(() => name.style.marginTop = new StyleLength(6f));
        built.Add(name);

        var where = best.Bench || best.Position.Length == 0 ? best.Club : $"{best.Club}  {best.Position}";
        var club = Ui.Text(where.Trim(), 13, Soft);
        Ui.Try(() => club.style.marginTop = new StyleLength(2f));
        built.Add(club);

        // 이번 경기 기록
        var stats = Divided();
        Stat(stats, "출전", Played(best));
        Stat(stats, "득점", best.Goals.ToString());
        Stat(stats, "도움", best.Assists.ToString());
        built.Add(stats);

        if (story.Count > 0)
        {
            var block = new VisualElement();
            Ui.Try(() => block.style.marginTop = new StyleLength(8f));
            Ui.Try(() => block.style.paddingTop = new StyleLength(8f));
            Ui.Try(() => block.style.borderTopWidth = new StyleFloat(1f));
            Ui.Try(() => block.style.borderTopColor = new StyleColor(Line));
            foreach (var line in story)
            {
                var item = Ui.Text(line, 12, Color.white);
                Ui.Try(() => item.style.marginBottom = new StyleLength(2f));
                block.Add(item);
            }
            built.Add(block);
        }

        var foot = Ui.Text((competition.Length > 0 ? competition + "  " : "") + result, 12, Soft);
        Ui.Try(() => foot.style.marginTop = new StyleLength(8f));
        built.Add(foot);

        Present(built, root, fontSample, BestCardMs);
    }

    /// <summary>"출전 / 풀타임"처럼 이름표와 값을 위아래로 놓은 칸 하나.</summary>
    private static void Stat(VisualElement row, string label, string value)
    {
        var cell = new VisualElement();
        Ui.Try(() => cell.style.marginRight = new StyleLength(18f));
        cell.Add(Ui.Text(label, 11, Soft));
        var shown = Ui.Text(value, 14, Color.white);
        Ui.Try(() => shown.style.marginTop = new StyleLength(2f));
        cell.Add(shown);
        row.Add(cell);
    }

    // ── 카드 공통 ─────────────────────────────────────────

    /// <summary>카드의 바탕. 화면 오른쪽 위, 점수판 아래에 놓인다.</summary>
    private static VisualElement Frame(Color accent)
    {
        var frame = new VisualElement { name = CardName };
        Ui.Try(() => frame.style.position = new StyleEnum<Position>(Position.Absolute));
        Ui.Try(() =>
        {
            frame.style.right = new StyleLength(16f);
            frame.style.top = new StyleLength(64f);
            frame.style.width = new StyleLength(290f);
        });
        Ui.Try(() => frame.style.backgroundColor = new StyleColor(Back));
        Ui.Try(() =>
        {
            frame.style.borderLeftWidth = new StyleFloat(4f);
            frame.style.borderLeftColor = new StyleColor(accent);
        });
        Ui.Pad(frame, 12, 14);
        Ui.Round(frame, 6);
        Ui.Try(() => frame.style.opacity = new StyleFloat(0f));
        return frame;
    }

    /// <summary>위쪽에 가는 줄을 그어 앞 내용과 나눈 가로줄.</summary>
    private static VisualElement Divided()
    {
        var row = Ui.Row();
        Ui.Try(() => row.style.marginTop = new StyleLength(8f));
        Ui.Try(() => row.style.paddingTop = new StyleLength(8f));
        Ui.Try(() => row.style.borderTopWidth = new StyleFloat(1f));
        Ui.Try(() => row.style.borderTopColor = new StyleColor(Line));
        return row;
    }

    private static void Present(VisualElement built, VisualElement root, VisualElement fontSample, int showMs)
    {
        // 카드는 보기만 하는 것이다. 카드 아래의 게임 화면을 누르는 데 방해가 되지 않게 한다
        IgnoreClicks(built);
        Ui.UseFontOf(built, fontSample);
        root.Add(built);
        card = built;
        cardFrom = Clock.ElapsedMilliseconds;
        cardUntil = cardFrom + showMs;
    }

    private static void IgnoreClicks(VisualElement element)
    {
        Ui.Try(() => element.pickingMode = PickingMode.Ignore);
        var children = element.m_Children;
        if (children == null) return;
        for (var i = 0; i < children.Count; i++)
        {
            var child = children[i];
            if (child != null) IgnoreClicks(child);
        }
    }

    private static void Fade(long now)
    {
        var opacity = 1f;
        if (now - cardFrom < FadeInMs) opacity = (now - cardFrom) / (float)FadeInMs;
        else if (cardUntil - now < FadeOutMs) opacity = Math.Max(0f, (cardUntil - now) / (float)FadeOutMs);
        try
        {
            card.style.opacity = new StyleFloat(opacity);
        }
        catch
        {
            // 화면이 통째로 사라진 경우. 다음 Step에서 치운다
        }
    }

    private static void HideCard()
    {
        try
        {
            if (card != null && card.parent != null) card.RemoveFromHierarchy();
        }
        catch
        {
            // 화면이 통째로 사라진 경우
        }
        card = null;
    }

    // ── 시험 ──────────────────────────────────────────────

    /// <summary>개발용. 경기 없이 견본 카드를 띄워 모양을 본다(goal, multi, hat, best).</summary>
    public static string Test(string kind)
    {
        var roots = UiTree.Roots();
        if (roots.Count == 0) return "no screen";
        var root = header?.panel?.visualTree ?? roots[^1];
        VisualElement sample = null;
        foreach (var each in roots)
        {
            Ui.Walk(each, element =>
            {
                if (Il2.ClassName(Il2.ClassOf(element.Pointer)) != "SI.Bindable.SIText") return false;
                if (string.IsNullOrEmpty(Il2.TextOf(element.Pointer))) return false;
                sample = element;
                return true;
            });
            if (sample != null) break;
        }

        if (kind == "best")
        {
            var best = new Row
            {
                Team = "LIV", Club = "리버풀", Name = "B. Barcola", Bench = true, SubMinute = "76'",
                Goals = 1, Assists = 1, Rating = 8.8f, RatingText = "8.8"
            };
            var story = new List<string> { "61'  도움 (알렉산데르 이삭 득점)", "64'  득점" };
            ShowBest(best, "브래들리 바르콜라", story, "프리미어 리그", "리버풀 3 : 0 울브스", root, sample);
            return "shown";
        }

        var goal = new Goal
        {
            Minute = "61'",
            Team = "LIV",
            Number = "9",
            Scorer = "알렉산데르 이삭",
            AssistNumber = "29",
            Assist = "브래들리 바르콜라",
            ScoreLine = "LIV 2 - 0 WOL",
            Fact = kind == "fact" ? "13경기에서 4득점을 달성했습니다" : ""
        };
        if (kind == "full")
        {
            goal.Competition = "프리미어 리그";
            goal.SeasonGoals = 13;
            goal.SeasonApps = 18;
            goal.CareerLeagueGoals = 128;
            goal.CareerGoals = 132;
            goal.AssistSeason = 8;
            goal.TopGoals = new List<Ranked>
            {
                new() { Position = "1", Name = "엘링 홀란", Team = "MCI", Value = "18" },
                new() { Position = "2", Name = "알렉산데르 이삭", Team = "LIV", Value = "13" },
                new() { Position = "3", Name = "니콜라 잭슨", Team = "AVL", Value = "11" },
                new() { Position = "4", Name = "조르지뇨 뤼테", Team = "BHA", Value = "10" },
                new() { Position = "=", Name = "모건 로저스", Team = "CHE", Value = "10" }
            };
            goal.TopAssists = new List<Ranked>
            {
                new() { Position = "1", Name = "마티아스 페르난데스 파르도", Team = "NFO", Value = "9" },
                new() { Position = "=", Name = "필 포든", Team = "MCI", Value = "9" },
                new() { Position = "4", Name = "브래들리 바르콜라", Team = "LIV", Value = "8" }
            };
        }
        ShowGoal(goal, kind == "multi" ? 2 : kind == "hat" ? 3 : 1, kind == "multi" ? 2 : 1, root, sample);
        return "shown";
    }
}
