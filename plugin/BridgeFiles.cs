using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 플러그인이 쓰는 파일. 게임 폴더가 아니라 사용자 폴더(%LOCALAPPDATA%\FmBojwagwan)에 둔다.
/// 앱은 여기 있는 bridge.json을 읽어 접속할 포트와 암호(토큰)를 안다.
/// </summary>
internal static class BridgeFiles
{
    public static string Root { get; private set; } = "";
    public static string Dumps => Path.Combine(Root, "dumps");

    public static void Prepare()
    {
        Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FmBojwagwan");
        Directory.CreateDirectory(Dumps);
        Prune();
    }

    /// <summary>기록이 끝없이 쌓이지 않게 최근 것만 남긴다.</summary>
    private static void Prune()
    {
        try
        {
            foreach (var old in new DirectoryInfo(Dumps).GetFiles("*.txt").OrderByDescending(f => f.LastWriteTimeUtc).Skip(150))
                old.Delete();
        }
        catch
        {
            // 정리를 못 해도 동작에는 지장이 없다
        }
    }

    public static void WriteInfo(string host, int port, string token)
    {
        var json = "{" +
                   $"\"host\":\"{host}\"," +
                   $"\"port\":{port}," +
                   $"\"token\":\"{token}\"," +
                   $"\"pid\":{Environment.ProcessId}," +
                   $"\"version\":\"{Plugin.Version}\"" +
                   "}";
        File.WriteAllText(Path.Combine(Root, "bridge.json"), json, new UTF8Encoding(false));
    }

    public static string WriteDump(string tag, string content)
    {
        var safe = new string(tag.Where(c => char.IsLetterOrDigit(c) || c == '-').Take(40).ToArray());
        var path = Path.Combine(Dumps, $"{DateTime.Now:yyyyMMdd-HHmmss}-{(safe.Length > 0 ? safe : "ui")}.txt");
        File.WriteAllText(path, content, new UTF8Encoding(false));
        return path;
    }

    public static void AppendLine(string file, string line)
    {
        File.AppendAllText(Path.Combine(Root, file), line + "\n", new UTF8Encoding(false));
    }
}
