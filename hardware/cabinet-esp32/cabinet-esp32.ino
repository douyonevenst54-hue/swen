/*
 * Swen smart supply cabinet — door sensor firmware (ESP32, Arduino core 3.x)
 *
 * What it does
 *  - Watches a magnetic reed switch on the cabinet door.
 *  - Sounds a buzzer if the door is left open (works with no Wi-Fi at all).
 *  - Sends door open/close events to the Swen server; events that happen while
 *    Wi-Fi is down are buffered and sent later with how long ago they happened.
 *  - Sends a heartbeat every 5 minutes so the dashboard knows the cabinet is alive.
 *
 * Wiring (see hardware/README.md)
 *  - Reed switch: GPIO 27 <-> GND  (internal pull-up; closed = door shut)
 *  - Buzzer (active, 3.3 V): GPIO 26 -> buzzer + ; buzzer - -> GND
 *  - Status LED: on-board LED (GPIO 2 on most dev boards)
 *
 * Setup
 *  1. In the Swen dashboard: Administration -> Supply cabinets -> Add cabinet.
 *     Copy the cabinet key (shown once).
 *  2. Fill in the CONFIG section below, then upload with the Arduino IDE
 *     (board: "ESP32 Dev Module").
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ============================== CONFIG ==============================
const char* WIFI_SSID     = "your-wifi";
const char* WIFI_PASSWORD = "your-password";
// Your Swen server, no trailing slash, e.g. "https://swen.example.org"
const char* SERVER_URL    = "https://swen.example.org";
// Cabinet key from the dashboard (keep it secret).
const char* CABINET_KEY   = "paste-cabinet-key-here";
// Optional: PEM root certificate of your server's CA for strict TLS checking.
// Leave empty to encrypt without verifying the certificate (simpler, weaker).
const char* ROOT_CA_PEM   = "";

const int PIN_REED   = 27;
const int PIN_BUZZER = 26;
const int PIN_LED    = 2;

const unsigned long LEFT_OPEN_ALARM_MS = 2UL * 60UL * 1000UL;  // beep after 2 minutes open
const unsigned long HEARTBEAT_MS       = 5UL * 60UL * 1000UL;
const unsigned long DEBOUNCE_MS        = 60;
// ====================================================================

struct Event {
  bool open;
  unsigned long at;  // millis() when it happened
};

const int QUEUE_SIZE = 64;
Event queue[QUEUE_SIZE];
int qHead = 0, qCount = 0;

bool doorOpen = false;
bool lastRaw = false;
unsigned long lastRawChange = 0;
unsigned long openedAt = 0;
unsigned long lastSendAttempt = 0;
unsigned long lastHeartbeat = 0;

void enqueue(bool open) {
  if (qCount == QUEUE_SIZE) {  // full: drop the oldest
    qHead = (qHead + 1) % QUEUE_SIZE;
    qCount--;
  }
  queue[(qHead + qCount) % QUEUE_SIZE] = {open, millis()};
  qCount++;
}

bool readDoorOpen() {
  // Reed switch closes (pulls to GND) when the magnet on the door is near.
  return digitalRead(PIN_REED) == HIGH;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// Sends queued events (and optionally a heartbeat). Returns true on success.
bool flush(bool heartbeat) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (qCount == 0 && !heartbeat) return true;

  String body = "{\"events\":[";
  int n = qCount > 50 ? 50 : qCount;
  unsigned long now = millis();
  for (int i = 0; i < n; i++) {
    const Event& e = queue[(qHead + i) % QUEUE_SIZE];
    if (i) body += ",";
    body += "{\"type\":\"";
    body += e.open ? "door_open" : "door_close";
    body += "\",\"agoMs\":";
    body += String(now - e.at);
    body += "}";
  }
  if (heartbeat) {
    if (n) body += ",";
    body += "{\"type\":\"heartbeat\",\"agoMs\":0}";
  }
  body += "]}";

  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/v1/cabinet/events";
  bool ok;
  if (url.startsWith("https")) {
    if (strlen(ROOT_CA_PEM) > 0) secure.setCACert(ROOT_CA_PEM);
    else secure.setInsecure();
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) return false;
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + CABINET_KEY);
  int code = http.POST(body);
  http.end();

  if (code >= 200 && code < 300) {
    qHead = (qHead + n) % QUEUE_SIZE;
    qCount -= n;
    return true;
  }
  // 401: wrong key. Keep events; blink fast so someone notices.
  if (code == 401) for (int i = 0; i < 6; i++) { digitalWrite(PIN_LED, i % 2); delay(80); }
  return false;
}

void setup() {
  pinMode(PIN_REED, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  doorOpen = lastRaw = readDoorOpen();
  if (doorOpen) openedAt = millis();
  enqueue(doorOpen);  // report the state at power-up
  connectWifi();
}

void loop() {
  unsigned long now = millis();

  // ---- Door state with debounce ----
  bool raw = readDoorOpen();
  if (raw != lastRaw) {
    lastRaw = raw;
    lastRawChange = now;
  }
  if (raw != doorOpen && now - lastRawChange > DEBOUNCE_MS) {
    doorOpen = raw;
    if (doorOpen) openedAt = now;
    enqueue(doorOpen);
    lastSendAttempt = 0;  // send soon
  }

  // ---- Local alarm: works without any network ----
  bool alarm = doorOpen && now - openedAt > LEFT_OPEN_ALARM_MS;
  digitalWrite(PIN_BUZZER, alarm && (now / 500) % 2 == 0 ? HIGH : LOW);

  // ---- Network ----
  connectWifi();
  digitalWrite(PIN_LED, WiFi.status() == WL_CONNECTED ? HIGH : (now / 1000) % 2);
  bool heartbeatDue = now - lastHeartbeat > HEARTBEAT_MS;
  if ((qCount > 0 || heartbeatDue) && now - lastSendAttempt > 5000) {
    lastSendAttempt = now;
    if (flush(heartbeatDue) && heartbeatDue) lastHeartbeat = now;
  }

  delay(20);
}
