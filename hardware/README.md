# Hardware

Swen is software-first: everything works with typed values on a cheap Android
tablet. Hardware is added only where it saves time or catches mistakes, and
only with parts that can be bought and replaced locally.

Prices below are rough estimates to plan a budget, not quotes. Check local
suppliers and import costs before buying.

## 1. MEWS vitals cart

| Part | Notes | Rough cost (USD) |
|---|---|---|
| Android tablet, 8–10", Android 10+ | Needs Chrome. 3 GB RAM is enough. A rugged case matters more than speed. | 100–180 |
| Rugged case + screen protector | Drops and spills are the main failure. | 15–30 |
| Manual BP cuff + stethoscope | Always keep a manual fallback. | 20–40 |
| Pulse oximeter | Bluetooth optional (see below). | 20–80 |
| Digital thermometer | Bluetooth optional. | 10–40 |
| Rolling cart or wall bracket | Local welder or carpenter. | 30–80 |
| Power bank 20,000 mAh or a small solar kit | Keeps the tablet alive through outages. | 25–120 |

### Bluetooth devices: what works

The app reads devices that implement the **standard Bluetooth SIG health
profiles** — no vendor apps or SDKs:

| Measurement | Bluetooth service |
|---|---|
| Temperature | Health Thermometer (0x1809) |
| Blood pressure (+ pulse) | Blood Pressure (0x1810) |
| SpO₂ (+ pulse) | Pulse Oximeter (0x1822) |
| Heart rate | Heart Rate (0x180D) |

Many very cheap devices use their own private protocol instead. **Test before
buying in quantity:** install the free *nRF Connect* app on any Android phone,
scan while the device is on, and check that it advertises one of the service
numbers above. If it does, it will work with Swen.

Bluetooth reading works in **Chrome on Android** (installed app or browser
tab). It does not work on iPhones/iPads. Typing the values always works.

## 2. Smart supply cabinet

The software part (QR labels, scan to dispense, first-expiry-first-out, stock
and expiry alerts) needs no hardware beyond the tablet camera. Print labels
from the dashboard: **Supplies → Print QR labels**.

The optional door sensor adds an audit trail of when the cabinet was opened,
and a buzzer if it is left open.

| Part | Notes | Rough cost (USD) |
|---|---|---|
| ESP32 dev board (ESP32-WROOM-32) | Wi-Fi built in. | 5–10 |
| Magnetic reed switch (door contact, normally open) | Alarm-system type with screw terminals. | 2–5 |
| Active buzzer, 3.3–5 V | | 1–2 |
| 5 V USB power supply + cable | Or power from the cabinet's light circuit. | 5 |
| Small project box | | 3 |
| Lockable steel or wooden cabinet | Local fabrication. | 60–200 |

### Wiring

```
ESP32 GPIO 27 ── reed switch ── GND        (magnet on the door; closed = shut)
ESP32 GPIO 26 ── buzzer (+)
ESP32 GND     ── buzzer (−)
ESP32 5V/GND  ── USB power
```

### Firmware

`cabinet-esp32/cabinet-esp32.ino` — open in the Arduino IDE with the ESP32
board package installed, fill in the Wi-Fi name, password, server address and
the cabinet key from the dashboard (**Administration → Supply cabinets**), and
upload. The board:

- beeps if the door stays open more than 2 minutes, even with no Wi-Fi;
- buffers up to 64 door events while offline and sends them later;
- sends a heartbeat every 5 minutes, shown as "last sync" in the dashboard.

## Power

Power cuts are the normal case, not the exception. Plan for:

- tablets charged overnight, plus a power bank per cart;
- the server hosted in the cloud (Vercel + Neon) so it stays up when the
  clinic is down — tablets keep working offline and catch up later;
- if you run a local server instead, a UPS or solar battery for it.
