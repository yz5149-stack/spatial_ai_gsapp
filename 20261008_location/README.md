# spatial_ai_gsapp
**ARCH6956-1, Columbia GSAPP. Assignment: Location.**

An LLM-only spatial model: a prompt that has the model keep a written STATE of rooms, agents, objects and beliefs, tested through a series of trial runs, plus an interactive lab page that draws each STATE in 3D and checks it against the rules.

**Live page:** https://ryan-ram.github.io/spatial_ai_gsapp/20261008_location/web/

Opening `web/index.html` on GitHub only shows its source code. Use the live page above, or open the file locally in a browser. Chat with Claude works when the page is opened on claude.ai; Import and the rule checker work anywhere.

## Contents

1. [`prompts/spatial_model.md`](prompts/spatial_model.md) — the spatial model prompt (the rules).
2. [`trials/`](trials/) — seven trial runs. Each one tests the current rules and lists the gaps that the next version fixed. See [`trials/README.md`](trials/README.md) for the overview.
3. [`web/`](web/) — the interactive lab page (`index.html`), its source (`lab.src.html`) and `build.py`.
