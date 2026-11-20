extends SceneTree
const Invite = preload("res://src/net/room_invite.gd")
func _initialize() -> void:
    var values: Array = [
        {"name": "tun0", "friendly": "VPN", "addresses": ["10.1.1.1"]},
        {"name": "seth_lte8", "addresses": ["10.41.4.2"]},
        {"name": "wlan0", "addresses": ["192.168.0.12", "::1"]},
        {"name": "Ethernet", "friendly": "Ethernet 2", "addresses": ["192.168.0.199"]},
        {"name": "lo", "addresses": ["127.0.0.1", "8.8.8.8"]}
    ]
    var choices: Array = Invite.address_options(values)
    if choices.size() != 4 or choices[0].address != "192.168.0.12" or choices[1].address != "192.168.0.199":
        printerr("PRODUCTION_TEST_FAIL: prefer real local interfaces and filter public/loopback addresses")
        quit(1)
        return
    print("MULTIMENTAL_ADDRESSES_PASS wifi_preferred=true selectable=true")
    quit(0)
