# GPT-5.5 Diagnostic Summary

The genuine GPT-5.5 debugger confirmed the root cause with high confidence: Mock avatar uploads can persist as `http://tmp/...` or `http://usr/...`, while the Mock public DTO and client normalizer rejected those exact WeChat sandbox schemes and downgraded the avatar to `DEFAULT`.

It found no deeper member/user mapping defect. The roster and hydrated profile maps consistently use `member.id`, while `member.userId` is only used to retrieve the corresponding current user profile.

Recommended fix: accept only exact WeChat local sandbox prefixes in Mock/client (`http://tmp/`, `http://usr/`, `wxfile://`, `/tmp/`, `/var/`), continue rejecting arbitrary HTTP and `cloud://`, and leave the production server restricted to HTTPS temporary URLs.
