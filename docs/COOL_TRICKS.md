# Cool tricks

Say “Dex, show me something cool” to select and perform one built-in demo.
“Show me another trick” chooses another eligible recipe. “What tricks do you
know?” lists available demos without running them. You can also request a title
from that list, or say “show the constellation” to open that playground scene.

The skill is enabled by default and can be disabled in Settings → Skills & tools.
It works through the normal text/pipeline and realtime tool loops. A demo never
automatically starts recording; use Settings → Recordings first to capture it.

## Starter library

| Trick | Demonstrates | Needs |
| --- | --- | --- |
| Gravity playground | Local interactive visuals, orbit/constellation, pointer and keyboard input | Cool tricks |
| Two cities, one moment | Live weather and time comparison | Weather, clock, network |
| A small jump through time | Live date-line comparison | Clock |
| A tiny rabbit hole | Opening a search directly in the browser | Open apps & URLs |
| Window boomerang | Minimize and restore the same Safari window | macOS, Open, computer control, Accessibility |
| Screen detective | A fresh screen observation with a useful next step | Computer control, screen access, vision-capable desktop agent |

Selection uses enabled/configured skills and standing permissions. Desktop demos
also check macOS system permissions. Network services can still fail at runtime;
the agent is instructed to stop and explain rather than fake success. Normal
sensitive-tool prompts still apply. Recipes stop on errors, denial, or a new user
request. No step may bypass a disabled skill or start an indefinite demo loop.

The first surprise favors the visual playground. After that, selection rotates
randomly through the eligible library without repeats until the cycle is used up.
Selection history lasts for the current app run and includes explicitly requested
tricks. Choosing a recipe counts as a selection, even if a later action fails.

## Adding a trick

Add a `Trick` entry in `src/skills/tricks/catalog.ts`:

1. Give it a stable ID, short title, description, and optional spoken inspiration in `intro`.
2. Declare every required skill and any platform/screen requirements.
3. Provide tool steps with concrete inputs or clear instructions for the normal
   agent loop. Use existing direct tools where possible; delegate visual work.
4. Define what evidence counts as success and how to stop on failure.
5. Add eligibility or selection tests where the new dependency changes behavior.

For a capability Dex does not yet have, build it as a normal self-contained skill
first, with its own metadata, permission requirements, implementation, and tests.
Then compose it into a demo recipe. Recipes should demonstrate working capability,
not promise functionality that is still on the roadmap.

`chooseTrick` returns `selected_not_performed` deliberately. The model must execute
the returned steps through the normal tool set. It does not directly call sensitive
tools from inside the chooser, so the existing permission and interruption paths
remain in use. Main-only `SkillExecutionContext` supplies the configured capability
snapshot without sending config or secrets in a tool result.

The playground is a reusable local Electron window (`#playground?scene=…`). It is
a built-in particle illustration, not a physical simulation or newly generated app.
It respects reduced-motion preferences on startup and has keyboard controls. Its
window is independent of the notch and the main voice session.

## Checks

`node_modules/.bin/tsx --test scripts/test-tricks.ts`

Checks availability, permission/platform exclusions, no-repeat cycles, unavailable
explicit requests, and the distinction between selection and execution.

## Spoken style

Perform the demo without announcing selection or narrating each step. Intros are
optional inspiration, not scripts. Visual demos usually need at most one short
comment or interaction hint, with no closing capability recap. Information demos
should deliver the interesting finding. Success criteria and verification metadata
guide honest behavior internally; they are not spoken disclaimers. Explain real
failures or uncertainty only when they affect the requested result.

Screen detective uses the permission-gated `describeScreen` direct tool, which
captures once and runs one bounded vision request. It does not delegate a general
desktop loop or use the older wake snapshot. It reports relevant observations
rather than listing generic interface furniture, and never clicks or types.
