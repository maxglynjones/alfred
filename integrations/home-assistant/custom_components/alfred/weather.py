"""Location-aware weather adapter; timestamps are absolute UTC instants.

The shared provider owns request deadlines/cache. This mixin keeps geocoding
and forecast normalization independent of OAuth/mail adapters.
"""

import time
from datetime import datetime, timezone
from urllib.parse import urlencode


class WeatherProvider:
    async def weather(self):
        c = self.r.config
        loc = (
            self.r.location
            if self.r.location and self.r.location["expires"] > time.monotonic()
            else None
        )
        city = c.get("weatherCity", "")
        if not loc and not city:
            return {"available": False, "configured": False}
        key = (city, str(loc))
        cached = self.cache.get(("weather", key))
        if cached and cached[0] > time.monotonic():
            return cached[1]
        try:
            if not loc:
                d = await self.r.http(
                    "GET",
                    "https://geocoding-api.open-meteo.com/v1/search?"
                    + urlencode({"name": city, "count": 20, "language": "en"}),
                    timeout=3,
                )
                rows = d.get("results", [])
                if not rows:
                    raise ValueError("Weather town not found.")
                qualifier = city.partition(",")[2].strip().casefold()
                country_alias = {
                    "england": "GB",
                    "uk": "GB",
                    "united kingdom": "GB",
                    "scotland": "GB",
                    "wales": "GB",
                    "northern ireland": "GB",
                    "usa": "US",
                    "us": "US",
                }
                if qualifier:
                    rows = [
                        x
                        for x in rows
                        if x.get("country_code", "").upper()
                        == country_alias.get(qualifier, qualifier.upper())
                        or qualifier
                        in [
                            str(x.get(k, "")).casefold()
                            for k in ("country", "admin1", "admin2")
                        ]
                    ]
                    if not rows:
                        raise ValueError(
                            "Weather town/region not found. Include the country in Profile."
                        )
                else:
                    zone = self.r.profile().get("timezone")
                    rows.sort(key=lambda x: x.get("timezone") != zone)
                loc = rows[0]
            d = await self.r.http(
                "GET",
                "https://api.open-meteo.com/v1/forecast?"
                + urlencode(
                    {
                        "latitude": loc["latitude"],
                        "longitude": loc["longitude"],
                        "current": "temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m",
                        "daily": "sunrise,sunset",
                        "timezone": "auto",
                        "timeformat": "unixtime",
                        "forecast_days": 1,
                    }
                ),
                timeout=3,
            )
            at = d["current"]
            code = at["weather_code"]
            description = (
                "Clear"
                if code == 0
                else (
                    "Partly cloudy"
                    if code <= 3
                    else (
                        "Fog"
                        if code <= 48
                        else (
                            "Rain"
                            if code <= 67
                            else (
                                "Snow"
                                if code <= 77
                                else "Showers" if code <= 86 else "Thunderstorms"
                            )
                        )
                    )
                )
            )
            result = {
                "available": True,
                "configured": True,
                "city": city if not self.r.location else "Nearby",
                "temperature": round(at["temperature_2m"]),
                "feels_like": round(at["apparent_temperature"]),
                "description": description,
                "weather_code": code,
                "is_day": bool(at["is_day"]),
                "humidity_percent": at["relative_humidity_2m"],
                "sunrise": datetime.fromtimestamp(
                    d["daily"]["sunrise"][0], timezone.utc
                ).isoformat(),
                "sunset": datetime.fromtimestamp(
                    d["daily"]["sunset"][0], timezone.utc
                ).isoformat(),
                "timezone": d["timezone"],
            }
            self.cache[("weather", key)] = (time.monotonic() + 600, result)
            return result
        except (ValueError, KeyError):
            return {
                "available": False,
                "configured": True,
                "city": city,
                "error": "Weather unavailable",
            }
