# VITTIQO
### Your money. Your language. Your intelligence.

<p align="center">
  <strong>A Multilingual AI-Powered Personal Finance Assistant</strong>
</p>

Vittiqo is a mobile personal finance application designed to make everyday expense management more accessible through voice interaction, AI-powered expense extraction and personalised financial insights.

It allows users to record expenses manually or describe transactions naturally through speech, review extracted details, monitor budgets and understand their spending patterns.

## Project Pitch

📄 **[Read the One-Page Vittiqo Project Pitch](docs/Vittiqo_Project_Pitch.pdf)**

## Key Features

- **Voice Expense Entry:** Record expenses using natural speech.
- **Multilingual Interaction:** Integrates Gnani Prisma and Timbre, whose published model capabilities cover 10+ Indian/Indic languages.
- **AI Expense Extraction:** Uses Google Gemini to identify transaction amounts, categories and dates from natural-language descriptions.
- **FinBot AI Assistant:** Provides conversational assistance and contextual financial insights.
- **Text-to-Speech:** Listen to generated financial responses using Gnani Timbre.
- **Expense Management:** Add, organise and review transactions.
- **Budget Tracking:** Set budgets and monitor category-wise spending.
- **Reports and Analytics:** Visualise spending patterns and financial activity.

## Technology Stack

| Technology | Purpose |
|---|---|
| React Native | Mobile application framework |
| Expo SDK 54 | Application development and builds |
| TypeScript | Application implementation |
| Appwrite | Authentication, database, storage and backend functions |
| Gnani Prisma | Speech-to-text |
| Gnani Timbre | Text-to-speech |
| Google Gemini | Natural-language processing and financial assistance |

## Voice Expense Workflow

1. The user records an expense description.
2. The audio is uploaded to Appwrite Storage.
3. An Appwrite Function sends the recording to Gnani Prisma for transcription.
4. Gemini extracts structured expense information from the transcript.
5. The user reviews the extracted details.
6. The confirmed expense is saved to the user's account.

## Getting Started

### Prerequisites

- Node.js
- npm
- Expo-compatible development environment
- An Appwrite project

### Installation

Clone the repository:

```bash
git clone https://github.com/Mysticlynxz/finance-tracker-app.git
cd finance-tracker-app
```

Install dependencies:

```bash
npm install
```

Configure the required environment variables using `.env.example`.

Start the Expo development server:

```bash
npx expo start
```

## Environment and Security

Vittiqo uses public Appwrite configuration values in the mobile application and protected credentials in its backend Functions.

Provider API keys, including `GNANI_API_KEY` and `GEMINI_API_KEY`, must remain server-side and must never be embedded in the mobile application.

Never commit populated `.env` files or private API credentials.

## Project Repository

**GitHub:** https://github.com/Mysticlynxz/finance-tracker-app

## Development

Vittiqo was developed with AI-assisted programming tools for implementation support, debugging and testing. Product decisions, integration choices and application verification form part of the project development process.

---

**VITTIQO**

*Your money. Your language. Your intelligence.*