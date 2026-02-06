const fs = require('fs');
const path = require('path');
const provinces = require('./provinces');

const searchIndex = [];

provinces.forEach(province => {
    // Add province
    searchIndex.push({
        name: province.name,
        en_name: province.en_name,
        type: 'province',
        url: `${province.en_name.toLowerCase()}.html`,
        display_zh: province.name,
        display_en: province.en_name
    });

    // Add cities
    if (province.cities) {
        province.cities.forEach(city => {
            searchIndex.push({
                name: city.name, // Usually short name like "朝阳"
                full_name: city.full_name, // "朝阳区"
                en_name: city.en_name,
                type: 'city',
                url: `${province.en_name.toLowerCase()}.html`, // Go to province page for now as per requirement
                parent_province: province.name,
                display_zh: `${city.name}, ${province.name}`,
                display_en: `${city.en_name}, ${province.en_name}`
            });
        });
    }
});

const outputPath = path.join(__dirname, 'website', 'search_index.json');
fs.writeFileSync(outputPath, JSON.stringify(searchIndex, null, 2));

console.log(`Search index generated with ${searchIndex.length} items at ${outputPath}`);
