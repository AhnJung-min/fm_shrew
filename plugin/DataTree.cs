using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 조사용. 게임이 화면에 값을 넣어 줄 때 쓰는 데이터 나무(SI.Bindable.Bindings)를 읽어 적는다. 읽기만 한다.
///
/// 화면의 글자는 "row.Player.InitialSurname" 같은 경로로 이 나무의 값을 받아 쓴다.
/// 화면이 열려 있는 동안에는 그 화면이 쓰는 값들이 나무에 올라와 있으므로,
/// 어떤 화면에서 어떤 이름으로 어떤 값이 오가는지(예: 시즌 득점, 리그 득점 순위)를 여기서 알아낼 수 있다.
///
/// 나무의 마디(Node)는 m_name, m_firstChild, m_nextSibling으로 이어지고, 값은 Value(TypedValue)에 있다.
/// </summary>
internal static class DataTree
{
    private static IntPtr Root()
    {
        var subsystems = Il2.StaticObject("SI.Core.GameSubsystems", "s_subsystems");
        foreach (var item in Il2.Items(subsystems, 200))
        {
            if (item == IntPtr.Zero || Il2.ClassName(Il2.ClassOf(item)) != "SI.Bindable.BindingSubsystem") continue;
            return Il2.FieldObject(item, "m_root");
        }
        return IntPtr.Zero;
    }

    private static string NameOf(IntPtr node) => Il2.Str(Il2.FieldObject(node, "m_name")) ?? "";

    private static string ValueOf(IntPtr node)
    {
        try
        {
            var value = Il2.CallObject(node, "get_Value");
            if (value == IntPtr.Zero) return "null";
            var text = Il2.Str(Il2.CallObject(value, "AsString")) ?? "?";
            if (!text.StartsWith("System.Collections.Generic.List")) return Il2.Quote(text, 200);

            // 목록이면 앞쪽 몇 개를 풀어 적는다
            var items = Il2.Items(Il2.CallObject(value, "Get"), 12);
            var parts = new List<string>();
            foreach (var item in items)
                parts.Add(item == IntPtr.Zero ? "null" : Il2.Quote(Il2.Str(Il2.CallObject(item, "AsString")) ?? "?", 60));
            return $"list [{string.Join(", ", parts)}{(items.Count >= 12 ? ", …" : "")}]";
        }
        catch (Exception error)
        {
            return "(" + error.Message + ")";
        }
    }

    /// <summary>
    /// path로 내려간 자리부터 depth 단계까지 적는다. path는 "MatchUI*.MatchTeam"처럼 점으로 잇고,
    /// 끝에 *를 붙이면 그 글자로 시작하는 첫 마디를 고른다. 비우면 뿌리부터.
    /// </summary>
    public static string Dump(string path, int depth, int max)
    {
        var node = Root();
        if (node == IntPtr.Zero) return "no data tree";
        foreach (var part in (path ?? "").Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            var found = IntPtr.Zero;
            for (var child = Il2.FieldObject(node, "m_firstChild"); child != IntPtr.Zero; child = Il2.FieldObject(child, "m_nextSibling"))
            {
                var name = NameOf(child);
                var hit = part.EndsWith("*")
                    ? name.StartsWith(part[..^1], StringComparison.OrdinalIgnoreCase)
                    : name.Equals(part, StringComparison.OrdinalIgnoreCase);
                if (!hit) continue;
                found = child;
                break;
            }
            if (found == IntPtr.Zero) return $"no node '{part}'";
            node = found;
        }

        var text = new StringBuilder();
        var left = max;
        text.Append(NameOf(node)).Append(" = ").Append(ValueOf(node)).Append('\n');
        Write(node, 1, depth, text, ref left);
        if (left <= 0) text.Append("… (more)\n");
        return text.ToString();
    }

    private static void Write(IntPtr node, int level, int depth, StringBuilder text, ref int left)
    {
        if (level > depth) return;
        for (var child = Il2.FieldObject(node, "m_firstChild"); child != IntPtr.Zero; child = Il2.FieldObject(child, "m_nextSibling"))
        {
            if (--left <= 0) return;
            text.Append(' ', level * 2).Append(NameOf(child)).Append(" = ").Append(ValueOf(child)).Append('\n');
            Write(child, level + 1, depth, text, ref left);
        }
    }
}
