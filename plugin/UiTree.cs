using System.Globalization;
using System.Text;
using UnityEngine.UIElements;

namespace FmBojwagwan.Bridge;

/// <summary>게임 화면(Unity UI Toolkit)의 요소 나무를 글로 옮긴다. 메인 스레드에서만 쓴다.</summary>
internal static class UiTree
{
    public sealed class Options
    {
        /// <summary>화면에 안 보이는 가지도 적는다</summary>
        public bool IncludeHidden;
        /// <summary>요소마다 번호표를 붙인다(/inspect·/click에서 쓴다)</summary>
        public bool WithIds = true;
        public int MaxDepth = 200;
        /// <summary>이 번호표의 요소부터 적는다(0이면 전체)</summary>
        public int RootId;
    }

    private static bool panelsBroken;

    /// <summary>화면에 올라와 있는 패널의 뿌리 요소들(아래에 깔린 것부터)</summary>
    public static List<VisualElement> Roots()
    {
        var roots = new List<VisualElement>();
        if (!panelsBroken)
        {
            try
            {
                var panels = UIElementsRuntimeUtility.GetSortedPlayerPanels();
                for (var i = 0; i < panels.Count; i++)
                {
                    var tree = panels[i]?.visualTree;
                    if (tree != null) roots.Add(tree);
                }
            }
            catch (Exception error)
            {
                panelsBroken = true;
                Plugin.Logger.LogWarning($"panel list unavailable, falling back to UIDocument: {error.Message}");
            }
        }
        if (roots.Count == 0)
        {
            foreach (var document in UnityEngine.Object.FindObjectsOfType<UIDocument>())
            {
                var root = document?.rootVisualElement;
                if (root != null) roots.Add(root);
            }
        }
        return roots;
    }

    private static int displayMode;

    /// <summary>화면에 그려지는 요소인지(display: none이 아닌지). 빠른 방법이 안 되면 느린 방법으로 바꾼다.</summary>
    public static bool Displayed(VisualElement element)
    {
        if (displayMode == 0)
        {
            try
            {
                return element.areAncestorsAndSelfDisplayed;
            }
            catch (Exception error)
            {
                displayMode = 1;
                Plugin.Logger.LogWarning($"display flag unavailable, using resolved style: {error.Message}");
            }
        }
        if (displayMode == 1)
        {
            try
            {
                return element.resolvedStyle.display != DisplayStyle.None;
            }
            catch (Exception error)
            {
                displayMode = 2;
                Plugin.Logger.LogWarning($"resolved style unavailable, treating everything as displayed: {error.Message}");
            }
        }
        return true;
    }

    public static string Dump(Options options)
    {
        var text = new StringBuilder(1 << 18);
        var count = 0;
        if (options.RootId > 0)
        {
            Write(text, new VisualElement(Handles.Get(options.RootId)), 0, options, ref count);
        }
        else
        {
            var roots = Roots();
            for (var i = 0; i < roots.Count; i++)
            {
                text.Append("=== panel ").Append(i).Append('\n');
                Write(text, roots[i], 0, options, ref count);
            }
        }
        text.Append("--- ").Append(count).Append(" element(s)\n");
        return text.ToString();
    }

    private static void Write(StringBuilder text, VisualElement element, int depth, Options options, ref int count)
    {
        var displayed = Displayed(element);
        if (!displayed && !options.IncludeHidden) return;
        count++;

        var pointer = element.Pointer;
        text.Append(' ', depth);
        if (options.WithIds) text.Append('#').Append(Handles.Add(pointer)).Append(' ');
        text.Append(Il2.ClassName(Il2.ClassOf(pointer)));

        try
        {
            var name = element.name;
            if (!string.IsNullOrEmpty(name)) text.Append(" \"").Append(name).Append('"');

            var classes = element.m_ClassList;
            if (classes != null)
                for (var i = 0; i < classes.Count; i++)
                    text.Append(" .").Append(classes[i]);

            var bounds = element.worldBound;
            var invariant = CultureInfo.InvariantCulture;
            text.Append(" [")
                .Append(bounds.x.ToString("0", invariant)).Append(',')
                .Append(bounds.y.ToString("0", invariant)).Append(' ')
                .Append(bounds.width.ToString("0", invariant)).Append('x')
                .Append(bounds.height.ToString("0", invariant)).Append(']');

            if (!displayed) text.Append(" hidden");
            if (!element.visible) text.Append(" invisible");
            if (!element.enabledInHierarchy) text.Append(" disabled");
            if (element.focusable) text.Append(" focusable");

            var label = Il2.TextOf(pointer);
            if (!string.IsNullOrEmpty(label)) text.Append(" text=").Append(Il2.Quote(label));
        }
        catch (Exception error)
        {
            text.Append(" !").Append(error.GetType().Name);
        }
        text.Append('\n');

        if (depth >= options.MaxDepth) return;
        var children = element.m_Children;
        if (children == null) return;
        var total = children.Count;
        for (var i = 0; i < total; i++)
        {
            var child = children[i];
            if (child != null) Write(text, child, depth + 1, options, ref count);
        }
    }
}
