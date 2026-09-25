import json
import subprocess
import os

try:
    subprocess.run(["pkill", "-9", "-f", "/opt/Polar/polar"], capture_output=True)
except Exception:
    pass

path = "/home/elogic360/.polar/networks/networks.json"
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

net = next((n for n in data["networks"] if n["id"] == 2), None)
if net:
    net["status"] = 1
    for b in net["nodes"]["bitcoin"]:
        b["status"] = 1
    for l in net["nodes"]["lightning"]:
        l["status"] = 1

chart = data["charts"]["2"]
chart["nodes"]["backend1"]["properties"]["status"] = 1
chart["nodes"]["alice"]["properties"]["status"] = 1
chart["nodes"]["bob"]["properties"]["status"] = 1
chart["nodes"]["carol"]["properties"]["status"] = 1

# Ports
chart["nodes"]["alice"]["ports"]["98d9451b7879"] = {
    "id": "98d9451b7879",
    "type": "right",
    "properties": {
        "nodeId": "alice",
        "initiator": True,
        "hasAssets": False
    }
}
chart["nodes"]["alice"]["ports"]["05fa2412c6f2"] = {
    "id": "05fa2412c6f2",
    "type": "right",
    "properties": {
        "nodeId": "alice",
        "initiator": True,
        "hasAssets": False
    }
}

chart["nodes"]["bob"]["ports"]["98d9451b7879"] = {
    "id": "98d9451b7879",
    "type": "left",
    "properties": {
        "nodeId": "bob",
        "initiator": False,
        "hasAssets": False
    }
}

chart["nodes"]["carol"]["ports"]["05fa2412c6f2"] = {
    "id": "05fa2412c6f2",
    "type": "left",
    "properties": {
        "nodeId": "carol",
        "initiator": False,
        "hasAssets": False
    }
}

# Links
chart["links"]["98d9451b7879"] = {
    "id": "98d9451b7879",
    "from": {
        "nodeId": "alice",
        "portId": "98d9451b7879"
    },
    "to": {
        "nodeId": "bob",
        "portId": "98d9451b7879"
    },
    "properties": {
        "type": "open-channel",
        "channelPoint": "62c64b157674fc1ff477550bc4ed849ffdf24def20b5b4237d7598d9451b7879:0",
        "capacity": "1000000",
        "fromBalance": "522530",
        "toBalance": "474000",
        "direction": "ltr",
        "status": "Open",
        "isPrivate": False
    }
}

chart["links"]["05fa2412c6f2"] = {
    "id": "05fa2412c6f2",
    "from": {
        "nodeId": "alice",
        "portId": "05fa2412c6f2"
    },
    "to": {
        "nodeId": "carol",
        "portId": "05fa2412c6f2"
    },
    "properties": {
        "type": "open-channel",
        "channelPoint": "eb4b94ab89de29e05a36611c2321de958881d8ddb49b8ea8d89505fa2412c6f2:0",
        "capacity": "1000000",
        "fromBalance": "496530",
        "toBalance": "500000",
        "direction": "ltr",
        "status": "Open",
        "isPrivate": False
    }
}

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print("SUCCESS: networks.json updated.")
