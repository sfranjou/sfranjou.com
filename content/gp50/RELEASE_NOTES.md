# Peppercorn v0.1.0 (on-screen version A1.1.0i)

This is an unofficial mod for firmware v1.1.0 for the Valeton GP-50. It is not affiliated with or endorsed by Valeton. It is built in the browser from your own official V1.1.0 file.

## New Features

- LTTC captures (Lean Twin Trained Clippers): a higher-fidelity alternative to SnapTone for tone captures.
  - Convert NAM captures to LTTC using the [in-browser trainer](https://sfranjou.com/gp50/trainer/).
  - LTTC captures sound significantly closer to the original NAM captures than SnapTone captures, but take longer to generate.
  - The N→S supports both SnapTone and LTTC captures.
  - The DST block now supports LTTC Capture, with Gain, VOL, Bass, Mid, and Treble parameters.
- Ability to run an LTTC capture and an IR at the same time, or two LTTC captures at the same time (using the DST and N→S blocks).
  - The pedal cannot mix LTTC and SnapTone captures, cannot run 2 LTTC captures and an IR, or run a SnapTone capture and an IR at the same time.
- New parameter assignment menu, accessible by holding DRUM in edit mode.
  - Home screen knob assignment: any parameter can now be assigned to a home screen knob to be visible at any time for quick access, replacing the Master, BPM and/or P-VOL knobs.
    - To assign a parameter: in edit mode, hold DRUM to open the assignment menu. Then → Assign control → turn parameter knob → turn Stomp knob
  - Similarly, any parameter can be assigned to a footswitch to toggle between 2 values, also from the assignment menu.
    - Knob and footswitch assignments are saved per preset.
    - Knob and footswitch assignments can be cleared in the assignment menu.

- Expression pedal Auto Engage: automatically turn an effect on when using the expression pedal by setting "auto-engage" in the expression block.
  - The effect block will turn on when the expression pedal's value goes above 0 (make sure to calibrate your expression pedal in the global menu if you are having issues with this)
  - The "release" parameter sets how many milliseconds the effect will stay on for when the expression pedal hits 0.
  - Try it with C-Wah for a wah that turns on automatically when the pedal is in use, and turns off when done!

- Gain-reduction meters: in edit mode, the Gate, COMP, and COMP4 now show live gain reduction meters.

- New CPU panel in Global settings: estimated, measured ARM and DSP load

- CPU FULL: refuses to enable an effect that would overload the available CPU, and flashes a warning on the screen

- New effects:
  - Auto Swell (PRE): a slow-gear inspired auto-swell.
  - Cloud Verb (RVB): a slightly lower-fidelity version of the reverb from [Mutable Instruments Clouds](https://pichenettes.github.io/mutable-instruments-documentation/modules/clouds/).
  - LTTC Captures (DST and N→S): a higher-fidelity alternative to SnapTone for tone capture. See above for details.

- Bug fix: Improved the tuning accuracy of Pitch, Octa and Detune effects

- Factory presets you never saved, or that you reset, have N→S set to user slot 50 (N→S stays off). Saved presets don't change.
- Custom boot animation!
- Full compatibility with existing presets: nothing is removed from the existing firmware.

## On the computer

- [Installer](https://sfranjou.com/gp50/installer/): builds the firmware in the browser from your own V1.1.0 file. The file isn't uploaded.
- [Editor](https://sfranjou.com/gp50/editor/): edit presets, reorder the effect chain, change parameters and manage captures over USB. It also opens preset files, and has a demo mode that works without a pedal.
- [Trainer](https://sfranjou.com/gp50/trainer/): turns a NAM A2 Full file into an LTTC capture. It trains on your computer, using the GPU if the browser supports WebGPU, and saves its progress so you can stop and resume.
- [Captures](https://sfranjou.com/gp50/captures/): 10 ready-made LTTC captures (RAT, Klon, Morning Glory, BE-OD, and Marshall, Orange, JC-120, Vox, Fender and Matchless amps), with credits and links to the original TONE3000 captures.
- [Uploader](https://sfranjou.com/gp50/uploader/): sends a capture to a user slot on the pedal.

## SDK

The SDK builds a complete firmware from your own V1.1.0 file plus your own C code. The features and effects in this release are included as source. You don't need to write assembly or choose memory addresses: the build places everything, and refuses an image that doesn't fit.

- Pedal features, in C on the main processor. A feature can:
  - react to knobs, footswitches, the encoder and other buttons, and to preset or screen changes
  - read and change blocks, effects and parameters
  - save its own settings in each preset
  - show text or a meter in the editor, use the home screen tiles and title, and add a page to Global settings
  - read the CPU load
  - exchange messages with a computer over USB
- Audio effects, in C on the audio processor. They appear in the effect list of their block (NR, PRE, MOD, DLY or RVB), with up to 8 parameters and access to the tempo. The SDK estimates their CPU cost.
- Boot animation: use your own GIF (144×28 pixels, up to 3.92 seconds).
- Tests: features and effects can be tested on the computer before they go on the pedal.
- JavaScript API: the code behind the web tools, usable in your own pages.
- Examples: the features and effects in this release, plus others that aren't in it, such as a tape effect, an FDN reverb with freeze, a compressor, a tremolo and several echoes.
- Limits:
  - New effects for DST, AMP, CAB and EQ aren't supported: they run on a separate coprocessor.
  - There's no protection against bugs: bad code can freeze the pedal. See the [recovery steps](https://sfranjou.com/gp50/#recovery).
  - Only tested on macOS.
- Start with `sdk/README.md`. The full guide is `sdk/sdk/DEVELOPER_GUIDE.md`.

## Install

1. Download the official GP-50 V1.1.0 firmware from Valeton's website.
2. Back up your presets. A normal install shouldn't delete or break them, but can't be too careful!
3. Open the [installer](https://sfranjou.com/gp50/installer/), drop the V1.1.0 file on the page and download the result. The page checks your file first, and the finished firmware afterwards.
4. In Valeton Suite, start a firmware update and select the file you downloaded. Don't unplug the pedal until it's done.
5. The Version screen should now show A1.1.0i (in global settings -> about).

## Go back

- Install the official V1.1.0 file with Valeton Suite, the same way.
- If the pedal doesn't start, use the [recovery steps](https://sfranjou.com/gp50/#recovery).
- Effects and captures added by this mod won't work in the official firmware.

## Known limits

- GP-50 only, and only built from the official V1.1.0 file.
- The web tools need Chrome, Edge or desktop Firefox to connect to the pedal. Make sure Valeton Suite is closed when connecting via web tools.
- Valeton Suite and the mobile app don't know the new effects.
- The trainer only accepts NAM A2 Full files.
