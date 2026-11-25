using System.Diagnostics;
using System.Text.RegularExpressions;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 조사용. 대화·기자회견·토크로 보이는 화면이 뜨면 그때의 화면 구조를 파일로 남긴다.
/// 게임을 평소처럼 하기만 하면 기록이 쌓인다. F10을 누르면 지금 화면을 바로 남긴다.
/// </summary>
internal static class Watcher
{
    private const int ScanEveryMs = 2000;
    private const int MinGapMs = 8000;
    private const int MaxAutoDumps = 60;
    private const int MaxPerScreen = 8;

    private static readonly Regex Interesting = new(
        "press|conference|conversation|talk|touchline|shout|speak|negotiat|interview|question|answer|reply|promise|contract|offer",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly Dictionary<IntPtr, string> InterestingClasses = new();
    private static readonly HashSet<string> SeenTypes = new();
    private static readonly HashSet<int> SeenScreens = new();
    private static readonly Dictionary<string, int> DumpsPerScreen = new();

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

    /// <summary>보이는 요소를 훑어, 관심 있는 종류가 있고 화면 내용이 처음 보는 것이면 남긴다.</summary>
    private static void Scan(long now)
    {
        var found = new SortedSet<string>(StringComparer.Ordinal);
        var digest = 17;
        var newTypes = new List<string>();
        foreach (var root in UiTree.Roots()) Visit(root, false, found, newTypes, ref digest);

        foreach (var type in newTypes) BridgeFiles.AppendLine("types.txt", type);

        if (found.Count == 0 || autoDumps >= MaxAutoDumps || now - lastDump < MinGapMs) return;
        foreach (var name in found) digest = unchecked(digest * 31 + StableHash(name));
        if (!SeenScreens.Add(digest)) return;

        var tag = found.Min;
        DumpsPerScreen.TryGetValue(tag, out var already);
        if (already >= MaxPerScreen) return;
        DumpsPerScreen[tag] = already + 1;

        lastDump = now;
        autoDumps++;
        var dot = tag.LastIndexOf('.');
        Plugin.Logger.LogInfo("UI dump: " + DumpToFile(dot >= 0 ? tag[(dot + 1)..] : tag));
    }

    private static void Visit(VisualElement element, bool inside, SortedSet<string> found, List<string> newTypes, ref int digest)
    {
        if (!UiTree.Displayed(element)) return;
        var pointer = element.Pointer;
        var klass = Il2.ClassOf(pointer);
        if (!InterestingClasses.TryGetValue(klass, out var match))
        {
            var name = Il2.ClassName(klass);
            if (SeenTypes.Add(name)) newTypes.Add(name);
            // Unity 기본 요소는 이름에 낱말이 들어 있어도 화면 종류를 말해 주지 않는다
            match = !name.StartsWith("UnityEngine.") && Interesting.IsMatch(name) ? name : null;
            InterestingClasses[klass] = match;
        }
        if (match != null)
        {
            found.Add(match);
            inside = true;
        }
        if (inside)
        {
            // 관심 화면 안의 글자가 달라지면(다음 질문 등) 새 화면으로 친다
            var label = Il2.TextOf(pointer);
            if (!string.IsNullOrEmpty(label)) digest = unchecked(digest * 31 + StableHash(label));
        }

        var children = element.m_Children;
        if (children == null) return;
        var total = children.Count;
        for (var i = 0; i < total; i++)
        {
            var child = children[i];
            if (child != null) Visit(child, inside, found, newTypes, ref digest);
        }
    }

    private static int StableHash(string text)
    {
        var hash = 23;
        foreach (var c in text) hash = unchecked(hash * 31 + c);
        return hash;
    }
}
