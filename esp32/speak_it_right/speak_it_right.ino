#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea0730544b34"

// NOTE: GPIO12 is a boot-strapping pin. It works with an LED + resistor to GND,
// but if you ever get boot problems, move the red LED to GPIO 26 or 27.
const int GREEN_LED = 13;
const int RED_LED   = 12;

volatile bool restartAdvertising = false;
volatile bool winBlink = false;

void setLeds(bool green, bool red) {
  digitalWrite(GREEN_LED, green ? HIGH : LOW);
  digitalWrite(RED_LED,   red   ? HIGH : LOW);
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) {
    Serial.println("Phone connected");
  }
  void onDisconnect(BLEServer* server) {
    Serial.println("Phone disconnected");
    setLeds(false, false);
    restartAdvertising = true;   // handled in loop() so the phone can reconnect
  }
};

class WriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) {
    // 'auto' works with both std::string (core 2.x) and Arduino String (core 3.x)
    auto value = characteristic->getValue();
    if (value.length() == 0) return;

    char command = value[0];
    Serial.printf("Received: %c\n", command);

    switch (command) {
      case 'c': setLeds(true,  false); break;  // correct
      case 'w': setLeds(false, true);  break;  // wrong
      case 'r': setLeds(false, false); break;  // reset
      case 'v': winBlink = true;       break;  // victory! (blink handled in loop)
      default:  break;
    }
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  setLeds(false, false);

  BLEDevice::init("SpeakItRight");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);
  BLECharacteristic* characteristic = service->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
  characteristic->setCallbacks(new WriteCallbacks());
  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);   // lets the device name show up in scans
  BLEDevice::startAdvertising();

  Serial.println("ESP32 BLE ready. Open the app and tap Connect.");
}

void loop() {
  if (winBlink) {
    winBlink = false;
    for (int i = 0; i < 6; i++) {        // alternate green/red 6 times
      setLeds(true, false);
      delay(150);
      setLeds(false, true);
      delay(150);
    }
    setLeds(true, false);                // finish with green on
  }

  if (restartAdvertising) {
    delay(300);                          // give the BLE stack a moment
    BLEDevice::startAdvertising();
    restartAdvertising = false;
    Serial.println("Advertising restarted");
  }
  delay(20);
}
