import { GoogleGenAI, Type } from "@google/genai";

export interface Act {
  id: string;
  name: string;
  stage: string;
  day: string;
  startTime: string;
  endTime: string;
}

export interface Vote {
  act_id: string;
  user_id: string;
  color: string;
}

export const extractScheduleFromImage = async (base64Image: string): Promise<{ festivalName: string, acts: Act[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image.split(",")[1] || base64Image,
        },
      },
      {
        text: "Extract the music festival schedule from this image. The image typically shows stages as columns and time on a vertical axis. Return a JSON object with 'festivalName' and an array 'acts'. Each act should have 'id' (unique string), 'name', 'stage', 'day', 'startTime' (24h format HH:mm), and 'endTime' (24h format HH:mm). Note that times starting from 1:00 are usually PM (13:00) and can go past midnight (00:00, 01:00, etc.). If an end time is not explicitly listed, estimate it based on the act's vertical size or assume a 50-minute set. If the image is not a schedule, return an empty array of acts.",
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
              },
              required: ["id", "name", "stage", "day", "startTime", "endTime"],
            },
          },
        },
        required: ["festivalName", "acts"],
      },
    },
  });

  const response = await model;
  return JSON.parse(response.text);
};

export const optimizeSchedule = async (acts: Act[], votes: (Vote & { color: string })[]): Promise<string[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `
      Given a list of music festival acts and group votes, generate an optimal schedule.
      The goal is to maximize the number of acts the group can see together, prioritizing acts with more votes.
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

  const response = await model;
  return JSON.parse(response.text);
};
