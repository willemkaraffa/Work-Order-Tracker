## Approach

* MANDATORY - Read existing files before writing. Don't re-read unless changed.
* MANDATORY - No emojis or em-dashes.
* MANDATORY - Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.
* MANDATORY - Work Silently during tasks. Do not make any chat dialogues until a coding task has been completed, adhering to all prior rules
* MANDATORY - Reduce all chat output to the bare minimum wording to convey the needed information. If something can be expressed through a single word, do so.
* ESSENTIAL - Read this file upon every new session without prompting.
* CRITICAL - Read and obey .claude\\settings.json in this repo.

## Design preferences

* UI must never clip content; content that exceeds the window must scroll or shrink to fit. Default fix: bound the offending container and give it an internal scroll region (flex `flex:1; minHeight:0; overflowY:auto`) with a pinned `flexShrink:0` footer - mirror an existing pane that already does this correctly. Electron `setZoomFactor` window-scaling was tried for the launch-landing clip and REVERTED (commit a229503): it only engages below a baseline window size, so it does nothing at the default/launch size where clips actually appear. Do not reach for global zoom before fixing the specific container's overflow.
* When a UI element "still" appears broken after a fix, grep for the user-visible string (e.g. the button label) and confirm WHICH component actually renders it before editing. This repo has duplicate components (e.g. launch `FullScreenLanding` at index.html:3568 vs in-pane `Landing` at :2534) sharing the same labels; two fixes were wasted editing the wrong one.

