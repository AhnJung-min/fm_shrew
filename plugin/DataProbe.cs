using System.Diagnostics;
using System.Text;
using Il2CppInterop.Runtime;
using SI.Bindable;
using SI.Core;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 조사용. 게임의 데이터 나무에 "이 값을 달라"고 직접 청해 본다.
///
/// 게임 화면의 글자는 경로("Human.Team.TopGoalscorerValue")를 나무에 걸어 두고(Bind),
/// 값이 도착하면 불리는 방식으로 채워진다. 여기서도 같은 방법으로 경로를 걸어,
/// 화면에 없는 값(시즌 득점, 통산 득점, 득점 순위)을 받아 올 수 있는지 확인한다.
///
/// 목록 안의 대상(예: 경기에 뛰는 선수들)은 경로로 가리킬 수 없어서,
/// 우리 이름("fmb.…")으로 나무에 올려 둔 뒤(Alias) 그 아래 경로를 건다.
///
/// 게임 쪽 함수를 직접 부르므로, 요청이 왔을 때만 움직이고 스스로는 아무것도 하지 않는다.
/// </summary>
internal static unsafe class DataProbe
{
    private const string OurRoot = "fmb.";
    private const int MaxWatches = 300;

    private sealed class Watch
    {
        public string Path = "";
        public string Value = "(아직 값이 오지 않음)";
        public int Fired;
        public long At;
        public Bindings.Key Key;
        /// <summary>게임이 부르는 동안 사라지지 않게 붙잡아 둔다</summary>
        public Bindings.ValueChangedCallback Callback;
    }

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly Dictionary<string, Watch> Watches = new(StringComparer.OrdinalIgnoreCase);
    private static readonly List<string> Aliases = new();
    private static readonly List<Il2CppSystem.String> HeldText = new();

    private static Bindings Tree()
    {
        var pointer = DataTree.Subsystem();
        if (pointer == IntPtr.Zero) throw new HttpError(503, "no data tree yet");
        return new Bindings(pointer);
    }

    /// <summary>게임 쪽 함수에 넘길 글자 구간. 가리키는 문자열은 우리가 붙잡아 둔다.</summary>
    private static Il2CppSystem.ReadOnlySpan<char> Span(string text)
    {
        Il2CppSystem.String held = text;
        HeldText.Add(held);
        if (HeldText.Count > 2000) HeldText.RemoveRange(0, 1000);
        try
        {
            return new Il2CppSystem.ReadOnlySpan<char>((void*)IL2CPP.il2cpp_string_chars(held.Pointer), text.Length);
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"data probe: span from pointer failed, using conversion ({error.Message})");
            return Il2CppSystem.MemoryExtensions.AsSpan(text);
        }
    }

    /// <summary>값을 사람이 읽을 글로. 목록은 앞쪽 몇 개를, 대상(선수·팀 등)은 종류와 식별 번호를 적는다.</summary>
    private static string Show(TypedValue value)
    {
        if (value == null) return "null";
        try
        {
            if (value.IsNull) return "null";
            var text = value.AsString() ?? "?";
            var held = value.Get();
            if (held == null) return text;
            var kind = Il2.ClassName(Il2.ClassOf(held.Pointer));
            if (kind.StartsWith("System.Collections.Generic.List"))
            {
                var items = Il2.Items(held.Pointer, 400);
                var parts = new List<string>();
                for (var i = 0; i < items.Count && i < 8; i++)
                    parts.Add(items[i] == IntPtr.Zero ? "null" : Show(new TypedValue(items[i])));
                return $"list({items.Count}) [{string.Join(", ", parts)}{(items.Count > 8 ? ", …" : "")}]";
            }
            var ids = Identity(held.Pointer);
            return ids.Length > 0 ? $"{text} {{{ids}}}" : text;
        }
        catch (Exception error)
        {
            return "(" + error.Message + ")";
        }
    }

    /// <summary>대상(InteropReference)의 식별 번호 쌍. 아니면 빈 글.</summary>
    private static string Identity(IntPtr reference)
    {
        var list = Il2.FieldObject(reference, "m_id");
        if (list == IntPtr.Zero) return "";
        var parts = new List<string>();
        foreach (var pair in Il2.Items(list, 8))
        {
            if (pair == IntPtr.Zero) continue;
            var data = (byte*)IL2CPP.il2cpp_object_unbox(pair);
            parts.Add($"{*(uint*)data}:{*(int*)(data + 4)}");
        }
        return string.Join(" ", parts);
    }

    private static string Describe(Watch watch) =>
        $"{watch.Path} = {watch.Value}   (받은 횟수 {watch.Fired}" +
        (watch.Fired > 0 ? $", {(Clock.ElapsedMilliseconds - watch.At) / 1000}초 전" : "") + ")";

    /// <summary>경로를 걸어 둔다. 값은 곧바로 올 수도, 조금 뒤에 올 수도 있다(/bound로 다시 본다).</summary>
    public static string Bind(string path)
    {
        var real = DataTree.Resolve(path);
        if (Watches.TryGetValue(real, out var known)) return Describe(known);
        if (Watches.Count >= MaxWatches) throw new HttpError(400, "too many watches; call /probe/clear");

        var tree = Tree();
        var watch = new Watch { Path = real };
        Action<Bindings.Key, TypedValue> onChange = (_, value) =>
        {
            watch.Fired++;
            watch.At = Clock.ElapsedMilliseconds;
            watch.Value = Show(value);
        };
        watch.Callback = onChange;
        var span = Span(real);
        watch.Key = tree.Bind(ref span, watch.Callback);
        Watches[real] = watch;

        // 이미 나무에 올라와 있는 값이면 바로 읽힌다
        if (watch.Fired == 0)
        {
            var now = tree.Get(ref watch.Key);
            if (now != null && !now.IsNull) watch.Value = Show(now) + " (이미 있던 값)";
        }
        return Describe(watch);
    }

    public static string Bound()
    {
        if (Watches.Count == 0) return "(걸어 둔 경로 없음)";
        var text = new StringBuilder();
        foreach (var watch in Watches.Values) text.Append(Describe(watch)).Append('\n');
        return text.ToString();
    }

    /// <summary>
    /// from 경로의 값(index가 0 이상이면 그 목록의 index번째)을 우리 이름으로 나무에 올린다.
    /// 그 뒤로 "name.항목" 경로를 걸 수 있다.
    /// </summary>
    public static string Alias(string name, string from, int index)
    {
        if (!name.StartsWith(OurRoot, StringComparison.OrdinalIgnoreCase) || name.Length <= OurRoot.Length)
            throw new HttpError(400, $"name must start with '{OurRoot}'");
        var tree = Tree();
        var source = tree.Get(Span(DataTree.Resolve(from)));
        if (source == null || source.IsNull) return "source has no value";
        var picked = source;
        if (index >= 0)
        {
            var held = source.Get();
            var items = held == null ? new List<IntPtr>() : Il2.Items(held.Pointer, index + 1);
            if (index >= items.Count || items[index] == IntPtr.Zero) return $"no item {index} (count {items.Count})";
            picked = new TypedValue(items[index]);
        }
        var shown = Show(picked);
        var span = Span(name);
        tree.Set(ref span, TypedValue.CreateCopyFrom(picked), Bindings.NodeFlags.Default, Bindings.SetFlags.Default);
        if (!Aliases.Contains(name)) Aliases.Add(name);
        return $"{name} = {shown}";
    }

    /// <summary>걸어 둔 경로와 올려 둔 이름을 모두 거둔다.</summary>
    public static string Clear()
    {
        var tree = Tree();
        var released = 0;
        foreach (var watch in Watches.Values)
        {
            try
            {
                tree.Unbind(ref watch.Key, watch.Callback);
                released++;
            }
            catch (Exception error)
            {
                Plugin.Logger.LogWarning($"data probe: unbind {watch.Path}: {error.Message}");
            }
        }
        Watches.Clear();
        foreach (var name in Aliases)
        {
            try
            {
                var span = Span(name);
                var key = Bindings.MakeKey(ref span);
                tree.Remove(ref key);
            }
            catch (Exception error)
            {
                Plugin.Logger.LogWarning($"data probe: remove {name}: {error.Message}");
            }
        }
        Aliases.Clear();
        return $"released {released}";
    }
}
