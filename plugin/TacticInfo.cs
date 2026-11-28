using System.Globalization;
using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 지금 게임 전술과 선수들의 역할 별점을 읽어 앱에 준다(0.14.0부터. 읽기만 하고 게임에 쓰는 것은 없다).
///   /tactic?team=팀 번호&amp;uid=내 팀 선수 번호[&amp;roles=1]
///       전술 이름과 포메이션 이름, 자리 11개의 포지션·역할 비트(점유 시와 비점유 시 각각). 선수 이름과 번호는 읽지 않는다(배정은 앱이 한다).
///       roles=1이면 자리마다 그 자리에서 고를 수 있는 역할 목록도 읽는다(22번 묻는다. 느리다).
///   /rolestars?team=팀 번호&amp;uids=a,b,c (한 번에 5명까지)
///       선수마다 점유 시와 비점유 시의 역할 별점 표(역할 번호와 별점).
///
/// 새 JSON을 짓지 않는다. 개발용 /fields가 돌려주는 모양(PersonInfo.Probe의 답. 값은 모두 글자)을 그대로 이어 붙이고 앱이 풀어 읽는다.
/// 청하는 항목과 조건은 켜진 게임에서 /fields로 확인한 것이다: 전술은 선수 → Team.Tactic(조건 Boolean), 자리 목록은 TacticalPositions(조건 InPossession),
/// 고를 수 있는 역할은 AvailableRolesOnlyDropdown(조건 TeamSelectionIndex), 역할 별점은 PositionalAbilitiesRoleTable(조건 PositionMask, InPossession).
/// 역할 번호는 64비트 값이라 숫자가 아니라 글자로 주고받는다.
/// 이 창구의 조회 실패는 따로 센다(PersonInfo.TacticFailures): 몸값·건강 같은 조회를 멈추지 않는다.
/// </summary>
internal static class TacticInfo
{
    /// <summary>/rolestars가 한 번에 받는 선수 수(앱의 STARS_PER_REQUEST와 맞춘다)</summary>
    public const int MaxStarPlayers = 5;
    /// <summary>전술의 자리 수</summary>
    private const int SlotCount = 11;
    /// <summary>자리 목록에서 읽는 줄 수의 상한. 11줄이어야 하는데 더 오면 앱이 알아보도록 넉넉히 둔다</summary>
    private const int MaxSlotRows = 20;
    /// <summary>한 자리에서 고를 수 있는 역할 목록의 상한</summary>
    private const int MaxRoleRows = 40;
    /// <summary>역할 별점 표의 상한(선수가 뛸 줄 아는 포지션의 역할이 모두 들어간다)</summary>
    private const int MaxStarRows = 60;

    private const string TacticPath = "Team.Tactic";

    private static readonly string[] SlotItems = { "Position", "PositionRole", "Index", "IsGoalkeeper" };

    private static readonly PersonInfo.Field[] RoleFields =
    {
        new("Age", "Age"),
        new("PositionValue", TacticPath + ".PositionValue"),
        new("PositionRole", TacticPath + ".PositionRole")
    };

    private static readonly string[] RoleItems =
    {
        "RowData.DisplayValue.Role",
        "RowData.DisplayValue.TacticsRoleName",
        "RowData.DisplayValue.Selected"
    };

    private static readonly string[] StarItems =
    {
        "TacticsRoleID",
        "IsInPossession",
        "CurrentAbilityStars.MinValue",
        "CurrentAbilityStars.MaxValue"
    };

    private static int Team(string text)
    {
        if (!int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var team) || team <= 0) throw new HttpError(400, "bad team");
        return team;
    }

    private static uint Uid(string text)
    {
        if (!uint.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var uid) || uid == 0) throw new HttpError(400, "bad uid");
        return uid;
    }

    private static List<PersonInfo.Context> TeamContext(int team) => new() { new("team", GameData.RecordKind.Team, team) };

    /// <summary>수·참거짓 조건. slot이 있으면 그 자리의 목록을 청할 때의 TeamSelectionIndex도 함께 올린다</summary>
    private static List<PersonInfo.ValueContext> Conditions(bool inPossession, int slot = -1)
    {
        var values = new List<PersonInfo.ValueContext>();
        if (slot >= 0) values.Add(new("TeamSelectionIndex", "int", slot.ToString(CultureInfo.InvariantCulture)));
        values.Add(new("InPossession", "bool", inPossession ? "1" : "0"));
        values.Add(new("Boolean", "bool", "1"));
        return values;
    }

    /// <summary>
    /// 지금 전술. 돌려주는 JSON: {"ip":Probe 답,"oop":Probe 답[,"roles":[{"index":자리 순번,"phase":"ip"|"oop","probe":Probe 답}…]]}
    /// uid는 내 팀 선수 한 명이다(전술은 선수를 거쳐 팀에서 읽는다). 찾지 못하면 404.
    /// </summary>
    public static string Tactic(string teamText, string uidText, bool withRoles)
    {
        var team = Team(teamText);
        var uid = Uid(uidText);
        if (!LiveMemory.PersonIndex(uid, out var index)) throw new HttpError(404, "player not found");

        var json = new StringBuilder("{\"ip\":").Append(Slots(uid, index, team, true));
        json.Append(",\"oop\":").Append(Slots(uid, index, team, false));
        if (withRoles) AppendRoleLists(json, uid, index, team);
        return json.Append('}').ToString();
    }

    /// <summary>한 국면의 전술 이름과 자리 목록</summary>
    private static string Slots(uint uid, int index, int team, bool inPossession)
    {
        var fields = new PersonInfo.Field[]
        {
            new("Age", "Age"),
            new("Name", TacticPath + ".Name"),
            new("FormationName", TacticPath + ".FormationName")
        };
        return PersonInfo.Probe(GameData.RecordKind.Person, uid, index, fields, TeamContext(team), Conditions(inPossession),
            TacticPath + ".TacticalPositions", SlotItems, MaxSlotRows, PersonInfo.TacticFailures);
    }

    /// <summary>
    /// 자리 11개 × 두 국면마다 고를 수 있는 역할 목록을 이어 붙인다. 게임이 바빠지거나 조회가 거듭 실패하면 읽은 데까지만 준다
    /// (앱은 22개가 다 오지 않은 것을 알아본다).
    /// </summary>
    private static void AppendRoleLists(StringBuilder json, uint uid, int index, int team)
    {
        json.Append(",\"roles\":[");
        var first = true;
        try
        {
            for (var slot = 0; slot < SlotCount; slot++)
            {
                foreach (var inPossession in new[] { true, false })
                {
                    var probe = PersonInfo.Probe(GameData.RecordKind.Person, uid, index, RoleFields, TeamContext(team), Conditions(inPossession, slot),
                        TacticPath + ".AvailableRolesOnlyDropdown", RoleItems, MaxRoleRows, PersonInfo.TacticFailures);
                    json.Append(first ? "" : ",")
                        .Append("{\"index\":").Append(slot.ToString(CultureInfo.InvariantCulture))
                        .Append(",\"phase\":\"").Append(inPossession ? "ip" : "oop")
                        .Append("\",\"probe\":").Append(probe).Append('}');
                    first = false;
                }
            }
        }
        catch (HttpError error) when (error.Status == 503)
        {
            Plugin.Logger.LogWarning($"tactic role lists: stopped early: {error.Message}");
        }
        json.Append(']');
    }

    /// <summary>
    /// 선수들의 역할 별점. 돌려주는 JSON: {"players":[{"uid":번호,"ip":Probe 답,"oop":Probe 답}…]}
    /// 켜져 있는 게임에서 찾지 못한 선수는 빠진다. 게임이 바빠져 중간에 멈추면 읽은 선수까지만 준다(하나도 못 읽었으면 오류).
    /// </summary>
    public static string RoleStars(string teamText, string uidsText)
    {
        var team = Team(teamText);
        var uids = PersonInfo.Parse(uidsText, MaxStarPlayers);
        var json = new StringBuilder("{\"players\":[");
        var read = 0;
        try
        {
            foreach (var uid in uids)
            {
                if (!LiveMemory.PersonIndex(uid, out var index)) continue;
                var ip = Stars(uid, index, team, true);
                var oop = Stars(uid, index, team, false);
                json.Append(read > 0 ? "," : "")
                    .Append("{\"uid\":").Append(uid.ToString(CultureInfo.InvariantCulture))
                    .Append(",\"ip\":").Append(ip)
                    .Append(",\"oop\":").Append(oop).Append('}');
                read++;
            }
        }
        catch (HttpError error) when (error.Status == 503 && read > 0)
        {
            Plugin.Logger.LogWarning($"role stars: stopped early after {read} player(s): {error.Message}");
        }
        return json.Append("]}").ToString();
    }

    /// <summary>한 선수의 한 국면 역할 별점 표. PositionMask 값은 게임이 무시한다(어느 값을 줘도 같은 표가 온다)</summary>
    private static string Stars(uint uid, int index, int team, bool inPossession)
    {
        var values = new List<PersonInfo.ValueContext>
        {
            new("PositionMask", "posmask", "1"),
            new("InPossession", "bool", inPossession ? "1" : "0")
        };
        return PersonInfo.Probe(GameData.RecordKind.Person, uid, index, new PersonInfo.Field[] { new("Age", "Age") }, TeamContext(team), values,
            "PositionalAbilitiesRoleTable", StarItems, MaxStarRows, PersonInfo.TacticFailures);
    }
}
