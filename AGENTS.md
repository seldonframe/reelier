# Reelier execution paths

Pinned capability summary: Path A (`reelier mcp --wrap`) records live MCP traffic and applies its policy seatbelt; malformed policy fails open with a warning/attestation claim. Path B (`reelier run`) replays a frozen skill and fails closed on manifest/state-gate drift. Path C is opt-in compiled authority: it accepts a typed outcome request, validates standing signed authority and verified source state, then gates a sealed provider effect. It delegates outcomes, not credentials, and proves bounded scope rather than safety or content correctness.
