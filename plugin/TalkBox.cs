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

    /// <summary>Talk: 선택지가 있는 대화 화면. Match: 경기 중(고를 것은 외침 메뉴의 항목)</summary>
    private enum Mode { Talk, Match }

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly Color Panel = new(0.105f, 0.118f, 0.165f, 1f);
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
    private static VisualElement body;
    private static Label foldButton;
    private static VisualElement log;
    private static TextField input;
    private static Label status;
    private static Label applyButton;
    private static readonly HashSet<IntPtr> WatchedRoots = new();
    /// <summary>경기 화면의 외침 메뉴. 경기 중 칸은 이것이 떠 있는 동안 붙어 있다</summary>
    private static VisualElement shouts;
    private static VisualElement seenShouts;

    // 상태
    private static State state = State.Idle;
    private static int sceneHash;
    private static bool wantFocus;
    private static Mode mode;
    /** 접어 두면 제목 줄만 남는다. 게임을 끌 때까지 기억한다. 경기 중 칸은 경기장을 가리므로 접힌 채로 시작한다 */
    private static bool foldedTalk;
    private static bool foldedMatch = true;
    private static bool Folded => mode == Mode.Match ? foldedMatch : foldedTalk;
    /** 외침 이름(메뉴에 놓인 순서, 고를 수 없는 줄은 빈 문자열). 처음 쓸 때 메뉴를 잠깐 열어 읽고 게임을 끌 때까지 기억한다 */
    private static List<string> shoutLabels;
    /** 외침 이름을 읽으려고 메뉴를 열어 둔 상태면 읽을 시각, 아니면 -1 */
    private static long readLabelsAt = -1;
    private static string heldWords;
    private static Il2CppSystem.Object blockedMap;
    private static int slowTicks;
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
    private static string pendingKind = "talk";
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
        if (box != null && mode == Mode.Match)
        {
            if (shouts.panel == null || !UiTree.Displayed(shouts)) Detach();
            // 경기 중에 대화 화면(하프타임 팀 대화 등)이 뜨면 칸을 그쪽으로 옮긴다
            else if (++slowTicks % 3 == 0 && state == State.Idle && FindHost() != null) Detach();
        }
        if (box == null)
        {
            if (buildFailures >= 3) return;
            var kind = Mode.Talk;
            var found = FindHost();
            if (found == null)
            {
                kind = Mode.Match;
                found = FindMatchHost();
            }
            if (found == null) return;
            try
            {
                Build(found, kind);
            }
            catch (Exception error)
            {
                buildFailures++;
                Detach();
                Plugin.Logger.LogError($"talk box could not be built ({buildFailures}): {error}");
                return;
            }
            sceneHash = mode == Mode.Talk ? HashScene() : 0;
            Plugin.Logger.LogInfo(mode == Mode.Talk ? "talk box attached" : "talk box attached (match)");
            return;
        }

        if (mode == Mode.Talk)
        {
            // 게임이 다음 질문으로 넘어갔으면 대화를 비운다
            var hash = HashScene();
            if (hash != sceneHash)
            {
                sceneHash = hash;
                ResetChat();
            }
        }
        else if (readLabelsAt >= 0 && now >= readLabelsAt)
        {
            ReadShoutLabels();
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
        seenShouts = null;
        foreach (var root in UiTree.Roots())
        {
            Walk(root, element =>
            {
                var name = element.name;
                if (name == "shouts-dropdown") seenShouts = element;
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

    /// <summary>
    /// 경기 중이면 칸을 올릴 자리를 준다. 아니면 null.
    /// 바로 앞에서 부른 FindHost가 화면을 훑으며 봐 둔 외침 메뉴를 쓴다.
    ///
    /// 자리는 화면 전체의 뿌리다. 외침 메뉴가 놓인 화면(OverviewHeader)에 올리면,
    /// 그 뒤에 그려지는 경기 개요 카드들(포메이션, 경기 기록)에 칸이 가려진다.
    /// </summary>
    private static VisualElement FindMatchHost()
    {
        if (seenShouts == null) return null;
        var root = seenShouts.panel?.visualTree;
        if (root == null) return null;
        shouts = seenShouts;
        return root;
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

    /// <summary>경기 중 칸은 경기장을 덜 가리게 대화 화면의 칸보다 작게 그린다.</summary>
    private static float Sized(float value) => mode == Mode.Match ? MathF.Round(value * 0.8f) : value;

    private static Label Text(string text, float size, Color color)
    {
        var label = new Label(text);
        Try(() => label.style.fontSize = new StyleLength(MathF.Max(11f, Sized(size))));
        // 게임 쪽 기본값(가운데 정렬)을 물려받지 않게 왼쪽 위로 맞춘다
        Try(() => label.style.unityTextAlign = new StyleEnum<TextAnchor>(TextAnchor.UpperLeft));
        Try(() => label.style.color = new StyleColor(color));
        Try(() => label.style.whiteSpace = new StyleEnum<WhiteSpace>(WhiteSpace.Normal));
        return label;
    }

    private static Label ButtonLike(string text, Color color, Action onPress)
    {
        var button = Text(text, 14, Color.white);
        Try(() => button.style.backgroundColor = new StyleColor(color));
        Try(() => button.style.unityTextAlign = new StyleEnum<TextAnchor>(TextAnchor.MiddleCenter));
        Try(() => button.style.flexShrink = new StyleFloat(0f));
        Try(() => button.style.marginLeft = new StyleLength(10f));
        Pad(button, Sized(8), Sized(16));
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

    private static void Build(VisualElement found, Mode kind)
    {
        mode = kind;
        host = found;
        box = new VisualElement { name = BoxName };
        Try(() => box.style.position = new StyleEnum<Position>(Position.Absolute));
        Try(() =>
        {
            var style = box.style;
            if (mode == Mode.Match)
            {
                // 경기 화면: 왼쪽 위, 전술·외침 버튼 줄 바로 아래
                style.left = new StyleLength(16f);
                style.top = new StyleLength(56f);
                style.width = new StyleLength(300f);
            }
            else
            {
                // 대화 화면: 선택지가 있는 카드의 아래쪽
                style.left = new StyleLength(0f);
                style.right = new StyleLength(0f);
                style.bottom = new StyleLength(0f);
            }
        });
        Try(() => box.style.backgroundColor = new StyleColor(Panel));
        Try(() =>
        {
            box.style.borderLeftWidth = new StyleFloat(3f);
            box.style.borderLeftColor = new StyleColor(Blue);
        });
        Pad(box, Sized(12), Sized(14));
        Round(box, 8);

        // 제목 줄: "직접 답변"과 접기. 접으면 칸이 가리던 선택지를 볼 수 있다
        var header = Row();
        Try(() => header.style.justifyContent = new StyleEnum<Justify>(Justify.Center));
        header.Add(Text("직접 답변", 14, Title));
        foldButton = Text("", 14, Soft);
        Try(() => foldButton.style.marginLeft = new StyleLength(10f));
        foldButton.RegisterCallback(
            DelegateSupport.ConvertDelegate<EventCallback<PointerDownEvent>>(new Action<PointerDownEvent>(evt =>
            {
                evt.StopPropagation();
                SetFolded(!Folded);
            })),
            TrickleDown.NoTrickleDown);
        header.Add(foldButton);
        box.Add(header);

        body = new VisualElement();
        Try(() => body.style.marginTop = new StyleLength(8f));
        Try(() => body.style.flexShrink = new StyleFloat(1f));
        box.Add(body);

        try
        {
            log = new ScrollView();
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"talk box: no scroll view ({error.Message})");
            log = new VisualElement();
        }
        Try(() => log.style.maxHeight = new StyleLength(mode == Mode.Match ? 170f : 330f));
        Try(() => log.style.flexShrink = new StyleFloat(1f));
        Try(() => log.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.None));
        body.Add(log);

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
        body.Add(entry);

        // 적용할 선택지는 문장이 길 수 있어 한 줄을 통째로 쓰고, 버튼은 그 아래 오른쪽에 둔다
        var footer = new VisualElement();
        Try(() => footer.style.marginTop = new StyleLength(8f));
        Try(() => footer.style.flexShrink = new StyleFloat(0f));
        status = Text("", 12, Soft);
        footer.Add(status);
        applyButton = ButtonLike(mode == Mode.Match ? "외치기" : "반영하고 넘어가기", Green, Apply);
        Try(() => applyButton.style.alignSelf = new StyleEnum<Align>(Align.FlexEnd));
        Try(() => applyButton.style.marginTop = new StyleLength(8f));
        Try(() => applyButton.style.display = new StyleEnum<DisplayStyle>(DisplayStyle.None));
        footer.Add(applyButton);
        body.Add(footer);

        host.Add(box);
        UseGameFont();
        SetFolded(Folded);
        StyleInput(input);
        WatchRoot();
        state = State.Idle;
        pickId = 0;
    }

    /// <summary>
    /// 칸의 글꼴을 게임 글자와 같은 것으로 맞춘다.
    /// 그냥 두면 Unity 기본 글꼴이 쓰이는데, 그 글꼴은 굵게 하면 한글 일부가 빠져 보인다(그래서 굵은 글씨는 쓰지 않는다).
    /// </summary>
    private static void UseGameFont()
    {
        VisualElement sample = null;
        Walk(mode == Mode.Match ? shouts : host, element =>
        {
            if (box != null && element.Pointer == box.Pointer) return false;
            if (Il2.ClassName(Il2.ClassOf(element.Pointer)) != "SI.Bindable.SIText") return false;
            if (string.IsNullOrEmpty(Il2.TextOf(element.Pointer))) return false;
            sample = element;
            // 선택지 문장(이름이 text)이 본문 글꼴이다. 없으면 처음 본 글자를 쓴다
            return element.name == "text";
        });
        if (sample == null) return;
        Try(() =>
        {
            var font = sample.resolvedStyle.unityFontDefinition;
            box.style.unityFontDefinition = new StyleFontDefinition(font);
        });
    }

    /// <summary>입력칸 안쪽(글자가 찍히는 부분)을 어두운 바탕에 밝은 글자로 맞춘다.</summary>
    private static void StyleInput(VisualElement element)
    {
        if (element.name == "unity-text-input")
        {
            Try(() => element.style.backgroundColor = new StyleColor(Field));
            Try(() => element.style.color = new StyleColor(Color.white));
            Try(() => element.style.fontSize = new StyleLength(MathF.Max(11f, Sized(14f))));
            Try(() => element.style.minHeight = new StyleLength(Sized(34f)));
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

    private static void SetFolded(bool fold)
    {
        if (mode == Mode.Match) foldedMatch = fold;
        else foldedTalk = fold;
        if (fold) SetTyping(false);
        foldButton.text = fold ? "[펼치기]" : "[접기]";
        Try(() => body.style.display = new StyleEnum<DisplayStyle>(fold ? DisplayStyle.None : DisplayStyle.Flex));
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
        body = null;
        foldButton = null;
        log = null;
        input = null;
        status = null;
        applyButton = null;
        shouts = null;
        readLabelsAt = -1;
        heldWords = null;
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
            if (manager != IntPtr.Zero)
            {
                Il2.Call(manager, wantFocus ? "OnExclusiveInputBegin" : "OnExclusiveInputEnd");
                BlockMatchKeys(manager, wantFocus);
            }
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

    /// <summary>
    /// 경기 화면의 단축키 묶음("Match": 스페이스 = 재생/일시정지 등)은 독점 입력으로 꺼지지 않아 따로 끈다.
    /// 우리가 끈 것만 다시 켠다.
    /// </summary>
    private static void BlockMatchKeys(IntPtr manager, bool block)
    {
        if (!block)
        {
            if (blockedMap == null) return;
            var held = blockedMap;
            blockedMap = null;
            Il2.Call(held.Pointer, "Enable");
            return;
        }
        if (blockedMap != null) return;
        var asset = Il2.FieldObject(manager, "m_asset");
        if (asset == IntPtr.Zero) return;
        var map = Il2.CallObject(asset, "FindActionMap", "Match", "false");
        if (map == IntPtr.Zero || !Il2.CallBool(map, "get_enabled")) return;
        Il2.Call(map, "Disable");
        blockedMap = new Il2CppSystem.Object(map);
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
            Try(() => name.style.marginBottom = new StyleLength(4f));
            wrap.Add(name);
        }
        var bubble = Text(text, 14, Color.white);
        Try(() => bubble.style.backgroundColor = new StyleColor(mine ? Blue : Theirs));
        Pad(bubble, Sized(8), Sized(12));
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
        if (mode == Mode.Match && shoutLabels == null)
        {
            // 외침 이름을 아직 모른다. 메뉴를 잠깐 열어 읽은 뒤에 보낸다
            if (!shouts.enabledInHierarchy)
            {
                Finish("지금은 외침 메뉴가 꺼져 있습니다. 잠시 뒤에 다시 말해 주세요.");
                return;
            }
            heldWords = words;
            Il2.Call(shouts.Pointer, "ShowDropdown");
            readLabelsAt = waitingSince + 350;
            return;
        }
        Publish(words);
    }

    /// <summary>적은 말을 앱이 가져가게 내놓는다.</summary>
    private static void Publish(string words)
    {
        lock (Gate)
        {
            seq++;
            pendingWords = words;
            pendingKind = mode == Mode.Match ? "shout" : "talk";
            Monitor.PulseAll(Gate);
        }
    }

    /// <summary>열어 둔 외침 메뉴에서 줄마다 이름을 읽고 메뉴를 닫는다.</summary>
    private static void ReadShoutLabels()
    {
        readLabelsAt = -1;
        var labels = new List<string>();
        foreach (var root in UiTree.Roots())
        {
            Walk(root, element =>
            {
                if (Il2.ClassName(Il2.ClassOf(element.Pointer)) != "SI.Bindable.DropdownRowNavigatable") return false;
                // 외침 줄에는 외침 그림이 있다. 그림이 없는 줄("개인": 선수 한 명에게 외치는 화면을 연다)은 뺀다
                var isShout = Walk(element, inner => inner.name == "shoutIcon" && inner.worldBound.width > 0);
                labels.Add(isShout ? JoinedText(element) : "");
                return false;
            });
        }
        Il2.Call(shouts.Pointer, "HideDropdown");

        var words = heldWords;
        heldWords = null;
        if (labels.Count(label => label.Length > 0) < 2)
        {
            Finish("외침 목록을 읽지 못했습니다. 다시 말해 주세요.");
            return;
        }
        shoutLabels = labels;
        Plugin.Logger.LogInfo($"talk box: shouts = {string.Join(", ", labels)}");
        if (state == State.Waiting && words != null) Publish(words);
    }

    private static void Apply()
    {
        if (state != State.Replied || pickId <= 0) return;
        if (mode == Mode.Match)
        {
            Shout();
            return;
        }
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

    /// <summary>고른 외침을 게임에 보낸다. 메뉴를 열지 않고, 메뉴가 항목을 골랐을 때 하는 일을 그대로 일으킨다.</summary>
    private static void Shout()
    {
        var index = pickId - 1;
        if (shoutLabels == null || index < 0 || index >= shoutLabels.Count || shoutLabels[index] != pickText || pickText.Length == 0)
        {
            Finish("외침 목록이 바뀌었습니다. 다시 말해 주세요.");
            return;
        }
        if (!shouts.enabledInHierarchy)
        {
            // 방금 외친 뒤에는 게임이 한동안 외침을 막는다. 버튼은 남겨 둔다
            status.text = "지금은 외칠 수 없습니다. 잠시 뒤에 다시 눌러 주세요.";
            return;
        }
        var shout = pickText;
        SetTyping(false);
        Il2.Call(shouts.Pointer, "TriggerSelectionEvent", index.ToString());
        Finish($"외쳤습니다: {shout}");
    }

    /// <summary>앱이 부른다. 읽어 둔 외침 이름을 "순번(1부터)\t이름" 줄들로 준다.</summary>
    public static string Shouts()
    {
        return MainThread.Run(() =>
        {
            if (shoutLabels == null) return "";
            var lines = new List<string>();
            for (var i = 0; i < shoutLabels.Count; i++)
                if (shoutLabels[i].Length > 0)
                    lines.Add($"{i + 1}\t{shoutLabels[i]}");
            return string.Join("\n", lines);
        });
    }

    // ── 앱과 주고받기(HTTP 스레드) ────────────────────────

    /// <summary>앱이 부른다. 새로 한 말이 생길 때까지 기다렸다가 "순번\n종류(talk·shout)\n말"을 준다. 없으면 빈 문자열.</summary>
    public static string Poll(int after, int waitSeconds)
    {
        var deadline = Clock.ElapsedMilliseconds + Math.Clamp(waitSeconds, 0, 30) * 1000L;
        lock (Gate)
        {
            while (true)
            {
                var now = Clock.ElapsedMilliseconds;
                lastPoll = now;
                if (pendingWords != null && seq > after) return seq + "\n" + pendingKind + "\n" + pendingWords;
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
