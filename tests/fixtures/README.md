# Audio test fixture

`python-answer.wav` is a synthetic English voice generated with the Windows Microsoft Zira speech synthesizer. It says: "A list in Python is mutable. A tuple in Python is immutable."

It contains no person's microphone recording. The manual audio smoke check converts it to AAC/M4A, the container used by the iPhone recording path, and sends it to the deployed transcription server. This checks format and API integration, not a physical iPhone or Russian recognition accuracy.
