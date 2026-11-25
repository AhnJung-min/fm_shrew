using Il2CppInterop.Runtime;
using UnityEngine;
using UnityEngine.UIElements;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 화면 요소를 대신 누른다(실험). 게임이 어떤 방식의 입력에 반응하는지 알아내려고 세 가지 방법을 둔다.
/// </summary>
internal static class Clicker
{
    public static string Click(int id, string mode)
    {
        if (id <= 0) throw new HttpError(400, "missing 'id'");
        var element = new VisualElement(Handles.Get(id));
        if (!UiTree.Displayed(element)) return "ERROR element is not displayed";
        if (!element.enabledInHierarchy) return "ERROR element is disabled";

        switch (mode)
        {
            // Unity 기본 버튼이 가진 "눌림" 처리를 직접 부른다
            case "clickable":
            {
                var button = element.TryCast<Button>();
                if (button == null) return "ERROR not a UnityEngine.UIElements.Button (try mode=submit or mode=pointer)";
                var clickable = button.clickable;
                if (clickable == null) return "ERROR button has no clickable";
                clickable.SimulateSingleClick(null);
                return "ok clickable";
            }

            // 키보드·패드의 "확인" 입력을 그 요소에 보낸다
            case "submit":
            {
                var submit = NavigationSubmitEvent.GetPooled();
                submit.target = element.Cast<IEventHandler>();
                element.SendEvent(submit);
                return "ok submit";
            }

            // 요소 한가운데를 마우스로 눌렀다 뗀 것처럼 보낸다
            case "pointer":
            {
                var panel = element.panel;
                if (panel == null) return "ERROR element is not on a panel";
                var center = element.worldBound.center;
                var root = panel.visualTree;

                var press = new Event { type = EventType.MouseDown, mousePosition = center, button = 0, clickCount = 1 };
                root.SendEvent(PointerDownEvent.GetPooled(press));
                var release = new Event { type = EventType.MouseUp, mousePosition = center, button = 0, clickCount = 1 };
                root.SendEvent(PointerUpEvent.GetPooled(release));
                return $"ok pointer at {center.x:0},{center.y:0}";
            }

            default:
                throw new HttpError(400, "mode must be clickable, submit or pointer");
        }
    }
}
