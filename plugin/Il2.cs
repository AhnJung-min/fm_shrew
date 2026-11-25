using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Il2CppInterop.Runtime;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 게임(IL2CPP) 객체를 이름으로 들여다보는 도구. 클래스·필드·속성·메서드를 실행 중에 조회한다.
/// 화면 뒤의 데이터가 어떤 모양인지 알아내는 개발용이며, 메인 스레드에서만 쓴다.
/// </summary>
internal static unsafe class Il2
{
    private const int FieldStatic = 0x10;
    private const int FieldLiteral = 0x40;
    private const int MethodStatic = 0x10;
    private const int MethodVirtual = 0x40;

    private static readonly Dictionary<IntPtr, string> ClassNames = new();
    private static readonly Dictionary<IntPtr, IntPtr> TextGetters = new();
    private static readonly Dictionary<IntPtr, Dictionary<long, string>> EnumNames = new();

    private static string Utf8(IntPtr text) => text == IntPtr.Zero ? "" : Marshal.PtrToStringUTF8(text) ?? "";

    // ── 이름 ──────────────────────────────────────────────

    public static IntPtr ClassOf(IntPtr obj) => IL2CPP.il2cpp_object_get_class(obj);

    public static string ClassName(IntPtr klass)
    {
        if (klass == IntPtr.Zero) return "?";
        if (ClassNames.TryGetValue(klass, out var known)) return known;
        var name = Utf8(IL2CPP.il2cpp_class_get_name(klass));
        var space = Utf8(IL2CPP.il2cpp_class_get_namespace(klass));
        var outer = IL2CPP.il2cpp_class_get_declaring_type(klass);
        var full = outer != IntPtr.Zero ? ClassName(outer) + "+" + name : space.Length > 0 ? space + "." + name : name;
        ClassNames[klass] = full;
        return full;
    }

    public static string TypeName(IntPtr type) => type == IntPtr.Zero ? "?" : Utf8(IL2CPP.il2cpp_type_get_name(type));

    // ── 클래스 안의 것들 ──────────────────────────────────

    private static List<IntPtr> Fields(IntPtr klass)
    {
        var list = new List<IntPtr>();
        var iterator = IntPtr.Zero;
        IntPtr field;
        while ((field = IL2CPP.il2cpp_class_get_fields(klass, ref iterator)) != IntPtr.Zero) list.Add(field);
        return list;
    }

    private static List<IntPtr> Properties(IntPtr klass)
    {
        var list = new List<IntPtr>();
        var iterator = IntPtr.Zero;
        IntPtr property;
        while ((property = IL2CPP.il2cpp_class_get_properties(klass, ref iterator)) != IntPtr.Zero) list.Add(property);
        return list;
    }

    private static List<IntPtr> Methods(IntPtr klass)
    {
        var list = new List<IntPtr>();
        var iterator = IntPtr.Zero;
        IntPtr method;
        while ((method = IL2CPP.il2cpp_class_get_methods(klass, ref iterator)) != IntPtr.Zero) list.Add(method);
        return list;
    }

    private static List<IntPtr> Chain(IntPtr klass)
    {
        var list = new List<IntPtr>();
        for (var k = klass; k != IntPtr.Zero && list.Count < 64; k = IL2CPP.il2cpp_class_get_parent(k)) list.Add(k);
        return list;
    }

    public static IntPtr FindMethod(IntPtr klass, string name, int argumentCount)
    {
        foreach (var k in Chain(klass))
        {
            var method = IL2CPP.il2cpp_class_get_method_from_name(k, name, argumentCount);
            if (method != IntPtr.Zero) return method;
        }
        return IntPtr.Zero;
    }

    private static readonly Dictionary<(IntPtr, string), IntPtr> FoundFields = new();

    private static IntPtr FindField(IntPtr klass, string name)
    {
        if (FoundFields.TryGetValue((klass, name), out var known)) return known;
        var found = IntPtr.Zero;
        foreach (var k in Chain(klass))
        {
            foreach (var field in Fields(k))
            {
                if (Utf8(IL2CPP.il2cpp_field_get_name(field)) != name) continue;
                found = field;
                break;
            }
            if (found != IntPtr.Zero) break;
        }
        FoundFields[(klass, name)] = found;
        return found;
    }

    private static bool IsStaticField(IntPtr field) => (IL2CPP.il2cpp_field_get_flags(field) & FieldStatic) != 0;

    private static bool IsLiteralField(IntPtr field) => (IL2CPP.il2cpp_field_get_flags(field) & FieldLiteral) != 0;

    private static int MethodFlags(IntPtr method)
    {
        uint implementation = 0;
        return (int)IL2CPP.il2cpp_method_get_flags(method, ref implementation);
    }

    private static int ValueSize(IntPtr klass)
    {
        uint align = 0;
        return (int)IL2CPP.il2cpp_class_value_size(klass, ref align);
    }

    // ── 글자 읽기 ─────────────────────────────────────────

    /// <summary>객체에 문자열 속성 text가 있으면 그 값을 준다(라벨·버튼 등).</summary>
    public static string TextOf(IntPtr obj)
    {
        var klass = ClassOf(obj);
        if (!TextGetters.TryGetValue(klass, out var getter))
        {
            getter = FindMethod(klass, "get_text", 0);
            if (getter != IntPtr.Zero && TypeName(IL2CPP.il2cpp_method_get_return_type(getter)) != "System.String")
                getter = IntPtr.Zero;
            TextGetters[klass] = getter;
        }
        if (getter == IntPtr.Zero) return null;
        var exception = IntPtr.Zero;
        var result = IL2CPP.il2cpp_runtime_invoke(getter, obj, (void**)0, ref exception);
        if (exception != IntPtr.Zero || result == IntPtr.Zero) return null;
        return IL2CPP.Il2CppStringToManaged(result);
    }

    // ── 값을 글로 ─────────────────────────────────────────

    public static string Quote(string text, int max = 400)
    {
        if (text == null) return "null";
        var cut = text.Length > max ? text[..max] + "…" : text;
        return "\"" + cut.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n") + "\"";
    }

    private static long ReadInteger(byte* data, int size) => size switch
    {
        1 => *data,
        2 => *(short*)data,
        4 => *(int*)data,
        _ => *(long*)data
    };

    private static Dictionary<long, string> EnumMap(IntPtr klass)
    {
        if (EnumNames.TryGetValue(klass, out var map)) return map;
        map = new Dictionary<long, string>();
        var size = ValueSize(klass);
        foreach (var field in Fields(klass))
        {
            if (!IsLiteralField(field)) continue;
            long raw = 0;
            IL2CPP.il2cpp_field_static_get_value(field, &raw);
            map.TryAdd(ReadInteger((byte*)&raw, size), Utf8(IL2CPP.il2cpp_field_get_name(field)));
        }
        EnumNames[klass] = map;
        return map;
    }

    /// <summary>객체 하나를 한 줄로. 문자열·숫자는 값을, 그 밖의 것은 종류와 번호표를 적는다.</summary>
    public static string Format(IntPtr obj)
    {
        if (obj == IntPtr.Zero) return "null";
        var klass = ClassOf(obj);
        var name = ClassName(klass);
        if (name == "System.String") return Quote(IL2CPP.Il2CppStringToManaged(obj));
        if (!IL2CPP.il2cpp_class_is_valuetype(klass)) return $"{name} #{Handles.Add(obj)}";

        var data = (byte*)IL2CPP.il2cpp_object_unbox(obj);
        if (IL2CPP.il2cpp_class_is_enum(klass))
        {
            var value = ReadInteger(data, ValueSize(klass));
            return EnumMap(klass).TryGetValue(value, out var label) ? $"{name}.{label} ({value})" : $"{name} ({value})";
        }
        switch (name)
        {
            case "System.Boolean": return *data != 0 ? "true" : "false";
            case "System.Byte": return (*data).ToString();
            case "System.SByte": return (*(sbyte*)data).ToString();
            case "System.Int16": return (*(short*)data).ToString();
            case "System.UInt16": return (*(ushort*)data).ToString();
            case "System.Int32": return (*(int*)data).ToString();
            case "System.UInt32": return (*(uint*)data).ToString();
            case "System.Int64": return (*(long*)data).ToString();
            case "System.UInt64": return (*(ulong*)data).ToString();
            case "System.Single": return (*(float*)data).ToString("R", CultureInfo.InvariantCulture);
            case "System.Double": return (*(double*)data).ToString("R", CultureInfo.InvariantCulture);
            case "System.Char": return Quote(((char)*(ushort*)data).ToString());
            case "System.IntPtr": return "0x" + ((long)*(IntPtr*)data).ToString("X");
            default: return $"{name} (struct) #{Handles.Add(obj)}";
        }
    }

    /// <summary>값을 꺼내도 안전한 종류인지(포인터·참조 전달·제네릭 자리표시는 건드리지 않는다).</summary>
    private static bool Readable(IntPtr type)
    {
        var kind = IL2CPP.il2cpp_type_get_type(type);
        if (kind is 0x0f or 0x10 or 0x13 or 0x1b or 0x1e) return false;
        var name = TypeName(type);
        return !name.EndsWith("*") && !name.EndsWith("&");
    }

    private static string FieldValue(IntPtr field, IntPtr obj, IntPtr klass)
    {
        var type = IL2CPP.il2cpp_field_get_type(field);
        if (!Readable(type)) return "(unreadable)";
        if (!IsStaticField(field))
            return obj == IntPtr.Zero ? "(instance)" : Format(IL2CPP.il2cpp_field_get_value_object(field, obj));

        if (IL2CPP.il2cpp_class_is_generic(klass)) return "(open generic)";
        if ((int)IL2CPP.il2cpp_field_get_offset(field) == -1 && !IsLiteralField(field)) return "(thread static)";
        var fieldClass = IL2CPP.il2cpp_class_from_type(type);
        if (IL2CPP.il2cpp_class_is_valuetype(fieldClass))
        {
            var size = Math.Max(ValueSize(fieldClass), 8);
            if (size > 256) return "(large struct)";
            var buffer = stackalloc byte[size];
            IL2CPP.il2cpp_field_static_get_value(field, buffer);
            return Format(IL2CPP.il2cpp_value_box(fieldClass, (IntPtr)buffer));
        }
        var pointer = IntPtr.Zero;
        IL2CPP.il2cpp_field_static_get_value(field, &pointer);
        return Format(pointer);
    }

    // ── 대상 찾기 ─────────────────────────────────────────

    private readonly struct Target
    {
        public readonly IntPtr Obj;
        public readonly IntPtr Klass;

        public Target(IntPtr obj, IntPtr klass)
        {
            Obj = obj;
            Klass = klass;
        }
    }

    /// <summary>"#12"·"12"는 번호표가 붙은 객체, "type:이름"은 클래스 자체(정적 멤버).</summary>
    private static Target Resolve(string id)
    {
        if (id.StartsWith("type:")) return new Target(IntPtr.Zero, FindClass(id[5..]));
        if (!int.TryParse(id.TrimStart('#'), out var number)) throw new HttpError(400, "id must be a number or type:Full.Name");
        var obj = Handles.Get(number);
        return new Target(obj, ClassOf(obj));
    }

    private static List<IntPtr> Images()
    {
        var list = new List<IntPtr>();
        uint count = 0;
        var assemblies = IL2CPP.il2cpp_domain_get_assemblies(IL2CPP.il2cpp_domain_get(), ref count);
        for (var i = 0; i < count; i++) list.Add(IL2CPP.il2cpp_assembly_get_image(assemblies[i]));
        return list;
    }

    public static IntPtr FindClass(string fullName)
    {
        var dot = fullName.LastIndexOf('.');
        var space = dot < 0 ? "" : fullName[..dot];
        var name = dot < 0 ? fullName : fullName[(dot + 1)..];
        foreach (var image in Images())
        {
            var klass = IL2CPP.il2cpp_class_from_name(image, space, name);
            if (klass != IntPtr.Zero) return klass;
        }
        throw new HttpError(404, $"no class '{fullName}' (nested classes: use /classes to find, then reach through an object)");
    }

    // ── 조회 ──────────────────────────────────────────────

    private static string Signature(IntPtr method)
    {
        var text = new StringBuilder();
        if ((MethodFlags(method) & MethodStatic) != 0) text.Append("static ");
        text.Append(TypeName(IL2CPP.il2cpp_method_get_return_type(method))).Append(' ');
        text.Append(Utf8(IL2CPP.il2cpp_method_get_name(method))).Append('(');
        var count = (int)IL2CPP.il2cpp_method_get_param_count(method);
        for (var i = 0; i < count; i++)
        {
            if (i > 0) text.Append(", ");
            text.Append(TypeName(IL2CPP.il2cpp_method_get_param(method, (uint)i))).Append(' ');
            text.Append(Utf8(IL2CPP.il2cpp_method_get_param_name(method, (uint)i)));
        }
        return text.Append(')').ToString();
    }

    private static bool IsFrameworkBase(string className) =>
        className is "System.Object" or "UnityEngine.Object" or "UnityEngine.Component" or "UnityEngine.Behaviour"
            or "UnityEngine.MonoBehaviour" or "UnityEngine.UIElements.VisualElement" or "UnityEngine.UIElements.Focusable"
            or "UnityEngine.UIElements.CallbackEventHandler" or "UnityEngine.UIElements.BindableElement";

    /// <summary>
    /// 객체(또는 클래스)의 구성. 필드는 값까지, 속성과 메서드는 이름만 적는다.
    /// values=1이면 인자 없는 속성도 읽어 본다. deep=1이면 Unity 기본 클래스까지 내려간다.
    /// </summary>
    public static string Inspect(string id, bool values, bool deep)
    {
        var target = Resolve(id);
        var text = new StringBuilder();
        var chain = Chain(target.Klass);
        text.Append(string.Join(" : ", chain.Select(ClassName))).Append('\n');
        if (target.Obj != IntPtr.Zero)
        {
            var label = TextOf(target.Obj);
            if (label != null) text.Append("text = ").Append(Quote(label)).Append('\n');
        }

        foreach (var klass in chain)
        {
            var className = ClassName(klass);
            if (!deep && klass != target.Klass && IsFrameworkBase(className)) break;
            text.Append("\n== ").Append(className).Append('\n');

            foreach (var field in Fields(klass))
            {
                var isStatic = IsStaticField(field);
                if (isStatic && target.Obj != IntPtr.Zero && !values && !IsLiteralField(field))
                {
                    text.Append("  static ").Append(TypeName(IL2CPP.il2cpp_field_get_type(field))).Append(' ')
                        .Append(Utf8(IL2CPP.il2cpp_field_get_name(field))).Append('\n');
                    continue;
                }
                text.Append(isStatic ? "  static " : "  ");
                text.Append(TypeName(IL2CPP.il2cpp_field_get_type(field))).Append(' ');
                text.Append(Utf8(IL2CPP.il2cpp_field_get_name(field))).Append(" = ");
                text.Append(FieldValue(field, target.Obj, klass)).Append('\n');
            }

            foreach (var property in Properties(klass))
            {
                var getter = IL2CPP.il2cpp_property_get_get_method(property);
                if (getter == IntPtr.Zero) continue;
                var isStatic = (MethodFlags(getter) & MethodStatic) != 0;
                text.Append(isStatic ? "  static prop " : "  prop ");
                text.Append(TypeName(IL2CPP.il2cpp_method_get_return_type(getter))).Append(' ');
                text.Append(Utf8(IL2CPP.il2cpp_property_get_name(property)));
                var canRead = IL2CPP.il2cpp_method_get_param_count(getter) == 0 && (isStatic || target.Obj != IntPtr.Zero);
                if (values && canRead && Readable(IL2CPP.il2cpp_method_get_return_type(getter)))
                    text.Append(" = ").Append(InvokeToText(getter, target.Obj, Array.Empty<string>()));
                text.Append('\n');
            }

            foreach (var method in Methods(klass))
            {
                var name = Utf8(IL2CPP.il2cpp_method_get_name(method));
                if (name.StartsWith("get_") || name.StartsWith("set_")) continue;
                text.Append("  fn ").Append(Signature(method)).Append('\n');
            }
        }
        return text.ToString();
    }

    /// <summary>필드·속성을 읽거나 메서드를 부른다. 결과가 객체면 번호표를 붙여 준다.</summary>
    public static string Member(string id, string member, string[] arguments)
    {
        var target = Resolve(id);
        if (arguments.Length == 0)
        {
            var field = FindField(target.Klass, member);
            if (field != IntPtr.Zero) return FieldValue(field, target.Obj, target.Klass);
            var getter = FindMethod(target.Klass, "get_" + member, 0);
            if (getter != IntPtr.Zero) return InvokeToText(getter, target.Obj, arguments);
        }
        var method = FindMethod(target.Klass, member, arguments.Length);
        if (method == IntPtr.Zero) throw new HttpError(404, $"no member '{member}' taking {arguments.Length} argument(s)");
        return InvokeToText(method, target.Obj, arguments);
    }

    /// <summary>배열·목록의 내용을 번호와 함께 적는다.</summary>
    public static string List(string id, int max)
    {
        var target = Resolve(id);
        if (target.Obj == IntPtr.Zero) throw new HttpError(400, "need an object");
        var text = new StringBuilder();
        var className = ClassName(target.Klass);

        if (className.EndsWith("[]"))
        {
            var length = (int)IL2CPP.il2cpp_array_length(target.Obj);
            var element = IL2CPP.il2cpp_class_get_element_class(target.Klass);
            var isValue = IL2CPP.il2cpp_class_is_valuetype(element);
            var size = isValue ? ValueSize(element) : IntPtr.Size;
            var data = (byte*)target.Obj + IntPtr.Size * 4;
            text.Append($"{className} length={length}\n");
            for (var i = 0; i < length && i < max; i++)
            {
                var slot = data + (long)i * size;
                var item = isValue ? IL2CPP.il2cpp_value_box(element, (IntPtr)slot) : *(IntPtr*)slot;
                text.Append($"  [{i}] {Format(item)}\n");
            }
            return text.ToString();
        }

        var counter = FindMethod(target.Klass, "get_Count", 0);
        var indexer = FindMethod(target.Klass, "get_Item", 1);
        if (counter != IntPtr.Zero && indexer != IntPtr.Zero &&
            TypeName(IL2CPP.il2cpp_method_get_param(indexer, 0)) == "System.Int32")
        {
            var boxed = Invoke(counter, target.Obj, Array.Empty<string>(), out var error);
            if (error != null) return error;
            var count = *(int*)IL2CPP.il2cpp_object_unbox(boxed);
            text.Append($"{className} count={count}\n");
            for (var i = 0; i < count && i < max; i++)
                text.Append($"  [{i}] {InvokeToText(indexer, target.Obj, new[] { i.ToString() })}\n");
            return text.ToString();
        }

        var enumerate = FindMethod(target.Klass, "GetEnumerator", 0);
        if (enumerate == IntPtr.Zero) throw new HttpError(400, $"{className} is not a list");
        var enumerator = Invoke(enumerate, target.Obj, Array.Empty<string>(), out var failure);
        if (failure != null) return failure;
        if (enumerator == IntPtr.Zero) return "null enumerator";
        var enumeratorClass = ClassOf(enumerator);
        var next = FindMethod(enumeratorClass, "MoveNext", 0);
        var current = FindMethod(enumeratorClass, "get_Current", 0);
        if (next == IntPtr.Zero || current == IntPtr.Zero) throw new HttpError(400, "enumerator has no MoveNext/Current");
        text.Append($"{className} (enumerated)\n");
        for (var i = 0; i < max; i++)
        {
            var moved = Invoke(next, enumerator, Array.Empty<string>(), out failure);
            if (failure != null) return text.Append(failure).ToString();
            if (moved == IntPtr.Zero || *(byte*)IL2CPP.il2cpp_object_unbox(moved) == 0) break;
            text.Append($"  [{i}] {InvokeToText(current, enumerator, Array.Empty<string>())}\n");
        }
        return text.ToString();
    }

    /// <summary>지금 살아 있는 Unity 객체를 종류로 찾는다(꺼져 있는 것 포함).</summary>
    public static string FindObjects(string typeName, int max)
    {
        var klass = FindClass(typeName);
        var type = new Il2CppSystem.Type(IL2CPP.il2cpp_type_get_object(IL2CPP.il2cpp_class_get_type(klass)));
        var found = UnityEngine.Resources.FindObjectsOfTypeAll(type);
        var text = new StringBuilder($"{found.Length} object(s) of {typeName}\n");
        for (var i = 0; i < found.Length && i < max; i++)
        {
            var item = found[i];
            if (item == null) continue;
            text.Append($"  {Format(item.Pointer)} name={Quote(item.name)}\n");
        }
        return text.ToString();
    }

    private static readonly Dictionary<string, Il2CppSystem.Type> UnityTypes = new();

    /// <summary>지금 살아 있는 Unity 객체 하나를 종류 이름으로 찾는다. 없으면 0.</summary>
    public static IntPtr FindUnityObject(string typeName)
    {
        if (!UnityTypes.TryGetValue(typeName, out var type))
        {
            var klass = FindClass(typeName);
            type = new Il2CppSystem.Type(IL2CPP.il2cpp_type_get_object(IL2CPP.il2cpp_class_get_type(klass)));
            UnityTypes[typeName] = type;
        }
        var found = UnityEngine.Resources.FindObjectsOfTypeAll(type);
        for (var i = 0; i < found.Length; i++)
            if (found[i] != null)
                return found[i].Pointer;
        return IntPtr.Zero;
    }

    /// <summary>
    /// 메서드를 이름으로 부르고 돌려준 객체를 준다(값 종류는 상자에 담겨 온다). 인자는 글로 넘긴다.
    /// 게임 쪽에서 예외가 나면 그 내용을 던진다.
    /// </summary>
    public static IntPtr CallObject(IntPtr obj, string method, params string[] arguments)
    {
        var found = FindMethod(ClassOf(obj), method, arguments.Length);
        if (found == IntPtr.Zero) throw new MissingMethodException(method);
        var result = Invoke(found, obj, arguments, out var error);
        if (error != null) throw new InvalidOperationException(error);
        return result;
    }

    public static void Call(IntPtr obj, string method, params string[] arguments) => CallObject(obj, method, arguments);

    public static bool CallBool(IntPtr obj, string method, params string[] arguments)
    {
        var result = CallObject(obj, method, arguments);
        return result != IntPtr.Zero && *(byte*)IL2CPP.il2cpp_object_unbox(result) != 0;
    }

    /// <summary>객체의 필드에 든 객체. 없으면 0.</summary>
    public static IntPtr FieldObject(IntPtr obj, string name)
    {
        var field = FindField(ClassOf(obj), name);
        return field == IntPtr.Zero ? IntPtr.Zero : IL2CPP.il2cpp_field_get_value_object(field, obj);
    }

    /// <summary>클래스의 정적 필드에 든 객체. 없으면 0.</summary>
    public static IntPtr StaticObject(string className, string fieldName)
    {
        var field = FindField(FindClass(className), fieldName);
        if (field == IntPtr.Zero || !IsStaticField(field)) return IntPtr.Zero;
        var pointer = IntPtr.Zero;
        IL2CPP.il2cpp_field_static_get_value(field, &pointer);
        return pointer;
    }

    /// <summary>게임 쪽 문자열 객체를 글자로. 문자열이 아니면 null.</summary>
    public static string Str(IntPtr obj) =>
        obj != IntPtr.Zero && ClassName(ClassOf(obj)) == "System.String" ? IL2CPP.Il2CppStringToManaged(obj) : null;

    /// <summary>목록(Count와 [번호]가 있는 것)의 내용. 목록이 아니면 빈 목록.</summary>
    public static List<IntPtr> Items(IntPtr list, int max)
    {
        var items = new List<IntPtr>();
        if (list == IntPtr.Zero) return items;
        var klass = ClassOf(list);
        var counter = FindMethod(klass, "get_Count", 0);
        var indexer = FindMethod(klass, "get_Item", 1);
        if (counter == IntPtr.Zero || indexer == IntPtr.Zero) return items;
        if (TypeName(IL2CPP.il2cpp_method_get_param(indexer, 0)) != "System.Int32") return items;
        var boxed = Invoke(counter, list, Array.Empty<string>(), out var error);
        if (error != null || boxed == IntPtr.Zero) return items;
        var count = *(int*)IL2CPP.il2cpp_object_unbox(boxed);
        for (var i = 0; i < count && i < max; i++)
        {
            var item = Invoke(indexer, list, new[] { i.ToString() }, out error);
            if (error != null) break;
            items.Add(item);
        }
        return items;
    }

    private static readonly Dictionary<IntPtr, List<(IntPtr field, string name, int kind)>> PathFields = new();

    /// <summary>
    /// 화면 요소가 데이터 나무의 어느 경로에서 값을 받는지("text=row.Player.InitialSurname").
    /// 요소의 필드 가운데 경로를 담는 것(BindingMethod, DirectBinding, BindingPath, 이름에 path가 든 문자열)을 읽는다.
    /// </summary>
    public static string BindingPaths(IntPtr obj)
    {
        var klass = ClassOf(obj);
        if (!PathFields.TryGetValue(klass, out var fields))
        {
            fields = new List<(IntPtr, string, int)>();
            foreach (var k in Chain(klass))
            {
                var owner = ClassName(k);
                if (owner.StartsWith("UnityEngine.") || owner == "System.Object") break;
                foreach (var field in Fields(k))
                {
                    if (IsStaticField(field)) continue;
                    var type = TypeName(IL2CPP.il2cpp_field_get_type(field));
                    var name = Utf8(IL2CPP.il2cpp_field_get_name(field));
                    var kind = type.StartsWith("SI.Bindable.BindingMethod") ? 1
                        : type == "SI.Bindable.DirectBinding" ? 2
                        : type == "SI.Bindable.BindingPath" ? 3
                        : type == "System.String" && name.Contains("path", StringComparison.OrdinalIgnoreCase) ? 4
                        : 0;
                    if (kind != 0) fields.Add((field, name, kind));
                }
            }
            PathFields[klass] = fields;
        }
        if (fields.Count == 0) return "";

        var text = new StringBuilder();
        foreach (var (field, name, kind) in fields)
        {
            try
            {
                var value = IL2CPP.il2cpp_field_get_value_object(field, obj);
                if (kind == 1 && value != IntPtr.Zero) value = FieldObject(value, "m_direct");
                if (kind is 1 or 2 && value != IntPtr.Zero) value = FieldObject(value, "Path");
                if (kind is 1 or 2 or 3 && value != IntPtr.Zero) value = FieldObject(value, "m_path");
                var path = Str(value);
                if (string.IsNullOrEmpty(path)) continue;
                var label = name.TrimStart('m', '_');
                text.Append(' ').Append(label.Length > 0 ? label : name).Append('=').Append(path);
            }
            catch
            {
                // 읽을 수 없는 필드는 건너뛴다
            }
        }
        return text.ToString();
    }

    /// <summary>모음(사전 등, GetEnumerator가 있는 것)을 돌며 항목을 준다. 값 종류 항목은 상자에 담겨 온다.</summary>
    public static List<IntPtr> Enumerate(IntPtr collection, int max)
    {
        var items = new List<IntPtr>();
        if (collection == IntPtr.Zero) return items;
        var enumerate = FindMethod(ClassOf(collection), "GetEnumerator", 0);
        if (enumerate == IntPtr.Zero) return items;
        var enumerator = Invoke(enumerate, collection, Array.Empty<string>(), out var error);
        if (error != null || enumerator == IntPtr.Zero) return items;
        var klass = ClassOf(enumerator);
        var next = FindMethod(klass, "MoveNext", 0);
        var current = FindMethod(klass, "get_Current", 0);
        if (next == IntPtr.Zero || current == IntPtr.Zero) return items;
        while (items.Count < max)
        {
            var moved = Invoke(next, enumerator, Array.Empty<string>(), out error);
            if (error != null || moved == IntPtr.Zero || *(byte*)IL2CPP.il2cpp_object_unbox(moved) == 0) break;
            var item = Invoke(current, enumerator, Array.Empty<string>(), out error);
            if (error != null) break;
            items.Add(item);
        }
        return items;
    }

    /// <summary>클래스의 정적 메서드를 부른다(인자는 글로). 돌려준 객체를 준다. 게임 쪽 예외는 던진다.</summary>
    public static IntPtr CallStatic(IntPtr klass, string method, params string[] arguments)
    {
        var found = FindMethod(klass, method, arguments.Length);
        if (found == IntPtr.Zero) throw new MissingMethodException(method);
        var result = Invoke(found, IntPtr.Zero, arguments, out var error);
        if (error != null) throw new InvalidOperationException(error);
        return result;
    }

    /// <summary>상자에 담긴 참·거짓을 꺼낸다.</summary>
    public static bool Bool(IntPtr boxed) => boxed != IntPtr.Zero && *(byte*)IL2CPP.il2cpp_object_unbox(boxed) != 0;

    /// <summary>상자에 담긴 부호 없는 32비트 수(또는 그것 하나만 든 구조체)를 꺼낸다.</summary>
    public static uint Uint(IntPtr boxed) => boxed == IntPtr.Zero ? 0 : *(uint*)IL2CPP.il2cpp_object_unbox(boxed);

    /// <summary>이름이 정규식에 맞는 클래스를 모든 어셈블리에서 찾는다.</summary>
    public static string Classes(string pattern, int max)
    {
        var regex = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var text = new StringBuilder();
        var hits = 0;
        foreach (var image in Images())
        {
            var imageName = Utf8(IL2CPP.il2cpp_image_get_name(image));
            var count = (int)IL2CPP.il2cpp_image_get_class_count(image);
            for (var i = 0; i < count; i++)
            {
                var klass = IL2CPP.il2cpp_image_get_class(image, (uint)i);
                if (klass == IntPtr.Zero) continue;
                var name = ClassName(klass);
                if (!regex.IsMatch(name)) continue;
                if (++hits > max) return text.Append($"… more than {max}\n").ToString();
                text.Append(name).Append("   [").Append(imageName).Append("]\n");
            }
        }
        return text.Append($"{hits} class(es)\n").ToString();
    }

    // ── 부르기 ────────────────────────────────────────────

    private static string InvokeToText(IntPtr method, IntPtr obj, string[] arguments)
    {
        var result = Invoke(method, obj, arguments, out var error);
        if (error != null) return error;
        return TypeName(IL2CPP.il2cpp_method_get_return_type(method)) == "System.Void" ? "void" : Format(result);
    }

    private static string DescribeException(IntPtr exception)
    {
        var klass = ClassOf(exception);
        var message = "";
        var getter = FindMethod(klass, "get_Message", 0);
        if (getter != IntPtr.Zero)
        {
            var failed = IntPtr.Zero;
            var text = IL2CPP.il2cpp_runtime_invoke(IL2CPP.il2cpp_object_get_virtual_method(exception, getter), exception, (void**)0, ref failed);
            if (failed == IntPtr.Zero && text != IntPtr.Zero) message = IL2CPP.Il2CppStringToManaged(text) ?? "";
        }
        return $"EXCEPTION {ClassName(klass)}: {message}";
    }

    /// <summary>
    /// 메서드를 부른다. 인자는 글로 받아 매개변수 종류에 맞게 바꾼다:
    /// 문자열·숫자·true/false·열거형(이름 또는 숫자)·null·"#번호"(번호표가 붙은 객체).
    /// </summary>
    private static IntPtr Invoke(IntPtr method, IntPtr obj, string[] arguments, out string error)
    {
        error = null;
        var flags = MethodFlags(method);
        var self = IntPtr.Zero;
        if ((flags & MethodStatic) == 0)
        {
            if (obj == IntPtr.Zero)
            {
                error = "ERROR instance member needs an object";
                return IntPtr.Zero;
            }
            var objectIsValue = IL2CPP.il2cpp_class_is_valuetype(ClassOf(obj));
            if (!objectIsValue && (flags & MethodVirtual) != 0) method = IL2CPP.il2cpp_object_get_virtual_method(obj, method);
            var ownerIsValue = IL2CPP.il2cpp_class_is_valuetype(IL2CPP.il2cpp_method_get_class(method));
            self = objectIsValue && ownerIsValue ? IL2CPP.il2cpp_object_unbox(obj) : obj;
        }

        var count = (int)IL2CPP.il2cpp_method_get_param_count(method);
        if (count != arguments.Length)
        {
            error = $"ERROR expected {count} argument(s)";
            return IntPtr.Zero;
        }
        var parameters = stackalloc void*[Math.Max(count, 1)];
        var slots = stackalloc long[Math.Max(count, 1)];
        for (var i = 0; i < count; i++)
        {
            var type = IL2CPP.il2cpp_method_get_param(method, (uint)i);
            var typeName = TypeName(type);
            var given = arguments[i];
            if (!Readable(type))
            {
                error = $"ERROR parameter {i} ({typeName}) is not supported";
                return IntPtr.Zero;
            }
            var klass = IL2CPP.il2cpp_class_from_type(type);
            var isValue = IL2CPP.il2cpp_class_is_valuetype(klass);

            if (given.StartsWith("#") && int.TryParse(given[1..], out var handle))
            {
                var pointer = Handles.Get(handle);
                parameters[i] = isValue ? (void*)IL2CPP.il2cpp_object_unbox(pointer) : (void*)pointer;
                continue;
            }
            if (!isValue)
            {
                if (given == "null") parameters[i] = null;
                else if (typeName is "System.String" or "System.Object") parameters[i] = (void*)IL2CPP.ManagedStringToIl2Cpp(given);
                else
                {
                    error = $"ERROR parameter {i} ({typeName}) needs #id or null";
                    return IntPtr.Zero;
                }
                continue;
            }

            slots[i] = 0;
            var slot = (byte*)&slots[i];
            var invariant = CultureInfo.InvariantCulture;
            var ok = true;
            if (IL2CPP.il2cpp_class_is_enum(klass))
            {
                if (long.TryParse(given, out var number)) slots[i] = number;
                else
                {
                    var match = EnumMap(klass).FirstOrDefault(pair => string.Equals(pair.Value, given, StringComparison.OrdinalIgnoreCase));
                    ok = match.Value != null;
                    slots[i] = match.Key;
                }
            }
            else
            {
                switch (typeName)
                {
                    case "System.Boolean":
                        *slot = (byte)(given is "true" or "1" ? 1 : 0);
                        break;
                    case "System.Single":
                        ok = float.TryParse(given, NumberStyles.Float, invariant, out var single);
                        *(float*)slot = single;
                        break;
                    case "System.Double":
                        ok = double.TryParse(given, NumberStyles.Float, invariant, out var real);
                        *(double*)slot = real;
                        break;
                    case "System.Byte" or "System.SByte" or "System.Int16" or "System.UInt16" or "System.Int32"
                        or "System.UInt32" or "System.Int64" or "System.UInt64" or "System.Char":
                        ok = long.TryParse(given, NumberStyles.Integer, invariant, out var whole);
                        slots[i] = whole;
                        break;
                    default:
                        ok = false;
                        break;
                }
            }
            if (!ok)
            {
                error = $"ERROR cannot turn '{given}' into {typeName} (parameter {i})";
                return IntPtr.Zero;
            }
            parameters[i] = slot;
        }

        var exception = IntPtr.Zero;
        var result = IL2CPP.il2cpp_runtime_invoke(method, self, parameters, ref exception);
        if (exception != IntPtr.Zero)
        {
            error = DescribeException(exception);
            return IntPtr.Zero;
        }
        return result;
    }
}
