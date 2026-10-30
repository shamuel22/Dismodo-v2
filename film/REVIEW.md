# Review — DISMODO film (2:34)

**Creative calls**
- Storyline 1, "One learner, one quarter": the same real problem ("one quarter of 20") runs from the hook to the evidence. Not built: "Two products, one engine" and "The trace first" (see `STORYLINES.md`).
- Hook = the feature itself: a real session with a sports example, then a tap on "I don't know this example" that turns it into a work project. The founder's story comes at 0:20, after the viewer has seen why it matters.
- Every screen is the real product, captured from a live session at 2x (`scripts/film-capture.mjs`, `scripts/film-capture-2.mjs`). The decisions, the latencies (Spark 3.8 s, Wonder 5.1 s), the event log and the MCP output (`scripts/film-mcp.mjs`) are real. Only the titles, the escalation labels and the list of allowed moves are drawn, and they use the package's and the console's own words.
- Voice: ElevenLabs "Brian" (eleven_v4), 13 lines normalised to −16 LUFS. Music: ElevenLabs music_v1, ambient at 88 BPM, ducked to 0.17 under the voice. Effects: ElevenLabs sound generation (click, two whooshes, a riser timed to the logo, typing).

**Measured, not heard**
- `hyperframes check`: 0 errors. 43 frames inspected across two passes. Fixed: the cursor missed its button, the code panel overflowed, the event log was unreadable, an MCP line overflowed, and a manager table showed an empty session.
- Loudness was measured on the source files. The final mix has not been listened to by anyone yet.

**Weakest shot**
- 1:07–1:16, the escalation board (Spark → Wonder → closed list). It is built type, not product UI. With more time it would come out of the console's decision card.

**Warnings kept**
- `line_unread` on the MCP outputs: the outputs are there to scan; the evidence line is highlighted and the camera leans in on it.
- `duplicate_media_discovery_risk`: the five marked cells are the same capture clipped five ways.
