---
name: warn-no-emoji-emdash
enabled: true
event: file
pattern: [\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF]|—
action: warn
---

**Emoji or em-dash detected in written content.**

Standing MANDATORY user rule: no emojis, no em-dashes. Anywhere. Code, comments,
docs, commit messages, UI strings.

**Fix:**
- Em-dash (--) becomes a comma, colon, or period. Restructure the sentence.
- Emoji: delete it. Use a plain word if a marker is needed.

If the character came from USER DATA you are echoing (a work order note, a scraped
field, a remittance line), this is a false positive: preserve the data as-is and say
so.
