using System.Text;
using System.Text.RegularExpressions;
using SI.Bindable.Reference.Core;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 조사용. 게임의 대상(선수·팀·대회 등, "…Reference")마다 어떤 항목을 달라고 할 수 있는지 적는다. 읽기만 한다.
///
/// 게임은 항목을 번호로 다루고, 이름표(PropertyIdentifierSet)에 번호와 이름("TotalCareerGoals")이 짝지어 있다.
/// 대상 클래스에 번호를 하나씩 대 보며(AcceptsPropertyInternal) 받는 항목을 골라내고,
/// 값의 종류와 그 항목이 요구하는 조건(문맥, 예: 어느 대회·어느 기록)을 함께 적는다.
/// </summary>
internal static class DataNames
{
    private static Dictionary<uint, string> properties;
    private static Dictionary<uint, string> contexts;

    private static Dictionary<uint, string> Table(string setClass)
    {
        var table = new Dictionary<uint, string>();
        var set = Il2.CallStatic(Il2.FindClass(setClass), "get_Instance");
        foreach (var pair in Il2.Enumerate(Il2.FieldObject(set, "m_idToInfo"), 50_000))
        {
            if (pair == IntPtr.Zero) continue;
            var info = Il2.CallObject(pair, "get_Value");
            if (info == IntPtr.Zero) continue;
            var name = Il2.Str(Il2.CallObject(info, "get_Name"));
            if (!string.IsNullOrEmpty(name)) table[Il2.Uint(Il2.CallObject(info, "get_ID"))] = name;
        }
        return table;
    }

    private static Dictionary<string, uint> idsByName;
    private static readonly Dictionary<string, IntPtr> ClassCache = new();

    /// <summary>
    /// 대상 클래스(예: FM.UI.StadiumReference)가 그 이름의 항목을 받는지. 게임이 그 이름을 아예 모르면 false,
    /// 클래스를 찾지 못하거나 확인하다 문제가 나면 null(모르겠다). 메인 스레드에서 부른다. 읽기만 한다.
    /// </summary>
    public static bool? Accepts(string typeName, string propertyName)
    {
        try
        {
            properties ??= Table("SI.Bindable.Reference.Core.PropertyIdentifierSet");
            if (idsByName == null)
            {
                idsByName = new Dictionary<string, uint>(StringComparer.OrdinalIgnoreCase);
                foreach (var (id, name) in properties) idsByName.TryAdd(name, id);
            }
            if (!idsByName.TryGetValue(propertyName, out var propertyId)) return false;
            if (!ClassCache.TryGetValue(typeName, out var klass))
            {
                try
                {
                    klass = Il2.FindClass(typeName);
                }
                catch (HttpError)
                {
                    klass = IntPtr.Zero;
                }
                ClassCache[typeName] = klass;
            }
            if (klass == IntPtr.Zero) return null;
            return Il2.Bool(Il2.CallStatic(klass, "AcceptsPropertyInternal", propertyId.ToString()));
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"accepts {typeName}.{propertyName}: {error.Message}");
            return null;
        }
    }

    /// <summary>값의 종류: 다른 대상이면 그 이름, 아니면 형식 이름.</summary>
    private static string KindOf(IntPtr klass, uint id)
    {
        try
        {
            var kind = Il2.CallStatic(klass, "GetPropertyTypeInternal", id.ToString());
            if (kind == IntPtr.Zero) return "?";
            var type = Il2.CallObject(kind, "get_Type");
            var typeName = type == IntPtr.Zero ? "" : Il2.Str(Il2.CallObject(type, "ToString")) ?? "";
            var reference = Il2.CallObject(kind, "get_Reference");
            var referenceName = "";
            if (reference != IntPtr.Zero && Il2.Uint(reference) != 0)
            {
                var info = Il2.CallObject(reference, "GetInfo");
                if (info != IntPtr.Zero) referenceName = Il2.Str(Il2.CallObject(info, "get_Name")) ?? "";
            }
            return referenceName.Length > 0 ? $"{referenceName} ({typeName})" : typeName;
        }
        catch (Exception error)
        {
            return "(" + error.Message + ")";
        }
    }

    private static string ContextsOf(IntPtr klass, uint id)
    {
        try
        {
            var list = new Il2CppSystem.Collections.Generic.List<ContextID>();
            Il2.CallStatic(klass, "GetContextsInternal", id.ToString(), "#" + Handles.Add(list.Pointer));
            var names = new List<string>();
            foreach (var item in Il2.Items(list.Pointer, 16))
            {
                var context = Il2.Uint(item);
                names.Add(contexts.TryGetValue(context, out var name) ? name : context.ToString());
            }
            return string.Join(", ", names);
        }
        catch (Exception error)
        {
            return "(" + error.Message + ")";
        }
    }

    /// <summary>대상 클래스(예: FM.UI.CompReference)가 받는 항목 가운데 이름이 정규식에 맞는 것을 적는다.</summary>
    public static string Props(string typeName, string pattern)
    {
        properties ??= Table("SI.Bindable.Reference.Core.PropertyIdentifierSet");
        contexts ??= Table("SI.Bindable.Reference.Core.ContextIdentifierSet");
        var klass = Il2.FindClass(typeName);
        var regex = new Regex(string.IsNullOrEmpty(pattern) ? "." : pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        var lines = new List<string>();
        foreach (var (id, name) in properties)
        {
            if (!regex.IsMatch(name)) continue;
            var accepted = Il2.CallStatic(klass, "AcceptsPropertyInternal", id.ToString());
            if (!Il2.Bool(accepted)) continue;
            var needs = ContextsOf(klass, id);
            lines.Add($"{name}\t{KindOf(klass, id)}" + (needs.Length > 0 ? $"\t조건: {needs}" : ""));
        }
        lines.Sort(StringComparer.OrdinalIgnoreCase);
        var text = new StringBuilder($"{typeName}: {lines.Count} of {properties.Count} names\n");
        foreach (var line in lines) text.Append(line).Append('\n');
        return text.ToString();
    }

    /// <summary>항목 이름이 정규식에 맞는 것을, 그것을 받는 대상 클래스들과 함께 적는다(FM.UI의 …Reference 가운데).</summary>
    public static string Owners(string pattern, string classes)
    {
        properties ??= Table("SI.Bindable.Reference.Core.PropertyIdentifierSet");
        var regex = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var owners = new List<(string name, IntPtr klass)>();
        foreach (var line in classes.Split('\n'))
        {
            var name = line.Split(' ')[0].Trim();
            if (!name.StartsWith("FM.UI.") || !name.EndsWith("Reference")) continue;
            try
            {
                var klass = Il2.FindClass(name);
                if (Il2.FindMethod(klass, "AcceptsPropertyInternal", 1) != IntPtr.Zero) owners.Add((name[6..], klass));
            }
            catch
            {
                // 안쪽 클래스 등 이름으로 못 찾는 것
            }
        }

        var lines = new List<string>();
        foreach (var (id, name) in properties)
        {
            if (!regex.IsMatch(name)) continue;
            var accepting = new List<string>();
            foreach (var (ownerName, klass) in owners)
            {
                var accepted = Il2.CallStatic(klass, "AcceptsPropertyInternal", id.ToString());
                if (Il2.Bool(accepted)) accepting.Add(ownerName);
            }
            lines.Add($"{name}\t{string.Join(", ", accepting)}");
            if (lines.Count >= 400) break;
        }
        lines.Sort(StringComparer.OrdinalIgnoreCase);
        return $"{lines.Count} names, {owners.Count} classes\n" + string.Join("\n", lines) + "\n";
    }
}
