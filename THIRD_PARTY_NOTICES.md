# Third-party software

Sprouting Halo uses the following. They are not part of this repository: the C++ ones are
cloned into `external/` before building (see the README), the viewer's are installed by npm.

| Component | Used by | Licence | Source |
| --- | --- | --- | --- |
| JUCE 8.0.9 | Sprout Tap plugin (`tap/`) | AGPLv3 (or a commercial JUCE licence) | https://github.com/juce-framework/JUCE |
| VST3 SDK (bundled with JUCE) | Sprout Tap plugin | GPLv3 option of Steinberg's dual licence (see `modules/juce_audio_processors/format_types/VST3_SDK/LICENSE.txt` in JUCE) | https://github.com/steinbergmedia/vst3sdk |
| Spout2 2.007.018 (SpoutDX, built from source) | Sprout.exe, `spout_snapshot` | BSD 2-Clause | https://github.com/leadedge/Spout2 |
| Tweakpane 4 | Viewer (settings panel) | MIT | https://github.com/cocopon/tweakpane |
| Vite, TypeScript | Viewer build only (not shipped) | MIT, Apache-2.0 | https://vitejs.dev, https://www.typescriptlang.org |

Because the plugin is built with JUCE under its AGPLv3 option, the plugin's own code (`tap/`) is
under the AGPLv3 as well, and anyone distributing a modified plugin must offer its source under
the same terms. Sprout.exe, the viewer and the tools don't use JUCE and are under the MIT licence.

VST is a trademark of Steinberg Media Technologies GmbH. OBS Studio, REAPER and VTube Studio are
trademarks of their respective owners; this project is not affiliated with them.
