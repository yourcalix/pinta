# Gemini 3.7 Flash Frontend Analysis

- Normalize all slots into `CUSTOM`, `DEFAULT`, or `EMPTY` before rendering.
- Reject legacy passenger pixel paths; legacy passenger kinds may only migrate to painted defaults.
- Render custom photos with `aspectFill`; render painted defaults without distortion; keep empty slots as CSS placeholders.
- Preserve stable slot keys, overlapping stack order, `+N`, pointer-event passthrough, and reduced-motion handling.
- Add a one-way `binderror` fallback state so a failed custom image can switch once to a bundled painted asset without a render loop.
- Use smaller visible stacks on 320px screens and path-based `setData` for image failures.

