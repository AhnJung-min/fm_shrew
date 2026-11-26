using System.Text;
using Il2CppInterop.Runtime;
using SI.Bindable;
using SI.Core;
using SI.Translation;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 화면에 떠 있지 않은 값을 게임에서 받아 오는 통로.
///
/// 게임 화면의 글자는 경로("Match.Competition.Name")를 데이터 나무에 걸어 두면 값이 도착하는 방식으로 채워진다.
/// 여기서도 같은 방법을 쓴다: Want로 경로를 걸어 두고, 값이 도착한 뒤 Text·Number로 읽는다.
/// 값은 요청한 다음 프레임 이후에 온다. 받을 때까지는 null이다.
///
/// 목록 안의 항목이나 조건이 필요한 값(예: 대회의 "득점" 순위)은 경로만으로 가리킬 수 없어서,
/// 우리 이름("fmb.…")의 마디를 나무에 만들어 그 아래에서 청한다:
///   fmb.g.Type = 2 (득점), fmb.g.Stage = -1 (전체), fmb.g.comp = 대회  →  fmb.g.comp.PlayerStats.Players
/// 조건은 같은 부모 아래(또는 그 위)에 조건 이름으로 놓인 마디에서 찾아진다.
///
/// 확인한 것(FM26 26.3): 선수의 TotalCareerGoals, 팀의 TopGoalscorerPlayer, 대회의 PlayerStats(득점 2, 도움 5).
/// 게임 쪽에서 문제가 거듭 생기면 스스로 꺼진다(카드는 화면에서 읽은 것만으로 뜬다).
/// </summary>
internal static unsafe class GameData
{
    public const string OurRoot = "fmb.";
    private const int MaxWatches = 600;
    private const int MaxFailures = 6;

    private sealed class Watch
    {
        public string Path = "";
        public bool Has;
        public string Text;
        /// <summary>값이 목록이면 항목 수, 아니면 -1</summary>
        public int Count = -1;
        public int Fired;
        public Bindings.Key Key;
        /// <summary>게임이 부르는 동안 사라지지 않게 붙잡아 둔다</summary>
        public Bindings.ValueChangedCallback Callback;
    }

    private static readonly Dictionary<string, Watch> Watches = new(StringComparer.OrdinalIgnoreCase);
    private static readonly List<string> Placed = new();
    private static readonly List<Il2CppSystem.String> HeldText = new();
    private static Bindings tree;
    private static int failures;

    public static bool Available => failures < MaxFailures && Tree() != null;

    private static void Failed(string what, Exception error)
    {
        failures++;
        Plugin.Logger.LogWarning($"game data ({failures}/{MaxFailures}) {what}: {error.Message}");
    }

    /// <summary>게임의 데이터 나무. 아직 없으면 null</summary>
    public static Bindings Tree()
    {
        if (tree != null) return tree;
        try
        {
            var pointer = DataTree.Subsystem();
            if (pointer != IntPtr.Zero) tree = new Bindings(pointer);
        }
        catch (Exception error)
        {
            Failed("tree", error);
        }
        return tree;
    }

    /// <summary>게임 쪽 함수에 넘길 글자 구간. 가리키는 문자열은 우리가 붙잡아 둔다.</summary>
    public static Il2CppSystem.ReadOnlySpan<char> Span(string text)
    {
        Il2CppSystem.String held = text;
        HeldText.Add(held);
        if (HeldText.Count > 4000) HeldText.RemoveRange(0, 2000);
        return new Il2CppSystem.ReadOnlySpan<char>((void*)IL2CPP.il2cpp_string_chars(held.Pointer), text.Length);
    }

    /// <summary>게임 글자에 딸려 오는 꼬리표(누르면 그 선수로 가는 연결 정보)를 떼어 낸다.</summary>
    public static string Clean(string text)
    {
        if (string.IsNullOrEmpty(text)) return text ?? "";
        try
        {
            return EmbeddedDataUtilities.ContainsEmbeddedData(text) ? EmbeddedDataUtilities.RemoveEmbeddedData(text) : text;
        }
        catch
        {
            return text;
        }
    }

    private static void Store(Watch watch, TypedValue value)
    {
        try
        {
            watch.Fired++;
            watch.Count = -1;
            if (value == null || value.IsNull)
            {
                watch.Has = false;
                watch.Text = null;
                return;
            }
            var held = value.Get();
            var pointer = held == null ? IntPtr.Zero : held.Pointer;
            var number = Il2.NumberText(pointer);
            if (number != null)
            {
                watch.Text = number;
            }
            else
            {
                if (pointer != IntPtr.Zero && Il2.ClassName(Il2.ClassOf(pointer)).StartsWith("System.Collections.Generic.List"))
                    watch.Count = Il2.Count(pointer);
                watch.Text = Clean(value.AsString() ?? "");
            }
            watch.Has = true;
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"game data: reading {watch.Path}: {error.Message}");
        }
    }

    /// <summary>경로를 걸어 둔다. 이미 걸려 있으면 아무 일도 하지 않는다.</summary>
    public static void Want(string path)
    {
        if (Watches.ContainsKey(path) || Watches.Count >= MaxWatches) return;
        var bindings = Tree();
        if (bindings == null || failures >= MaxFailures) return;
        try
        {
            var watch = new Watch { Path = path };
            Action<Bindings.Key, TypedValue> onChange = (_, value) => Store(watch, value);
            watch.Callback = onChange;
            var span = Span(path);
            watch.Key = bindings.Bind(ref span, watch.Callback);
            Watches[path] = watch;
            // 이미 나무에 올라와 있는 값이면 바로 읽힌다
            if (watch.Fired == 0)
            {
                var now = bindings.Get(ref watch.Key);
                if (now != null && !now.IsNull)
                {
                    Store(watch, now);
                    watch.Fired = 0;
                }
            }
        }
        catch (Exception error)
        {
            Failed("bind " + path, error);
        }
    }

    public static bool Has(string path) => Watches.TryGetValue(path, out var watch) && watch.Has;

    /// <summary>나무에 그 이름의 마디가 있는지(값을 청하지는 않는다)</summary>
    public static bool Exists(string path)
    {
        var bindings = Tree();
        if (bindings == null) return false;
        try
        {
            var span = Span(path);
            var key = Bindings.MakeKey(ref span);
            return bindings.Exists(ref key);
        }
        catch (Exception error)
        {
            Failed("exists " + path, error);
            return false;
        }
    }

    /// <summary>도착한 값을 글로. 아직 없으면 null</summary>
    public static string Text(string path) => Watches.TryGetValue(path, out var watch) && watch.Has ? watch.Text : null;

    public static int? Number(string path) => int.TryParse(Text(path), out var value) ? value : null;

    /// <summary>값이 목록이면 그 항목 수, 아니거나 아직 없으면 -1</summary>
    public static int Count(string path) => Watches.TryGetValue(path, out var watch) && watch.Has ? watch.Count : -1;

    private static bool Place(string name, TypedValue value)
    {
        if (!name.StartsWith(OurRoot, StringComparison.OrdinalIgnoreCase)) return false;
        var bindings = Tree();
        if (bindings == null || value == null) return false;
        var span = Span(name);
        bindings.Set(ref span, TypedValue.CreateCopyFrom(value), Bindings.NodeFlags.Default, Bindings.SetFlags.Default);
        if (!Placed.Contains(name)) Placed.Add(name);
        return true;
    }

    /// <summary>from 경로의 값(index가 0 이상이면 그 목록의 index번째)을 우리 이름으로 나무에 올린다.</summary>
    public static bool Put(string name, string from, int index = -1)
    {
        var bindings = Tree();
        if (bindings == null || failures >= MaxFailures) return false;
        try
        {
            var source = bindings.Get(Span(from));
            if (source == null || source.IsNull) return false;
            if (index < 0) return Place(name, source);
            var held = source.Get();
            var items = held == null ? new List<IntPtr>() : Il2.Items(held.Pointer, index + 1);
            return index < items.Count && items[index] != IntPtr.Zero && Place(name, new TypedValue(items[index]));
        }
        catch (Exception error)
        {
            Failed("put " + name, error);
            return false;
        }
    }

    /// <summary>작은 정수(-1~100)를 우리 이름으로 올린다. 게임이 미리 만들어 둔 값 상자를 베껴 쓴다.</summary>
    public static bool PutInt(string name, int value)
    {
        try
        {
            var common = Il2.StaticObject("SI.Core.TypedValue", "s_commonInts");
            var boxed = Il2.ArrayItem(common, value + 1);
            if (boxed == IntPtr.Zero) return false;
            var typed = new TypedValue(boxed);
            return typed.AsString() == value.ToString() && Place(name, typed);
        }
        catch (Exception error)
        {
            Failed("put " + name, error);
            return false;
        }
    }

    /// <summary>prefix로 시작하는 경로를 모두 거두고, 그 아래에 올려 둔 우리 마디도 지운다.</summary>
    public static void Drop(string prefix)
    {
        var bindings = Tree();
        if (bindings == null) return;
        foreach (var path in Watches.Keys.Where(p => p.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)).ToList())
        {
            var watch = Watches[path];
            Watches.Remove(path);
            try
            {
                bindings.Unbind(ref watch.Key, watch.Callback);
            }
            catch (Exception error)
            {
                Plugin.Logger.LogWarning($"game data: unbind {path}: {error.Message}");
            }
        }
        // 안쪽 마디부터 지운다
        foreach (var name in Placed.Where(p => p.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)).OrderByDescending(p => p.Length).ToList())
        {
            Placed.Remove(name);
            try
            {
                var span = Span(name);
                var key = Bindings.MakeKey(ref span);
                if (bindings.Exists(ref key)) bindings.Remove(ref key);
            }
            catch (Exception error)
            {
                Plugin.Logger.LogWarning($"game data: remove {name}: {error.Message}");
            }
        }
    }

    /// <summary>개발용. 걸어 둔 경로와 지금 값을 적는다.</summary>
    public static string Dump()
    {
        var text = new StringBuilder($"{Watches.Count} watch(es), {Placed.Count} placed, failures {failures}\n");
        foreach (var watch in Watches.Values.OrderBy(w => w.Path, StringComparer.OrdinalIgnoreCase))
            text.Append(watch.Path).Append(" = ")
                .Append(watch.Has ? (watch.Count >= 0 ? $"list({watch.Count})" : Il2.Quote(watch.Text, 120)) : "(없음)")
                .Append("  x").Append(watch.Fired).Append('\n');
        return text.ToString();
    }
}
