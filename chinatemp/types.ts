export type Language = 'zh' | 'en';

export interface ForecastDay {
  date: string;
  dayName: string; // e.g. "周一"
  dayNameEn: string; // e.g. "Mon"
  high: number;
  low: number;
  condition: string;
  conditionEn: string;
}

export interface WeatherData {
  regionName: string;
  regionNameEn: string; // Added English Name
  adcode?: number; 
  temperature: number; 
  condition: string;
  conditionEn: string; // Added English Condition
  humidity: number;
  windSpeed: number;
  isProvince: boolean;
  forecast: ForecastDay[];
  children?: WeatherData[]; 
}

export enum ViewState {
  NATIONAL = 'NATIONAL',
  PROVINCIAL = 'PROVINCIAL'
}