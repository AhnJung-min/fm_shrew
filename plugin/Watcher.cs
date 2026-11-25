using System.Diagnostics;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 조사용. 처음 보는 화면이 뜨거나 대화 틀의 내용이 바뀌면 그때의 화면 구조를 파일로 남긴다.
/// 게임을 평소처럼 하기만 하면 기록이 쌓인다. F10을 누르면 지금 화면을 바로 남긴다.
///
/// FM26의 화면은 모두 같은 종류의 요소(SI.Bindable.*)로 만들어져 있어 종류만으로는 어떤 화면인지 알 수 없다.
/// 화면마다 붙은 이름(SI.Bindable.Panel의 name, 예: TeamTalkPanel)으로 구분한다.
///
/// 경기 중에는 점수가 바뀐 순간(골)과 그 직후의 화면도 남긴다. 골 알림 카드를 만들려면
/// 그 순간 게임이 득점자를 어디에 어떻게 보여 주는지 알아야 하기 때문이다.
/// </summary>
internal static class Watcher
{
    private const int ScanEveryMs = 2000;
    private const int MinGapMs = 6000;
    private const int MaxAutoDumps = 60;
    private const int MaxPerTalkScreen = 6;
    private const int MaxGoalDumps = 24;

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly HashSet<string> SeenPanels = new()
    {
        // 늘 떠 있는 것
        "GameWorldBackground", "Watermark", "GameVersion", "CutsceneCrossFade", "ContinuePanel"
    };
    private static readonly HashSet<int> SeenTalks = new();
    private static readonly Dictionary<string, int> TalkDumps = new();
    /// <summary>골 직후에 한 번 더 남길 시각과 이름표</summary>
    private static readonly List<(long at, string tag)> Scheduled = new();

    private static long nextScan = 5000;
    private static long lastDump = -MinGapMs;
    private static int autoDumps;
    private static int goalDumps;
    private static int errors;
    private static bool hotkeyBroken;
    private static bool dataBroken;
    private static string lastScore;

    public static void Tick()
    {
        if (!hotkeyBroken)
        {
            try
            {
                var keyboard = Keyboard.current;
                if (keyboard != null && keyboard.f10Key.wasPressedThisFrame)
                {
                    Plugin.Logger.LogInfo("UI dump: " + DumpToFile("manual"));
                    DumpDataQuietly("manual");
                }
            }
            catch (Exception error)
            {
                hotkeyBroken = true;
                Plugin.Logger.LogWarning($"F10 hotkey unavailable: {error.Message}");
            }
        }

        var now = Clock.ElapsedMilliseconds;
        if (errors > 5) return;
        try
        {
            for (var i = Scheduled.Count - 1; i >= 0; i--)
            {
                if (now < Scheduled[i].at) continue;
                var tag = Scheduled[i].tag;
                Scheduled.RemoveAt(i);
                Plugin.Logger.LogInfo("UI dump: " + DumpToFile(tag));
            }
            if (now < nextScan) return;
            nextScan = now + ScanEveryMs;
            Scan(now);
        }
        catch (Exception error)
        {
            errors++;
            Plugin.Logger.LogWarning($"UI scan failed ({errors}): {error.Message}");
        }
    }

    public static string DumpToFile(string tag)
    {
        var content = UiTree.Dump(new UiTree.Options { WithIds = false });
        return BridgeFiles.WriteDump(tag, content);
    }

    /// <summary>게임이 지금 화면에 넣어 주고 있는 값들(데이터 나무)을 파일로 남긴다.</summary>
    public static string DumpDataToFile(string tag)
    {
        return BridgeFiles.WriteDump(tag + "-data", DataTree.Dump("", 9, 6000));
    }

    /// <summary>화면 기록에 딸린 데이터 기록. 실패해도 화면 기록에는 영향을 주지 않는다.</summary>
    private static void DumpDataQuietly(string tag)
    {
        if (dataBroken) return;
        try
        {
            DumpDataToFile(tag);
        }
        catch (Exception error)
        {
            dataBroken = true;
            Plugin.Logger.LogWarning($"data dump unavailable: {error.Message}");
        }
    }

    private static void Scan(long now)
    {
        var panels = new List<string>();
        VisualElement matchHeader = null;
        foreach (var root in UiTree.Roots()) FindPanels(root, 0, panels, ref matchHeader);
        WatchScore(now, matchHeader);
        if (autoDumps >= MaxAutoDumps || now - lastDump < MinGapMs) return;

        string tag = null;
        foreach (var name in panels)
            if (SeenPanels.Add(name))
                tag = name;

        // 대화 틀이 떠 있으면 질문이 바뀔 때마다 몇 장 더 남긴다
        if (tag == null && TalkBox.Active && panels.Count > 0 && SeenTalks.Add(TalkBox.SceneHash))
        {
            var screen = panels[^1];
            TalkDumps.TryGetValue(screen, out var already);
            if (already < MaxPerTalkScreen)
            {
                TalkDumps[screen] = already + 1;
                tag = screen + "-talk";
            }
        }
        if (tag == null) return;

        lastDump = now;
        autoDumps++;
        Plugin.Logger.LogInfo("UI dump: " + DumpToFile(tag));
        // 새 화면이면 그 화면이 쓰는 값들도 남긴다(대화가 이어지는 동안의 기록에는 남기지 않는다)
        if (!tag.EndsWith("-talk")) DumpDataQuietly(tag);
    }

    /// <summary>경기 점수판의 점수가 바뀌면(골) 그 순간과 3초·8초 뒤의 화면을 남긴다.</summary>
    private static void WatchScore(long now, VisualElement matchHeader)
    {
        if (matchHeader == null)
        {
            lastScore = null;
            return;
        }
        string home = null, away = null;
        ReadScore(matchHeader, 0, ref home, ref away);
        if (home == null || away == null) return;
        var score = home + "-" + away;
        var before = lastScore;
        lastScore = score;
        if (before == null || before == score || goalDumps >= MaxGoalDumps) return;

        goalDumps += 3;
        var tag = "goal-" + score;
        Plugin.Logger.LogInfo("UI dump: " + DumpToFile(tag + "-a"));
        Scheduled.Add((now + 3000, tag + "-b"));
        Scheduled.Add((now + 8000, tag + "-c"));
    }

    private static void ReadScore(VisualElement element, int depth, ref string home, ref string away)
    {
        if (home != null && away != null) return;
        if (!UiTree.Displayed(element)) return;
        var name = element.name;
        if (name == "HomeScore" || name == "AwayScore")
        {
            var text = Il2.TextOf(element.Pointer);
            if (!string.IsNullOrEmpty(text))
            {
                if (name == "HomeScore") home = text;
                else away = text;
            }
            return;
        }
        if (depth > 30) return;
        var children = element.m_Children;
        if (children == null) return;
        var total = children.Count;
        for (var i = 0; i < total; i++)
        {
            var child = children[i];
            if (child != null) ReadScore(child, depth + 1, ref home, ref away);
        }
    }

    /// <summary>보이는 화면(SI.Bindable.Panel)의 이름을 모은다. 화면 안쪽까지는 내려가지 않는다.</summary>
    private static void FindPanels(VisualElement element, int depth, List<string> panels, ref VisualElement matchHeader)
    {
        if (!UiTree.Displayed(element)) return;
        if (Il2.ClassName(Il2.ClassOf(element.Pointer)) == "SI.Bindable.Panel")
        {
            var name = element.name;
            if (!string.IsNullOrEmpty(name)) panels.Add(name);
            // 경기 화면의 윗줄(점수판, 전술·외침 버튼)
            if (name == "OverviewHeader") matchHeader = element;
            return;
        }
        if (depth > 12) return;
        var children = element.m_Children;
        if (children == null) return;
        var total = children.Count;
        for (var i = 0; i < total; i++)
        {
            var child = children[i];
            if (child != null) FindPanels(child, depth + 1, panels, ref matchHeader);
        }
    }
}
