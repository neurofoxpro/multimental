# Device cold-start correction

On the first physical install of v0.1.0-alpha.20.1, ADB confirmed installation and the process ran, but a fixed 2.5-second readiness check ended before Godot initialized. The log later reported MULTIMENTAL_READY at 00:36:47 UTC on 2026-09-24. The installer correctly did not write a success receipt.

Replace the fixed delay with bounded polling for a real process and MULTIMENTAL_READY (up to 60 seconds), failing immediately on actual Godot/FATAL errors. Three regression tests cover delayed readiness, absent readiness and runtime errors. No data deletion, reinstall with a different key, or weakening of the success requirement is used.
