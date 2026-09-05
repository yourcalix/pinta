# Review

## Result

The bug was caused by mismatched Mock avatar-path allowlists. `wx.getFileSystemManager().saveFile` can return `http://usr/...` (and developer tools may use `http://tmp/...`), but the activity DTO and client normalizer rejected those paths and converted the avatar to `DEFAULT`.

The Mock upload confirmation, Mock activity DTO, and client normalizer now consistently accept only exact WeChat sandbox prefixes. Arbitrary public HTTP and `cloud://` remain rejected. The production server remains HTTPS-only.

## External review

The genuine GPT-5.5 final review reported **0 Critical / 0 Warning** and concluded **可交付**. It confirmed that production exposure was not broadened and the end-to-end reproduction path is covered.

## Verification

- End-to-end Mock test covers `prepare -> confirm(http://usr) -> activity.detail -> CUSTOM`.
- Sandbox matrix covers `http://tmp`, `http://usr`, `wxfile://`, `/tmp`, and `/var`.
- Rejection coverage preserves blocking of `cloud://` and arbitrary public HTTP.
- `npm run verify`: 271 tests, 270 passed, 1 historical skip, 0 failed.
- Static project check passed; `git diff --check` passed.
