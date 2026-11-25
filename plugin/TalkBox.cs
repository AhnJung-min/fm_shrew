using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Il2CppInterop.Runtime;
using UnityEngine;
using UnityEngine.UIElements;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 게임의 대화 틀(기자회견·면담·팀 대화가 함께 쓰는 "SpeakTo") 아래에 붙는 "직접 답변" 칸.
///
/// 흐름: 하고 싶은 말을 적고 [말하기] → FM 보좌관 앱이 그 말을 가져가 AI에게 묻고 답을 돌려준다
/// → 상대의 반응과 "적용할 선택지"가 뜬다 → [반영하고 넘어가기]를 누르면 그 선택지를 게임에서 고른다.
///
/// 화면 요소는 메인 스레드에서만 만진다. 앱과 주고받는 값(Gate로 잠근 것)만 HTTP 스레드와 나눠 쓴다.
/// </summary>
internal static class TalkBox
{
    public const string BoxName = "FmBojwagwanTalk";

    private enum State { Idle, Waiting, Replied }

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly Color Panel = new(0.105f, 0.118f, 0.165f, 0.98f);
    private static readonly Color Field = new(0.07f, 0.078f, 0.11f, 1f);
    private static readonly Color Line = new(0.27f, 0.3f, 0.38f, 1f);
    private static readonly Color Blue = new(0.145f, 0.388f, 0.922f, 1f);
    private static readonly Color Green = new(0.13f, 0.59f, 0.33f, 1f);
    private static readonly Color Theirs = new(0.21f, 0.23f, 0.29f, 1f);
    private static readonly Color Name = new(0.93f, 0.7f, 0.33f, 1f);
    private static readonly Color Soft = new(0.62f, 0.65f, 0.72f, 1f);
    private static readonly Color Title = new(0.56f, 0.69f, 0.98f, 1f);

    // 화면 요소
    private static VisualElement host;
    private static VisualElement box;
    private static VisualElement log;
    private static TextField input;
    private static Label status;
    private static Label applyButton;
    private static readonly HashSet<IntPtr> WatchedRoots = new();

    // 상태
    private static State state = State.Idle;
    private static int sceneHash;
    private static bool wantFocus;
    private static bool exclusive;
    private static long nextTick;
    private static long submitAt = -1;
    private static long waitingSince;
    private static long scrollUntil;
    private static int pickId;
    private static string pickText = "";
    private static int buildFailures;

    // 앱과 주고받는 것
    private static readonly object Gate = new();
    private static int seq;
    private static string pendingWords;
    private static long lastPoll = -100_000;

    /// <summary>대화 틀이 떠 있고 입력칸이 붙어 있는지</summary>
    public static bool Active => box != null;

    public static int SceneHash => sceneHash;

    // ── 매 프레임 ─────────────────────────────────────────

    public static void Tick()
    {
        var now = Clock.ElapsedMilliseconds;
        try
        {
            if (box != null)
            {
                if (submitAt >= 0 && now >= submitAt)
                {
                    submitAt = -1;
                    Submit();
                }
                if (wantFocus && !InputFocused()) input.Focus();
                if (now < scrollUntil && log is ScrollView scroll) scroll.scrollOffset = new Vector2(0, 100_000);
            }
            if (now < nextTick) return;
            nextTick = now + 400;
            Slow(now);
        }
        catch (Exception error)
        {
            nextTick = now + 3000;
            Plugin.Logger.LogWarning($"talk box: {error}");
        }
    }

    private static void Slow(long now)
    {
        if (box != null && (box.panel == null || !UiTree.Displayed(host))) Detach();
        if (box == null)
        {
            if (buildFailures >= 3) return;
            var found = FindHost();
            if (found == null) return;
            try
            {
                Build(found);
            }
            catch (Exception error)
            {
                buildFailures++;
                Detach();
                Plugin.Logger.LogError($"talk box could not be built ({buildFailures}): {error}");
                return;
            }
            sceneHash = HashScene();
            Plugin.Logger.LogInfo("talk box attached");
            return;
        }

        // 게임이 다음 질문으로 넘어갔으면 대화를 비운다
        var hash = HashScene();
        if (hash != sceneHash)
        {
            sceneHash = hash;
            ResetChat();
        }

        if (state == State.Waiting && now - waitingSince > 90_000)
        {
            Finish("답을 받지 못했습니다. FM 보좌관 앱이 켜져 있는지 확인해 주세요.");
        }
        else if (state == State.Idle && status.text.Length == 0 && !AppConnected(now))
        {
            status.text = "FM 보좌관 앱을 켜면 쓸 수 있습니다.";
        }
        else if (state == State.Idle && AppConnected(now) && status.text.StartsWith("FM 보좌관 앱을"))
        {
            status.text = "";
        }
    }

    private static bool AppConnected(long now)
    {
        lock (Gate) return now - lastPoll < 45_000;
    }

    // ── 대화 틀 찾기 ──────────────────────────────────────

    private static bool Walk(VisualElement element, Func<VisualElement, bool> visit)
    {
        if (!UiTree.Displayed(element)) return false;
        if (visit(element)) return true;
        var children = element.m_Children;
        if (children == null) return false;
        var total = children.Count;
        for (var i = 0; i < total; i++)
        {
            var child = children[i];
            if (child != null && Walk(child, visit)) return true;
        }
        return false;
    }

    private static bool IsSiButton(VisualElement element) => Il2.ClassName(Il2.ClassOf(element.Pointer)) == "SI.Bindable.SIButton";

    /// <summary>선택지가 떠 있는 대화 틀. 없으면 null</summary>
    private static VisualElement FindHost()
    {
        VisualElement card = null;
        VisualElement container = null;
        foreach (var root in UiTree.Roots())
        {
            Walk(root, element =>
            {
                var name = element.name;
                if (name == "SpeakToContainer" && element.worldBound.width > 100) container = element;
                if (name != "SpeakToShortcutElement" || element.worldBound.width <= 100) return false;
                card = element;
                return true;
            });
            if (card != null || container != null) break;
        }
        var found = card ?? container;
        if (found == null) return null;

        // 고를 것이 있을 때만 붙는다
        var hasOption = Walk(found, element =>
            IsSiButton(element) && element.enabledInHierarchy && element.worldBound.width > 100 &&
            !element.ClassListContains("shortcut-fake-button") && JoinedText(element).Length > 0);
        return hasOption ? found : null;
    }

    private static readonly Regex Tags = new("</?[a-zA-Z][^>]*>", RegexOptions.CultureInvariant);
    private static readonly Regex Spaces = new(@"\s+", RegexOptions.CultureInvariant);

    private static string Plain(string text) => text == null ? "" : Spaces.Replace(Tags.Replace(text, ""), " ").Trim();

    /// <summary>요소와 그 안의 글자를 순서대로 이어 붙인다(같은 글자는 한 번만). 앱이 선택지 문장을 만드는 방식과 같다.</summary>
    private static string JoinedText(VisualElement element)
    {
        var parts = new List<string>();
        Collect(element, parts);
        return string.Join(" ", parts);
    }

    private static void Collect(VisualElement element, List<string> parts)
    {
        if (!UiTree.Displayed(element)) return;
        var text = Plain(Il2.TextOf(element.Pointer));
        if (text.Length > 0 && !parts.Contains(text)) parts.Add(text);
        var children = element.m_Children;
        if (children == null) return;
        for (var i = 0; i < children.Count; i++)
        {
            var child = children[i];
            if (child != null) Collect(child, parts);
        }
    }

    private static int HashScene()
    {
        var hash = 17;
        Walk(host, element =>
        {
            if (box != null && element.Pointer == box.Pointer) return true;
            var text = Il2.TextOf(element.Pointer);
            if (!string.IsNullOrEmpty(text))
                foreach (var c in text)
                    hash = unchecked(hash * 31 + c);
            return false;
        });
        // 위의 Walk는 우리 칸을 만나면 멈춘다. 우리 칸은 맨 끝에 붙어 있으므로 그 앞의 글자는 모두 셈에 들어간다
        return hash;
    }

    // ── 칸 만들기 ─────────────────────────────────────────

    private static void Try(Action action)
    {
        try
        {
            action();
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"talk box style: {error.Message}");
        }
    }

    private static void Pad(VisualElement element, float vertical, float horizontal) => Try(() =>
    {
        var style = element.style;
        style.paddingTop = new StyleLength(vertical);
        style.paddingBottom = new StyleLength(vertical);
        style.paddingLeft = new StyleLength(horizontal);
        style.paddingRight = new StyleLength(horizontal);
    });

    private static void Round(VisualElement element, float radius) => Try(() =>
    {
        var style = element.style;
        style.borderTopLeftRadius = new StyleLength(radius);
        style.borderTopRightRadius = new StyleLength(radius);
        style.borderBottomLeftRadius = new StyleLength(radius);
        style.borderBottomRightRadius = new StyleLength(radius);
    });

    private static void Border(VisualElement element, Color color) => Try(() =>
    {
        var style = element.style;
        style.borderTopWidth = new StyleFloat(1f);
        style.borderBottomWidth = new StyleFloat(1f);
        style.borderLeftWidth = new StyleFloat(1f);
        style.borderRightWidth = new StyleFloat(1f);
        style.borderTopColor = new StyleColor(color);
        style.borderBottomColor = new StyleColor(color);
        style.borderLeftColor = new StyleColor(color);
        style.borderRightColor = new StyleColor(color);
    });

    private static Label Text(string text, float size, Color color)
    {
        var label = new Label(text);
        Try(() => label.style.fontSize = new StyleLength(size));
        Try(() => label.style.color = new StyleColor(color));
        Try(() => label.style.whiteSpace = new StyleEnum<WhiteSpace>(WhiteSpace.Normal));
        return label;
    }

    private static Label ButtonLike(string text, Color color, Action onPress)
    {
        var button = Text(text, 14, Color.white);
        Try(() => button.style.backgroundColor = new StyleColor(color));
        Try(() => button.style.unityTextAlign = new StyleEnum<TextAnchor>(TextAnchor.MiddleCenter));
        Try(() => button.style.unityFontStyleAndWeight = new StyleEnum<FontStyle>(FontStyle.Bold));
        Try(() => button.style.flexShrink = new StyleFloat(0f));
        Try(() => button.style.marginLeft = new StyleLength(10f));
        Pad(button, 8, 16);
        Round(button, 6);
        button.RegisterCallback(
            DelegateSupport.ConvertDelegate<EventCallback<PointerDownEvent>>(new Action<PointerDownEvent>(evt =>
            {
                evt.StopPropagation();
                try
                {
                    onPress();
                }
                catch (Exception error)
                {
                    Plugin.Logger.LogWarning($"talk box button: {error}");
                }
            })),
            TrickleDown.NoTrickleDown);
        return button;
    }

    private static VisualElement Row()
    {
        var row = new VisualElement();
        Try(() => row.style.flexDirection = new StyleEnum<FlexDirection>(FlexDirection.Row));
        Try(() => row.style.flexShrink = new StyleFloat(0f));
        return row;
    }

    private static void Build(VisualElement found)
    {
        host = found;
        box = new VisualElement { name = BoxName };
        Try(() => box.style.position = new StyleEnum<Position>(Position.Absolute));
        Try(() =>
        {
            var style = box.style;
            style.left = new StyleLength(0f);
            style.right = new StyleLength(0f);
            style.bottom = new StyleLength(0f);
        });
        Try(() => box.style.backgroundColor = new StyleColor(Panel));
        Try(() =>
        {
            box.style.borderLeftWidth = new StyleFloat(3f);
            box.style.borderLeftColor = new StyleColor(Blue);
        });
        Pad(box, 12, 14);
        Round(box, 8);

        var title = Text("직접 답변", 14, Title);
        Try(() => title.style.unityTextAlign = new StyleEnum<TextAnchor>(TextAnchor.MiddleCenter));
        Try(() => title.style.marginBottom = new StyleLength(8f));
        box.Add(title);

        try
        {
            log = new ScrollView();
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"talk box: no scroll view ({error.Message})");
            log = new VisualElement();
        }
        Try(() => log.style.maxHeight = new StyleLength(330f));
        Try(() => log.style.flexShrink = new StyleFloat(1f));
        Try(() => log.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.None));
        box.Add(log);

        var entry = Row();
        input = new TextField();
        Try(() => input.style.flexGrow = new StyleFloat(1f));
        Try(() => input.style.marginLeft = new StyleLength(0f));
        Try(() => input.style.marginRight = new StyleLength(0f));
        input.RegisterCallback(
            DelegateSupport.ConvertDelegate<EventCallback<KeyDownEvent>>(new Action<KeyDownEvent>(OnKey)),
            TrickleDown.TrickleDown);
        input.RegisterCallback(
            DelegateSupport.ConvertDelegate<EventCallback<PointerDownEvent>>(new Action<PointerDownEvent>(_ => SetTyping(true))),
            TrickleDown.TrickleDown);
        entry.Add(input);
        entry.Add(ButtonLike("말하기", Blue, () => submitAt = Clock.ElapsedMilliseconds));
        box.Add(entry);

        var footer = Row();
        Try(() => footer.style.marginTop = new StyleLength(8f));
        status = Text("", 12, Soft);
        Try(() => status.style.flexGrow = new StyleFloat(1f));
        Try(() => status.style.flexShrink = new StyleFloat(1f));
        Try(() => status.style.alignSelf = new StyleEnum<Align>(Align.Center));
        footer.Add(status);
        applyButton = ButtonLike("반영하고 넘어가기", Green, Apply);
        Try(() => applyButton.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.None));
        footer.Add(applyButton);
        box.Add(footer);

        host.Add(box);
        StyleInput(input);
        WatchRoot();
        state = State.Idle;
        pickId = 0;
    }

    /// <summary>입력칸 안쪽(글자가 찍히는 부분)을 어두운 바탕에 밝은 글자로 맞춘다.</summary>
    private static void StyleInput(VisualElement element)
    {
        if (element.name == "unity-text-input")
        {
            Try(() => element.style.backgroundColor = new StyleColor(Field));
            Try(() => element.style.color = new StyleColor(Color.white));
            Try(() => element.style.fontSize = new StyleLength(14f));
            Try(() => element.style.minHeight = new StyleLength(34f));
            Pad(element, 6, 10);
            Round(element, 6);
            Border(element, Line);
            return;
        }
        var children = element.m_Children;
        if (children == null) return;
        for (var i = 0; i < children.Count; i++)
        {
            var child = children[i];
            if (child != null) StyleInput(child);
        }
    }

    /// <summary>칸 밖을 누르면 글자 입력을 끝낸다(게임 단축키를 돌려준다).</summary>
    private static void WatchRoot()
    {
        var root = host.panel?.visualTree;
        if (root == null || !WatchedRoots.Add(root.Pointer)) return;
        root.RegisterCallback(
            DelegateSupport.ConvertDelegate<EventCallback<PointerDownEvent>>(new Action<PointerDownEvent>(evt =>
            {
                if (box == null || !wantFocus) return;
                var target = evt.target?.TryCast<VisualElement>();
                for (var element = target; element != null; element = element.parent)
                    if (element.Pointer == input.Pointer)
                        return;
                SetTyping(false);
            })),
            TrickleDown.TrickleDown);
    }

    private static void Detach()
    {
        SetTyping(false);
        try
        {
            if (box != null && box.parent != null) box.RemoveFromHierarchy();
        }
        catch
        {
            // 화면이 통째로 사라진 경우
        }
        host = null;
        box = null;
        log = null;
        input = null;
        status = null;
        applyButton = null;
        state = State.Idle;
        submitAt = -1;
        lock (Gate) pendingWords = null;
    }

    // ── 글자 입력 ─────────────────────────────────────────

    private static bool InputFocused()
    {
        var focused = host?.panel?.focusController?.focusedElement?.TryCast<VisualElement>();
        for (var element = focused; element != null; element = element.parent)
            if (element.Pointer == input.Pointer)
                return true;
        return false;
    }

    /// <summary>
    /// 글자를 치는 동안에는 게임 단축키(스페이스 = 계속 등)가 먹지 않게 한다.
    /// 게임의 검색창이 쓰는 것과 같은 방법(입력 관리자의 "독점 입력")이다.
    /// </summary>
    private static void SetTyping(bool typing)
    {
        wantFocus = typing && box != null;
        if (wantFocus == exclusive) return;
        try
        {
            var manager = Il2.FindUnityObject("SI.Input.InputManager");
            if (manager != IntPtr.Zero) Il2.Call(manager, wantFocus ? "OnExclusiveInputBegin" : "OnExclusiveInputEnd");
            exclusive = wantFocus;
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"talk box: shortcut guard failed: {error.Message}");
        }
        if (!wantFocus)
        {
            try
            {
                input?.Blur();
            }
            catch
            {
                // 이미 화면에서 빠졌다
            }
        }
    }

    private static void OnKey(KeyDownEvent evt)
    {
        var key = evt.keyCode;
        if (key == KeyCode.Return || key == KeyCode.KeypadEnter)
        {
            evt.StopPropagation();
            // 한글은 조합 중인 마지막 글자가 들어온 뒤에 보내야 한다
            submitAt = Clock.ElapsedMilliseconds + 150;
        }
        else if (key == KeyCode.Escape)
        {
            evt.StopPropagation();
            SetTyping(false);
        }
    }

    // ── 대화 ──────────────────────────────────────────────

    private static void AddBubble(string speaker, string text, bool mine)
    {
        var wrap = new VisualElement();
        Try(() => wrap.style.alignSelf = new StyleEnum<Align>(mine ? Align.FlexEnd : Align.FlexStart));
        Try(() => wrap.style.maxWidth = new StyleLength(new Length(88f, LengthUnit.Percent)));
        Try(() => wrap.style.marginBottom = new StyleLength(8f));
        Try(() => wrap.style.flexShrink = new StyleFloat(0f));
        if (!string.IsNullOrEmpty(speaker))
        {
            var name = Text(speaker, 12, Name);
            Try(() => name.style.unityFontStyleAndWeight = new StyleEnum<FontStyle>(FontStyle.Bold));
            Try(() => name.style.marginBottom = new StyleLength(4f));
            wrap.Add(name);
        }
        var bubble = Text(text, 14, Color.white);
        Try(() => bubble.style.backgroundColor = new StyleColor(mine ? Blue : Theirs));
        Pad(bubble, 8, 12);
        Round(bubble, 12);
        wrap.Add(bubble);
        log.Add(wrap);
        Try(() => log.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.Flex));
        scrollUntil = Clock.ElapsedMilliseconds + 600;
    }

    private static void ResetChat()
    {
        try
        {
            log.Clear();
            Try(() => log.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.None));
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"talk box: reset failed: {error.Message}");
        }
        Finish("");
    }

    /// <summary>한 차례를 끝내고 다음 말을 받을 수 있게 한다.</summary>
    private static void Finish(string message)
    {
        state = State.Idle;
        pickId = 0;
        status.text = message;
        Try(() => applyButton.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.None));
        lock (Gate) pendingWords = null;
    }

    private static void Submit()
    {
        if (state == State.Waiting) return;
        var words = (input.text ?? "").Trim();
        if (words.Length == 0) return;
        input.value = "";
        AddBubble(null, words, true);
        Try(() => applyButton.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.None));
        pickId = 0;
        state = State.Waiting;
        waitingSince = Clock.ElapsedMilliseconds;
        status.text = AppConnected(waitingSince) ? "생각하는 중…" : "FM 보좌관 앱을 기다리는 중… (앱이 켜져 있어야 합니다)";
        lock (Gate)
        {
            seq++;
            pendingWords = words;
            Monitor.PulseAll(Gate);
        }
    }

    private static void Apply()
    {
        if (state != State.Replied || pickId <= 0) return;
        VisualElement option;
        try
        {
            option = new VisualElement(Handles.Get(pickId));
        }
        catch
        {
            Finish("화면이 바뀌었습니다. 다시 말해 주세요.");
            return;
        }
        // 앱이 받은 문장은 아주 길면 끝이 "…"로 잘려 있다
        var shown = JoinedText(option);
        var same = pickText.EndsWith("…") ? shown.StartsWith(pickText[..^1]) : shown == pickText;
        if (option.panel == null || !UiTree.Displayed(option) || !option.enabledInHierarchy || !same)
        {
            Finish("화면이 바뀌었습니다. 다시 말해 주세요.");
            return;
        }
        var clickable = option.TryCast<Button>()?.clickable;
        if (clickable == null)
        {
            Finish("이 선택지는 대신 고를 수 없습니다. 직접 눌러 주세요.");
            return;
        }
        SetTyping(false);
        Finish("게임에 반영했습니다.");
        clickable.SimulateSingleClick(null);
    }

    // ── 앱과 주고받기(HTTP 스레드) ────────────────────────

    /// <summary>앱이 부른다. 새로 한 말이 생길 때까지 기다렸다가 "순번\n말"을 준다. 없으면 빈 문자열.</summary>
    public static string Poll(int after, int waitSeconds)
    {
        var deadline = Clock.ElapsedMilliseconds + Math.Clamp(waitSeconds, 0, 30) * 1000L;
        lock (Gate)
        {
            while (true)
            {
                var now = Clock.ElapsedMilliseconds;
                lastPoll = now;
                if (pendingWords != null && seq > after) return seq + "\n" + pendingWords;
                if (now >= deadline) return "";
                Monitor.Wait(Gate, (int)Math.Min(deadline - now, 5000));
            }
        }
    }

    /// <summary>앱이 보낸 답(JSON)을 받아 화면에 올린다.</summary>
    public static string Reply(int forSeq, string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        string Read(JsonElement from, string name) =>
            from.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : "";

        var error = Read(root, "error");
        var note = Read(root, "note");
        var text = Read(root, "pickText");
        var pick = root.TryGetProperty("pick", out var picked) && picked.ValueKind == JsonValueKind.Number ? picked.GetInt32() : 0;
        var replies = new List<(string speaker, string text)>();
        if (root.TryGetProperty("replies", out var list) && list.ValueKind == JsonValueKind.Array)
            foreach (var item in list.EnumerateArray())
                replies.Add((Read(item, "speaker"), Read(item, "text")));

        return MainThread.Run(() =>
        {
            int current;
            lock (Gate) current = seq;
            if (box == null || state != State.Waiting || forSeq != current) return "stale";
            if (error.Length > 0)
            {
                Finish(error);
                return "ok";
            }
            foreach (var reply in replies)
                if (reply.text.Length > 0)
                    AddBubble(reply.speaker, reply.text, false);
            if (pick <= 0)
            {
                Finish(note.Length > 0 ? note : "맞는 선택지를 찾지 못했습니다.");
                return "ok";
            }
            pickId = pick;
            pickText = text;
            state = State.Replied;
            status.text = note;
            Try(() => applyButton.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.Flex));
            lock (Gate) pendingWords = null;
            return "ok";
        });
    }
}
