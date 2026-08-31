# Review

## Verification

- `npm run verify`: 236/236 tests passed; static project check passed.
- WeChat DevTools rendering verified: the student verification page shows the free-text “所属学校” input and helper copy, with no campus Picker residue.
- Production CloudBase `api` function deployed successfully after the final backend validation changes.
- Accidental temporary cloud function `pinba-student-school-api-20260831` was deleted from CloudBase and its absence was confirmed through the official CLI list.

## GPT-5.5 backend review

- Initial finding: length must be checked after whitespace normalization; legacy campus mapping should be explicitly read-only; stale `schoolId` writes should be rejected.
- Applied: normalized 2–60 character validation, broader unsafe/URL-like input rejection, explicit `schoolId` rejection, an independent frozen legacy label map, and boundary/migration tests.
- Final review: no Critical or Major findings. Existing document `fileID` confirmation is not free text; it remains constrained by the server-issued owner-bound upload slot, TTL, exact cloud-path match, image inspection, sealed storage, and non-public DTO.

## Gemini 3.7 Flash frontend review

- Result: deliverable; no Critical findings.
- Warning: `confirm-type="next"` plus explicit focus handoff could improve movement from school to student-number input.
- Decision: defer the optional focus-state enhancement. The current native keyboard behavior is stable and the requested school-field replacement is complete; adding cross-input focus state is not required for this delivery.
- 320px, large text, keyboard avoidance, long-name wrapping, accessibility label association, and lifecycle clearing were approved.
