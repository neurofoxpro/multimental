class_name RoomCertificate
extends RefCounted
## Isolate a pinned-engine PEM serialization issue without disabling TLS validation.
static func pem(certificate: X509Certificate) -> String:
    if certificate == null:
        return ""
    var name: String = "user://room-public-cert-" + Crypto.new().generate_random_bytes(16).hex_encode() + ".crt"
    # Godot 4.7.2 save_to_string includes a NUL terminator in UTF-8 decoding.
    # save() writes a valid PEM without that terminator. This file is public cert only,
    # never a private key, and is removed before returning.
    if certificate.save(name) != OK:
        return ""
    var data: PackedByteArray = FileAccess.get_file_as_bytes(name)
    var removed: Error = DirAccess.remove_absolute(name)
    if removed != OK or data.is_empty() or data.size() > 8192 or data.has(0):
        return ""
    var text: String = data.get_string_from_utf8()
    if text.to_utf8_buffer() != data or not text.begins_with("-----BEGIN CERTIFICATE-----"):
        return ""
    return text
