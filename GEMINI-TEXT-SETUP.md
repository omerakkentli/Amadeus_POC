# Gemini Text API Setup & Connection

Quick reference for using Google's Gemini Text API for text generation, analysis, and AI-powered features.

## Prerequisites

- Google Cloud project with Gemini API enabled
- API key stored in Secret Manager (or use directly)
- Node.js 18+

## API Key Setup

### Option 1: Google Cloud Secret Manager (Recommended)

```typescript
// src/connectors/secret-manager.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

export async function getGeminiApiKey(): Promise<string> {
  const projectId = '894145150101';
  const secretName = 'chat-genai-token';
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
  
  const [version] = await client.accessSecretVersion({ name });
  const payload = version.payload?.data?.toString();
  
  if (!payload) throw new Error('Secret not found');
  return payload;
}
```

### Option 2: Direct API Key

```typescript
const GEMINI_API_KEY = 'your-api-key-here';
```

## Basic Connection & Text Generation

```typescript
// src/connectors/gemini-text.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey } from './secret-manager.js';

// Initialize client
const apiKey = await getGeminiApiKey();
const genAI = new GoogleGenerativeAI(apiKey);

// Get model
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.0-flash'
});

// Simple text generation
async function generateText(prompt: string): Promise<string> {
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// Usage
const response = await generateText('Explain quantum computing in simple terms');
console.log(response);
```

## Configuration

```typescript
// src/common/config.ts
export const GEMINI_CONFIG = {
  // Model selection
  TEXT_MODEL: 'gemini-2.0-flash',              // Fast, efficient
  ADVANCED_MODEL: 'gemini-1.5-pro',            // More capable, slower
  
  // Generation parameters
  TEMPERATURE: 1.0,                            // Creativity (0-2)
  TOP_P: 0.95,                                 // Nucleus sampling
  TOP_K: 40,                                   // Top-k sampling
  MAX_OUTPUT_TOKENS: 8192,                     // Response length limit
  
  // Safety settings
  SAFETY_THRESHOLD: 'BLOCK_MEDIUM_AND_ABOVE'
};
```

## Advanced Features

### 1. Structured JSON Output

```typescript
import { SchemaType } from '@google/generative-ai';

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    keyPoints: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING }
    },
    confidence: { type: SchemaType.NUMBER }
  },
  required: ['summary', 'keyPoints']
};

const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: schema
  }
});

const result = await model.generateContent('Analyze this text...');
const data = JSON.parse(result.response.text());
// { summary: "...", keyPoints: [...], confidence: 0.95 }
```

### 2. Search Grounding (Web Search)

```typescript
import { DynamicRetrievalMode } from '@google/generative-ai';

const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  tools: [{
    googleSearch: {}  // Enable web search
  }],
  toolConfig: {
    functionCallingConfig: {
      mode: DynamicRetrievalMode.MODE_DYNAMIC  // Auto-trigger search
    }
  }
});

const result = await model.generateContent(
  'What is the current stock price of Tesla?'
);
// Gemini searches web and provides current data
```

### 3. Multi-Turn Conversations

```typescript
const chat = model.startChat({
  history: [
    { role: 'user', parts: [{ text: 'Hello!' }] },
    { role: 'model', parts: [{ text: 'Hi! How can I help?' }] }
  ]
});

const result = await chat.sendMessage('Tell me about your previous response');
// Maintains conversation context
```

### 4. System Instructions (Persona)

```typescript
const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  systemInstruction: {
    parts: [{
      text: 'You are a senior technical interviewer with 15 years of experience. Be concise and professional.'
    }]
  }
});

const result = await model.generateContent('Ask me a coding question');
// Responds with interviewer persona
```

### 5. Long Context Processing

```typescript
// Gemini 2.0 Flash supports up to 1M tokens
const longDocument = readFileSync('large-document.txt', 'utf-8');

const result = await model.generateContent([
  { text: 'Summarize the key findings from this document:' },
  { text: longDocument }  // Can be very large
]);
```

## Real-World Examples from Project

### Conversation Compression

```typescript
export async function compressConversation(
  transcript: TranscriptTurn[]
): Promise<string> {
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.0-flash' 
  });
  
  const transcriptText = transcript
    .map(t => `${t.speaker}: ${t.text}`)
    .join('\n');
  
  const prompt = `Compress this conversation to 2-3 paragraphs, preserving key information:

${transcriptText}`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}
```

### Intent Detection

```typescript
export async function detectIntent(
  transcript: TranscriptTurn[],
  goals: string[]
): Promise<IntentResult> {
  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      completion: { type: SchemaType.NUMBER },
      answeredQuestions: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING }
      },
      nextAction: { type: SchemaType.STRING }
    }
  };
  
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  });
  
  const prompt = `Analyze this interview conversation and determine completion status.

Goals: ${goals.join(', ')}

Conversation:
${transcript.map(t => `${t.speaker}: ${t.text}`).join('\n')}`;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}
```

### Company Analysis with Search

```typescript
export async function analyzeCompany(
  companyUrl: string
): Promise<{ summary: string; idealCustomers: string[] }> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{ googleSearch: {} }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          summary: { type: SchemaType.STRING },
          idealCustomers: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING }
          }
        }
      }
    }
  });
  
  const prompt = `Research this company and provide:
1. A brief summary (2-3 sentences)
2. Their ideal customer profiles

Company: ${companyUrl}`;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}
```

## Error Handling

```typescript
import { GoogleGenerativeAIError } from '@google/generative-ai';

try {
  const result = await model.generateContent(prompt);
  return result.response.text();
} catch (error) {
  if (error instanceof GoogleGenerativeAIError) {
    console.error('Gemini API Error:', error.message);
    
    // Handle specific error types
    if (error.message.includes('quota')) {
      // Rate limit exceeded
    } else if (error.message.includes('safety')) {
      // Content filtered by safety settings
    }
  }
  throw error;
}
```

## Rate Limits & Best Practices

**Rate Limits** (Gemini 2.0 Flash):
- 15 requests per minute (RPM)
- 1 million tokens per minute (TPM)
- 1,500 requests per day (RPD)

**Best Practices**:
1. **Cache API key** - Don't fetch from Secret Manager on every request
2. **Reuse model instances** - Don't recreate `GoogleGenerativeAI` unnecessarily
3. **Handle rate limits** - Implement exponential backoff
4. **Use streaming** - For long responses: `model.generateContentStream()`
5. **Batch requests** - Group multiple prompts when possible
6. **Monitor token usage** - Track `usageMetadata` in responses

## Singleton Pattern (Recommended)

```typescript
// src/connectors/gemini-text.ts
let cachedClient: GoogleGenerativeAI | null = null;

export async function getGeminiClient(): Promise<GoogleGenerativeAI> {
  if (!cachedClient) {
    const apiKey = await getGeminiApiKey();
    cachedClient = new GoogleGenerativeAI(apiKey);
  }
  return cachedClient;
}

// Usage
const client = await getGeminiClient();
const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
```

## Dependencies

```json
{
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "@google-cloud/secret-manager": "^5.6.0"
  }
}
```

## Testing

```typescript
// Mock for tests
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: { text: () => 'mocked response' }
      })
    })
  }))
}));
```

## Resources

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Node.js SDK Reference](https://github.com/google/generative-ai-js)
- Project docs: [`docs/B00-gemini-dev-api-intro.md`](B00-gemini-dev-api-intro.md)

---

**Key Takeaway**: Gemini Text API is perfect for AI-powered analysis, structured data extraction, web-grounded research, and intelligent content generation. Use `gemini-2.0-flash` for fast, cost-effective applications.

