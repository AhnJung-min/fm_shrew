namespace FmBojwagwan.Bridge;

/// <summary>
/// 게임 객체에 붙이는 번호표. 밖에서는 "#12"처럼 번호로 가리킨다.
/// 번호표가 있는 동안 객체가 사라지지 않게 붙잡아 둔다(/reset으로 모두 놓는다).
/// 메인 스레드에서만 쓴다.
/// </summary>
internal static class Handles
{
    private static readonly Dictionary<IntPtr, int> Ids = new();
    private static readonly List<Il2CppSystem.Object> Objects = new() { null! };

    public static int Add(IntPtr pointer)
    {
        if (pointer == IntPtr.Zero) return 0;
        if (Ids.TryGetValue(pointer, out var id)) return id;
        if (Objects.Count > 400_000) Clear();
        id = Objects.Count;
        Objects.Add(new Il2CppSystem.Object(pointer));
        Ids[pointer] = id;
        return id;
    }

    public static IntPtr Get(int id)
    {
        if (id <= 0 || id >= Objects.Count) throw new HttpError(404, $"no object #{id} (ids are reset by /reset)");
        return Objects[id].Pointer;
    }

    public static void Clear()
    {
        Ids.Clear();
        Objects.Clear();
        Objects.Add(null!);
    }
}
