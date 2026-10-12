# Speak It Right

## Get the APK from GitHub
1. Create a GitHub repo and push all these files to the `main` branch.
2. Open the **Actions** tab, then **Build Android APK**. It runs on every push, or press **Run workflow**.
3. After ~10-15 min open the finished run and download **speak-it-right-apk** under *Artifacts*. Unzip it and install `app-release.apk`.
   (Enable "Install unknown apps" on the phone.)

No Expo account or token is needed. The APK is signed with the default debug key, which is fine for personal use.

## ESP32
Open `esp32/speak_it_right/speak_it_right.ino` in Arduino IDE and upload.
Green LED on GPIO 13, red LED on GPIO 12, each through a ~220 ohm resistor to GND.

## Note
Native BLE and voice modules do not work in Expo Go. Use the built APK.
