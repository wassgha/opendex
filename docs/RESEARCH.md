# Guided browser research

Ask Dex to investigate a question, compare options, or research a topic in a
particular browser. For example: “Research the tradeoffs between these options
in Chrome. Show me your plan, compare original sources, and explain where the
evidence disagrees.” Opening a search page alone remains a simple action.

The Research companion skill is enabled by default. It publishes a tailored
plan before research, then updates the current activity, source record,
source-linked findings, and unresolved questions. It appears in the existing
tool-result area and a scrollable notch view. Source links can be opened from
the record. There are no additional search credentials for the progress view;
actual browsing still uses the existing computer tools and permissions.

The model is instructed to break broad questions into subquestions, vary queries
and search engines as useful, open original sources, collect specific data with
dates/units/methods, and compare independent evidence. Depth follows the question
and evidence gaps, rather than a fixed source count. Search-engine snippets are
leads. Source status distinguishes found, read, and unavailable pages. A finding
must reference a source included as read in the same snapshot; a completed
record requires findings and a finished plan. These are agent-reported claims,
not an independent verifier of browser reading or factual accuracy.

The model sends complete snapshots through `updateResearch`, with up to five
plan steps, twenty-four sources, twelve findings, and four open questions.
Snapshots remain in the current interaction; this is not a saved research
library or document exporter. The latest active research record takes precedence
over individual search-result cards. The skill can be disabled in Skills & tools.

Realtime browser research uses the existing `run_task` worker. The parent
presents the plan once and hands off the question, requested browser, constraints,
and plan. The worker updates the record as it investigates. Substantive findings,
changes of direction, and blockers can request a short spoken update, at most
once every fifteen seconds and only when local playback is quiet. There is no
periodic “still working” narration. Progress requests are tied to the current
tool's response epoch; interruptions discard queued milestones. Progress-only
responses cannot execute tools. The final handoff uses the last assistant report
rather than concatenating earlier plans and progress into the answer.

The pipeline retains forty tool/generation steps for routine tasks. Calling
`updateResearch` enables ninety-six steps, with a closing reminder near the
limit. This is bounded research: reaching the limit without a report is surfaced
as incomplete. Microphone forwarding, permission gates, and provider selection
are unchanged.

Validation: targeted tests cover source references, completion state, safe link
schemes, milestone throttling and interruption, response coordination, report
selection, and the larger research budget. The mocked session host also checks
that a progress-only response cannot launch another task. `preview-research.tsx`
renders sample data for visual QA of main/notch layouts; it does not perform
research. Real-world source quality and full browser investigations still need
live evaluation with the user's chosen model and browser permissions.

## GPT-5 research startup latency

The direct OpenAI `gpt-5` research worker now uses minimal reasoning while
planning and gathering evidence, and medium reasoning after a research record
enters comparing, synthesizing, complete, or blocked. Other models/providers and
ordinary requests retain their existing settings. The research manual requires
a stage update before comparison or synthesis. A progress-only step temporarily
removes updateResearch from the next step's active tools, preventing consecutive
plan-card loops while retaining real tool actions and final text.

The main loop records provider-stream-ready, reasoning-start/end, and
action-generation-start timing metadata; it does not log reasoning content.
Tool errors now settle their visible invocation instead of remaining running.

The local `scripts/probe-research-start.cjs` runs with the configured model and
tool definitions. It never executes browser/computer tools. `--effort=minimal`
compares the first action with the default; `--flow` uses the real chat loop,
executes only the side-effect-free research-record tool, and stops when another
tool is selected. It prints metadata and may print the generated final answer.

## Plan and first URL in one model call

`withResearchStart` composes the already permission-wrapped updateResearch and
openUrl tools into a desktop-worker `startResearch` action. The model supplies
a compact plan plus its first HTTP(S) URL together. Execution publishes a clean
planning record, then calls the existing URL wrapper immediately, with no model
round trip in between. Nested tool events preserve the research card and visible
URL action. Cancellation is checked before each operation; URL denial remains a
denial. The action is absent if either underlying tool is unavailable. Existing
tab requests and supplied plans use their appropriate browser tools directly.

Startup constructs empty evidence/source lists itself; the model cannot invent
read evidence in this initial record. The combined result participates in the
research step budget and reasoning-stage selection. startResearch is removed
from subsequent steps so a worker cannot repeatedly restart the plan.

### Single browsing owner and search-based startup

Realtime research now delegates planning and browsing to the worker; it must
not open a competing page or duplicate the plan before run_task. New worker
startup takes a query plus a supported search engine and optional browser;
the app encodes the query into a search URL. It no longer accepts a generated
article path in startResearch. User-supplied URLs and existing tabs remain
ordinary browser tasks. Explicit 404/503/access errors require an explained
fallback to an accessible result, not repeated waiting on the error page.

### Visible links only

The research policy requires reaching source pages by clicking links
visibly presented in the browser. Source addresses must not be invented,
copied, pasted, typed, or opened directly, including addresses supplied by a
search API. Search queries may be entered to obtain visible results. Visited
page URLs may still be recorded for citations.

The desktop worker's browser-research policy wraps existing tool executors,
retaining their permission gates. During research it refuses direct openUrl
calls except narrowly validated query-only Google/Bing/DuckDuckGo entry points,
URL-shaped typeText input, copy/paste keyboard chords, and webSearch API calls.
The policy activates for recognized research requests and when updateResearch
runs, including inside startResearch. Research and delegation instructions
require screenshot-grounded clicks and error recovery through visible links.
The coordinate-click tool itself does not prove a target is a visible link;
that grounding remains an agent instruction, not a DOM-level guarantee.
