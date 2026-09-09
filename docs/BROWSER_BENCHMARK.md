# Repeatable browser benchmark

## Ask Dex to benchmark itself

After loading this build, say **“Dex, benchmark yourself.”** The built-in
`benchmarkDex` tool starts the local fixture automatically. Dex must perform all
three tasks with its normal computer controls, then read the measured result and
summarize it. Realtime uses its existing desktop worker for those screen actions;
pipeline mode uses the same tools directly. No terminal command is needed.

The first fully attempted suite (successes or timeouts, with no abandoned tasks)
becomes the saved baseline. Say **“Benchmark yourself again”** for a comparison,
or **“What are my benchmark results?”** to read the current run. Results persist
under Electron userData in `browser-benchmarks`, with a separate directory per run.
Baseline selection persists across app restarts; current-run status is in memory.
Duplicate starts reuse the active run. A hard five-minute limit starts when the built-in fixture opens, includes navigation
and waiting, and cancels its bound desktop worker as well as finalizing the fixture; a bound desktop worker ending or being cancelled now finalizes its
fixture immediately. Stopping a blocked run records unfinished tasks without replacing the
baseline. Dex must respect disabled Computer/Open skills and OS access requirements.

Benchmark comparison wording does not authorize research-source shortcuts. The
research policy permits `openUrl` only for the exact active main-owned benchmark
entry URL, still through its normal permission wrapper. Other localhost addresses,
fixture endpoints, modified URLs and expired run URLs receive no exception. During
work, spoken status questions preserve the worker; explicit Stop still cancels it.
Progress is read from fixture counts rather than inferred from completed clicks.

Metadata captures the app version, model, voice mode, display sizes/scales and
grants. Browser version/zoom and cold/warm state are not automatically observed;
keep those consistent. This measures the browser workflow, not automatic tuning.
After building, quit and relaunch Dex through the normal app entry point. Verify
that the request starts real browser actions, all three outcomes appear, and a
second request reports baseline deltas. Also verify denial and Stop. Build and
fixture tests do not establish live voice acceptance. On macOS, capture and
Accessibility grants belong to the launching app identity; development and
packaged launches may have different grants.

## Developer CLI

The developer CLI serves a private, loopback-only fixture site. Ask Dex to operate
it with the existing computer-control workflow. It does not start another agent,
change configuration, bypass permission gates, or connect to real shopping/accounts.
No additional dependencies, credentials or running-app update are required for the
harness itself. Dex still needs a configured vision-capable model, enabled Computer
and Open skills, their normal grants, and OS Screen Recording/Accessibility access.
A denied or unavailable capability is a setup blocker, not a reason to alter policy.

## Run a baseline and comparison

From this checkout:

```sh
pnpm benchmark:browser --out /tmp/dex-baseline --environment 'revision=<git SHA + dirty changes>; model=<provider/model/reasoning>; browser=<version>; viewport=1280x900; scale=2; OS=<version>; mode=pipeline; grants=Ask; state=warm'
```

Use real environment values. The CLI prints a unique local URL and a prompt. Give
that prompt to Dex in a fresh session. Dex opens the page, clicks **Start scenario**,
performs the task using screenshots and ordinary computer tools, and repeats for
the remaining scenarios until **Benchmark complete**. Do not help with clicks or
typing during measurement. If a permission prompt appears, answer normally and
record the grant policy consistently across runs. Use the same browser dimensions,
zoom, display scale, model, voice mode and cold/warm setup on every comparison.
Each step starts from clean fixture fields; reloading retains the measured step
and timer. Fixture controls deliberately do not navigate to external sites.

Read `/tmp/dex-baseline/report.md` and `report.json`. Press Ctrl+C to close the
server. Ctrl+C during a scenario records `aborted`; remaining tasks are `not-run`.
An active scenario times out at its budget and the next Start page becomes ready.
Waiting to press Start is unmeasured; there is no automatic desktop takeover.

After changing one variable, run:

```sh
pnpm benchmark:browser --out /tmp/dex-candidate --baseline /tmp/dex-baseline/report.json --environment '<same setup, record changed revision or variable>'
```

Repeat the printed prompt in a fresh Dex session. The resulting Markdown is both
the current run report and the comparison report: per-scenario status transitions,
time, misclick and score deltas. Negative time/misclick deltas and positive score
deltas indicate improvement. Time deltas are withheld unless both attempts succeeded.
Run several trials per revision; one noisy model run is not evidence of a trend.
The CLI refuses to overwrite an existing `report.json`, so use a new output folder.
While running, reports are partial checkpoints; only completed or Ctrl+C-finalized
reports should be used as baselines. Scenario/hash/order mismatches are rejected.

## Golden definitions and scoring

`benchmarks/browser/golden.json` supplies three scenarios: search and choose a
specific result; fill and submit a form; navigate settings and save a selection.
Pass `--suite path/to/suite.json` to use a custom set of three to five scenarios.
The strict Zod schema in `src/main/benchmarks/core.ts` is the format contract.
Each scenario has a unique ID, visible task, time budget, and ordered fixture steps.
Each step defines labelled button/input/select controls, one exact success button
and exact required field values. All criteria must be met in order; a wrong action
leaves the step unchanged. Add distractor buttons to measure target selection.
This is a bounded fixture workflow, not arbitrary HTML or a real-site test runner.
Definitions are validated before serving; task text is escaped, never executed.

The server checks clicks and form state against the golden criteria. It does not
trust a model's completion message. Timing uses the server's monotonic clock from
Start to final valid action, including subsequent reasoning, tool and permission
waits. It excludes URL opening, initial model latency and waits between scenarios.
Timeouts are capped at the scenario budget. A misclick is a document click outside
a control or on a non-goal button in that step. Input/select focus is allowed.
A correct button with wrong field values counts as an invalid submission instead.
Browser chrome, other windows, scroll accuracy and mouse movement are not measured.
Humans can complete the fixture too; attribution to Dex is an operator protocol,
not an anti-cheating guarantee. Client events require trusted browser interaction;
source/network inspection or scripted DOM actions invalidate a Dex benchmark.

For success, score is rounded to the nearest integer:

`100 × (0.70 + 0.20 × (1 − elapsedMs / budgetMs) + 0.10 / (1 + misclicks + invalidSubmissions))`

Failure, timeout, aborted and not-run score zero. The report includes mean score
and all raw counts; no score hides a failed task. Suite content and fixture/scoring version
are fingerprinted, preventing comparisons across changed goals or budgets. Bump
the version and schema when changing scoring semantics. Environment labels remain
operator supplied and are displayed for review, not silently assumed equivalent.

Given the same validated suite, environment and measured event timeline, JSON and
Markdown output are deterministic. Actual agent actions and elapsed times are
stochastic and are expected to differ. JSON retains the entire suite, ordered click
trace, step/revision, coordinates, submitted fixture values, outcome and elapsed
time for failure reproduction. It captures no screenshots, audio or conversations.
Use only synthetic data in custom fixtures; local output may contain typed values.
Keep run outputs outside the repository; no upload or recording is performed.

## Verification and activation

```sh
pnpm test:browser-benchmark
pnpm typecheck
pnpm build
```

Tests validate golden criteria, timing, exact event replay, misclick accounting,
timeouts/cancellation, comparison compatibility and escaping. They do not prove
Dex desktop or voice acceptance. To verify live, run baseline and candidate as
above, observe Dex completing every task without help, deliberately exercise one
wrong target in a separate labelled manual trial, and check failure/timeout output.
Confirm skill denial stops Dex instead of bypassing access. The CLI needs permission
to bind a local loopback port; if blocked, allow that operation through the existing
development environment approval path. It has no public network listener.

The CLI and the built-in skill share the main-process fixture server and scoring
implementation. CLI use requires no app restart; the new built-in skill requires
loading this build. This implementation does not restart Dex automatically.

## Control grounding and run limits

On macOS, Computer screenshots include bounded, read-only Accessibility observations
of the foreground window’s interactive controls. Centers are converted into the
latest screenshot coordinate space, including Retina scale and zoom crops. Dex
still uses its permission-gated mouse/keyboard controls and checks window freshness;
this does not execute page source or expose benchmark answers. Applications without
usable Accessibility trees retain the screenshot workflow. Field values and secure
text fields are excluded. Traversal is bounded and may omit some controls.

Clicking an input label correctly counts as field focus. Fixture version 2 prevents
comparing scores to the older label-misclick behavior. The built-in time limit also
persists a stop reason and never promotes an abandoned run to baseline. Existing
per-scenario limits remain unchanged. The standalone CLI does not own Dex’s worker;
use the built-in request for the hard worker cancellation guarantee.

Automatic benchmark voice updates announce only verified scenario outcomes, rather
than repeating periodic current-step snapshots that can become stale during speech.
An explicit status question reads fresh main-owned measurements when its response
can begin. Snapshot phrasing identifies the latest check; completed milestones are
past verified outcomes. The normal Stop behavior remains available.

The development build was live-tested with two uninterrupted Safari runs: all three
scenarios passed twice with zero misclicks. Scores were 96.33 and 97.00. The real
realtime model and desktop worker were used via typed Dex requests; this does not
establish acoustic voice acceptance or a long-term performance trend. See the
self-healing record for validation, artifact identifiers and remaining live gates.

## Recorded outcomes and consistency

`report.json` now includes `summary.status` (`running`, `succeeded`, `failed`,
`incomplete`, or `error`), aggregate counts/metrics, and a fixture snapshot with
revision, scenario index, step, started state and terminal completion signal.
Each finalized row retains timing, misclicks, invalid submissions, completed steps,
score and transition. Without a baseline the transition describes execution;
with a baseline it describes the baseline-to-current outcome. Row status `success`
means completed successfully; `not-run` is reserved for unstarted scenarios.
Mean score uses the whole suite denominator; elapsed time sums scenario durations
and excludes navigation and waits between scenarios. Zero errors are valid metrics.

The skill retains its lifecycle `status` (`running`/`finished`/`error`) and exposes
`outcome`, `metrics`, and `consistency` separately. A full successful run has
`outcome: succeeded`. The reports compare accepted fixture step signals, timing,
error counts and scoring with the rows. Inconsistencies retain the original evidence
and show explicit scenario-specific errors; they never repair records by guessing
success or replacing them with not-run. Inconsistent baselines are refused.

Writes replace each report atomically and verify its contents before acknowledging
success. Completion callbacks use only verified persisted snapshots. JSON and
Markdown are separate files, not a single crash-atomic transaction; an interrupted
write may leave different revisions, and JSON is the authoritative evidence.
A filesystem failure surfaces as a recording error in the fixture and host status;
it cannot promote a baseline. Existing historical reports are not rewritten.

After building and relaunching Dex, use a fresh session and request a benchmark. Let Dex complete all tasks
through its normal permission gates, then ask for benchmark status. Verify all
three rows have `success`, finite elapsed time, nonzero scores, error counts and
transitions, `summary.status: succeeded`, and `consistency.ok: true` in the run's
report.json. Confirm report.md and spoken summary agree, including after worker
completion. Repeat under the same browser conditions to verify baseline transitions.
Synthetic regression tests do not establish live desktop or acoustic acceptance.
