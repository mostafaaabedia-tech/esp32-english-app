import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Button, Alert, TouchableOpacity } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import Voice from '@react-native-community/voice';

const ESP32_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const ESP32_CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea0730544b34";

const sentences = {
  Beginner: ["The cat sat on the mat.", "She has a red apple.", "I like to run and jump.", "The sun is very hot today.", "He plays with his big dog.", "We eat rice and fish for dinner.", "My mother makes good soup.", "The bird flies in the blue sky.", "Look at the tall green tree.", "I read a book before bed.", "The baby is crying for milk.", "Put the pen on the desk.", "They went to the park by bus.", "Can you see the yellow star?", "He has two black shoes.", "We drink water when we are thirsty.", "The frog jumps into the pool.", "Please close the front door.", "I want to buy a new toy.", "She sings a sweet song.", "The man is driving a truck.", "Do you want some hot tea?", "The wind blows the leaves away.", "My hands are cold in winter.", "The clock strikes twelve at noon.", "I found a shell on the beach.", "He is fixing his broken bike.", "She has a beautiful smile.", "The duck swims in the lake.", "We walk to school every day.", "The dog chased the small cat.", "I can hear the loud music.", "Please pass the salt and pepper.", "The train is coming to the station."],
  Intermediate: ["She carefully wrapped the fragile present.", "They’re going to put their bags over there.", "If I had known, I would have gone to the bakery.", "The fierce wind howled through the dark alley.", "He realized his mistake immediately.", "The museum exhibited ancient artifacts.", "Would you prefer coffee or herbal tea?", "She thoroughly enjoyed the theater performance.", "The mountain path was dangerously steep.", "He couldn’t decide which dessert to order.", "The submarine explored the depths of the ocean.", "I usually walk to work, but today I drove.", "The lawyer presented a compelling argument.", "She wore a comfortable, thick sweater.", "The robot performed complex calculations instantly.", "We watched the breathtaking sunset from the balcony.", "The doctor measured the patient's blood pressure.", "He is responsible for organizing the conference.", "The legendary sword was hidden in the cave.", "She wrote a detailed report on the economy.", "The exotic bird had brightly colored feathers.", "They are building a massive bridge across the river.", "The comedian told a hilarious joke.", "He accidentally dropped his phone into the puddle.", "The scientist discovered a new species of plant.", "She speaks three languages fluently.", "The orchestra played a beautiful symphony.", "He was exhausted after the grueling marathon.", "The fragile glass shattered into a thousand pieces.", "We need to schedule a meeting for tomorrow.", "The politician made a controversial statement.", "She was thrilled to receive the prestigious award.", "The heavy rain caused severe flooding."],
  Advanced: ["The aforementioned regulations supersede all prior legislation.", "She thoroughly thought through the theoretical thesis.", "Peter Piper picked a peck of pickled peppers.", "The charismatic entrepreneur established several successful startups.", "Isomorphic structures exhibit identical geometrical properties.", "The philosophical discourse explored existential themes.", "His belligerent demeanor alienated his prospective colleagues.", "The ethereal mist enveloped the desolate landscape.", "She eloquently articulated her nuanced perspective.", "The idiosyncratic scientist challenged conventional paradigms.", "A plethora of bureaucratic obstacles hindered progress.", "The clandestine operation was successfully executed.", "He possessed an insatiable thirst for knowledge.", "The ubiquitous nature of the internet is undeniable.", "Her ostentatious display of wealth was distasteful.", "The menacing locomotive hurtled down the track.", "They perused the ancient manuscript with great scrutiny.", "The convoluted plot confused the bewildered audience.", "A multifaceted approach is required to solve this.", "The juxtaposition of light and shadow created depth.", "He was known for his meticulous attention to detail.", "The archaic language made the text difficult to decipher.", "She demonstrated unparalleled proficiency in astrophysics.", "The ambivalent protagonist struggled with his morality.", "An unexpected anomaly disrupted the chronological sequence.", "The cacophony of the city was overwhelming.", "He extrapolated the data to reach a logical conclusion.", "The ubiquitous phenomenon continues to fascinate researchers.", "A ubiquitous, albeit ephemeral, sense of joy permeated the room.", "The rigorous curriculum prepared students for university.", "She gave a comprehensive analysis of the geopolitical situation.", "The diaphanous curtains fluttered in the gentle breeze.", "In retrospect, the strategic maneuver was a catastrophic failure."]
};

export default function App() {
  const [currentLevel, setCurrentLevel] = useState('Beginner');
  const [currentSentence, setCurrentSentence] = useState('Select a level');
  const [resultText, setResultText] = useState('Waiting...');
  const [bleStatus, setBleStatus] = useState('Disconnected');
  
  const manager = new BleManager();

  useEffect(() => {
    Voice.onSpeechResults = onSpeechResults;
    Voice.onSpeechError = (e) => setResultText("Error: " + e.error);
    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  const onSpeechResults = (event) => {
    let spokenText = event.value[0].toLowerCase().replace(/[.,!?]/g, '').trim();
    let targetText = currentSentence.toLowerCase().replace(/[.,!?]/g, '').trim();
    
    if (spokenText === targetText) {
      setResultText("✅ CORRECT! Well done.");
      sendToESP32('c');
    } else {
      setResultText("❌ WRONG. You said: " + spokenText);
      sendToESP32('w');
    }
  };

  const sendToESP32 = async (command) => {
    // This requires a connected device. In a full app, you'd store the device object.
    // For brevity, this assumes you've scanned and connected.
    Alert.alert("Sent to ESP32", "Command: " + command);
    // Example write code (requires device object):
    // device.writeCharacteristicWithResponseForService(ESP32_SERVICE_UUID, ESP32_CHAR_UUID, btoa(command));
  };

  const getRandomSentence = () => {
    sendToESP32('r');
    const list = sentences[currentLevel];
    setCurrentSentence(list[Math.floor(Math.random() * list.length)]);
    setResultText("Ready to listen...");
  };

  const startListening = async () => {
    try { await Voice.start('en-US'); } catch (e) { console.error(e); }
  };

  const connectBluetooth = async () => {
    setBleStatus("Scanning...");
    // Scanning logic goes here. React Native BLE PLX requires native build.
    setBleStatus("Found ESP32 (Connect in production build)");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🗣️ Speak-It-Right</Text>
      
      <Button title={bleStatus} onPress={connectBluetooth} color="#007bff" />

      <View style={styles.levelSelector}>
        <Button title="Beginner" onPress={() => setCurrentLevel('Beginner')} />
        <Button title="Inter." onPress={() => setCurrentLevel('Intermediate')} />
        <Button title="Advanced" onPress={() => setCurrentLevel('Advanced')} />
      </View>

      <View style={styles.sentenceCard}>
        <Text style={styles.sentenceText}>{currentSentence}</Text>
      </View>

      <TouchableOpacity style={styles.micButton} onPress={startListening}>
        <Text style={styles.micText}>🎙️ Read Sentence</Text>
      </TouchableOpacity>

      <Button title="Next Sentence" onPress={getRandomSentence} />

      <Text style={styles.resultText}>{resultText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', alignItems: 'center', padding: 20, paddingTop: 50 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  levelSelector: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 20 },
  sentenceCard: { backgroundColor: 'white', padding: 30, borderRadius: 15, width: '100%', alignItems: 'center', minHeight: 100, justifyContent: 'center', marginBottom: 20 },
  sentenceText: { fontSize: 18, textAlign: 'center' },
  micButton: { backgroundColor: '#28a745', padding: 15, borderRadius: 30, width: '100%', alignItems: 'center', marginBottom: 10 },
  micText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  resultText: { marginTop: 20, fontSize: 16, fontWeight: 'bold', textAlign: 'center' }
});
