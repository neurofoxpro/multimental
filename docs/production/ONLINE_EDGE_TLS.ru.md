# NET-06: Trusted TLS edge mode (experimental)

The existing `OnlineServer.listen(port, TLSOptions.server(key, cert), bind)` remains the default and requires TLS. Public clients continue to require `wss://` and non-null TLS options.

A Render/Koyeb deployment may terminate public TLS on the provider edge and forward WebSocket upgrades to the application as cleartext within the provider-managed ingress network. The new server-only `listen_trusted_edge(port, profile, bind)` is **opt-in** and requires an explicit profile:

```gdscript
var profile := {
    "kind": "trusted-platform-tls-edge-v1",
    "external_scheme": "wss",
    "provider": "render" # or "koyeb"
}
var error := server.listen_trusted_edge(10000, profile, "0.0.0.0")
```

The profile is a deployment assertion, **not** cryptographic proof of origin. Never expose the cleartext backend directly, bind it through an untrusted port-forward, or enable it for arbitrary hosting. The deployment must enforce TLS/WSS at its public edge and prevent bypass connections to its backend. Do not put secrets or personal device identity in the profile. An attacker with direct backend network access can bypass TLS; provider network restrictions are a necessary external condition.

This increment intentionally adds no hosting credentials, deployment, persistence or claim of a public endpoint. In-memory rooms are lost on restart; reconnect to a missing room must return `room_missing`. Measured external WSS end-to-end tests, reconnect-grace fixes, cold-start, RAM/CPU quota and human acceptance remain open. The adapter changes no match rules, save profiles, Bluetooth/LAN transport or public client URL policy.
