using System.Collections.Concurrent;

namespace FmBojwagwan.Bridge;

/// <summary>다른 스레드(HTTP)가 맡긴 일을 게임의 메인 스레드에서 실행한다.</summary>
internal static class MainThread
{
    private sealed class Job
    {
        public readonly Func<string> Work;
        public Job(Func<string> work) => Work = work;
        public string Result;
        public Exception Error;
        public readonly ManualResetEventSlim Done = new(false);
        public volatile bool Abandoned;
    }

    private static readonly ConcurrentQueue<Job> Queue = new();

    /// <summary>메인 스레드에서 실행하고 결과를 기다린다. 게임이 멈춰 있으면 시간 초과로 끝난다.</summary>
    public static string Run(Func<string> work, int timeoutMs = 10_000)
    {
        var job = new Job(work);
        Queue.Enqueue(job);
        if (!job.Done.Wait(timeoutMs))
        {
            job.Abandoned = true;
            throw new TimeoutException("게임이 응답하지 않습니다(불러오는 중이거나 창이 멈춰 있을 수 있습니다).");
        }
        if (job.Error != null) throw new InvalidOperationException(job.Error.Message, job.Error);
        return job.Result ?? "";
    }

    /// <summary>한 프레임에 몇 개만 처리해 게임이 끊기지 않게 한다.</summary>
    public static void Pump()
    {
        for (var handled = 0; handled < 4 && Queue.TryDequeue(out var job); handled++)
        {
            if (job.Abandoned) continue;
            try
            {
                job.Result = job.Work();
            }
            catch (Exception error)
            {
                job.Error = error;
            }
            job.Done.Set();
        }
    }
}
