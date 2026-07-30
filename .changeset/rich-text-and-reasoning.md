---
"create-dpas-app": patch
---

Render assistant answers as markdown, and give model reasoning its own place.

Answers arrived as plain text, so emphasis and inline code showed their
syntax (`**turin-vanchiglia-01**`). They now render through react-markdown,
which builds a React tree rather than injecting HTML.

Model reasoning now streams on its own protocol frame and renders as a
collapsed "Model reasoning" block instead of being mixed into the answer.
Models that leak their channel format into visible text (`<|channel|>analysis`,
a bare `thought` line) are cleaned before display; ordinary prose, including
the word "thought" in a sentence, is untouched.
