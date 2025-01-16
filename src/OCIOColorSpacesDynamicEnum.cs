// Steps to implement your own enum based on this template:
// 1) Rename "DynamicEnumTemplate" to what your enum should be named
// 2) Rename "DynamicEnumTemplateDefinition" accordingly
// 3) Implement the definitions GetEntries() 
// 
// For more details regarding the template, see:
// https://thegraybook.vvvv.org/reference/extending/writing-nodes.html#dynamic-enums

using System.Reactive.Linq;
using System.Reactive.Subjects;
using VL.Core.CompilerServices;
using VL.Lib.Collections;

namespace VL.OCIO;

[Serializable]
public class OCIODisplayColorSpaceEnum : DynamicEnumBase<OCIODisplayColorSpaceEnum, OCIODisplayColorSpaceEnumDefinition>
{
    public OCIODisplayColorSpaceEnum(string value) : base(value)
    {
    }

    [CreateDefault]
    public static OCIODisplayColorSpaceEnum CreateDefault()
    {
        return CreateDefaultBase();
    }
}

public class OCIODisplayColorSpaceEnumDefinition : DynamicEnumDefinitionBase<OCIODisplayColorSpaceEnumDefinition>
{
    Dictionary<string, object> entries = new Dictionary<string, object>();
    Subject<object> trigger = new Subject<object>(); //Really just used as a trigger, the "object" is ignored

    [CreateDefault]
    public static OCIODisplayColorSpaceEnumDefinition CreateDefault()
    {
        return Instance;
    }

    /// <summary>
    /// Adds an entry to the enum that can optionally have an object associated as its tag
    /// </summary>
    /// <param name="name">Name of the entry to add</param>
    /// <param name="tag">Optional: Object associated to the enum entry</param>
    public void AddEntry(string name, object? tag = null)
    {
        entries[name] = tag;
        trigger.OnNext("");
    }

    /// <summary>
    /// Removes the given entry from the enum
    /// </summary>
    /// <param name="name">Name of the entry to remove</param>
    public void RemoveEntry(string name)
    {
        entries.Remove(name);
        trigger.OnNext("");
    }

    /// <summary>
    /// Removes all entries from the enum
    /// </summary>
    public void ClearEntries()
    {
        entries.Clear();
        trigger.OnNext("");
    }

    public Dictionary<string, object> GetInternalEntries()
    {
        return entries;
    }

    protected override IReadOnlyDictionary<string, object> GetEntries()
    {
        return entries;
    }

    protected override IObservable<object> GetEntriesChangedObservable()
    {
        return trigger;
    }

    protected override bool AutoSortAlphabetically => true;
}

[Serializable]
public class OCIOColorSpaceEnum : DynamicEnumBase<OCIOColorSpaceEnum, OCIOColorSpaceEnumDefinition>
{
    public OCIOColorSpaceEnum(string value) : base(value)
    {
    }

    [CreateDefault]
    public static OCIOColorSpaceEnum CreateDefault()
    {
        return CreateDefaultBase();
    }
}

public class OCIOColorSpaceEnumDefinition : DynamicEnumDefinitionBase<OCIOColorSpaceEnumDefinition>
{
    Dictionary<string, object> entries = new Dictionary<string, object>();
    Subject<object> trigger = new Subject<object>(); //Really just used as a trigger, the "object" is ignored

    [CreateDefault]
    public static OCIOColorSpaceEnumDefinition CreateDefault()
    {
        return Instance;
    }

    /// <summary>
    /// Adds an entry to the enum that can optionally have an object associated as its tag
    /// </summary>
    /// <param name="name">Name of the entry to add</param>
    /// <param name="tag">Optional: Object associated to the enum entry</param>
    public void AddEntry(string name, object? tag = null)
    {
        entries[name] = tag;
        trigger.OnNext("");
    }

    /// <summary>
    /// Removes the given entry from the enum
    /// </summary>
    /// <param name="name">Name of the entry to remove</param>
    public void RemoveEntry(string name)
    {
        entries.Remove(name);
        trigger.OnNext("");
    }

    /// <summary>
    /// Removes all entries from the enum
    /// </summary>
    public void ClearEntries()
    {
        entries.Clear();
        trigger.OnNext("");
    }

    public Dictionary<string, object> GetInternalEntries()
    {
        return entries;
    }

    protected override IReadOnlyDictionary<string, object> GetEntries()
    {
        return entries;
    }

    protected override IObservable<object> GetEntriesChangedObservable()
    {
        return trigger;
    }

    protected override bool AutoSortAlphabetically => true;
}