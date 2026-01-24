const Influx = require('influx');
require('dotenv').config({ path: 'backend/.env' });

const influx = new Influx.InfluxDB({
    host: process.env.INFLUX_HOST || 'localhost',
    database: process.env.INFLUX_DATABASE || 'weather',
    schema: [
        {
            measurement: 'weather',
            fields: {
                temperature: Influx.FieldType.FLOAT,
                windSpeed: Influx.FieldType.FLOAT,
                humidity: Influx.FieldType.FLOAT,
                pressure: Influx.FieldType.FLOAT,
                weatherDesc: Influx.FieldType.STRING
            },
            tags: [
                'city',
                'province'
            ]
        }
    ]
});

async function debugNeimenggu() {
    const date = new Date();
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Neimenggu code: ANM
    const provinceCode = 'ANM';

    console.log(`Querying Neimenggu (ANM) from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);
    console.log(`Database: ${process.env.INFLUX_DATABASE || 'weather'}`);

    const query = `
    SELECT MAX(temperature) as max_temp, MIN(temperature) as min_temp
    FROM weather
    WHERE time >= '${startOfDay.toISOString()}' AND time <= '${endOfDay.toISOString()}' AND province = '${provinceCode}'
    GROUP BY city
  `;

    try {
        const results = await influx.query(query);
        console.log(`Found ${results.length} cities.`);

        // Sort by min_temp ascending to find the coldest
        results.sort((a, b) => a.min_temp - b.min_temp);

        console.log('Top 10 Coldest Cities (by Min Temp):');
        results.slice(0, 10).forEach(r => {
            console.log(`City: ${r.city} (${r.city}), Min: ${r.min_temp}, Max: ${r.max_temp}`);
        });

    } catch (err) {
        console.error(err);
    }
}

debugNeimenggu();
