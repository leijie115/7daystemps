import { GoogleGenAI } from "@google/genai";
import { WeatherData } from "../types";

const initClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API_KEY is not set. Gemini features will be disabled.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const generateWeatherReport = async (
  regionName: string,
  data: WeatherData[]
): Promise<string> => {
  const ai = initClient();
  if (!ai) return "AI services unavailable. Please check your API key configuration.";

  // Summarize top 5 hottest and coldest for the prompt
  const sorted = [...data].sort((a, b) => b.temperature - a.temperature);
  const hottest = sorted.slice(0, 3).map(d => `${d.regionName}: ${d.temperature}°C`).join(', ');
  const coldest = sorted.slice(-3).map(d => `${d.regionName}: ${d.temperature}°C`).join(', ');

  const prompt = `
    Act as a professional weather anchor. 
    Analyze the current temperature data for ${regionName}.
    
    Data Highlights:
    - Hottest areas: ${hottest}
    - Coldest areas: ${coldest}
    - Average trends: Mixed conditions observed.

    Please provide a concise, engaging 3-sentence summary of the weather situation for this region, including a brief travel or health advisory based on the extremes.
    Do not use markdown formatting like **bold** or *italics*. Keep it plain text.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 } // Fast response needed
      }
    });

    return response.text || "No report generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Unable to generate AI report at this time.";
  }
};
