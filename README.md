# VL.OCIO
Reads OpenColorIO (OCIO) config files and can apply a selected color transformation to a texture. Especially helpful for working with CG artists or displaying vvvv rendering on HDR displays with 10-bit colors or more.

For use with vvvv, the visual live-programming environment for .NET: http://vvvv.org

## Getting started
- Install as [described here](https://thegraybook.vvvv.org/reference/hde/managing-nugets.html) via commandline:

    `nuget install vl.ocio`

- Usage examples and more information are included in the pack and can be found via the [Help Browser](https://thegraybook.vvvv.org/reference/hde/findinghelp.html)

## Pipeline Checker
An interactive WebGPU tool for visualizing HDR/SDR color pipelines stage by stage. Drop in an EXR, DDS, or standard image and inspect how each processing step transforms the data — from BC texture compression through color grading, tonemapping, and display output.

**[Try it in your browser](https://tebjan.github.io/VL.OCIO/)** (requires Chrome/Edge with WebGPU)

![PipeScope screenshot](pipeline-checker/public/og-image-clean.jpg)

## Contributing
- Report issues on [the vvvv forum](https://discourse.vvvv.org/c/vvvv-gamma/28)
- When making a pull-request, please make sure to read the general [guidelines on contributing to vvvv libraries](https://thegraybook.vvvv.org/reference/extending/contributing.html)

## Credits
Based on [OpenColorIO](https://github.com/AcademySoftwareFoundation/OpenColorIO) and [OCIOSharp](https://github.com/tebjan/OCIOSharp), my C# wrapper for it.

## Sponsoring
Development of this library was partially sponsored by:
* [Refik Anadol Studio](https://refikanadolstudio.com/)
