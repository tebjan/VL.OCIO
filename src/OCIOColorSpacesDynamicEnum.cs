using System.Reactive.Linq;
using System.Reactive.Subjects;
using VL.Core.CompilerServices;
using VL.Lib.Collections;

namespace VL.OCIO;

[Serializable]
public class OCIODisplayViewEnum : DynamicEnumBase<OCIODisplayViewEnum, OCIODisplayViewEnumDefinition>
{
    public OCIODisplayViewEnum(string value) : base(value) { }

    [CreateDefault]
    public static OCIODisplayViewEnum CreateDefault() => CreateDefaultBase();
}

public class OCIODisplayViewEnumDefinition : DynamicEnumDefinitionBase<OCIODisplayViewEnumDefinition>
{
    Dictionary<string, object> entries = new();
    Subject<object> trigger = new();

    [CreateDefault]
    public static OCIODisplayViewEnumDefinition CreateDefault() => Instance;

    public void SetEntries(Dictionary<string, object> newEntries)
    {
        entries = newEntries;
        trigger.OnNext("");
    }

    public void AddEntry(string name, object? tag = null)
    {
        entries[name] = tag;
        trigger.OnNext("");
    }

    public void ClearEntries()
    {
        entries.Clear();
        trigger.OnNext("");
    }

    protected override IReadOnlyDictionary<string, object> GetEntries() => entries;
    protected override IObservable<object> GetEntriesChangedObservable() => trigger;
    protected override bool AutoSortAlphabetically => true;
}

[Serializable]
public class OCIOLookEnum : DynamicEnumBase<OCIOLookEnum, OCIOLookEnumDefinition>
{
    public OCIOLookEnum(string value) : base(value) { }

    [CreateDefault]
    public static OCIOLookEnum CreateDefault() => CreateDefaultBase();
}

public class OCIOLookEnumDefinition : DynamicEnumDefinitionBase<OCIOLookEnumDefinition>
{
    Dictionary<string, object> entries = new();
    Subject<object> trigger = new();

    [CreateDefault]
    public static OCIOLookEnumDefinition CreateDefault() => Instance;

    public void SetEntries(Dictionary<string, object> newEntries)
    {
        entries = newEntries;
        trigger.OnNext("");
    }

    public void AddEntry(string name, object? tag = null)
    {
        entries[name] = tag;
        trigger.OnNext("");
    }

    public void ClearEntries()
    {
        entries.Clear();
        trigger.OnNext("");
    }

    protected override IReadOnlyDictionary<string, object> GetEntries() => entries;
    protected override IObservable<object> GetEntriesChangedObservable() => trigger;
    protected override bool AutoSortAlphabetically => true;
}

[Serializable]
public class OCIOColorSpaceEnum : DynamicEnumBase<OCIOColorSpaceEnum, OCIOColorSpaceEnumDefinition>
{
    public OCIOColorSpaceEnum(string value) : base(value) { }

    [CreateDefault]
    public static OCIOColorSpaceEnum CreateDefault() => CreateDefaultBase();
}

public class OCIOColorSpaceEnumDefinition : DynamicEnumDefinitionBase<OCIOColorSpaceEnumDefinition>
{
    Dictionary<string, object> entries = new();
    Subject<object> trigger = new();

    [CreateDefault]
    public static OCIOColorSpaceEnumDefinition CreateDefault() => Instance;

    public void SetEntries(Dictionary<string, object> newEntries)
    {
        entries = newEntries;
        trigger.OnNext("");
    }

    public void AddEntry(string name, object? tag = null)
    {
        entries[name] = tag;
        trigger.OnNext("");
    }

    public void ClearEntries()
    {
        entries.Clear();
        trigger.OnNext("");
    }

    protected override IReadOnlyDictionary<string, object> GetEntries() => entries;
    protected override IObservable<object> GetEntriesChangedObservable() => trigger;
    protected override bool AutoSortAlphabetically => true;
}

public sealed class OCIOConfigTag
{
    public bool IsBuiltin;
    public string? BuiltinUri;
    public string? FilePath;
    public string Source = "";
}

[Serializable]
public class OCIOConfigEnum : DynamicEnumBase<OCIOConfigEnum, OCIOConfigEnumDefinition>
{
    public OCIOConfigEnum(string value) : base(value) { }

    [CreateDefault]
    public static OCIOConfigEnum CreateDefault() => CreateDefaultBase("ACES 2.0 CG");
}

public class OCIOConfigEnumDefinition : DynamicEnumDefinitionBase<OCIOConfigEnumDefinition>
{
    Dictionary<string, object> entries = new();
    Subject<object> trigger = new();

    protected override IReadOnlyDictionary<string, object> GetEntries()
    {
        if (entries.Count == 0)
            AddBuiltinEntries();
        return entries;
    }

    protected override IObservable<object> GetEntriesChangedObservable() => trigger;
    protected override bool AutoSortAlphabetically => false;

    public void AddEntry(string name, object tag = null)
    {
        entries[name] = tag;
        trigger.OnNext("");
    }

    public bool HasEntry(string name) => entries.ContainsKey(name);

    public IReadOnlyDictionary<string, object> GetAllEntries()
    {
        if (entries.Count == 0)
            AddBuiltinEntries();
        return entries;
    }

    private void AddBuiltinEntries()
    {
        entries["ACES 2.0 CG"] = new OCIOConfigTag
            { IsBuiltin = true, BuiltinUri = "ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5", Source = "builtin" };
        entries["ACES 2.0 Studio"] = new OCIOConfigTag
            { IsBuiltin = true, BuiltinUri = "ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5", Source = "builtin" };
        entries["ACES 1.3 CG"] = new OCIOConfigTag
            { IsBuiltin = true, BuiltinUri = "ocio://cg-config-v2.2.0_aces-v1.3_ocio-v2.4", Source = "builtin" };
        entries["ACES 1.3 Studio"] = new OCIOConfigTag
            { IsBuiltin = true, BuiltinUri = "ocio://studio-config-v2.2.0_aces-v1.3_ocio-v2.4", Source = "builtin" };
    }
}
