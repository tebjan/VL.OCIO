namespace VL.OCIO;

/// <summary>
/// Simple log levels for the color grading subsystem.
/// Default is Warn — only errors and warnings are printed.
/// Set to Info or Debug for startup diagnostics and troubleshooting.
/// </summary>
public enum GradeLogLevel
{
    /// <summary>Show nothing.</summary>
    Off = 0,
    /// <summary>Errors and failures that need attention.</summary>
    Error = 1,
    /// <summary>Warnings and non-critical issues (e.g. fallback paths).</summary>
    Warn = 2,
    /// <summary>Key lifecycle events (startup, shutdown, URL, network).</summary>
    Info = 3,
    /// <summary>Verbose diagnostics (instance register/unregister, presets, clients).</summary>
    Debug = 4,
}

/// <summary>
/// Lightweight logger for the color grading subsystem.
/// All output goes to Console with a [tag] prefix.
/// </summary>
internal static class GradeLog
{
    /// <summary>
    /// Current log level. Default is Warn (errors + warnings only).
    /// Change at runtime to increase verbosity for debugging.
    /// </summary>
    public static GradeLogLevel Level { get; set; } = GradeLogLevel.Warn;

    public static void Error(string tag, string message)
    {
        if (Level >= GradeLogLevel.Error)
            Console.WriteLine($"[{tag}] ERROR: {message}");
    }

    public static void Warn(string tag, string message)
    {
        if (Level >= GradeLogLevel.Warn)
            Console.WriteLine($"[{tag}] {message}");
    }

    public static void Info(string tag, string message)
    {
        if (Level >= GradeLogLevel.Info)
            Console.WriteLine($"[{tag}] {message}");
    }

    public static void Debug(string tag, string message)
    {
        if (Level >= GradeLogLevel.Debug)
            Console.WriteLine($"[{tag}] {message}");
    }
}
