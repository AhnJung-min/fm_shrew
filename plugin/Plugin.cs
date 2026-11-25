using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using UnityEngine;

namespace FmBojwagwan.Bridge;

/// <summary>
/// FM 보좌관과 게임을 잇는 다리. 게임 안에서 UI를 읽어, 이 PC 안에서만 열리는 주소(127.0.0.1)로 앱에 알려 준다.
/// </summary>
[BepInPlugin(Id, "FM Bojwagwan Bridge", Version)]
public class Plugin : BasePlugin
{
    public const string Id = "fm.bojwagwan.bridge";
    public const string Version = "0.2.2";

    internal static ManualLogSource Logger = null!;

    public override void Load()
    {
        Logger = Log;
        try
        {
            BridgeFiles.Prepare();
            Server.Start();
            AddComponent<BridgeBehaviour>();
            Log.LogInfo($"FM Bojwagwan Bridge {Version} ready on {Server.Host}:{Server.Port}");
        }
        catch (Exception error)
        {
            Log.LogError($"FM Bojwagwan Bridge failed to start: {error}");
        }
    }
}

/// <summary>게임의 매 프레임에 불린다. 게임 UI는 이 스레드에서만 만질 수 있다.</summary>
public class BridgeBehaviour : MonoBehaviour
{
    public BridgeBehaviour(IntPtr pointer) : base(pointer) { }

    public void Update()
    {
        MainThread.Pump();
        TalkBox.Tick();
        Watcher.Tick();
    }
}
