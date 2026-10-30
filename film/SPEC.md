# DISMODO — 3-minute film for the judges

GOAL:    a judge who watched once can say "DISMODO is an engine that adapts how people learn, inside anyone's product, and shows its evidence" — and remembers the learner who tapped "I don't know this example".
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps.
TIME:    154 s x 30 = 4620 frames. Narrated: the voice is the clock (ElevenLabs "Brian", eleven_v4). Music bed: ElevenLabs music_v1, 88 BPM ambient, -0.14 under voice.
LOOK:    the design spec (v3.0). Ground #141517 with one plum radial at 8.5% (rgb 91 72 116); surfaces #1C1D20; ink #F3F0E9; secondary #AAA8AD.
         Accent pear #D7FF7F, rationed: the click, the one key word per title, the logo. Lavender #B39CFF only for adaptive help and the model (Muse) moments.
         Display Space Grotesk 500, titles 72–96 px, -2% tracking. Body Inter 400. Code JetBrains Mono 26–30 px.
         The medium is the real product UI, captured at 2x from a live session (Muse Spark and Muse Wonder answering live), shown at 1.4–2x.
         Acme world is the one light world (#F8FAFC) — a different product, so a different ground.
OBJECTS: the session card (real), the cursor (system arrow, 64 px), the package JSON (real excerpt), a terminal (real CLI and MCP output), the console trace (real), the brand atlas (approved logo PNG).
MOTION:  arrivals expo.out 0.5–0.7 s; camera power2.inOut 0.8–1.2 s; exits power3.in 0.25 s; titles per word blur 6px→0, 0.08 s apart, then dead still.
         Brand open: pages rotateY ±83°→0 in 0.95 s, book glides from centre at +0.51 s, word emerges at +0.65 s (the design spec §9 timings).
SHOTS:   0–19.6 open: sports problem pushed in → cursor taps "I don't know this example" → same problem, work project → five tasks marked → "The example changed. The goal didn't."
         19.6–37 origin: kinetic type, "I'm bad at math." struck through by a pear line → "a question to investigate".
         37–51 reveal: brand opens, "for builders and AI agents", the founder's phrase types under it.
         51–66.5 package: real JSON, lines lit as named → terminal `dismodo validate` ✓.
         66.5–97 practice: 6 of 8 marked, "Sure" → escalation chip Spark→Wonder → closed list, contrast picked → reviewed card with hypothesis → learner pushes back.
         97–108 proof: held-out problem, 2 of 2. 108–118 trace: console columns lit in turn. 118–130 Acme: colour flood to light, embedded session, manager evidence.
         130–141 MCP: three real tool calls. 141–154 claim + end card.
BANNED:  invented UI or numbers; glow, particles, neon; purple gradients; three cards in a row; logo docked in a corner; titles drifting after they land; every element fading and sliding up; real API keys or learner tokens on screen.
QA:      t=0.5 (thumbnail reads), 10.6 (swap), 18 (title), 31 (strike), 40 (logo), 62 (validate), 80 (Wonder chip), 104 (2 of 2), 124 (Acme), 136 (MCP), 150 (end card).
