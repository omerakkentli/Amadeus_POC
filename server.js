require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Gemini Configuration ---
let genAI = null;
let model = null;

// Initialize Gemini with Secret Manager or Env Var
async function initializeGemini() {
    let apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.log('GEMINI_API_KEY not found in env. Attempting to fetch from Secret Manager...');
        try {
            const client = new SecretManagerServiceClient();
            // Use configured project ID or default to current environment's project
            const projectId = process.env.GOOGLE_PROJECT_ID || 'glov-ecomai'; 
            const secretName = process.env.GEMINI_SECRET_NAME || 'chat-genai-token';
            const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

            console.log(`Fetching secret: ${name}`);
            const [version] = await client.accessSecretVersion({ name });
            apiKey = version.payload.data.toString();
            console.log('Successfully retrieved API key from Secret Manager.');
        } catch (error) {
            console.error('Failed to retrieve API key from Secret Manager:', error.message);
            console.error('Ensure you have authenticated with `gcloud auth application-default login` and the secret exists.');
        }
    }

    if (!apiKey) {
        console.error('CRITICAL ERROR: Could not initialize Gemini. No API key found.');
        return;
    }

    genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                    origin: { type: SchemaType.STRING, nullable: true },
                    destination: { type: SchemaType.STRING, nullable: true },
                    date: { type: SchemaType.STRING, nullable: true },
                    missing_info: { type: SchemaType.STRING, nullable: true }
                },
                required: ["origin", "destination", "date", "missing_info"]
            }
        }
    });
}

// Call initialization
initializeGemini();

// Serve static files from public directory
app.use(express.static('public'));
app.use(express.json());

let accessToken = null;
let tokenExpiry = null;

// Helper to get Amadeus Access Token
async function getAccessToken() {
    const currentTime = Date.now();
    
    if (accessToken && tokenExpiry && currentTime < tokenExpiry) {
        return accessToken;
    }

    try {
        const response = await axios.post('https://test.api.amadeus.com/v1/security/oauth2/token', 
            new URLSearchParams({
                'grant_type': 'client_credentials',
                'client_id': process.env.AMADEUS_CLIENT_ID,
                'client_secret': process.env.AMADEUS_CLIENT_SECRET
            }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        accessToken = response.data.access_token;
        // Set expiry a bit before actual expiry to be safe (expires_in is in seconds)
        tokenExpiry = currentTime + (response.data.expires_in * 1000) - 60000; 
        return accessToken;
    } catch (error) {
        console.error('Error fetching access token:', error.response ? error.response.data : error.message);
        throw new Error('Failed to authenticate with Amadeus API');
    }
}

// Search Endpoint (Inspiration Search)
app.get('/api/search', async (req, res) => {
    const { origin, maxPrice } = req.query;

    if (!origin) {
        return res.status(400).json({ error: 'Origin is required' });
    }

    try {
        const token = await getAccessToken();
        
        const response = await axios.get('https://test.api.amadeus.com/v1/shopping/flight-destinations', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            params: {
                origin: origin,
                maxPrice: maxPrice || undefined
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('API Request Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to fetch flight destinations', details: error.response ? error.response.data : error.message });
    }
});

// Chat Endpoint using Gemini
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    if (!model) {
        return res.status(503).json({ error: 'AI Model not initialized. Check server logs for API Key issues.' });
    }

    try {
        // 1. Interpret user intent with Gemini
        const currentDate = new Date().toISOString().split('T')[0];
        const prompt = `
            You are a flight search assistant. The current date is ${currentDate}.
            The user wants to search for flights.
            
            Extract the following parameters from the user's query:
            - origin: The IATA code of the origin airport (e.g., IST for Istanbul, SFO for San Francisco). Convert city names to their main airport's IATA code.
            - destination: The IATA code of the destination airport. Convert city names to their main airport's IATA code.
            - date: The departure date in YYYY-MM-DD format. Handle relative dates like "today", "tomorrow", "next Friday".

            User Query: "${message}"
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const searchParams = JSON.parse(responseText);

        console.log('Gemini extracted params:', searchParams);

        if (!searchParams.origin || !searchParams.destination || !searchParams.date) {
             return res.json({
                 type: 'message',
                 content: `I understood you want to go from ${searchParams.origin || '?'} to ${searchParams.destination || '?'} on ${searchParams.date || '?'}. Please provide the missing information.`
             });
        }

        // 2. Call Amadeus API
        const token = await getAccessToken();
        const amadeusResponse = await axios.get('https://test.api.amadeus.com/v2/shopping/flight-offers', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            params: {
                originLocationCode: searchParams.origin,
                destinationLocationCode: searchParams.destination,
                departureDate: searchParams.date,
                adults: 1,
                max: 5 // Limit results
            }
        });

        // 3. Return results
        res.json({
            type: 'results',
            params: searchParams,
            data: amadeusResponse.data.data
        });

    } catch (error) {
        console.error('Chat processing error:', error);
        
        let errorMessage = 'An error occurred while processing your request.';
        if (error.response && error.response.data && error.response.data.errors) {
             errorMessage = `Amadeus API Error: ${error.response.data.errors[0].detail}`;
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ error: errorMessage });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
