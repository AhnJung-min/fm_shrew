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
/// </summary>
internal static class Watcher
{
    private const int ScanEveryMs = 2000;
    private const int MinGapMs = 6000;
    private const int MaxAutoDumps = 60;
    private const int MaxPerTalkScreen = 6;

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly HashSet<string> SeenPanels = new()
    {
        // 늘 떠 있는 것
        "GameWorldBackground", "Watermark", "GameVersion", "CutsceneCrossFade", "ContinuePanel"
    };
    private static readonly HashSet<int> SeenTalks = new();
    private static readonly Dictionary<string, int> TalkDumps = new();

    private static long nextScan = 5000;
    private static long lastDump = -MinGapMs;
    private static int autoDumps;
    private static int errors;
    private static bool hotkeyBroken;

    public static void Tick()
    {
        if (!hotkeyBroken)
        {
            try
            {
                var keyboard = Keyboard.current;
                if (keyboard != null && keyboard.f10Key.wasPressedThisFrame)
                    Plugin.Logger.LogInfo("UI dump: " + DumpToFile("manual"));
            }
            catch (Exception error)
            {
                hotkeyBroken = true;
                Plugin.Logger.LogWarning($"F10 hotkey unavailable: {error.Message}");
            }
        }

        var now = Clock.ElapsedMilliseconds;
        if (now < nextScan) return;
        nextScan = now + ScanEveryMs;
        if (errors > 5) return;
        try
        {
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

    private static void Scan(long now)
    {
        var panels = new List<string>();
        foreach (var root in UiTree.Roots()) FindPanels(root, 0, panels);
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
    }

    /// <summary>보이는 화면(SI.Bindable.Panel)의 이름을 모은다. 화면 안쪽까지는 내려가지 않는다.</summary>
    private static void FindPanels(VisualElement element, int depth, List<string> panels)
    {
        if (!UiTree.Displayed(element)) return;
        if (Il2.ClassName(Il2.ClassOf(element.Pointer)) == "SI.Bindable.Panel")
        {
            var name = element.name;
            if (!string.IsNullOrEmpty(name)) panels.Add(name);
            return;
        }
        if (depth > 12) return;
        var children = element.m_Children;
        if (children == null) return;
        var total = children.Count;
        for (var i = 0; i < total; i++)
        {
            var child = children[i];
            if (child != null) FindPanels(child, depth + 1, panels);
        }
    }
}
