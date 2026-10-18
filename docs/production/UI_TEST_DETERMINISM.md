# Deterministic UI smoke fixtures

The dev run 35943910358 failed after PR8 even though its PR checks passed. Inspection showed 17 Node tests and core checks passing; the UI smoke failed to place a card. Its input was the real UI's wall-clock-seeded starting hand. A valid opening can contain only cost-2 cards while the player has one coin, so that fixture has no legal card placement. The old test incorrectly assumed every random opening had a playable card.

The fix changes tests only: after normal UI construction, reset the domain to seed 42 and explicitly assert that its legal play exists before exercising selection and placement. Add a separate expensive-only hand fixture; assert cards are disabled, passing works, and no unit appears. Player-facing card costs, starting hand, random draw and game rules are NOT changed to satisfy the test.

This is not handled by rerunning until a lucky hand passes. PR9 and the subsequent dev run must pass with these deterministic fixtures before a new successful prerelease is claimed. The last verified installed alpha.26.1 stays on the phone; foreground gameplay is not interrupted.
