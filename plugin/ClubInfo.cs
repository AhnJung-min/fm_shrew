using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 세이브에서 읽지 못하는 구단과 선수단의 지금 상태를 게임에 물어 받아 온다(앱의 대시보드가 쓴다). 읽기만 한다.
///   /club?team=번호     내 팀의 프로필(리그, 경기장, 연고 시즌 티켓, 창단 연도), 시설, 재정
///   /health?uids=…      1군 선수들의 부상·징계·컨디션·경기 감각·사기·최근 활약
///   /fields             개발용. 한 대상에 임의의 항목 경로를 청해 본다
///
/// 항목 경로는 PersonInfo와 같은 방법으로 청한다. 항목 이름은 게임의 대상 클래스(…Reference)가 받는 이름이다.
/// 클래스가 받는 이름은 앞서 /props로 받아 둔 목록에서 확인했고(Team, Club, Person, Comp, Contract), 안쪽 대상(경기장·시설 등급·부상 등)이
/// 받는 이름은 정적으로는 알 수 없어서 후보를 늘어놓는다. 같은 이름(key)의 후보 가운데 게임이 받지 않는 것은 청하지 않고,
/// 받아서 값이 온 첫 후보를 쓴다. 어느 경로에서 값이 왔는지는 응답의 "paths"에 적고, 청하지 않은 후보는 "skipped"에 적는다.
/// </summary>
internal static class ClubInfo
{
    private const string StadiumRef = "FM.UI.StadiumReference";
    private const string FacilityRef = "FM.UI.FacilityRatingReference";
    private const string StarRef = "FM.UI.StarRangeReference";
    private const string InjuryRef = "FM.UI.PlayerInjuryReference";
    private const string BansRef = "FM.UI.PlayerBansOverviewReference";
    private const string LastFiveRef = "FM.UI.LastFiveMatchesFormReference";
    private const string DisplayRef = "FM.UI.DisplayValueWithSortReference";

    private static PersonInfo.Field F(string key, string path, params (string Owner, string Leaf)[] checks) => new(key, path, false, checks);

    /// <summary>경로의 마지막 항목을 owner가 받는지 확인하라는 표시</summary>
    private static (string, string) Leaf(string owner, string path) => (owner, path[(path.LastIndexOf('.') + 1)..]);

    private static PersonInfo.Field[] Chain(string key, string prefix, string owner, params string[] leaves)
    {
        var fields = new PersonInfo.Field[leaves.Length];
        for (var i = 0; i < leaves.Length; i++) fields[i] = F(key, prefix + "." + leaves[i], (owner, leaves[i]));
        return fields;
    }

    /// <summary>시설 등급 하나: 말(등급 이름)과 별(숫자) 후보</summary>
    private static IEnumerable<PersonInfo.Field> Facility(string key, string ratingPath, string starsPath)
    {
        foreach (var field in Chain(key, ratingPath, FacilityRef, "FacilityRating", "Description", "Name", "DisplayValue", "Text", "Value", "Level", "Rating"))
            yield return field;
        // 팀에 별 범위로 따로 있는 경우(유소년 시설)
        if (starsPath != null)
            foreach (var field in Chain(key + "Stars", starsPath, StarRef, "Value", "Max", "Upper", "Min", "Lower"))
                yield return field;
        // 등급 안에 별 범위가 들어 있는 경우
        foreach (var leaf in new[] { "Value", "Max", "Upper", "Min", "Lower" })
            yield return F(key + "Stars", ratingPath + ".FacilityStarRange." + leaf, (FacilityRef, "FacilityStarRange"), (StarRef, leaf));
    }

    /// <summary>팀 기록에 청하는 항목. 첫 항목(Name)은 모든 팀에 있다.</summary>
    private static readonly PersonInfo.Field[] ClubFields = new[]
    {
        F("name", "Name"),
        F("club", "Club.Name"),
        // 구단 프로필
        F("division", "Division.Name"),
        F("division", "Club.Division.Name"),
        F("division", "DomesticDivision.Name"),
        F("divisionShort", "Division.ShortName"),
        F("leaguePosition", "LeaguePositionString"),
        F("leaguePosition", "LeaguePosition"),
        F("stadium", "Stadium.Name", Leaf(StadiumRef, "Name")),
        F("capacity", "Stadium.Capacity", Leaf(StadiumRef, "Capacity")),
        F("capacity", "Stadium.TotalCapacity", Leaf(StadiumRef, "TotalCapacity")),
        F("averageAttendance", "AverageAttendance"),
        F("seasonTickets", "Club.SeasonTicketHolders"),
        F("seasonTicketPrice", "Club.SeasonTicketPrice"),
        F("seasonTicketWaiting", "Club.SeasonTicketWaitingList"),
        F("founded", "Club.YearFounded"),
        F("reputation", "Club.Reputation")
    }
    // 시설: 훈련 시설, 유소년 시설(유스 코칭·유스 영입은 구단에 값이 바로 있다)
    .Concat(Facility("training", "Club.TrainingFacilityRating", null))
    .Append(F("training", "TrainingFacilitiesLongString"))
    .Concat(Facility("youthFacilities", "Club.YouthFacilityRating", "YouthFacilitiesStars"))
    .Append(F("youthCoaching", "Club.YouthCoaching"))
    .Append(F("youthCoaching", "Club.YouthCoachingLevel"))
    .Concat(Chain("youthCoachingStars", "YouthCoachingStars", StarRef, "Value", "Max", "Upper", "Min", "Lower"))
    .Append(F("youthRecruitment", "Club.YouthRecruitment"))
    .Concat(Chain("youthRecruitmentStars", "YouthRecruitmentStars", StarRef, "Value", "Max", "Upper", "Min", "Lower"))
    // 재정
    .Concat(new[]
    {
        F("transferBudget", "Club.TransferBudget"),
        F("wageBudget", "Club.WageBudget"),
        F("wageSpend", "Club.CurrentWageSpending"),
        F("wageSpendText", "Club.CurrentWageSpendingWithText"),
        F("wageRemaining", "Club.RemainingWageBudget"),
        F("wageRemainingText", "Club.RemainingWageBudgetWithText"),
        F("balance", "Club.OverallBalance"),
        F("balanceStatus", "Club.FinancialStatus.DisplayValue", Leaf(DisplayRef, "DisplayValue")),
        F("incomeSeason", "Club.TotalIncomeThisSeason"),
        F("expenditureSeason", "Club.TotalExpenditureThisSeason"),
        F("debt", "Club.TotalDebt")
    })
    .ToArray();

    /// <summary>선수 기록에 청하는 항목. 첫 항목(Age)은 모든 선수에게 있다.</summary>
    private static readonly PersonInfo.Field[] HealthFields = new[]
    {
        F("age", "Age"),
        // 부상
        F("injured", "IsInjured")
    }
    .Concat(Chain("injuryName", "CurrentInjury", InjuryRef, "InjuryDescription", "InjuryTypeString", "Description", "Name"))
    .Concat(Chain("injuryDuration", "CurrentInjury", InjuryRef, "InjuryDuration", "InjuryDurationLong", "InjuryDurationShort", "Duration"))
    .Concat(Chain("injuryDays", "CurrentInjury", InjuryRef, "InjuryDurationDays", "InjuryReturnDays"))
    .Concat(Chain("injurySeverity", "CurrentInjury", InjuryRef, "InjurySeverity"))
    // 징계(사기·징계는 팀 문맥이 필요해 team 마디를 함께 올린다)
    .Append(F("suspensions", "SuspensionsCount"))
    .Concat(Chain("banReason", "BanOverviewDefault", BansRef, "BanOverviewReason", "BanReason", "BanCurrentBan"))
    .Concat(Chain("banLeft", "BanOverviewDefault", BansRef, "BanDurationString", "BanCountRemaining"))
    // 몸 상태
    .Concat(new[]
    {
        F("condition", "Condition"),
        F("conditionText", "ConditionString"),
        F("sharpness", "Sharpness"),
        F("sharpnessText", "SharpnessStatusDescription"),
        F("morale", "Morale"),
        F("moraleText", "MoraleString"),
        F("fatigue", "Fatigue"),
        // 이번 시즌 활약
        F("appearances", "ClubAppearancesThisSeason"),
        F("goals", "ClubGoalsThisSeason"),
        F("assists", "ClubAssistsThisSeason"),
        F("rating", "ClubAverageRatingThisSeason"),
        F("lastRating", "LastMatchRating")
    })
    .Concat(Chain("formRating", "LastFiveClubMatchesForm", LastFiveRef, "LastFiveMatchesRating"))
    .ToArray();

    private static int ParseTeam(string text)
    {
        if (!int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var team) || team <= 0) throw new HttpError(400, "bad team");
        return team;
    }

    /// <summary>결과 JSON: {"records":[…],"paths":{키:경로},"skipped":[경로…]}</summary>
    private static string Wrap(PersonInfo.Answer answer)
    {
        var text = new StringBuilder("{\"records\":").Append(answer.Json).Append(",\"paths\":{");
        var first = true;
        foreach (var (key, path) in answer.Paths)
        {
            text.Append(first ? "" : ",").Append(PersonInfo.Quote(key)).Append(':').Append(PersonInfo.Quote(path));
            first = false;
        }
        text.Append("},\"skipped\":[");
        first = true;
        foreach (var path in answer.Skipped)
        {
            text.Append(first ? "" : ",").Append(PersonInfo.Quote(path));
            first = false;
        }
        return text.Append("]}").ToString();
    }

    /// <summary>팀(내 팀)의 프로필·시설·재정. 번호는 세이브에 적힌 팀 번호다.</summary>
    public static string Club(string teamText)
    {
        var team = ParseTeam(teamText);
        var targets = new List<(uint Id, int Index)> { ((uint)team, team) };
        return Wrap(PersonInfo.Run(GameData.RecordKind.Team, targets, ClubFields, "team", null));
    }

    /// <summary>선수들(고유 번호)의 건강과 경기력. teamText는 그 선수들이 뛰는 팀 번호(사기·징계를 보려면 필요하다).</summary>
    public static string Health(string uidsText, string teamText)
    {
        var targets = new List<(uint Id, int Index)>();
        foreach (var uid in PersonInfo.Parse(uidsText, PersonInfo.MaxPeople))
            if (LiveMemory.PersonIndex(uid, out var index))
                targets.Add((uid, index));
        var contexts = string.IsNullOrEmpty(teamText) ? null : new List<PersonInfo.Context> { new("team", GameData.RecordKind.Team, ParseTeam(teamText)) };
        return Wrap(PersonInfo.Run(GameData.RecordKind.Person, targets, HealthFields, "uid", contexts));
    }

    private static readonly Regex PathPattern = new("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)*$", RegexOptions.CultureInvariant);

    /// <summary>
    /// 개발용: 팀이나 선수 하나에 임의의 항목 경로들을 청하고, 값이 온 것을 경로를 이름으로 돌려준다.
    /// 예: /fields?kind=team&amp;id=번호&amp;f=Division.Name,Stadium.Name,Club.TransferBudget
    /// 선수일 때 team=팀 번호를 주면 사기처럼 팀 문맥이 필요한 항목도 청할 수 있다. 받는 이름인지는 확인하지 않고 그대로 청한다.
    /// </summary>
    public static string Fields(string kind, string idText, string pathsText, string teamText)
    {
        var paths = pathsText.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToList();
        if (paths.Count == 0 || paths.Count > 60) throw new HttpError(400, "need 1 to 60 paths");
        if (paths.Any(path => !PathPattern.IsMatch(path))) throw new HttpError(400, "bad path");
        if (!uint.TryParse(idText, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id == 0) throw new HttpError(400, "bad id");

        var baseline = kind == "person" ? "Age" : "Name";
        var fields = new List<PersonInfo.Field> { new(baseline, baseline) };
        fields.AddRange(paths.Where(path => path != baseline).Select(path => new PersonInfo.Field(path, path)));

        if (kind == "person")
        {
            if (!LiveMemory.PersonIndex(id, out var index)) throw new HttpError(404, "player not found");
            var contexts = string.IsNullOrEmpty(teamText) ? null : new List<PersonInfo.Context> { new("team", GameData.RecordKind.Team, ParseTeam(teamText)) };
            return Wrap(PersonInfo.Run(GameData.RecordKind.Person, new List<(uint, int)> { (id, index) }, fields.ToArray(), "uid", contexts));
        }
        if (kind == "team")
            return Wrap(PersonInfo.Run(GameData.RecordKind.Team, new List<(uint, int)> { (id, (int)id) }, fields.ToArray(), "team", null));
        throw new HttpError(400, "kind must be team or person");
    }
}
