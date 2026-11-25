using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.UIElements;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 게임 화면 위에 우리 요소를 그릴 때 쓰는 작은 도구들.
/// 꾸밈 하나가 실패해도 나머지는 그려지게, 꾸밈마다 따로 감싼다.
/// </summary>
internal static class Ui
{
    private static readonly Regex Tags = new("</?[a-zA-Z][^>]*>", RegexOptions.CultureInvariant);
    private static readonly Regex Spaces = new(@"\s+", RegexOptions.CultureInvariant);

    /// <summary>게임 글자에 섞인 꾸밈 표시(색, 링크)를 걷어 낸다.</summary>
    public static string Plain(string text) => text == null ? "" : Spaces.Replace(Tags.Replace(text, ""), " ").Trim();

    public static void Try(Action action)
    {
        try
        {
            action();
        }
        catch (Exception error)
        {
            Plugin.Logger.LogWarning($"ui style: {error.Message}");
        }
    }

    public static void Pad(VisualElement element, float vertical, float horizontal) => Try(() =>
    {
        var style = element.style;
        style.paddingTop = new StyleLength(vertical);
        style.paddingBottom = new StyleLength(vertical);
        style.paddingLeft = new StyleLength(horizontal);
        style.paddingRight = new StyleLength(horizontal);
    });

    public static void Round(VisualElement element, float radius) => Try(() =>
    {
        var style = element.style;
        style.borderTopLeftRadius = new StyleLength(radius);
        style.borderTopRightRadius = new StyleLength(radius);
        style.borderBottomLeftRadius = new StyleLength(radius);
        style.borderBottomRightRadius = new StyleLength(radius);
    });

    /// <summary>
    /// 글자 한 덩이. 굵은 글씨는 쓰지 않는다(기본 글꼴은 굵게 하면 한글 일부가 빠져 보인다).
    /// </summary>
    public static Label Text(string text, float size, Color color, TextAnchor anchor = TextAnchor.UpperLeft)
    {
        var label = new Label(text);
        Try(() => label.style.fontSize = new StyleLength(size));
        // 게임 쪽 기본값(가운데 정렬)을 물려받지 않게 정렬을 정해 둔다
        Try(() => label.style.unityTextAlign = new StyleEnum<TextAnchor>(anchor));
        Try(() => label.style.color = new StyleColor(color));
        Try(() => label.style.whiteSpace = new StyleEnum<WhiteSpace>(WhiteSpace.Normal));
        Try(() => label.style.marginLeft = new StyleLength(0f));
        Try(() => label.style.marginRight = new StyleLength(0f));
        Try(() => label.style.marginTop = new StyleLength(0f));
        Try(() => label.style.marginBottom = new StyleLength(0f));
        Pad(label, 0, 0);
        return label;
    }

    public static VisualElement Row()
    {
        var row = new VisualElement();
        Try(() => row.style.flexDirection = new StyleEnum<FlexDirection>(FlexDirection.Row));
        Try(() => row.style.flexShrink = new StyleFloat(0f));
        return row;
    }

    /// <summary>보이는 요소만 차례로 찾아간다. visit이 true를 주면 거기서 멈춘다.</summary>
    public static bool Walk(VisualElement element, Func<VisualElement, bool> visit)
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

    /// <summary>우리 요소의 글꼴을 게임 글자(sample)와 같은 것으로 맞춘다.</summary>
    public static void UseFontOf(VisualElement target, VisualElement sample)
    {
        if (sample == null) return;
        Try(() =>
        {
            var font = sample.resolvedStyle.unityFontDefinition;
            target.style.unityFontDefinition = new StyleFontDefinition(font);
        });
    }
}
