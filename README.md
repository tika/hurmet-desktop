_Hurmet_ is a web-based rich text editor endowed with live calculations. With it, you can create documents that do calculations and preserve an easy-to-read record of your work.

The emphasis is on readability. Hurmet calculations are much easier to review than spreadsheet calculations because Hurmet typically exposes all mathematical expressions and displays an echo of each expression containing the plugged-in values for each variable.

The main Hurmet page is at [hurmet.org][1]. There is more information in the [examples page][2] and in the [documentation][3].

Hurmet can also be run locally. It is a progressive web app, so it stores a copy of itself on your local drive. If you are offline, you can still open a browser, navigate to hurmet.org, and it will be there. So will the main documentation page.

## Desktop builds and releases

Use Node.js 22 and the pinned Yarn version (`corepack enable`, then `yarn install --immutable`). Run `yarn desktop` to open the app locally.

Right-click in the editor for formatting, paragraph styles, inserts, calculation tools, and contextual table tools. The Engineering submenu includes EE and MechE symbols and unit notation, plus worked-problem and lab-note templates. Unit shortcuts insert readable notation in prose, quoted unit literals in Hurmet calculation source, and TeX markup in equation source. Engineering shortcuts are also available through Insert → Engineering in the native menu bar.

On macOS, `yarn desktop:package` builds `release/Hurmet-<version>-universal.dmg` for both Apple Silicon and Intel Macs. The disk image includes the app and a shortcut to Applications. Run `yarn desktop:verify-package` to check its universal binary, code signature, bundled files, and editor launch.

The [Release macOS workflow](https://github.com/tika/hurmet-desktop/actions/workflows/release-macos.yml) publishes a GitHub release automatically when a `v*` tag is pushed. The tag must match `package.json`'s version, such as `v0.1.1`. Update the version, commit and push it, then create and push the matching tag:

```sh
git tag v0.1.1
git push origin v0.1.1
```

The workflow runs lint and tests, builds and launches the packaged app, verifies the DMG, and attaches the DMG and SHA-256 checksums to the release. Tags containing a hyphen, such as `v0.2.0-beta.1`, produce prereleases. Re-running a tag's workflow replaces the release assets.

You can also run the workflow manually from Actions to download a build artifact. Runs on a branch build the DMG without publishing a release; runs on a version tag publish it.

Builds are ad-hoc signed, without Apple notarization, so macOS may require approval before opening a downloaded app. Developer ID signing and notarization are not configured.

--------------------

This repository contains the code used to create hurmet org. You are free to use this code or hurmet org under terms of the [MIT license][5].

If enough interest develops in Hurmet, I’ll create a forum, but for now, comments can be sent to me at ronkok55 { at } outlook.com. Bugs should be reported in the Issues page of this repository.


[1]: https://hurmet.org/

[2]: https://hurmet.org/examples.html

[3]: https://hurmet.org/docs/en/manual.html

[4]: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml

[5]: https://opensource.org/licenses/MIT/
