/** A customer-safe projection of one active Square pickup location. */
export interface StoreLocation {
  id: string;
  name: string;
  address: string;
  city: string | null;
  timezone: string | null;
  currency: string | null;
  phone: string | null;
  businessHours: StoreHoursPeriod[];
  coordinates: { latitude: number; longitude: number } | null;
}

export interface StoreHoursPeriod {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
}

export interface LocationSnapshot {
  id: string;
  name: string;
  address: string;
  city: string | null;
  phone: string | null;
  timezone: string | null;
  businessHours: StoreHoursPeriod[];
}
