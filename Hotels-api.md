const Amadeus = require("amadeus");

const amadeus = new Amadeus({
  clientId: "YOUR_API_KEY",
  clientSecret: "YOUR_API_SECRET",
});

async function main() {
  try {
    // Get list of available offers in specific hotels by hotel ids
    const response = await amadeus.shopping.hotelOffersSearch.get({
      hotelIds: "RTPAR001",
      adults: "2",
      checkInDate: "2023-10-10",
      checkOutDate: "2023-10-12",
    });

    console.log(response);
  } catch (error) {
    console.error(error);
  }
}

main();


const Amadeus = require("amadeus");
const amadeus = new Amadeus({
  clientId: "YOUR_API_KEY",
  clientSecret: "YOUR_API_SECRET",
});

async function main() {
  try {
    // Book a hotel in DEL for 2023-10-10 to 2023-10-12

    // 1. Hotel List API to get the list of hotels
    const hotelsList = await amadeus.referenceData.locations.hotels.byCity.get({
      cityCode: "LON",
    });

    // 2. Hotel Search API to get the price and offer id
    const pricingResponse = await amadeus.shopping.hotelOffersSearch.get({
      hotelIds: hotelsList.data[0].hotelId,
      adults: 1,
      checkInDate: "2023-10-10",
      checkOutDate: "2023-10-12",
    });

    // Finally, Hotel Booking API to book the offer
    const response = await amadeus.booking.hotelBookings.post({
      data: {
        offerId: pricingResponse.data[0].offers[0].id,
        guests: [
          {
            id: 1,
            name: {
              title: "MR",
              firstName: "BOB",
              lastName: "SMITH",
            },
            contact: {
              phone: "+33679278416",
              email: "bob.smith@email.com",
            },
          },
        ],
        payments: [
          {
            id: 1,
            method: "creditCard",
            card: {
              vendorCode: "VI",
              cardNumber: "4151289722471370",
              expiryDate: "2022-08",
            },
          },
        ],
      },
    });
    console.log(response);
  } catch (error) {
    console.error(error);
  }
}

main();


const Amadeus = require("amadeus");

const amadeus = new Amadeus({
  clientId: "YOUR_API_KEY",
  clientSecret: "YOUR_API_SECRET",
});

async function main() {
  try {
    // What travelers think about this hotel?
    const response = await amadeus.eReputation.hotelSentiments.get({
      hotelIds: "ADNYCCTB",
    });

    console.log(response);
  } catch (error) {
    console.error(error);
  }
}

main();

const Amadeus = require("amadeus");

const amadeus = new Amadeus({
  clientId: "YOUR_API_KEY",
  clientSecret: "YOUR_API_SECRET",
});

async function main() {
  try {
    // Returns activities for a location in Barcelona based on geolocation coordinates
    const response = await amadeus.shopping.activities.get({
      latitude: 41.397158,
      longitude: 2.160873,
    });

    console.log(response);
  } catch (error) {
    console.error(error);
  }
}

main();
