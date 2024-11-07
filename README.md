# Chatbot METAGPT-4 Free [English]

This chatbot utilizes the free version of META using .

[Leer en español](README.es.md)

## Installation

1. Clone the repository to your local machine or server using `git clone https://github.com/andresayac/bot-wa-meta-ai.git`
2. Navigate to the cloned project directory and run `npm install` to install all the necessary dependencies.
3. Copy the `.env.example` file and rename it to `.env`. Then, fill in the necessary environment variables in the `.env` file.

## ENV Configuration
#### META AI Configuration
This section describes the necessary environment variables to configure the META AI service.

#### Environment Variables
- **META_AI_SYSTEM_MESSAGE**: System message used by the META AI assistant. It defines the behavior of the assistant in conversations.
- **META_AI_MODEL**: META AI model is default to 'meta-llama-3'



#### Configuration Variables BOT
- **BOT_LANGUAGE**: Default language used by the bot. It can be 'en' (English), 'es' (Spanish), 'fr' (French), 'de' (German), 'it' (Italian), 'pt' (Portuguese), 'zh' (Chinese), or 'ja' (Japanese).
- **BOT_RECONGNIZE_AUDIO**: Indicates whether the bot should recognize audio messages.
- **BOT_RECONGNIZE_PDF**: Indicates whether the bot should recognize PDF files.
- **BOT_TEXT_TO_SPEECH**: Indicates whether the bot should convert text to speech.
- **BOT_MESSAGE_ON_PROCESS**: Edit message in real time to show to users.

**Note**: Make sure to configure these environment variables correctly before running the bot for proper functionality.

## API META URL
Reference: [raycast-g4f](https://github.com/XInTheDark/raycast-g4f)

## Running the Bot
Once you have completed the `.env` file, you can start the bot by running `npm start`.
- To use the bot on WhatsApp it is necessary to scan the QR code from your WhatsApp as if you were going to link it on WhatsApp web, said QR code is in the file bot.qr.png

## Contribution
If you want to contribute to this project, feel free to do so. Any type of improvement, bug fix or new features are welcome.

## License
This project is licensed under the [MIT](LICENSE).
