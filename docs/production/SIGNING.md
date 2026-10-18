# Signing policy

Never publish a private signing key, including a development key. The skill's general discussion of public test keys is NOT enabled for Multimental.

The current station signs verified CI artifacts locally with a persistent private key. Receipts explicitly record the before/after hashes. This unblocks repeated USB updates without GitHub Secrets write access and without leaking a key. Do not present the CI ephemeral signature as suitable for long-term direct sideload updates or Google Play.

Later production setup: private keystore in approved GitHub environment secrets or externally controlled signer; same tested signed artifact published; protected stable gate. No implementation or success is claimed for that future step.
