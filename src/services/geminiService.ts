import { GoogleGenAI, Type } from "@google/genai";

export interface Act {
  id: string;
  name: string;
  stage: string;
  day: string;
  startTime: string;
  endTime: string;
  genres?: string[];
}

export interface Vote {
  act_id: string;
  user_id: string;
  color: string;
}

export const extractScheduleFromImage = async (base64Image: string): Promise<{ festivalName: string, acts: Act[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite-preview"
  ];

  let lastError: any;
  for (const modelName of models) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(",")[1] || base64Image,
            },
          },
          {
            text: "Extract the music festival schedule from this image. The image typically shows stages as columns and time on a vertical axis. Return a JSON object with 'festivalName' and an array 'acts'. Each act should have 'id' (unique string), 'name', 'stage', 'day', 'startTime' (24h format HH:mm), 'endTime' (24h format HH:mm), and 'genres' (an array of 1-3 genres the artist is known for). Note that times starting from 1:00 are usually PM (13:00) and can go past midnight (00:00, 01:00, etc.). If an end time is not explicitly listed, estimate it based on the act's vertical size or assume a 50-minute set. If the image is not a schedule, return an empty array of acts.",
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              festivalName: { type: Type.STRING },
              acts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    name: { type: Type.STRING },
                    stage: { type: Type.STRING },
                    day: { type: Type.STRING },
                    startTime: { type: Type.STRING },
                    endTime: { type: Type.STRING },
                    genres: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "1-3 genres the artist is known for",
                    },
                  },
                  required: ["id", "name", "stage", "day", "startTime", "endTime", "genres"],
                },
              },
            },
            required: ["festivalName", "acts"],
          },
        },
      });

      if (!response.text) {
        throw new Error("No text returned from model");
      }
      return JSON.parse(response.text);
    } catch (error: any) {
      console.warn(`Model ${modelName} failed:`, error);
      lastError = error;
      const errorMessage = error?.message?.toLowerCase() || '';
      const isThrottled = error?.status === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('too many requests') || errorMessage.includes('resource has been exhausted');
      
      if (isThrottled) {
        console.warn(`Model ${modelName} throttled, falling back...`);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
};

export type OptimizationStrategy = 'default' | 'quantity' | 'consensus' | 'variety';

export const optimizeSchedule = async (acts: Act[], votes: (Vote & { color: string })[], strategy: OptimizationStrategy = 'default'): Promise<string[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite-preview"
  ];
  
  let strategyPrompt = "First, prioritize acts that have received votes from the group. Then, maximize the number of acts the group can see together, prioritizing acts with more votes.";
  if (strategy === 'quantity') {
    strategyPrompt = "First, prioritize acts that have received votes from the group. Then, maximize the total number of acts that can be seen within the day. Resolve overlaps by picking shorter sets or more frequent transitions to fit as many unique artists as possible into the schedule.";
  } else if (strategy === 'consensus') {
    strategyPrompt = "First, prioritize acts that have received votes from the group. Then, maximize seeing the acts with the most consensus (acts where the highest percentage of the group voted for them).";
  } else if (strategy === 'variety') {
    strategyPrompt = "First, prioritize acts that have received votes from the group. Then, maximize the acts that collectively create the most varied range in music genres. Use your knowledge of the artists to determine their genres.";
  }

  let lastError: any;
  for (const modelName of models) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: `
          Given a list of music festival acts and group votes, generate an optimal schedule.
          ${strategyPrompt}
          Assume the group can only be at one act at a time.
          
          Acts: ${JSON.stringify(acts)}
          Votes (includes user color/id): ${JSON.stringify(votes)}
          
          Return a JSON array of act IDs that form the optimal schedule.
        `,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      });

      if (!response.text) {
        throw new Error("No text returned from model");
      }
      return JSON.parse(response.text);
    } catch (error: any) {
      console.warn(`Model ${modelName} failed:`, error);
      lastError = error;
      const errorMessage = error?.message?.toLowerCase() || '';
      const isThrottled = error?.status === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('too many requests') || errorMessage.includes('resource has been exhausted');
      
      if (isThrottled) {
        console.warn(`Model ${modelName} throttled, falling back...`);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
};
