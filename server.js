require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Session Persistence ---
// Removed: Sessions are now managed client-side.


// --- Gemini Configuration ---
let genAI = null;
let model = null;
let summaryModel = null;

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

    // Define the tools
    const tools = [
        {
            functionDeclarations: [
                {
                    name: "searchFlights",
                    description: "Search for flights given an origin, destination, and date. Code must be IATA airport code.",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            origin: {
                                type: SchemaType.STRING,
                                description: "The IATA code of the origin airport (e.g., IST, SFO, LHR)."
                            },
                            destination: {
                                type: SchemaType.STRING,
                                description: "The IATA code of the destination airport (e.g., JFK, CDG, DXB)."
                            },
                            date: {
                                type: SchemaType.STRING,
                                description: "The departure date in YYYY-MM-DD format."
                            }
                        },
                        required: ["origin", "destination", "date"]
                    }
                },
                {
                    name: "searchHotelsByCity",
                    description: "Search for hotels in a specific city.",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            cityCode: {
                                type: SchemaType.STRING,
                                description: "The IATA city code (e.g., PAR, LON, NYC)."
                            }
                        },
                        required: ["cityCode"]
                    }
                },
                {
                    name: "getHotelOffers",
                    description: "Get offers for specific hotels. Use this after finding hotel IDs.",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            hotelIds: {
                                type: SchemaType.STRING,
                                description: "Comma-separated list of Amadeus hotel IDs (e.g., RTPAR001)."
                            },
                            adults: {
                                type: SchemaType.STRING,
                                description: "Number of adult guests (default 1)."
                            },
                            checkInDate: {
                                type: SchemaType.STRING,
                                description: "Check-in date in YYYY-MM-DD format."
                            },
                            checkOutDate: {
                                type: SchemaType.STRING,
                                description: "Check-out date in YYYY-MM-DD format."
                            }
                        },
                        required: ["hotelIds", "checkInDate", "checkOutDate"]
                    }
                },
                {
                    name: "bookHotel",
                    description: "Book a hotel offer. This is a simulation.",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            offerId: {
                                type: SchemaType.STRING,
                                description: "The offer ID to book."
                            },
                            guestName: {
                                type: SchemaType.STRING,
                                description: "Name of the guest."
                            },
                            guestEmail: {
                                type: SchemaType.STRING,
                                description: "Email of the guest."
                            },
                            guestPhone: {
                                type: SchemaType.STRING,
                                description: "Phone number of the guest."
                            }
                        },
                        required: ["offerId", "guestName", "guestEmail", "guestPhone"]
                    }
                },
                {
                    name: "getHotelSentiments",
                    description: "Get sentiment analysis/ratings for a hotel.",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            hotelIds: {
                                type: SchemaType.STRING,
                                description: "Comma-separated list of Amadeus hotel IDs."
                            }
                        },
                        required: ["hotelIds"]
                    }
                },
                {
                    name: "searchActivities",
                    description: "Search for tours and activities in a location.",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            latitude: {
                                type: SchemaType.NUMBER,
                                description: "Latitude of the location."
                            },
                            longitude: {
                                type: SchemaType.NUMBER,
                                description: "Longitude of the location."
                            }
                        },
                        required: ["latitude", "longitude"]
                    }
                }
            ]
        }
    ];

    model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        tools: tools,
        systemInstruction: {
            parts: [{
                text: `You are a smart, proactive, and efficient travel assistant.
            Your goal is to help users plan their trips by finding flights, hotels, and activities using the available tools.

            **Capabilities:**
            - **Flights:** Search for flights.
            - **Hotels:** Search for hotels by city, check offers.
            - **Activities:** Find things to do.
            - **Sentiments:** Check hotel reviews.

            **Key Behaviors:**
            1.  **Be Proactive & Assuming:** Do NOT constantly ask for every little detail if you can make a reasonable guess or if the user's intent is clear enough to start a search.
                -   *Example:* If user says "Flights to Paris next weekend", assume they mean from their likely location (if known) or ask for origin *once*. Assume 1 adult unless specified. Calculate the dates yourself.
                -   *Example:* If finding hotels, don't ask for price range immediately unless results are too broad. Just show the best/popular options.
            2.  **Location & Coordinates:**
                -   **NEVER ask the user for latitude and longitude.** If a tool requires coordinates (like \`searchActivities\`), use your internal knowledge to estimate the coordinates for the mentioned location (e.g., city center).
                -   **Contextual Location:** If the user mentions a location, ALWAYS use that location for subsequent queries unless explicitly told otherwise. Do not ask "Which city?" if it was just mentioned.
            3.  **Dates:**
                -   **NEVER ask the user for dates if they are not provided.** Automatically select reasonable future dates (e.g., next weekend, or 2 weeks from now) and inform the user of the dates you chose in your response. Do not ask for confirmation.
            4.  **Lean Context:** You will see summaries of previous search results in the context. Use these to answer follow-up questions without needing to search again, but don't regurgitate the full list.
            5.  **Efficient Responses:** Keep text responses concise. The UI handles showing the detailed cards.

            **Response Formatting:**
            - Use **Markdown** for text.
            - **DO NOT** output raw JSON blocks for data (flights/hotels/etc) in your text response. The system handles the visual cards.
            - **Comparisons:** If asked to compare, use the \`json-comparison\` block as follows:
              \`\`\`json-comparison
              {
                "title": "Comparison",
                "columns": ["Option", "Price", "Score"],
                "rows": [["A", "$100", "4.5"], ["B", "$90", "4.2"]],
                "recommendation": "Option A is better because..."
              }
              \`\`\`
            ` }]
        }
    });

    // Initialize summary model
    summaryModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

// Helper to summarize data for context
function summarizeForContext(type, data) {
    if (!data) return "";

    try {
        if (type === 'flights') {
            return data.slice(0, 5).map(f => {
                const it = f.itineraries[0];
                const seg = it.segments[0];
                return `${seg.departure.iataCode}->${it.segments[it.segments.length - 1].arrival.iataCode} | ${f.price.total} ${f.price.currency} | ${seg.carrierCode}`;
            }).join('\n') + (data.length > 5 ? `\n...and ${data.length - 5} more` : '');
        } else if (type === 'hotels') {
            return data.slice(0, 10).map(h => `${h.name} (ID: ${h.hotelId})`).join('\n') + (data.length > 10 ? `\n...and ${data.length - 10} more` : '');
        } else if (type === 'activities') {
            return data.slice(0, 5).map(a => `${a.name} - ${a.price ? a.price.amount + " " + a.price.currencyCode : "N/A"}`).join('\n') + (data.length > 5 ? `\n...and ${data.length - 5} more` : '');
        } else if (type === 'offers') {
            // Hotel offers can be complex, just capture price and hotel
            return data.data.slice(0, 5).map(o => `Hotel ${o.hotel.name}: ${o.offers[0].price.total} ${o.offers[0].price.currency}`).join('\n');
        }
    } catch (e) {
        return "Data available but summarization failed.";
    }
    return "Data results available.";
}

// Call initialization
initializeGemini();

// Helper to generate ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Helper to generate title (Stateless)
async function generateTitle(history) {
    if (!summaryModel || !history || history.length === 0) return null;

    try {
        // Only use the first few messages to generate a title to avoid long context
        const historyText = history.slice(0, 4).map(m => `${m.role}: ${m.content}`).join('\n');
        const prompt = `Summarize the following conversation into a very short, catchy title (max 4-5 words). Do not use quotes or "Title:". conversation:\n${historyText}`;

        const result = await summaryModel.generateContent(prompt);
        const title = result.response.text().trim();
        return title;
    } catch (e) {
        console.error("Title generation failed", e);
        return null;
    }
}

// Serve static files from public directory
app.use(express.static('public'));
app.use(express.json());

// --- Session Management Endpoints ---

// POST /api/generate-title
app.post('/api/generate-title', async (req, res) => {
    const { history } = req.body;
    if (!history) return res.status(400).json({ error: 'History is required' });

    const title = await generateTitle(history);
    res.json({ title });
});


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

// Tool Implementations
const functions = {
    searchFlights: async ({ origin, destination, date }) => {
        console.log(`Executing searchFlights: ${origin} -> ${destination} on ${date}`);
        try {
            const token = await getAccessToken();
            const response = await axios.get('https://test.api.amadeus.com/v2/shopping/flight-offers', {
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                params: {
                    originLocationCode: origin,
                    destinationLocationCode: destination,
                    departureDate: date,
                    adults: 1,
                    max: 15 // Increased from 5 to 15 per user request
                }
            });

            console.log('Amadeus API Response (Flights):', JSON.stringify(response.data, null, 2));
            return response.data;
        } catch (error) {
            console.error('Amadeus API Error (Flights):', error.response ? error.response.data : error.message);
            throw new Error('Failed to fetch flights from Amadeus.');
        }
    },

    searchHotelsByCity: async ({ cityCode }) => {
        console.log(`Executing searchHotelsByCity: ${cityCode}`);
        try {
            const token = await getAccessToken();
            const response = await axios.get('https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-city', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { cityCode: cityCode }
            });
            console.log(`Found ${response.data.data.length} hotels.`);
            // Limit to top 15 to prevent data bloating
            const limitedData = response.data.data.slice(0, 15);
            return { ...response.data, data: limitedData };
        } catch (error) {
            console.error('Amadeus API Error (Hotels):', error.response ? error.response.data : error.message);
            throw new Error('Failed to search hotels.');
        }
    },

    getHotelOffers: async ({ hotelIds, adults, checkInDate, checkOutDate }) => {
        console.log(`Executing getHotelOffers for ${hotelIds} on ${checkInDate}`);
        try {
            const token = await getAccessToken();
            const response = await axios.get('https://test.api.amadeus.com/v3/shopping/hotel-offers', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    hotelIds,
                    adults: adults || 1,
                    checkInDate,
                    checkOutDate
                }
            });
            console.log('Amadeus API Response (Offers):', JSON.stringify(response.data, null, 2));
            return response.data;
        } catch (error) {
            console.error('Amadeus API Error (Hotel Offers):', error.response ? error.response.data : error.message);
            throw new Error('Failed to fetch hotel offers.');
        }
    },

    bookHotel: async ({ offerId, guestName, guestEmail, guestPhone }) => {
        console.log(`Executing bookHotel for offer ${offerId}`);
        try {
            const token = await getAccessToken();
            // Constructing the booking payload with dummy payment info as required for sandbox
            const [firstName, lastName] = guestName.split(' ');

            const bookingPayload = {
                data: {
                    offerId: offerId,
                    guests: [{
                        name: {
                            title: "MR",
                            firstName: firstName ? firstName.toUpperCase() : "GUEST",
                            lastName: lastName ? lastName.toUpperCase() : "USER"
                        },
                        contact: {
                            phone: guestPhone || "+33679278416",
                            email: guestEmail || "guest@example.com"
                        }
                    }],
                    payments: [{
                        method: "creditCard",
                        card: {
                            vendorCode: "VI",
                            cardNumber: "4151289722471370", // Amadeus Test Card
                            expiryDate: "2026-12"
                        }
                    }]
                }
            };

            const response = await axios.post('https://test.api.amadeus.com/v1/booking/hotel-bookings', bookingPayload, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            console.log('Amadeus API Response (Booking):', JSON.stringify(response.data, null, 2));
            return response.data;
        } catch (error) {
            console.error('Amadeus API Error (Booking):', error.response ? error.response.data : error.message);
            throw new Error('Failed to book hotel.');
        }
    },

    getHotelSentiments: async ({ hotelIds }) => {
        console.log(`Executing getHotelSentiments for ${hotelIds}`);
        try {
            const token = await getAccessToken();
            const response = await axios.get('https://test.api.amadeus.com/v2/e-reputation/hotel-sentiments', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { hotelIds }
            });
            return response.data;
        } catch (error) {
            console.error('Amadeus API Error (Sentiments):', error.response ? error.response.data : error.message);
            // Sentiments might not be available for all test hotels
            return { message: "Sentiments not available for this hotel in test environment." };
        }
    },

    searchActivities: async ({ latitude, longitude }) => {
        console.log(`Executing searchActivities at ${latitude}, ${longitude}`);
        try {
            const token = await getAccessToken();
            const response = await axios.get('https://test.api.amadeus.com/v1/shopping/activities', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { latitude, longitude, radius: 1 }
            });
            // Amadeus response structure is { data: [...] }
            // Check if response.data.data exists and is an array
            const activities = response.data.data || [];
            const limitedData = activities.slice(0, 15);
            return { data: limitedData };
        } catch (error) {
            console.error('Amadeus API Error (Activities):', error.response ? error.response.data : error.message);
            throw new Error('Failed to fetch activities.');
        }
    }
};

// Chat Endpoint using Gemini with Tools
app.post('/api/chat', async (req, res) => {
    const { message, history } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    if (!model) {
        return res.status(503).json({ error: 'AI Model not initialized. Check server logs for API Key issues.' });
    }

    try {
        // Convert session history to Gemini format
        // history comes from client now
        const chatHistory = (history || []).map(msg => {
            let textContent = msg.content;
            // If the message had associated UI data (flights, hotels, etc.), inject a SUMMARY into the context
            // This keeps the context lean while letting the agent know what was shown.
            if (msg.data && msg.dataType) {
                const summary = summarizeForContext(msg.dataType, msg.data);
                textContent += `\n\n[System Context: User saw these ${msg.dataType} results:\n${summary}]`;
            }
            return {
                role: msg.role,
                parts: [{ text: textContent }]
            };
        });

        const chat = model.startChat({
            history: chatHistory
        });

        const currentDate = new Date().toISOString().split('T')[0];
        const userMessage = `[System: Current Date is ${currentDate}] ${message}`;

        let result = await chat.sendMessage(userMessage);
        let response = result.response;
        let uiData = null;
        let uiType = null;

        // Handle Function Calls
        while (response.functionCalls()) {
            const calls = response.functionCalls();
            const functionResponses = [];

            for (const call of calls) {
                const name = call.name;
                const args = call.args;

                if (functions[name]) {
                    try {
                        const apiResult = await functions[name](args);

                        // Capture data for UI rendering
                        if (name === 'searchFlights') {
                            uiData = apiResult.data;
                            uiType = 'flights';
                        } else if (name === 'searchActivities') {
                            uiData = apiResult.data;
                            uiType = 'activities';
                        } else if (name === 'searchHotelsByCity') {
                            uiData = apiResult.data;
                            uiType = 'hotels';
                        } else if (name === 'getHotelOffers') {
                            uiData = apiResult.data;
                            uiType = 'offers';
                        }

                        functionResponses.push({
                            functionResponse: {
                                name: name,
                                response: { name: name, content: apiResult }
                            }
                        });
                    } catch (err) {
                        functionResponses.push({
                            functionResponse: {
                                name: name,
                                response: { name: name, content: { error: err.message } }
                            }
                        });
                    }
                }
            }

            // Send function results back to the model
            result = await chat.sendMessage(functionResponses);
            response = result.response;
        }

        // Final text response from model
        const text = response.text();

        res.json({
            type: uiData ? 'results' : 'message',
            content: text,
            data: uiData,
            dataType: uiType
        });

    } catch (error) {
        console.error('Chat processing error:', error);
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
