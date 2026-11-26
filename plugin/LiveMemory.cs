using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace FmBojwagwan.Bridge;

/// <summary>
/// 켜져 있는 게임의 메모리에서 선수 기록을 찾아 읽고 고친다(앱의 스쿼드·영입 후보·에디터가 쓰는 "지금 값").
///
/// 선수 기록의 생김새(26.3.2에서 켜진 게임의 메모리를 세이브와 대조해 확인. 선수 약 10만 명 중 99.6%가 맞았다):
///   [포인터 8바이트 — 모든 선수가 같은 값][숙련도 15바이트(1~20)][능력치 54바이트(1~100)] …
///   숙련도가 시작하는 곳을 0으로 보면: 현재 능력 u16은 +0x114, 잠재 능력 u16은 +0x116,
///   그 뒤에 그 선수의 인물 기록이 온다: [포인터 8바이트 — 선수끼리 같은 값][색인 u32][고유 번호 u32][같은 번호 u32].
///   인물 기록은 보통 +0x138에서 시작하고(번호는 +0x144), 코치를 겸하는 선수는 +0x230에서 시작한다(번호는 +0x23C).
/// 세이브 파일에서는 순서가 달라서(번호가 능력치 앞에 있는 것은 앞 사람의 번호다) 세이브의 배치를 그대로 쓰면 안 된다.
///
/// 포인터 값은 게임을 켤 때마다 달라지므로, 훑으면서 가장 흔한 값을 "선수의 값"으로 삼는다.
/// 숙련도·능력치·능력 값이 모두 제 범위이고, 세 포인터가 그 흔한 값이며, 번호가 두 번 똑같이 적힌 곳만 선수 기록으로 본다.
///
/// 처음 한 번 메모리 전체를 훑어 모든 선수 기록의 위치를 적어 두고(몇 초 걸린다), 그 뒤로는 적어 둔 자리만 다시 읽는다.
/// 읽기와 쓰기는 운영체제의 ReadProcessMemory·WriteProcessMemory로 한다(우리 자신의 프로세스).
/// 그 사이 게임이 그 메모리를 놓아도 오류로 끝날 뿐 게임이 죽지 않는다. 화면 스레드를 붙잡지 않도록 요청을 받은 스레드에서 돈다.
/// 고치는 것은 확인된 기록 안의 정해진 자리뿐이고, 값의 범위를 먼저 본다. 같은 번호의 기록이 둘 이상이면 쓰지 않는다.
/// </summary>
internal static unsafe class LiveMemory
{
    private const int Positions = 15;
    private const int Attributes = 54;
    /// <summary>숙련도 앞에 붙은 포인터의 크기. 기록을 읽을 때는 여기서부터 읽는다</summary>
    private const int Lead = 8;
    private const int CaAt = 0x114;
    private const int PaAt = 0x116;
    /// <summary>인물 기록이 시작하는 곳: 보통 선수, 코치를 겸하는 선수</summary>
    private const int PersonAt = 0x138;
    private const int PersonAtStaff = 0x230;
    /// <summary>인물 기록 안에서 고유 번호가 적힌 곳(포인터 8 + 색인 4 뒤)</summary>
    private const int UidInPerson = 12;
    /// <summary>기록 하나를 확인하려고 읽는 길이: 앞 포인터부터 가장 먼 번호의 끝까지</summary>
    private const int RecordSpan = Lead + PersonAtStaff + UidInPerson + 8;
    /// <summary>앱에 넘기는 선수 한 명의 크기: 번호 4 + 현재·잠재 능력 4 + 숙련도 15 + 능력치 54</summary>
    private const int PackedSize = 4 + 4 + Positions + Attributes;

    private const uint MemCommit = 0x1000;
    private const uint MemPrivate = 0x20000;
    private const uint PageReadWrite = 0x04;
    private const int ChunkSize = 16 * 1024 * 1024;
    /// <summary>적어 두지 못한 선수를 찾으려고 메모리를 다시 훑는 것은 이 간격보다 자주 하지 않는다</summary>
    private const int RescanGapMs = 60 * 1000;
    /// <summary>모든 선수를 읽을 때, 이웃한 기록 사이가 이보다 가까우면 한 번에 읽는다</summary>
    private const int BatchGap = 64 * 1024;
    /// <summary>선수 기록이 이만큼은 나와야 제대로 찾은 것으로 본다</summary>
    private const int MinRecords = 500;

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryInfo
    {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public uint Alignment1;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
        public uint Alignment2;
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    private static extern IntPtr VirtualQuery(IntPtr address, out MemoryInfo info, IntPtr length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte* buffer, IntPtr size, out IntPtr read);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte* buffer, IntPtr size, out IntPtr written);

    private static readonly object Gate = new();
    /// <summary>고유 번호 → 기록 위치(숙련도가 시작하는 곳). 번호가 겹치는 기록은 -1</summary>
    private static readonly Dictionary<uint, long> Index = new();
    // 훑으면서 알아낸 "선수의 포인터 값" 셋: 숙련도 앞, 보통 선수의 인물 기록, 코치를 겸하는 선수의 인물 기록
    private static ulong blockMark;
    private static ulong personMark;
    private static ulong staffMark;
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static long indexedAt = -1;
    private static long lastScanMb;
    private static long lastScanMs;

    // 우리가 읽어 온 사본이 다음 훑기에서 "선수 기록"으로 다시 잡히지 않도록, 읽는 그릇은 자리를 아는 것만 쓰고 훑을 때 건너뛴다
    private static byte* chunk;
    private static byte* scratch;

    private static void Prepare()
    {
        if (chunk != null) return;
        chunk = (byte*)NativeMemory.Alloc(ChunkSize);
        scratch = (byte*)NativeMemory.Alloc(RecordSpan);
    }

    private static bool Read(long address, byte* into, int length) =>
        ReadProcessMemory(GetCurrentProcess(), (IntPtr)address, into, (IntPtr)length, out var read) && (long)read == length;

    private static bool Write(long address, byte[] from)
    {
        fixed (byte* buffer = from)
        {
            return WriteProcessMemory(GetCurrentProcess(), (IntPtr)address, buffer, (IntPtr)from.Length, out var written) &&
                   (long)written == from.Length;
        }
    }

    private delegate void ChunkVisitor(long address, byte* data, int length);

    /// <summary>게임이 읽고 쓰는 자기 메모리(힙)를 조각조각 읽어 visit에 넘긴다. 조각은 overlap만큼 겹친다.</summary>
    private static long Walk(int overlap, Func<bool> stop, ChunkVisitor visit)
    {
        Prepare();
        long scanned = 0;
        long address = 0x10000;
        const long end = 0x7FFF_FFFF_0000;
        var ours = (long)chunk;
        var infoSize = (IntPtr)sizeof(MemoryInfo);
        while (address < end && !stop())
        {
            if (VirtualQuery((IntPtr)address, out var info, infoSize) == IntPtr.Zero) break;
            var regionStart = (long)info.BaseAddress;
            var regionSize = (long)info.RegionSize;
            if (regionSize <= 0) break;
            if (info.State == MemCommit && info.Type == MemPrivate && info.Protect == PageReadWrite)
            {
                for (long offset = 0; offset < regionSize && !stop(); offset += ChunkSize - overlap)
                {
                    var length = (int)Math.Min(ChunkSize, regionSize - offset);
                    if (length <= overlap) break;
                    var from = regionStart + offset;
                    // 우리 그릇이 든 자리는 건너뛴다
                    if (from < ours + ChunkSize && from + length > ours) continue;
                    if (!Read(from, chunk, length)) continue;
                    scanned += length;
                    visit(from, chunk, length);
                }
            }
            address = regionStart + regionSize;
        }
        return scanned;
    }

    private static bool InRange(byte* bytes, int count, int min, int max)
    {
        for (var i = 0; i < count; i++)
            if (bytes[i] < min || bytes[i] > max)
                return false;
        return true;
    }

    /// <summary>훑다가 만난, 선수 기록처럼 생긴 곳 하나</summary>
    private struct Candidate
    {
        public long Address;
        public uint Uid;
        public bool Staff;
        public ulong BlockMark;
        public ulong PersonMark;
    }

    /// <summary>
    /// block(숙련도가 시작하는 곳, 앞 8바이트와 뒤 RecordSpan까지 읽을 수 있어야 한다)이 선수 기록의 모양인지.
    /// 맞으면 그 번호와 포인터 값들을 채운다. 포인터 값이 맞는지는 여기서 보지 않는다.
    /// </summary>
    private static bool Shape(byte* block, out Candidate found)
    {
        found = default;
        if (!InRange(block, Positions, 1, 20) || !InRange(block + Positions, Attributes, 1, 100)) return false;
        var ca = *(ushort*)(block + CaAt);
        var pa = *(ushort*)(block + PaAt);
        if (ca < 1 || ca > 200 || pa < 1 || pa > 200) return false;
        found.BlockMark = *(ulong*)(block - Lead);
        if (found.BlockMark == 0) return false;

        var person = block + PersonAt;
        var uid = *(uint*)(person + UidInPerson);
        if (uid == 0 || uid != *(uint*)(person + UidInPerson + 4))
        {
            person = block + PersonAtStaff;
            uid = *(uint*)(person + UidInPerson);
            if (uid == 0 || uid != *(uint*)(person + UidInPerson + 4)) return false;
            found.Staff = true;
        }
        found.Uid = uid;
        found.PersonMark = *(ulong*)person;
        return found.PersonMark != 0;
    }

    /// <summary>모양이 맞고, 포인터 값들도 훑을 때 알아낸 선수의 값과 같은지</summary>
    private static bool Genuine(byte* block, out uint uid)
    {
        uid = 0;
        if (!Shape(block, out var found)) return false;
        if (found.BlockMark != blockMark || found.PersonMark != (found.Staff ? staffMark : personMark)) return false;
        uid = found.Uid;
        return true;
    }

    private static ulong MostCommon(List<Candidate> candidates, Func<Candidate, bool> among, Func<Candidate, ulong> value)
    {
        var counts = new Dictionary<ulong, int>();
        foreach (var candidate in candidates)
        {
            if (!among(candidate)) continue;
            var key = value(candidate);
            counts[key] = counts.TryGetValue(key, out var seen) ? seen + 1 : 1;
        }
        ulong best = 0;
        var most = 0;
        foreach (var (key, count) in counts)
        {
            if (count <= most) continue;
            best = key;
            most = count;
        }
        return best;
    }

    /// <summary>메모리 전체를 훑어 모든 선수 기록의 위치를 적는다.</summary>
    private static void BuildIndex()
    {
        var watch = Stopwatch.StartNew();
        // 방금 읽어 둔 선수의 사본이 "또 하나의 기록"으로 잡히지 않게 비운다
        Prepare();
        new Span<byte>(scratch, RecordSpan).Clear();
        var candidates = new List<Candidate>(140_000);
        var scanned = Walk(RecordSpan, () => false, (address, data, length) =>
        {
            var last = length - (RecordSpan - Lead);
            for (var i = Lead; i <= last; i++)
            {
                // 싼 검사부터: 숙련도의 첫 값
                var first = data[i];
                if (first < 1 || first > 20) continue;
                if (!Shape(data + i, out var found)) continue;
                found.Address = address + i;
                candidates.Add(found);
                i += Positions + Attributes - 1;
            }
        });

        // 선수 기록이 아닌데 우연히 모양이 맞은 곳은 포인터 값이 제각각이다. 가장 흔한 값을 가진 것만 남긴다
        blockMark = MostCommon(candidates, _ => true, c => c.BlockMark);
        personMark = MostCommon(candidates, c => c.BlockMark == blockMark && !c.Staff, c => c.PersonMark);
        staffMark = MostCommon(candidates, c => c.BlockMark == blockMark && c.Staff, c => c.PersonMark);
        Index.Clear();
        var staff = 0;
        foreach (var candidate in candidates)
        {
            if (candidate.BlockMark != blockMark || candidate.PersonMark != (candidate.Staff ? staffMark : personMark)) continue;
            // 조각이 겹치는 곳에서 같은 기록을 두 번 볼 수 있다
            if (Index.TryGetValue(candidate.Uid, out var seen)) Index[candidate.Uid] = seen == candidate.Address ? seen : -1;
            else Index[candidate.Uid] = candidate.Address;
            if (candidate.Staff) staff++;
        }
        indexedAt = Clock.ElapsedMilliseconds;
        lastScanMb = scanned / (1024 * 1024);
        lastScanMs = watch.ElapsedMilliseconds;
        Plugin.Logger.LogInfo(
            $"live memory: {Index.Count} player record(s) ({staff} also staff) of {candidates.Count} look-alike(s), scanned {lastScanMb} MB in {lastScanMs} ms");
    }

    private static void EnsureIndex(bool force = false)
    {
        if (force || indexedAt < 0) BuildIndex();
        // 선수를 거의 못 찾았으면(게임이 아직 세이브를 불러오지 않았을 때) 조금 뒤에 다시 훑는다
        else if (Index.Count < MinRecords && Clock.ElapsedMilliseconds - indexedAt > RescanGapMs) BuildIndex();
    }

    /// <summary>적어 둔 자리에서 이 선수의 기록을 scratch로 읽는다. 자리가 없거나 그새 달라졌으면 false</summary>
    private static bool Load(uint uid, out long address)
    {
        Prepare();
        return Index.TryGetValue(uid, out address) && address > 0 && Read(address - Lead, scratch, RecordSpan) &&
               Genuine(scratch + Lead, out var found) && found == uid;
    }

    /// <summary>이 선수의 기록 수: 1이면 scratch에 그 내용이 있다. 적어 둔 자리가 틀렸으면 한 번 다시 훑는다.</summary>
    private static int Locate(uint uid, out long address)
    {
        EnsureIndex();
        if (Load(uid, out address)) return 1;
        var known = Index.TryGetValue(uid, out var at);
        if (known && at < 0) return 2;
        // 게임이 기록을 옮겼거나(불러오기 등) 아직 적지 못한 선수다
        if (Clock.ElapsedMilliseconds - indexedAt > RescanGapMs) BuildIndex();
        if (Load(uid, out address)) return 1;
        return Index.TryGetValue(uid, out at) && at < 0 ? 2 : 0;
    }

    private static string Describe(int found, bool withValues)
    {
        var text = new StringBuilder("{");
        text.Append("\"found\":").Append(found);
        text.Append(",\"records\":").Append(Index.Count);
        text.Append(",\"scannedMb\":").Append(lastScanMb);
        text.Append(",\"ms\":").Append(lastScanMs);
        if (withValues)
        {
            var block = scratch + Lead;
            text.Append(",\"ca\":").Append(*(ushort*)(block + CaAt));
            text.Append(",\"pa\":").Append(*(ushort*)(block + PaAt));
            text.Append(",\"positions\":[");
            for (var i = 0; i < Positions; i++) text.Append(i > 0 ? "," : "").Append(block[i]);
            text.Append("],\"attributes\":[");
            for (var i = 0; i < Attributes; i++) text.Append(i > 0 ? "," : "").Append(block[Positions + i]);
            text.Append(']');
        }
        return text.Append('}').ToString();
    }

    private static uint ParseUid(string text)
    {
        if (!uint.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var uid) || uid == 0)
            throw new HttpError(400, "bad uid");
        return uid;
    }

    /// <summary>선수 한 명의 지금 값. found가 1일 때만 값이 들어 있다.</summary>
    public static string Player(string uidText)
    {
        var uid = ParseUid(uidText);
        lock (Gate)
        {
            var found = Locate(uid, out _);
            return Describe(found, found == 1);
        }
    }

    /// <summary>
    /// 모든 선수의 지금 값을 한 덩어리로: 선수마다 [고유 번호 u32][현재 능력 u16][잠재 능력 u16][숙련도 15][능력치 54].
    /// 번호가 겹치는 기록과 그새 달라진 자리는 뺀다. rescan이면 메모리를 처음부터 다시 훑는다.
    /// </summary>
    public static byte[] All(bool rescan)
    {
        lock (Gate)
        {
            EnsureIndex(rescan);
            var packed = new byte[Index.Count * PackedSize];
            var count = 0;
            var gone = 0;
            // 선수 기록은 메모리에 줄지어 놓여 있다. 한 명씩 읽으면 10만 번을 읽어야 해서 몇 초가 걸리므로,
            // 주소 순으로 늘어놓고 가까이 붙은 기록들을 한 번에 읽는다.
            var entries = new List<KeyValuePair<uint, long>>(Index.Count);
            foreach (var entry in Index)
                if (entry.Value > 0)
                    entries.Add(entry);
            entries.Sort((a, b) => a.Value.CompareTo(b.Value));
            fixed (byte* output = packed)
            {
                var first = 0;
                while (first < entries.Count)
                {
                    var start = entries[first].Value - Lead;
                    var last = first;
                    while (last + 1 < entries.Count &&
                           entries[last + 1].Value - entries[last].Value <= BatchGap &&
                           entries[last + 1].Value - Lead + RecordSpan - start <= ChunkSize)
                        last++;
                    var length = (int)(entries[last].Value - Lead + RecordSpan - start);
                    var together = last > first && Read(start, chunk, length);
                    for (var k = first; k <= last; k++)
                    {
                        var (uid, address) = entries[k];
                        byte* record;
                        if (together) record = chunk + (address - Lead - start);
                        else if (Read(address - Lead, scratch, RecordSpan)) record = scratch;
                        else record = null;
                        if (record == null || !Genuine(record + Lead, out var found) || found != uid)
                        {
                            gone++;
                            continue;
                        }
                        var item = output + count * PackedSize;
                        var block = record + Lead;
                        *(uint*)item = uid;
                        *(ushort*)(item + 4) = *(ushort*)(block + CaAt);
                        *(ushort*)(item + 6) = *(ushort*)(block + PaAt);
                        Buffer.MemoryCopy(block, item + 8, Positions + Attributes, Positions + Attributes);
                        count++;
                    }
                    first = last + 1;
                }
            }
            // 사라진 자리가 많으면 게임이 다른 세이브를 불러온 것이다. 다음 요청 때 다시 훑게 한다
            if (gone > Math.Max(50, Index.Count / 10)) indexedAt = -1;
            return count * PackedSize == packed.Length ? packed : packed.AsSpan(0, count * PackedSize).ToArray();
        }
    }

    private static byte[] ParseList(string text, int count, int min, int max, string what)
    {
        if (string.IsNullOrEmpty(text)) return null;
        var parts = text.Split(',');
        if (parts.Length != count) throw new HttpError(400, $"{what}: need {count} values");
        var values = new byte[count];
        for (var i = 0; i < count; i++)
        {
            if (!int.TryParse(parts[i], NumberStyles.None, CultureInfo.InvariantCulture, out var value) || value < min || value > max)
                throw new HttpError(400, $"{what}: value out of range");
            values[i] = (byte)value;
        }
        return values;
    }

    private static int? ParseAbility(string text, string what)
    {
        if (string.IsNullOrEmpty(text)) return null;
        if (!int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) || value < 1 || value > 200)
            throw new HttpError(400, $"{what}: value out of range");
        return value;
    }

    /// <summary>선수의 값을 고친다. 맞는 기록이 정확히 하나일 때만 쓰고, 쓴 뒤의 값을 다시 읽어 돌려준다.</summary>
    public static string Set(string uidText, string positionsText, string attributesText, string caText, string paText)
    {
        var uid = ParseUid(uidText);
        var positions = ParseList(positionsText, Positions, 1, 20, "positions");
        var attributes = ParseList(attributesText, Attributes, 1, 100, "attributes");
        var ca = ParseAbility(caText, "ca");
        var pa = ParseAbility(paText, "pa");
        if (positions == null && attributes == null && ca == null && pa == null) throw new HttpError(400, "nothing to change");

        lock (Gate)
        {
            var found = Locate(uid, out var address);
            if (found != 1) return Describe(found, false);
            var block = address;
            var newCa = ca ?? *(ushort*)(scratch + Lead + CaAt);
            var newPa = pa ?? *(ushort*)(scratch + Lead + PaAt);
            if (newCa > newPa) throw new HttpError(400, "ca above pa");

            var ok = true;
            if (positions != null) ok &= Write(block, positions);
            if (attributes != null) ok &= Write(block + Positions, attributes);
            if (ca != null) ok &= Write(block + CaAt, BitConverter.GetBytes((ushort)ca.Value));
            if (pa != null) ok &= Write(block + PaAt, BitConverter.GetBytes((ushort)pa.Value));
            Plugin.Logger.LogInfo($"live edit: player {uid}, positions {positions != null}, attributes {attributes != null}, ca {ca}, pa {pa}, ok {ok}");
            if (!ok) throw new HttpError(500, "write failed");
            var after = Load(uid, out _);
            return Describe(after ? 1 : 0, after);
        }
    }

    /// <summary>
    /// 이 선수의 "사람 색인"(게임 안에서 사람마다 붙은 순번. 게임에 그 선수의 정보를 물을 때 쓴다).
    /// 인물 기록의 번호 바로 앞에 적혀 있다. 기록이 정확히 하나일 때만 준다.
    /// </summary>
    public static bool PersonIndex(uint uid, out int index)
    {
        index = -1;
        lock (Gate)
        {
            if (Locate(uid, out _) != 1) return false;
            var block = scratch + Lead;
            var person = *(uint*)(block + PersonAt + UidInPerson) == uid ? block + PersonAt : block + PersonAtStaff;
            index = *(int*)(person + UidInPerson - 4);
            return index > 0;
        }
    }

    /// <summary>앱에 알려 줄 요약: 선수 기록을 몇 개 찾아 두었는지(아직 훑지 않았으면 -1)</summary>
    public static int Records
    {
        get
        {
            lock (Gate) return indexedAt < 0 ? -1 : Index.Count;
        }
    }

    // ── 조사용(읽기만) ────────────────────────────────────

    /// <summary>개발용. 바이트 열이 메모리의 어디에 있는지.</summary>
    public static string Find(string hex, int max)
    {
        hex = hex.Replace(" ", "");
        if (hex.Length < 8 || hex.Length % 2 != 0) throw new HttpError(400, "need at least 4 bytes of hex");
        var pattern = Convert.FromHexString(hex);
        max = Math.Clamp(max, 1, 500);
        lock (Gate)
        {
            var watch = Stopwatch.StartNew();
            var found = new List<long>();
            var scanned = Walk(pattern.Length - 1, () => found.Count >= max, (address, data, length) =>
            {
                var span = new ReadOnlySpan<byte>(data, length);
                var from = 0;
                while (found.Count < max)
                {
                    var at = span[from..].IndexOf(pattern);
                    if (at < 0) break;
                    found.Add(address + from + at);
                    from += at + 1;
                }
            });
            var text = new StringBuilder($"{found.Count} match(es), scanned {scanned / (1024 * 1024)} MB in {watch.ElapsedMilliseconds} ms\n");
            foreach (var address in found) text.Append("0x").Append(address.ToString("X")).Append('\n');
            return text.ToString();
        }
    }

    /// <summary>개발용. 메모리의 한 구간을 16진수로.</summary>
    public static string Dump(string addressText, int length)
    {
        addressText = addressText.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? addressText[2..] : addressText;
        if (!long.TryParse(addressText, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var address)) throw new HttpError(400, "bad address");
        length = Math.Clamp(length, 1, 4096);
        var bytes = new byte[length];
        bool read;
        fixed (byte* buffer = bytes) read = Read(address, buffer, length);
        if (!read) return "unreadable";
        var text = new StringBuilder();
        for (var i = 0; i < length; i += 32)
        {
            text.Append("0x").Append((address + i).ToString("X")).Append("  ");
            text.Append(Convert.ToHexString(bytes, i, Math.Min(32, length - i))).Append('\n');
        }
        return text.ToString();
    }
}
